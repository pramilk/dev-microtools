import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  parsePackageSpec,
  parsePackageJsonDependencies,
  packageSearchQuery,
  isResolvableRange,
  maxSatisfying,
  latestPerMajor,
  measureBundleSize,
  compressionRatio,
  estimateDownloadSeconds,
  CONNECTION_SPEEDS,
  sortRows,
  type SortKey,
  type SortDirection,
  type SizeResult,
  type ModuleFormat,
  type EsmSupport,
} from '../lib/tools/bundleSize';
import {
  parseRepositoryUrl,
  readmeLinkBases,
  rewriteReadmeLinks,
  buildNpmPackageUrl,
  formatCompactNumber,
  formatRelativeTime,
  yearsSince,
  sparklinePoints,
  sumDownloads,
  type RepositoryRef,
  type DownloadDay,
} from '../lib/tools/packageInsights';
import { markdownToHtml } from '../lib/tools/markdownPreview';
import {
  fetchPackageOverview,
  fetchResolvedVersion,
  fetchWeeklyDownloads,
  fetchBundledSource,
  fetchRepoStats,
  fetchCommitActivity,
  fetchReadme,
  fetchDownloadTrend,
  searchPackages,
  runWithConcurrency,
  type PackageOverview,
  type ResolvedVersionInfo,
  type PackageSuggestion,
  type RepoStats,
  type CommitActivity,
} from '../lib/npmRegistry';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { FileDropzone } from './shared/FileDropzone';
import { formatBytes } from './shared/formatBytes';

type Mode = 'single' | 'bulk';

const PRESETS = ['react', 'lodash', 'date-fns', 'axios', 'zod'];

const BULK_EXAMPLE = JSON.stringify(
  {
    name: 'example-app',
    dependencies: { react: '^18.3.0', lodash: '^4.17.21', axios: '^1.7.0', dayjs: '^1.11.0', zod: '^3.23.0' },
  },
  null,
  2
);

const BULK_CONCURRENCY = 5;
const BREAKDOWN_CONCURRENCY = 4;
const MAJOR_HISTORY_CONCURRENCY = 3;
const MAJOR_HISTORY_LIMIT = 6;

/**
 * How long to wait after the last keystroke before checking a package on its own.
 * There is no "Check size" button any more — every complete choice runs itself — so this
 * is the one thing standing between a half-typed name and a real request to two public
 * services. It is deliberately longer than the 250ms search debounce: search is a cheap
 * registry lookup, a size check bundles and downloads an entire package.
 */
const AUTO_CHECK_DELAY_MS = 700;

/** package.json mode fans out one bundle fetch per dependency, so it waits longer still
 *  before deciding that a paste has settled. */
const AUTO_BULK_DELAY_MS = 900;

/** A README far past this is a manual (some packages publish their whole docs site as
 *  one file); rendering it would block the main thread for no real benefit. */
const MAX_README_BYTES = 400_000;

interface ShareState {
  mode: Mode;
  spec: string;
  namedImports: string;
  bulkDeps: { name: string; range: string }[];
}

interface SingleResult {
  name: string;
  resolvedVersion: string;
  info: ResolvedVersionInfo;
  size: SizeResult;
  /** Total published versions, from the same overview used to resolve the range. */
  versionCount: number;
  /** When anything was last published to this package, ISO-8601. */
  lastPublished: string | null;
}

interface BreakdownRow {
  name: string;
  gzipBytes: number | null;
  error: string | null;
}

interface MajorHistoryRow {
  major: number;
  version: string;
  size: SizeResult | null;
  error: string | null;
}

type RowStatus = 'pending' | 'running' | 'done' | 'error';

interface BulkRow {
  name: string;
  range: string;
  source: 'dependencies' | 'devDependencies';
  status: RowStatus;
  resolvedVersion: string | null;
  minifiedBytes: number | null;
  gzipBytes: number | null;
  license: string | null;
  error: string | null;
}

/** null range means "no version given" — resolves to the latest dist-tag. Falls back to
 *  null (caller treats as "unresolvable") if an explicit range matches nothing published. */
function resolveVersion(range: string | null, overview: PackageOverview): string | null {
  if (range === null || range === '') return overview.distTags.latest ?? overview.versions.at(-1) ?? null;
  if (overview.versions.includes(range)) return range;
  if (overview.distTags[range]) return overview.distTags[range];
  return maxSatisfying(overview.versions, range);
}

const sumBytes = (rows: BulkRow[], field: 'minifiedBytes' | 'gzipBytes'): number =>
  rows.reduce((sum, r) => sum + (r[field] ?? 0), 0);

/** Identifies one dependency set, so a paste that only reformats whitespace or reorders
 *  keys doesn't trigger a fresh round of network requests for the same packages. */
const dependencySignature = (deps: { name: string; range: string; source: string }[]): string =>
  deps
    .map((d) => `${d.source}:${d.name}@${d.range}`)
    .sort()
    .join('|');

/** Plain text, because it is used as a `title` tooltip and an `aria-label` — no markup
 *  survives either, so the code sample is written the way it would be typed. */
const NAMED_IMPORTS_HELP =
  `Leave empty to size the whole package. Fill it in to size only what you’d really import — entering "debounce" answers "how big is import { debounce } from 'lodash'?" rather than "how big is all of lodash?"`;

const MODULE_FORMAT_LABEL: Record<ModuleFormat, string> = {
  esm: 'ESM only',
  dual: 'ESM + CommonJS',
  cjs: 'CommonJS only',
  unknown: 'No entry point declared',
};

const MODULE_FORMAT_TONE: Record<ModuleFormat, string> = {
  esm: 'success',
  dual: 'success',
  cjs: 'warning',
  unknown: 'neutral',
};

const MODULE_FORMAT_TOOLTIP: Record<ModuleFormat, string> = {
  esm: 'Ships an ES module entry only — import/export, which a bundler can tree-shake.',
  dual: 'Ships both an ES module and a CommonJS entry, so it works in either world.',
  cjs: "Ships a CommonJS entry only (require/module.exports) — a bundler generally has to include all of it.",
  unknown: 'Declares neither a recognisable ESM nor CommonJS entry point in its package.json.',
};

type SideEffects = EsmSupport['sideEffects'];

/**
 * The three `sideEffects` states, each with one fixed colour. "Unspecified" is
 * deliberately neutral grey rather than a warning: a package that never added the field
 * has not told you it is dirty, it has told you nothing — which is a different, and much
 * more common, thing than declaring side effects.
 */
const SIDE_EFFECTS_LABEL: Record<SideEffects, string> = {
  free: 'side-effect free',
  'has-side-effects': 'has side effects',
  unspecified: 'sideEffects unspecified',
};

const SIDE_EFFECTS_TONE: Record<SideEffects, string> = {
  free: 'success',
  'has-side-effects': 'warning',
  unspecified: 'neutral',
};

const SIDE_EFFECTS_TOOLTIP: Record<SideEffects, string> = {
  free: 'Declares "sideEffects": false — a bundler may drop any module you import but never use.',
  'has-side-effects': 'Declares side effects, so a bundler keeps those modules even when nothing appears to use them.',
  unspecified: 'No sideEffects field at all — not a claim either way, so bundlers tree-shake conservatively.',
};

interface DependencyTableProps {
  title: string;
  rows: BulkRow[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  onToggleSort: (key: SortKey) => void;
  /** Opens one dependency on its own in single-package mode. Passed in rather than
   *  imported so the table stays a presentation component that knows nothing about how a
   *  check is actually run. */
  onInspect: (name: string, version: string | null) => void;
}

/** One dependencies/devDependencies table with its own total — factored out because bulk
 *  mode renders this twice (once per `source`) so the two never mix into one list or total. */
function DependencyTable({ title, rows, sortKey, sortDirection, onToggleSort, onInspect }: DependencyTableProps) {
  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDirection === 'asc' ? '▲' : '▼') : '');

  return (
    <div class="field">
      <div class="field__label">
        <span>
          {title} ({rows.length})
        </span>
      </div>
      <div class="bsc-table-wrap">
        <table class="bsc-table">
          <thead>
            <tr>
              <th>
                <button type="button" class="bsc-sort" onClick={() => onToggleSort('name')}>
                  Package {sortIndicator('name')}
                </button>
              </th>
              <th>Requested</th>
              <th>Resolved</th>
              <th>
                <button type="button" class="bsc-sort" onClick={() => onToggleSort('minified')}>
                  Minified {sortIndicator('minified')}
                </button>
              </th>
              <th>
                <button type="button" class="bsc-sort" onClick={() => onToggleSort('gzip')}>
                  Gzipped {sortIndicator('gzip')}
                </button>
              </th>
              <th>License</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  <button
                    type="button"
                    class="bsc-inspect"
                    // Prefer the version this table actually resolved; before that lands,
                    // fall back to the range the project asked for so the drill-in still
                    // answers the same question the row does. A workspace/git/file range
                    // can't be resolved against the registry at all, so that becomes
                    // "whatever is latest" rather than a spec guaranteed to fail.
                    onClick={() => onInspect(r.name, r.resolvedVersion ?? (isResolvableRange(r.range) ? r.range : null))}
                    title={`Open ${r.name}${r.resolvedVersion ? `@${r.resolvedVersion}` : ''} on its own — README, project health and version history`}
                  >
                    {r.name}
                  </button>
                </td>
                <td class="tnum">{r.range}</td>
                <td class="tnum">{r.resolvedVersion ?? '—'}</td>
                <td class="tnum">{r.minifiedBytes !== null ? formatBytes(r.minifiedBytes) : '—'}</td>
                <td class="tnum">{r.gzipBytes !== null ? formatBytes(r.gzipBytes) : '—'}</td>
                <td>{r.license ?? '—'}</td>
                <td>
                  {r.status === 'error' ? (
                    <span class="badge badge--warning" title={r.error ?? ''}>
                      error
                    </span>
                  ) : r.status === 'done' ? (
                    <span class="badge badge--success">ok</span>
                  ) : r.status === 'running' ? (
                    'checking…'
                  ) : (
                    'pending'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <strong>Total</strong>
              </td>
              <td class="tnum">
                <strong>{formatBytes(sumBytes(rows, 'minifiedBytes'))}</strong>
              </td>
              <td class="tnum">
                <strong>{formatBytes(sumBytes(rows, 'gzipBytes'))}</strong>
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  /** Full-precision or explanatory text for the hover — the tile itself stays compact. */
  title?: string;
  href?: string;
}

/** One number in the project-health row. A tile with a `href` links straight to the page
 *  on the host that owns that number, so every figure shown is checkable at its source. */
function Stat({ label, value, title, href }: StatProps) {
  const body = (
    <>
      <span class="bsc-stat__value tnum">{value}</span>
      <span class="bsc-stat__label">{label}</span>
    </>
  );
  return href ? (
    <a class="bsc-stat bsc-stat--link" href={href} title={title} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <div class="bsc-stat" title={title}>
      {body}
    </div>
  );
}

/** Renders one Markdown table (with its own total row) for a dependencies/devDependencies group. */
function rowsAsMarkdownTable(title: string, rows: BulkRow[]): string {
  const header = `**${title}**\n\n| Package | Requested | Resolved | Minified | Gzipped | License | Status |\n|---|---|---|---|---|---|---|`;
  const lines = rows.map((r) => {
    const statusText = r.status === 'error' ? `Error: ${r.error ?? 'unknown'}` : r.status === 'done' ? 'OK' : r.status;
    return `| ${r.name} | ${r.range} | ${r.resolvedVersion ?? '—'} | ${r.minifiedBytes !== null ? formatBytes(r.minifiedBytes) : '—'} | ${r.gzipBytes !== null ? formatBytes(r.gzipBytes) : '—'} | ${r.license ?? '—'} | ${statusText} |`;
  });
  const total = `| **Total** |  |  | **${formatBytes(sumBytes(rows, 'minifiedBytes'))}** | **${formatBytes(sumBytes(rows, 'gzipBytes'))}** |  |  |`;
  return [header, ...lines, total].join('\n');
}

export default function BundleSizeChecker() {
  const [mode, setMode] = useState<Mode>('single');
  const toolRef = useRef<HTMLDivElement | null>(null);

  // ---------------------------------------------------------------- single-package mode
  const [spec, setSpec] = useState('');
  const [namedImports, setNamedImports] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SingleResult | null>(null);
  const [downloads, setDownloads] = useState<number | null>(null);

  const [repo, setRepo] = useState<RepositoryRef | null>(null);
  const [repoStats, setRepoStats] = useState<RepoStats | null>(null);
  const [commits, setCommits] = useState<CommitActivity | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [trend, setTrend] = useState<DownloadDay[]>([]);

  const [readmeMarkdown, setReadmeMarkdown] = useState<string | null>(null);
  const [readmeHtml, setReadmeHtml] = useState<string | null>(null);
  const [readmeStatus, setReadmeStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const readmeRef = useRef<HTMLDivElement | null>(null);

  const [breakdownStatus, setBreakdownStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);

  const [compareSpec, setCompareSpec] = useState('');
  const [compareStatus, setCompareStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [compareResult, setCompareResult] = useState<{ version: string; size: SizeResult } | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const [majorHistoryStatus, setMajorHistoryStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [majorHistoryRows, setMajorHistoryRows] = useState<MajorHistoryRow[]>([]);

  const [suggestions, setSuggestions] = useState<PackageSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const searchAbortRef = useRef<AbortController | null>(null);

  /**
   * Incremented on every check. Because checks now start on their own — a preset, a
   * suggestion, a settled keystroke — two can easily overlap, and without this the
   * slower one would overwrite the newer one's results. Every async continuation compares
   * the token it captured against the current one and drops its result if they differ.
   */
  const runTokenRef = useRef(0);
  /** The spec+imports combination most recently *started*, so the auto-check effect never
   *  re-runs a check the user already got an answer for. */
  const lastRunKeyRef = useRef<string | null>(null);

  // ------------------------------------------------------------------------- bulk mode
  const [packageJsonText, setPackageJsonText] = useState('');
  const [includeDev, setIncludeDev] = useState(false);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [bulkStatus, setBulkStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [sortKey, setSortKey] = useState<SortKey>('gzip');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const abortRef = useRef<AbortController | null>(null);
  const lastBulkSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    // A plain `?q=lodash` deep link, so the tool can be reached straight from a bookmark,
    // a browser search keyword, or a link in a chat — no encoded share payload needed.
    // Checked before the share fragment because it is the more explicit request of the two.
    const query = new URLSearchParams(window.location.search).get('q');
    if (query && query.trim() !== '') {
      setMode('single');
      setSpec(query.trim());
      void checkSize(query.trim());
      return;
    }

    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setMode(state.mode);
      setSpec(state.spec);
      setNamedImports(state.namedImports);
      if (state.bulkDeps.length > 0) {
        const text = JSON.stringify(
          { dependencies: Object.fromEntries(state.bulkDeps.map((d) => [d.name, d.range])) },
          null,
          2
        );
        setPackageJsonText(text);
        void runBulkCheck(text, false);
      } else if (state.spec.trim() !== '') {
        void checkSize(state.spec, state.namedImports);
      }
      history.replaceState(null, '', window.location.pathname);
    });
    // Runs once on mount; `checkSize`/`runBulkCheck` are stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced package-name search, so a dropdown of matching packages appears as you
  // type — searches only the name portion (see `packageSearchQuery`), so adding
  // "@version" after picking one doesn't keep re-querying.
  useEffect(() => {
    if (mode !== 'single') return;
    const query = packageSearchQuery(spec);
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      void searchPackages(query, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setSuggestions(result.value);
          setHighlightIndex(-1);
        }
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [spec, mode]);

  /**
   * Checks a package on its own once typing settles — the reason there is no "Check size"
   * button any more.
   *
   * The gate is that the typed name must appear in the suggestions already fetched for
   * it. Those cost one cheap registry search that happens regardless, and they are proof
   * the package actually exists, so a half-typed "reac" or a typo never fires a real
   * bundle request at esm.sh and never flashes a "no such package" error at someone who
   * is still typing. Pressing Enter bypasses this deliberately: an explicit submit
   * deserves a real error message when the name is wrong.
   */
  useEffect(() => {
    if (mode !== 'single') return;
    const parsed = parsePackageSpec(spec);
    if (!parsed.ok) return;
    if (`${spec.trim()}|${namedImports.trim()}` === lastRunKeyRef.current) return;
    if (!suggestions.some((s) => s.name === parsed.value.name)) return;

    const timer = window.setTimeout(() => void checkSize(), AUTO_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [spec, namedImports, suggestions, mode]);

  /**
   * The package.json equivalent: a paste or an edit that parses into a dependency set
   * different from the one already on screen checks itself. Keyed on the dependency
   * signature rather than the raw text so reformatting, reordering or editing an
   * unrelated field (`name`, `scripts`) never re-fetches the same packages.
   */
  useEffect(() => {
    if (mode !== 'bulk') return;
    if (packageJsonText.trim() === '') return;
    const parsed = parsePackageJsonDependencies(packageJsonText, includeDev);
    if (!parsed.ok) {
      // An error is worth showing once the text has settled, but not while it is a
      // half-finished paste — so it waits for the same debounce a successful parse does.
      const errorTimer = window.setTimeout(() => {
        setBulkError(parsed.error);
        setBulkStatus('error');
      }, AUTO_BULK_DELAY_MS);
      return () => window.clearTimeout(errorTimer);
    }
    if (dependencySignature(parsed.value) === lastBulkSignatureRef.current) return;

    const timer = window.setTimeout(() => void runBulkCheck(), AUTO_BULK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [packageJsonText, includeDev, mode]);

  const selectSuggestion = (suggestion: PackageSuggestion) => {
    setSpec(suggestion.name);
    setSuggestions([]);
    setSuggestionsOpen(false);
    setHighlightIndex(-1);
    // Picking a suggestion is a complete choice, not a partial edit — check it right away
    // rather than waiting out the auto-check debounce for something already decided.
    void checkSize(suggestion.name);
  };

  const selectPreset = (preset: string) => {
    setSpec(preset);
    setSuggestionsOpen(false);
    // Same reasoning as a suggestion: clicking a named package is the whole request.
    void checkSize(preset);
  };

  // ------------------------------------------------------------------ single: check size

  /** `overrideSpec` lets a caller (a preset chip, a suggestion, a `?q=` link) check a
   *  package immediately without waiting for the `spec` state update to land — reading
   *  `spec` here would still see the *previous* value in that same tick. */
  const checkSize = async (overrideSpec?: string, overrideImports?: string) => {
    const effectiveSpec = overrideSpec ?? spec;
    const effectiveImports = overrideImports ?? namedImports;
    lastRunKeyRef.current = `${effectiveSpec.trim()}|${effectiveImports.trim()}`;

    const token = (runTokenRef.current += 1);
    const isStale = () => runTokenRef.current !== token;

    const parsed = parsePackageSpec(effectiveSpec);
    if (!parsed.ok) {
      setError(parsed.error);
      setStatus('error');
      return;
    }

    setStatus('loading');
    setError(null);
    setResult(null);
    setDownloads(null);
    setRepo(null);
    setRepoStats(null);
    setCommits(null);
    setRepoError(null);
    setTrend([]);
    setReadmeMarkdown(null);
    setReadmeHtml(null);
    setReadmeError(null);
    setReadmeStatus('idle');
    setBreakdown([]);
    setBreakdownStatus('idle');
    setCompareResult(null);
    setCompareStatus('idle');
    setCompareError(null);
    setMajorHistoryStatus('idle');
    setMajorHistoryRows([]);

    const { name, range } = parsed.value;

    const overview = await fetchPackageOverview(name);
    if (isStale()) return;
    if (!overview.ok) {
      setError(overview.error);
      setStatus('error');
      return;
    }

    const resolvedVersion = resolveVersion(range, overview.value);
    if (!resolvedVersion) {
      setError(`Could not resolve a published version of "${name}" matching "${range}".`);
      setStatus('error');
      return;
    }

    const versionInfo = await fetchResolvedVersion(name, resolvedVersion);
    if (isStale()) return;
    if (!versionInfo.ok) {
      setError(versionInfo.error);
      setStatus('error');
      return;
    }

    const exportNames = effectiveImports
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const source = await fetchBundledSource(name, resolvedVersion, exportNames);
    if (isStale()) return;
    if (!source.ok) {
      setError(source.error);
      setStatus('error');
      return;
    }

    const size = await measureBundleSize(source.value);
    if (isStale()) return;
    if (!size.ok) {
      setError(size.error);
      setStatus('error');
      return;
    }

    setResult({
      name,
      resolvedVersion,
      info: versionInfo.value,
      size: size.value,
      versionCount: overview.value.versions.length,
      lastPublished: overview.value.modified,
    });
    setStatus('done');

    void fetchWeeklyDownloads(name).then((d) => {
      if (!isStale() && d.ok) setDownloads(d.value);
    });
    void fetchDownloadTrend(name).then((d) => {
      if (!isStale() && d.ok) setTrend(d.value);
    });
    // Everything below is supplementary: it takes explicit arguments instead of reading
    // the `result` state, which has not landed yet in this same tick, and every one of
    // them is best-effort — a failure enriches nothing but breaks nothing either.
    void loadRepositoryInsights(versionInfo.value, token);
    void loadReadme(name, resolvedVersion, versionInfo.value, token);
    void loadMajorHistory(name, resolvedVersion, size.value, exportNames, token);
  };

  /** Stars, forks, issues, commits and dates for whatever repository the package points
   *  at. Only GitHub is queried — it is the only host with a public, CORS-enabled, no-key
   *  API — so a GitLab or Bitbucket package still gets its repository *link*, just no stats. */
  const loadRepositoryInsights = async (info: ResolvedVersionInfo, token: number) => {
    const ref = info.repository ? parseRepositoryUrl(info.repository, info.repositoryDirectory) : null;
    if (runTokenRef.current !== token) return;
    setRepo(ref);
    if (!ref || ref.host !== 'github' || !ref.owner || !ref.repo) return;

    const [stats, activity] = await Promise.all([
      fetchRepoStats(ref.owner, ref.repo),
      fetchCommitActivity(ref.owner, ref.repo),
    ]);
    if (runTokenRef.current !== token) return;

    if (stats.ok) setRepoStats(stats.value);
    if (activity.ok) setCommits(activity.value);
    // One shared message: both calls hit the same API and fail for the same reasons
    // (rate limit, network, a repository that has since been deleted or made private).
    if (!stats.ok) setRepoError(stats.error);
    else if (!activity.ok) setRepoError(activity.error);
  };

  const loadReadme = async (name: string, version: string, info: ResolvedVersionInfo, token: number) => {
    setReadmeStatus('loading');
    const raw = await fetchReadme(name, version);
    if (runTokenRef.current !== token) return;
    if (!raw.ok) {
      setReadmeError(raw.error);
      setReadmeStatus('error');
      return;
    }
    if (raw.value.length > MAX_README_BYTES) {
      setReadmeError(
        `This README is ${formatBytes(raw.value.length)} — too large to render here. Read it on npm or in the repository instead.`
      );
      setReadmeStatus('error');
      return;
    }

    const ref = info.repository ? parseRepositoryUrl(info.repository, info.repositoryDirectory) : null;
    const resolved = rewriteReadmeLinks(raw.value, readmeLinkBases(ref, name, version));
    const html = await markdownToHtml(resolved);
    if (runTokenRef.current !== token) return;
    if (!html.ok) {
      setReadmeError(html.error);
      setReadmeStatus('error');
      return;
    }
    setReadmeMarkdown(raw.value);
    setReadmeHtml(html.value);
    setReadmeStatus('done');
  };

  /**
   * The rendered README is sanitized Markdown from a third party, so its links are
   * retargeted here rather than trusted as written: every anchor opens in a new tab with
   * `rel="noopener noreferrer"` (it must not be able to reach back into this page), and
   * every image loads lazily, since a README can carry dozens of badges.
   */
  useEffect(() => {
    const container = readmeRef.current;
    if (!container || readmeHtml === null) return;
    for (const anchor of container.querySelectorAll('a')) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    for (const image of container.querySelectorAll('img')) {
      image.loading = 'lazy';
      image.decoding = 'async';
    }
  }, [readmeHtml]);

  const loadDependencyBreakdown = async () => {
    if (!result) return;
    const depNames = Object.keys(result.info.dependencies);
    if (depNames.length === 0) {
      setBreakdown([]);
      setBreakdownStatus('done');
      return;
    }
    setBreakdownStatus('loading');
    const measured = await runWithConcurrency(depNames, BREAKDOWN_CONCURRENCY, async (depName): Promise<BreakdownRow> => {
      const depOverview = await fetchPackageOverview(depName);
      if (!depOverview.ok) return { name: depName, gzipBytes: null, error: depOverview.error };
      const version = resolveVersion(null, depOverview.value);
      if (!version) return { name: depName, gzipBytes: null, error: 'No published version.' };
      const source = await fetchBundledSource(depName, version);
      if (!source.ok) return { name: depName, gzipBytes: null, error: source.error };
      const size = await measureBundleSize(source.value);
      if (!size.ok) return { name: depName, gzipBytes: null, error: size.error };
      return { name: depName, gzipBytes: size.value.gzipBytes, error: null };
    });
    setBreakdown(measured);
    setBreakdownStatus('done');
  };

  /** Takes the just-checked package explicitly rather than reading `result` state, since
   *  it is called from `checkSize` right after `setResult` — before that state update has
   *  actually landed, a stale read would still see the *previous* check's package. */
  const loadMajorHistory = async (
    name: string,
    resolvedVersion: string,
    currentSize: SizeResult,
    exportNames: string[],
    token: number
  ) => {
    setMajorHistoryStatus('loading');

    const overview = await fetchPackageOverview(name);
    if (runTokenRef.current !== token) return;
    if (!overview.ok) {
      setMajorHistoryRows([{ major: 0, version: '', size: null, error: overview.error }]);
      setMajorHistoryStatus('done');
      return;
    }

    const candidates = latestPerMajor(overview.value.versions, MAJOR_HISTORY_LIMIT);

    const measured = await runWithConcurrency(candidates, MAJOR_HISTORY_CONCURRENCY, async (version): Promise<MajorHistoryRow> => {
      const major = parseInt(version, 10);
      // The version already checked above needn't be fetched again — reuse its result.
      if (version === resolvedVersion) return { major, version, size: currentSize, error: null };

      const source = await fetchBundledSource(name, version, exportNames);
      if (!source.ok) return { major, version, size: null, error: source.error };
      const size = await measureBundleSize(source.value);
      if (!size.ok) return { major, version, size: null, error: size.error };
      return { major, version, size: size.value, error: null };
    });
    if (runTokenRef.current !== token) return;

    measured.sort((a, b) => b.major - a.major);
    setMajorHistoryRows(measured);
    setMajorHistoryStatus('done');
  };

  const runCompare = async () => {
    if (!result || compareSpec.trim() === '') return;
    setCompareStatus('loading');
    setCompareError(null);
    setCompareResult(null);

    const overview = await fetchPackageOverview(result.name);
    if (!overview.ok) {
      setCompareError(overview.error);
      setCompareStatus('error');
      return;
    }
    const version = resolveVersion(compareSpec.trim(), overview.value);
    if (!version) {
      setCompareError(`Could not resolve a version of "${result.name}" matching "${compareSpec}".`);
      setCompareStatus('error');
      return;
    }
    const exportNames = namedImports
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const source = await fetchBundledSource(result.name, version, exportNames);
    if (!source.ok) {
      setCompareError(source.error);
      setCompareStatus('error');
      return;
    }
    const size = await measureBundleSize(source.value);
    if (!size.ok) {
      setCompareError(size.error);
      setCompareStatus('error');
      return;
    }
    setCompareResult({ version, size: size.value });
    setCompareStatus('done');
  };

  const clearSingle = () => {
    // Bumping the token abandons anything still in flight, so a check started a moment
    // ago can't repopulate the panel the user just cleared.
    runTokenRef.current += 1;
    lastRunKeyRef.current = null;
    setSpec('');
    setNamedImports('');
    setSuggestions([]);
    setSuggestionsOpen(false);
    setHighlightIndex(-1);
    setStatus('idle');
    setError(null);
    setResult(null);
    setDownloads(null);
    setRepo(null);
    setRepoStats(null);
    setCommits(null);
    setRepoError(null);
    setTrend([]);
    setReadmeMarkdown(null);
    setReadmeHtml(null);
    setReadmeError(null);
    setReadmeStatus('idle');
    setBreakdown([]);
    setBreakdownStatus('idle');
    setCompareSpec('');
    setCompareResult(null);
    setCompareStatus('idle');
    setCompareError(null);
    setMajorHistoryStatus('idle');
    setMajorHistoryRows([]);
  };

  // ------------------------------------------------------------------------- bulk: run

  const updateRow = (index: number, patch: Partial<BulkRow>) => {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  /** `overrideText`/`overrideIncludeDev` exist for the same reason `checkSize`'s override
   *  does: a dropped file or a restored share link sets the textarea and needs the check
   *  to run against that content in the same tick, before the state update lands. */
  const runBulkCheck = async (overrideText?: string, overrideIncludeDev?: boolean) => {
    const text = overrideText ?? packageJsonText;
    const withDev = overrideIncludeDev ?? includeDev;

    const parsed = parsePackageJsonDependencies(text, withDev);
    if (!parsed.ok) {
      setBulkError(parsed.error);
      setBulkStatus('error');
      setRows([]);
      lastBulkSignatureRef.current = null;
      return;
    }
    lastBulkSignatureRef.current = dependencySignature(parsed.value);

    // A run already under way is for an older dependency list — stop it rather than
    // letting two sets of results write into the same table.
    abortRef.current?.abort();

    const initialRows: BulkRow[] = parsed.value.map((d) => {
      const resolvable = isResolvableRange(d.range);
      return {
        name: d.name,
        range: d.range,
        source: d.source,
        status: resolvable ? 'pending' : 'error',
        resolvedVersion: null,
        minifiedBytes: null,
        gzipBytes: null,
        license: null,
        error: resolvable
          ? null
          : `"${d.range}" isn't a registry version range — workspace/git/file/URL dependencies can't be resolved here.`,
      };
    });
    setRows(initialRows);
    setBulkError(null);
    setBulkStatus('running');

    const resolvableIndices = initialRows.map((_, i) => i).filter((i) => initialRows[i]!.status === 'pending');
    setProgress({ done: 0, total: resolvableIndices.length });

    const controller = new AbortController();
    abortRef.current = controller;

    await runWithConcurrency(
      resolvableIndices,
      BULK_CONCURRENCY,
      async (rowIndex) => {
        const row = initialRows[rowIndex]!;
        updateRow(rowIndex, { status: 'running' });

        const overview = await fetchPackageOverview(row.name);
        if (!overview.ok) {
          updateRow(rowIndex, { status: 'error', error: overview.error });
          return;
        }
        const version = resolveVersion(row.range, overview.value);
        if (!version) {
          updateRow(rowIndex, { status: 'error', error: `Could not resolve a version matching "${row.range}".` });
          return;
        }
        const [versionInfo, source] = await Promise.all([
          fetchResolvedVersion(row.name, version),
          fetchBundledSource(row.name, version),
        ]);
        if (!source.ok) {
          updateRow(rowIndex, { status: 'error', resolvedVersion: version, error: source.error });
          return;
        }
        const size = await measureBundleSize(source.value);
        if (!size.ok) {
          updateRow(rowIndex, { status: 'error', resolvedVersion: version, error: size.error });
          return;
        }
        updateRow(rowIndex, {
          status: 'done',
          resolvedVersion: version,
          minifiedBytes: size.value.minifiedBytes,
          gzipBytes: size.value.gzipBytes,
          license: versionInfo.ok ? versionInfo.value.license : null,
          error: null,
        });
      },
      (done, total) => setProgress({ done, total }),
      controller.signal
    );

    // A newer run has already taken over the table — leave its state alone.
    if (abortRef.current !== controller) return;
    abortRef.current = null;
    if (controller.signal.aborted) {
      setRows((current) =>
        current.map((r) => (r.status === 'pending' || r.status === 'running' ? { ...r, status: 'error', error: 'Cancelled.' } : r))
      );
    }
    setBulkStatus('done');
  };

  const cancelBulk = () => {
    // Cancelling means "stop and leave it alone", so the signature is cleared too —
    // otherwise the auto-check effect would consider this list already handled and never
    // offer to finish it, even after an edit and an undo brought back the same text.
    lastBulkSignatureRef.current = null;
    abortRef.current?.abort();
  };

  const clearBulk = () => {
    abortRef.current?.abort();
    lastBulkSignatureRef.current = null;
    setPackageJsonText('');
    setIncludeDev(false);
    setRows([]);
    setBulkStatus('idle');
    setBulkError(null);
    setProgress({ done: 0, total: 0 });
  };

  const sortedRows = useMemo(() => sortRows(rows, sortKey, sortDirection), [rows, sortKey, sortDirection]);
  // Kept as two separate groups end-to-end — devDependencies never mix into the same
  // table or total as regular dependencies, since they answer a different question
  // (what ships to users vs. what's only needed to build/test the project).
  const dependencyRows = useMemo(() => sortedRows.filter((r) => r.source === 'dependencies'), [sortedRows]);
  const devDependencyRows = useMemo(() => sortedRows.filter((r) => r.source === 'devDependencies'), [sortedRows]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'name' ? 'asc' : 'desc');
    }
  };

  const bulkTableAsMarkdown = (): string => {
    const sections = [rowsAsMarkdownTable('Dependencies', dependencyRows)];
    if (devDependencyRows.length > 0) sections.push(rowsAsMarkdownTable('Dev Dependencies', devDependencyRows));
    return sections.join('\n\n');
  };

  const summaryText = result
    ? `${result.name}@${result.resolvedVersion} — ${formatBytes(result.size.minifiedBytes)} minified · ${formatBytes(result.size.gzipBytes)} gzipped`
    : '';

  const commitCount = commits?.totalCommits ?? null;
  const monthlyDownloads = trend.length > 0 ? sumDownloads(trend) : null;
  const sparkline = sparklinePoints(trend, 240, 40);

  /**
   * Opens one dependency as a full single-package result. Bulk mode's own state is left
   * untouched, so the "package.json" tab still holds the table and totals it had — this
   * is a detour into one row, not a reset.
   */
  const inspectPackage = (name: string, version: string | null) => {
    const target = version ? `${name}@${version}` : name;
    setMode('single');
    setSpec(target);
    setNamedImports('');
    setSuggestions([]);
    setSuggestionsOpen(false);
    void checkSize(target, '');
    // The panel below has just been replaced wholesale; without this the reader is left
    // looking at whatever was at their scroll position in the old one. Optional-called
    // because scrolling is a nicety, not correctness — an environment without
    // `scrollIntoView` (jsdom, for one) must not break the drill-in itself.
    toolRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const shareState = (): ShareState => {
    if (mode === 'bulk') {
      const parsed = parsePackageJsonDependencies(packageJsonText, includeDev);
      return { mode, spec: '', namedImports: '', bulkDeps: parsed.ok ? parsed.value.map((d) => ({ name: d.name, range: d.range })) : [] };
    }
    return { mode, spec, namedImports, bulkDeps: [] };
  };

  return (
    <div class="tool" ref={toolRef}>
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Check a single package, or a whole package.json">
          <button type="button" class="seg__btn" aria-pressed={mode === 'single'} onClick={() => setMode('single')}>
            Single package
          </button>
          <button type="button" class="seg__btn" aria-pressed={mode === 'bulk'} onClick={() => setMode('bulk')}>
            package.json
          </button>
        </div>
      </div>

      {mode === 'single' ? (
        <>
          <div class="presets" role="group" aria-label="Popular packages">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                class="preset-chip"
                onClick={() => selectPreset(preset)}
                title={`Check "${preset}" now`}
              >
                {preset}
              </button>
            ))}
          </div>

          <div class="bsc-row">
            <div class="field bsc-combobox" style="flex:2">
              <label class="field__label" for="bsc-spec">
                <span>Package</span>
                <span class="field__hint">checks itself as you finish typing</span>
              </label>
              <input
                id="bsc-spec"
                class="input"
                spellcheck={false}
                autocomplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestionsOpen && suggestions.length > 0}
                aria-controls="bsc-suggestions"
                aria-activedescendant={highlightIndex >= 0 ? `bsc-suggestion-${highlightIndex}` : undefined}
                placeholder="lodash, react@18, or date-fns@^3"
                title="A package name, optionally pinned: name, name@version, or name@range."
                value={spec}
                aria-invalid={status === 'error'}
                onInput={(e) => {
                  setSpec((e.target as HTMLInputElement).value);
                  setSuggestionsOpen(true);
                }}
                onFocus={() => setSuggestionsOpen(true)}
                onBlur={() => setSuggestionsOpen(false)}
                onKeyDown={(e) => {
                  const showing = suggestionsOpen && suggestions.length > 0;
                  if (showing && e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
                    return;
                  }
                  if (showing && e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightIndex((i) => Math.max(i - 1, 0));
                    return;
                  }
                  if (showing && e.key === 'Escape') {
                    setSuggestionsOpen(false);
                    return;
                  }
                  if (showing && e.key === 'Enter' && highlightIndex >= 0) {
                    e.preventDefault();
                    selectSuggestion(suggestions[highlightIndex]!);
                    return;
                  }
                  // Enter is an explicit submit: it skips the auto-check's "is this a real
                  // package" gate, so a typo gets a real error instead of silence.
                  if (e.key === 'Enter') void checkSize();
                }}
              />
              {suggestionsOpen && suggestions.length > 0 && (
                <ul class="bsc-suggestions" role="listbox" id="bsc-suggestions">
                  {suggestions.map((s, i) => (
                    <li
                      key={s.name}
                      id={`bsc-suggestion-${i}`}
                      role="option"
                      aria-selected={i === highlightIndex}
                      class={`bsc-suggestions__item${i === highlightIndex ? ' bsc-suggestions__item--active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectSuggestion(s);
                      }}
                      onMouseEnter={() => setHighlightIndex(i)}
                    >
                      <span class="bsc-suggestions__name">{s.name}</span>
                      {s.description && <span class="bsc-suggestions__desc">{s.description}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div class="field" style="flex:1">
              <label class="field__label" for="bsc-exports">
                <span>
                  Named imports{' '}
                  {/* The explanation is long enough to crowd the field if it were always
                      visible, but short enough to read in one hover — so it lives on an
                      icon, focusable so it is reachable without a mouse too. */}
                  <span class="field__info" tabIndex={0} role="note" title={NAMED_IMPORTS_HELP} aria-label={NAMED_IMPORTS_HELP}>
                    i
                  </span>
                </span>
                <span class="field__hint">optional</span>
              </label>
              <input
                id="bsc-exports"
                class="input"
                spellcheck={false}
                autocomplete="off"
                placeholder="debounce, throttle"
                title={NAMED_IMPORTS_HELP}
                value={namedImports}
                onInput={(e) => setNamedImports((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === 'Enter' && void checkSize()}
              />
            </div>
          </div>

          <details class="bsc-details">
            <summary>When does "Named imports" actually make a difference?</summary>
            <p class="field__hint">
              Most projects don't use everything a package exports. A bundler that can prove which exports you left unused
              deletes the rest — that's tree-shaking — so the number that matters for your app is the size of the parts you
              import, not the size of the package. Listing exports here measures exactly that: esm.sh rebuilds the package
              keeping only the names you gave, and the result is measured through the same minify-and-gzip pipeline as
              everything else.
            </p>
            <p class="field__hint">
              Three things can happen, and all three are useful answers:
            </p>
            <ul class="bsc-notes">
              <li>
                <strong>It shrinks a lot.</strong> The package is a well-separated ESM bundle of independent exports —
                exactly the case where importing one function costs you one function.
              </li>
              <li>
                <strong>It barely changes.</strong> The package routes everything through one shared internal module, so
                there is genuinely nothing to shake off. That is a property of how the package is published, not a failure
                of the measurement — and it is worth knowing before you assume an import is cheap.
              </li>
              <li>
                <strong>It fails with an error.</strong> The package is CommonJS-only (see "Module format" in the results),
                and its exports can't be analysed statically at all. In a real build the same thing happens quietly: you get
                the whole package.
              </li>
            </ul>
          </details>

          <div class="tool-bar">
            <ShareLinkButton getState={shareState} describe="this package" />
            <button type="button" class="btn" onClick={clearSingle} disabled={spec === '' && status === 'idle'} title="Clear and start over">
              Clear
            </button>
            {status === 'loading' && (
              <span class="field__hint">
                <span class="job__spinner" aria-hidden="true" /> Fetching and bundling {spec.trim()}…
              </span>
            )}
          </div>

          <ErrorMessage message={error} onRetry={() => void checkSize()} />

          {result && (
            <>
              <div class="bsc-heading">
                <p class="bsc-version">
                  <code>
                    {result.name}@{result.resolvedVersion}
                  </code>
                </p>
                {(result.info.description ?? repoStats?.description) && (
                  <p class="bsc-description">{result.info.description ?? repoStats?.description}</p>
                )}
                <p class="bsc-links">
                  <a href={buildNpmPackageUrl(result.name)} target="_blank" rel="noopener noreferrer">
                    npm
                  </a>
                  {repo && (
                    <a href={repo.url} target="_blank" rel="noopener noreferrer" title={`Source repository on ${repo.host}`}>
                      {repo.host === 'other' ? 'Repository' : `${repo.host} repo`}
                    </a>
                  )}
                  {result.info.homepage && result.info.homepage !== repo?.url && (
                    <a href={result.info.homepage} target="_blank" rel="noopener noreferrer">
                      Homepage
                    </a>
                  )}
                </p>
                {result.info.deprecated && (
                  <p class="msg msg--error" role="status">
                    <span class="msg__icon" aria-hidden="true">
                      !
                    </span>
                    <span>
                      <strong>Deprecated:</strong> {result.info.deprecated}
                    </span>
                  </p>
                )}
                {repoStats?.archived && (
                  <p class="msg msg--error" role="status">
                    <span class="msg__icon" aria-hidden="true">
                      !
                    </span>
                    <span>
                      This repository is <strong>archived</strong> on GitHub — it is read-only and no longer maintained.
                    </span>
                  </p>
                )}
              </div>

              <dl class="bsc-grid">
                <dt>Minified</dt>
                <dd class="tnum">{formatBytes(result.size.minifiedBytes)}</dd>

                <dt>Minified + gzipped</dt>
                <dd class="tnum bsc-headline">{formatBytes(result.size.gzipBytes)}</dd>

                <dt>Compression</dt>
                <dd class="tnum">{Math.round(compressionRatio(result.size.minifiedBytes, result.size.gzipBytes) * 100)}% smaller gzipped</dd>

                <dt>Unpacked size</dt>
                <dd class="tnum">
                  {result.info.unpackedSize !== null ? formatBytes(result.info.unpackedSize) : 'Unknown'}
                  {result.info.fileCount !== null && (
                    <span class="field__hint"> · {result.info.fileCount.toLocaleString()} files in the tarball</span>
                  )}
                </dd>

                <dt>Direct dependencies</dt>
                <dd class="tnum">
                  {Object.keys(result.info.dependencies).length}
                  {Object.keys(result.info.peerDependencies).length > 0 && (
                    <span class="field__hint">
                      {' '}
                      · {Object.keys(result.info.peerDependencies).length} peer
                    </span>
                  )}
                </dd>

                {/* Module format and sideEffects get a labelled row each, rather than two
                    badges sharing one cell: they are independent facts with independent
                    colour scales, and side by side it is genuinely hard to tell which
                    badge a colour belongs to. */}
                <dt>Module format</dt>
                <dd>
                  <span
                    class={`badge badge--${MODULE_FORMAT_TONE[result.info.esm.format]}`}
                    title={MODULE_FORMAT_TOOLTIP[result.info.esm.format]}
                  >
                    {MODULE_FORMAT_LABEL[result.info.esm.format]}
                  </span>
                </dd>

                <dt>Tree-shaking</dt>
                <dd>
                  <span
                    class={`badge badge--${SIDE_EFFECTS_TONE[result.info.esm.sideEffects]}`}
                    title={SIDE_EFFECTS_TOOLTIP[result.info.esm.sideEffects]}
                  >
                    {SIDE_EFFECTS_LABEL[result.info.esm.sideEffects]}
                  </span>
                </dd>

                <dt>TypeScript types</dt>
                <dd>{result.info.esm.hasTypes ? 'Bundled' : 'Not bundled'}</dd>

                <dt>License</dt>
                <dd>{result.info.license ?? 'Unknown'}</dd>

                {result.info.engineNode && (
                  <>
                    <dt>Requires Node</dt>
                    <dd class="tnum">{result.info.engineNode}</dd>
                  </>
                )}

                <dt>Published versions</dt>
                <dd class="tnum">
                  {result.versionCount.toLocaleString()}
                  {result.lastPublished && (
                    <span class="field__hint"> · last published {formatRelativeTime(result.lastPublished) ?? 'unknown'}</span>
                  )}
                </dd>
              </dl>

              <details class="bsc-details">
                <summary>What do "CommonJS only" and "sideEffects unspecified" mean?</summary>
                <dl class="bsc-explain">
                  <dt>ESM only</dt>
                  <dd>
                    The package ships an ES module entry point — the modern <code>import</code> / <code>export</code> syntax.
                    Imports and exports are fixed at parse time, so a bundler can see exactly which exports you use and drop
                    the rest. This is the format that makes tree-shaking possible.
                  </dd>

                  <dt>ESM + CommonJS</dt>
                  <dd>
                    A "dual" package: it ships both formats, normally through an <code>exports</code> map with separate{' '}
                    <code>import</code> and <code>require</code> conditions. Bundlers take the ESM build and tree-shake it;
                    plain Node <code>require()</code> still works. This is the most compatible thing a package can publish.
                  </dd>

                  <dt>CommonJS only</dt>
                  <dd>
                    The package ships only the older Node format — <code>require()</code> and <code>module.exports</code>.
                    Its exports are ordinary runtime property assignments, not declarations, so a bundler usually cannot
                    prove which ones you left unused and has to include the whole module. That is why importing one function
                    from a large CommonJS package often costs you the entire package, and why the "named imports" field
                    above fails for one. It still <em>works</em> everywhere — it just doesn't shrink.
                  </dd>

                  <dt>No entry point declared</dt>
                  <dd>
                    Neither a <code>main</code> nor a <code>module</code>/<code>exports</code> entry that this tool
                    recognises. Usually a types-only package, one that is only meant to be imported by a deep subpath, or a
                    publishing mistake.
                  </dd>

                  <dt>side-effect free</dt>
                  <dd>
                    The package sets <code>"sideEffects": false</code> (or an empty array) in its package.json — an explicit
                    promise that merely importing a module from it does nothing observable on its own: no globals patched,
                    no CSS injected, no polyfill installed. That promise is what lets a bundler delete a module you imported
                    but never actually used.
                  </dd>

                  <dt>has side effects</dt>
                  <dd>
                    <code>sideEffects</code> is <code>true</code>, or lists specific files that do have side effects (a
                    common pattern for the one file that imports a stylesheet). A bundler keeps those files even when
                    nothing appears to use them, because dropping them would change how your app behaves.
                  </dd>

                  <dt>sideEffects unspecified</dt>
                  <dd>
                    The package simply doesn't have the field. It is <strong>not</strong> a statement that the package has
                    side effects — it is the absence of a statement either way, which is still the most common case, since
                    the field is optional and predates most published packages. Bundlers must then assume the worst and keep
                    every imported module, so tree-shaking is more conservative than it would be with an explicit{' '}
                    <code>false</code>. A package can be perfectly clean and just never have added the field.
                  </dd>
                </dl>
              </details>

              {(repoStats || commits || monthlyDownloads !== null || downloads !== null) && (
                <div class="field">
                  <div class="field__label">
                    <span>Project health</span>
                    {repo && (
                      <a class="field__hint" href={repo.url} target="_blank" rel="noopener noreferrer">
                        {repo.owner && repo.repo ? `${repo.owner}/${repo.repo}` : 'repository'} ↗
                      </a>
                    )}
                  </div>
                  <div class="bsc-stats">
                    {downloads !== null && (
                      <Stat
                        label="Weekly downloads"
                        value={formatCompactNumber(downloads)}
                        title={`${downloads.toLocaleString()} downloads in the last week (npm)`}
                      />
                    )}
                    {monthlyDownloads !== null && (
                      <Stat
                        label="Monthly downloads"
                        value={formatCompactNumber(monthlyDownloads)}
                        title={`${monthlyDownloads.toLocaleString()} downloads over the last 30 days (npm)`}
                      />
                    )}
                    {repoStats && (
                      <>
                        <Stat
                          label="Stars"
                          value={formatCompactNumber(repoStats.stars)}
                          title={`${repoStats.stars.toLocaleString()} GitHub stars`}
                          href={`${repoStats.htmlUrl}/stargazers`}
                        />
                        <Stat
                          label="Forks"
                          value={formatCompactNumber(repoStats.forks)}
                          title={`${repoStats.forks.toLocaleString()} forks`}
                          href={`${repoStats.htmlUrl}/forks`}
                        />
                        <Stat
                          label="Watchers"
                          value={formatCompactNumber(repoStats.watchers)}
                          title={`${repoStats.watchers.toLocaleString()} people watching this repository`}
                          href={`${repoStats.htmlUrl}/watchers`}
                        />
                        <Stat
                          label="Open issues + PRs"
                          value={formatCompactNumber(repoStats.openIssuesAndPulls)}
                          title={`${repoStats.openIssuesAndPulls.toLocaleString()} open items. GitHub's API counts open pull requests as issues, so this is the combined figure rather than a pure issue count.`}
                          href={`${repoStats.htmlUrl}/issues`}
                        />
                      </>
                    )}
                    {commitCount !== null && (
                      <Stat
                        label="Commits"
                        value={formatCompactNumber(commitCount)}
                        title={`${commitCount.toLocaleString()} commits on the repository's default branch`}
                        href={repoStats ? `${repoStats.htmlUrl}/commits` : undefined}
                      />
                    )}
                    {commits?.lastCommitDate && (
                      <Stat
                        label="Last commit"
                        value={formatRelativeTime(commits.lastCommitDate) ?? '—'}
                        title={
                          commits.lastCommitMessage
                            ? `${new Date(commits.lastCommitDate).toLocaleString()} — "${commits.lastCommitMessage}"${commits.lastCommitAuthor ? ` by ${commits.lastCommitAuthor}` : ''}`
                            : new Date(commits.lastCommitDate).toLocaleString()
                        }
                        href={commits.lastCommitUrl ?? undefined}
                      />
                    )}
                    {repoStats?.createdAt && (
                      <Stat
                        label="Project age"
                        value={(() => {
                          const years = yearsSince(repoStats.createdAt);
                          return years === null ? '—' : years < 1 ? '<1 yr' : `${years} yr`;
                        })()}
                        title={`Repository created ${new Date(repoStats.createdAt).toLocaleDateString()} (${formatRelativeTime(repoStats.createdAt) ?? 'unknown'})`}
                      />
                    )}
                  </div>

                  {sparkline && (
                    <figure class="bsc-spark">
                      <svg viewBox="0 0 240 40" preserveAspectRatio="none" role="img" aria-label={`Daily downloads of ${result.name} over the last 30 days`}>
                        <polyline points={sparkline} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" />
                      </svg>
                      <figcaption class="field__hint">Daily downloads, last 30 days — from npm's public download-counts API.</figcaption>
                    </figure>
                  )}

                  {repoStats && repoStats.topics.length > 0 && (
                    <p class="bsc-topics">
                      {repoStats.topics.slice(0, 8).map((topic) => (
                        <span class="badge badge--neutral" key={topic}>
                          {topic}
                        </span>
                      ))}
                    </p>
                  )}

                  {repoError && <p class="field__hint">{repoError}</p>}
                </div>
              )}

              {!repoStats && !repoError && repo && repo.host !== 'github' && (
                <p class="field__hint">
                  Stars, issues and commit counts are only available for packages hosted on GitHub — {result.name} publishes
                  its source on {repo.host}, so only the repository link is shown.
                </p>
              )}

              <div class="field">
                <div class="field__label">
                  <span>Gzipped size across major versions</span>
                </div>
                {majorHistoryStatus === 'loading' && majorHistoryRows.length === 0 && (
                  <p class="field__hint">
                    <span class="job__spinner" aria-hidden="true" /> Measuring the latest release of each major version…
                  </p>
                )}
                {majorHistoryRows.length === 1 && majorHistoryRows[0]!.error !== null && <ErrorMessage message={majorHistoryRows[0]!.error} />}
                {majorHistoryRows.length === 1 && majorHistoryRows[0]!.error === null && (
                  <p class="field__hint">No earlier major versions of {result.name} were found on the registry.</p>
                )}
                {majorHistoryRows.length > 1 && (
                  <>
                    <figure class="bsc-chart">
                      <div
                        class="bsc-chart__bars"
                        role="img"
                        aria-label={`Gzipped size of ${result.name} across its last ${majorHistoryRows.length} major versions, oldest to newest, current version highlighted`}
                      >
                        {[...majorHistoryRows]
                          .sort((a, b) => a.major - b.major)
                          .map((row) => {
                            const max = Math.max(...majorHistoryRows.map((r) => r.size?.gzipBytes ?? 0), 1);
                            const pct = row.size ? Math.max(4, Math.round((row.size.gzipBytes / max) * 100)) : 0;
                            const isCurrent = row.version === result.resolvedVersion;
                            return (
                              <div class="bsc-chart__col" key={row.major}>
                                <span class="tnum bsc-chart__value">
                                  {row.size ? formatBytes(row.size.gzipBytes) : row.error ? '—' : '…'}
                                </span>
                                <span
                                  class={`bsc-chart__bar${isCurrent ? ' bsc-chart__bar--current' : ''}`}
                                  style={`height:${pct}%`}
                                  title={`v${row.major} (${row.version || 'unresolved'}): ${
                                    row.size ? `${formatBytes(row.size.gzipBytes)} gzipped` : (row.error ?? 'measuring…')
                                  }`}
                                />
                                <span class="bsc-chart__label">
                                  v{row.major}
                                  <br />
                                  <span class="bsc-chart__label-version">{row.version || '—'}</span>
                                  {isCurrent && (
                                    <>
                                      <br />
                                      <span class="bsc-chart__current-tag">current</span>
                                    </>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                      <figcaption class="field__hint">
                        Gzipped size of the latest release in each major version — fetched and measured live, the same way as the
                        result above.
                      </figcaption>
                    </figure>

                    <details class="bsc-details">
                      <summary>Show as a table</summary>
                      <div class="bsc-table-wrap">
                        <table class="bsc-table">
                          <thead>
                            <tr>
                              <th>Major</th>
                              <th>Latest release</th>
                              <th>Minified</th>
                              <th>Gzipped</th>
                              <th>vs current</th>
                            </tr>
                          </thead>
                          <tbody>
                            {majorHistoryRows.map((row) => (
                              <tr key={row.major}>
                                <td class="tnum">v{row.major}</td>
                                <td class="tnum">{row.version || '—'}</td>
                                <td class="tnum">{row.size ? formatBytes(row.size.minifiedBytes) : '—'}</td>
                                <td class="tnum">{row.size ? formatBytes(row.size.gzipBytes) : '—'}</td>
                                <td class="tnum">
                                  {row.version === result.resolvedVersion ? (
                                    <span class="field__hint">current</span>
                                  ) : row.size ? (
                                    row.size.gzipBytes === result.size.gzipBytes ? (
                                      'no change'
                                    ) : (
                                      <span class={row.size.gzipBytes > result.size.gzipBytes ? 'bsc-delta--up' : 'bsc-delta--down'}>
                                        {row.size.gzipBytes > result.size.gzipBytes ? '+' : '−'}
                                        {formatBytes(Math.abs(row.size.gzipBytes - result.size.gzipBytes))}
                                      </span>
                                    )
                                  ) : (
                                    <span class="bsc-bars__error" title={row.error ?? ''}>
                                      error
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </>
                )}
              </div>

              <div class="field">
                <div class="field__label">
                  <span>Estimated download time</span>
                </div>
                <ul class="bsc-speeds">
                  {CONNECTION_SPEEDS.map((c) => (
                    <li key={c.label}>
                      <span class="bsc-speeds__label">{c.label}</span>
                      <span class="tnum">{estimateDownloadSeconds(result.size.gzipBytes, c.kbps).toFixed(2)}s</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div class="field">
                <div class="field__label">
                  <span>Copyable summary</span>
                  <CopyButton value={summaryText} describe="the size summary" />
                </div>
                <pre class="output">{summaryText}</pre>
                <p class="field__hint">
                  There's no live-updating size badge here — that needs a server to render an image on every request, and this site
                  has none. Paste this line into a README instead.
                </p>
              </div>

              <details class="bsc-details">
                <summary>Compare with another version</summary>
                <div class="bsc-row">
                  <div class="field" style="flex:1">
                    <input
                      class="input"
                      placeholder="e.g. 3.0.0, or ^2"
                      aria-label="Version or range to compare against"
                      value={compareSpec}
                      onInput={(e) => setCompareSpec((e.target as HTMLInputElement).value)}
                      onKeyDown={(e) => e.key === 'Enter' && void runCompare()}
                    />
                  </div>
                  <button type="button" class="btn" onClick={() => void runCompare()} disabled={compareStatus === 'loading' || compareSpec.trim() === ''}>
                    {compareStatus === 'loading' ? 'Comparing…' : 'Compare'}
                  </button>
                </div>
                <ErrorMessage message={compareError} />
                {compareResult && (
                  <p class="field__hint">
                    {result.name}@{compareResult.version}: {formatBytes(compareResult.size.gzipBytes)} gzipped —{' '}
                    {compareResult.size.gzipBytes === result.size.gzipBytes
                      ? 'identical size'
                      : compareResult.size.gzipBytes > result.size.gzipBytes
                        ? `${formatBytes(compareResult.size.gzipBytes - result.size.gzipBytes)} bigger than ${result.resolvedVersion}`
                        : `${formatBytes(result.size.gzipBytes - compareResult.size.gzipBytes)} smaller than ${result.resolvedVersion}`}
                  </p>
                )}
              </details>

              <details class="bsc-details" onToggle={(e) => (e.target as HTMLDetailsElement).open && breakdownStatus === 'idle' && void loadDependencyBreakdown()}>
                <summary>Dependency size breakdown ({Object.keys(result.info.dependencies).length})</summary>
                {breakdownStatus === 'loading' && (
                  <p class="field__hint">
                    <span class="job__spinner" aria-hidden="true" /> Measuring each direct dependency…
                  </p>
                )}
                {breakdownStatus === 'done' && breakdown.length === 0 && <p class="field__hint">No direct dependencies.</p>}
                {breakdownStatus === 'done' && breakdown.length > 0 && (
                  <>
                    <p class="field__hint">
                      Gzipped size of each dependency, measured standalone (same pipeline as the result above) — bar length is
                      relative to the heaviest one shown.
                    </p>
                    <ul class="bsc-bars">
                      {[...breakdown]
                        .sort((a, b) => (b.gzipBytes ?? 0) - (a.gzipBytes ?? 0))
                        .map((b) => {
                          const max = Math.max(...breakdown.map((x) => x.gzipBytes ?? 0), 1);
                          const pct = b.gzipBytes !== null ? Math.max(2, Math.round((b.gzipBytes / max) * 100)) : 0;
                          return (
                            <li key={b.name}>
                              <button
                                type="button"
                                class="bsc-bars__name bsc-inspect"
                                onClick={() => inspectPackage(b.name, null)}
                                title={`Open ${b.name} on its own — README, project health and version history`}
                              >
                                {b.name}
                              </button>
                              {b.error ? (
                                <span class="bsc-bars__error" title={b.error}>
                                  error
                                </span>
                              ) : (
                                <>
                                  <span class="bsc-bars__track" title={`${formatBytes(b.gzipBytes ?? 0)} gzipped`}>
                                    <span class="bsc-bars__fill" style={`width:${pct}%`} />
                                  </span>
                                  <span class="tnum bsc-bars__value">{formatBytes(b.gzipBytes ?? 0)} gzip</span>
                                </>
                              )}
                            </li>
                          );
                        })}
                    </ul>
                    <p class="field__hint">
                      Each dependency is measured as its own standalone bundle, so these can sum to more than the total above —
                      dependencies that share code with each other or with {result.name} aren't deduplicated here.
                    </p>
                  </>
                )}
              </details>

              <div class="field">
                <div class="field__label">
                  <span>README</span>
                  {readmeMarkdown && <CopyButton value={readmeMarkdown} label="Copy Markdown" describe="the README source" />}
                </div>
                {readmeStatus === 'loading' && (
                  <p class="field__hint">
                    <span class="job__spinner" aria-hidden="true" /> Fetching the README published with {result.name}@
                    {result.resolvedVersion}…
                  </p>
                )}
                {readmeStatus === 'error' && <p class="field__hint">{readmeError}</p>}
                {readmeStatus === 'done' && readmeHtml !== null && (
                  <>
                    <p class="field__hint">
                      The README published with this exact version, taken from the package's own tarball. Its links open in a
                      new tab.
                    </p>
                    {/* Rendered from Markdown that DOMPurify has already sanitized (see
                        `markdownToHtml`), with relative paths rewritten to the package's
                        repository so its images and links still resolve here. It sits last
                        on the page and is shown in full: a README is the longest thing
                        here by far, and anything clipped above it would push the rest of
                        the results out of reach. */}
                    <div class="bsc-readme">
                      <div class="bsc-readme__body" ref={readmeRef} dangerouslySetInnerHTML={{ __html: readmeHtml }} />
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div class="tool-bar">
            <ShareLinkButton getState={shareState} describe="this dependency list" />
            <button
              type="button"
              class="btn"
              onClick={() => {
                setPackageJsonText(BULK_EXAMPLE);
                void runBulkCheck(BULK_EXAMPLE);
              }}
              title="Fill in a sample package.json and check it"
            >
              Load example
            </button>
            <button type="button" class="btn" onClick={clearBulk} disabled={packageJsonText === '' && rows.length === 0} title="Clear and start over">
              Clear
            </button>
            <span class="tool-bar__spacer" />
            {bulkStatus === 'running' && (
              <>
                <span class="field__hint">
                  <span class="job__spinner" aria-hidden="true" /> Checked {progress.done} / {progress.total}…
                </span>
                <button type="button" class="btn" onClick={cancelBulk} title="Stop checking the remaining dependencies">
                  Cancel
                </button>
              </>
            )}
            <label class="checkbox" title="Also check devDependencies, not just dependencies">
              <input type="checkbox" checked={includeDev} onChange={(e) => setIncludeDev((e.target as HTMLInputElement).checked)} />
              <span>Include devDependencies</span>
            </label>
          </div>

          <FileDropzone
            file={null}
            onFileSelected={(file) => {
              if (!file) return;
              // Choosing a file is a complete request in itself — read it and check it,
              // rather than dropping the contents into the textarea and waiting.
              void file.text().then((text) => {
                setPackageJsonText(text);
                void runBulkCheck(text);
              });
            }}
            chooseLabel="Choose a package.json file"
            accept="application/json,.json"
          />

          <div class="field">
            <label class="field__label" for="bsc-pkgjson">
              <span>package.json</span>
              <span class="field__hint">checks itself once a paste settles</span>
            </label>
            <textarea
              id="bsc-pkgjson"
              class="textarea textarea--tall"
              spellcheck={false}
              placeholder={'{\n  "dependencies": {\n    "react": "^18.3.0"\n  }\n}'}
              value={packageJsonText}
              aria-invalid={bulkStatus === 'error'}
              onInput={(e) => setPackageJsonText((e.target as HTMLTextAreaElement).value)}
            />
          </div>

          <ErrorMessage message={bulkError} />

          {rows.length > 0 && (
            <>
              <p class="field__hint">
                Select any package name to open it on its own — its README, project health and version history. Your
                package.json and this table are kept, so the "package.json" tab brings them straight back.
              </p>
              <DependencyTable
                title="Dependencies"
                rows={dependencyRows}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onToggleSort={toggleSort}
                onInspect={inspectPackage}
              />
              {devDependencyRows.length > 0 && (
                <DependencyTable
                  title="Dev Dependencies"
                  rows={devDependencyRows}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onToggleSort={toggleSort}
                  onInspect={inspectPackage}
                />
              )}
              <div class="tool-bar">
                <CopyButton value={bulkTableAsMarkdown()} label="Copy tables as Markdown" describe="the dependency size tables" />
              </div>
            </>
          )}
        </>
      )}

      <style>{`
        .presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .preset-chip {
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); padding: 0.35rem 0.75rem;
          font: inherit; font-size: var(--text-sm); font-weight: 550; color: var(--text);
          cursor: pointer; font-family: var(--font-mono);
        }
        .preset-chip:hover { background: var(--surface-2); border-color: var(--text-subtle); }
        .bsc-row { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: flex-end; }
        .bsc-combobox { position: relative; }
        .bsc-suggestions {
          position: absolute; top: 100%; left: 0; right: 0; z-index: 20; margin: 0.25rem 0 0; padding: 0.25rem;
          list-style: none; max-height: 16rem; overflow-y: auto;
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); box-shadow: 0 8px 24px rgba(0,0,0,0.18);
        }
        .bsc-suggestions__item { padding: 0.4rem 0.6rem; border-radius: var(--radius); cursor: pointer; display: flex; flex-direction: column; gap: 0.1rem; }
        .bsc-suggestions__item--active, .bsc-suggestions__item:hover { background: var(--surface-2); }
        .bsc-suggestions__name { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text); font-weight: 600; }
        .bsc-suggestions__desc { font-size: var(--text-xs); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bsc-heading { display: flex; flex-direction: column; gap: var(--space-2); }
        .bsc-version { margin: 0; font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); }
        .bsc-version code { color: var(--text); font-weight: 600; }
        .bsc-description { margin: 0; font-size: var(--text-sm); color: var(--text-muted); max-width: 68ch; }
        .bsc-links { margin: 0; display: flex; flex-wrap: wrap; gap: var(--space-3); font-size: var(--text-sm); }
        .bsc-delta--up { color: var(--danger); }
        .bsc-delta--down { color: var(--success); }
        .bsc-grid {
          display: grid; grid-template-columns: minmax(10rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4); font-size: var(--text-sm);
        }
        .bsc-grid dt {
          font-family: var(--font-mono); color: var(--text-muted);
          font-size: var(--text-xs); letter-spacing: .06em; align-self: center;
        }
        .bsc-grid dd { margin: 0; align-self: center; }
        .bsc-headline { font-size: var(--text-lg, 1.15rem); font-weight: 700; color: var(--accent); }
        .tnum { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
        .badge {
          font-size: var(--text-xs); font-weight: 600; padding: .1em .6em;
          border-radius: 99px; border: 1px solid; display: inline-block;
        }
        .badge--success { color: var(--success); background: var(--success-subtle); border-color: var(--success-border); }
        .badge--warning { color: var(--warning); background: var(--warning-subtle); border-color: var(--warning-border); }
        .badge--neutral { color: var(--text-muted); background: var(--surface-2); border-color: var(--border-strong); }
        .bsc-explain { margin: 0; display: grid; gap: var(--space-2); font-size: var(--text-sm); }
        .bsc-explain dt { font-family: var(--font-mono); font-weight: 700; color: var(--text); font-size: var(--text-xs); letter-spacing: .04em; }
        .bsc-explain dd { margin: 0 0 var(--space-2); color: var(--text-muted); max-width: 72ch; }
        .bsc-explain code { font-family: var(--font-mono); font-size: 0.9em; }
        .bsc-notes { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-muted); max-width: 72ch; }
        .bsc-notes strong { color: var(--text); }
        .field__info {
          display: inline-flex; align-items: center; justify-content: center;
          width: 1.05rem; height: 1.05rem; border-radius: 99px; cursor: help;
          border: 1px solid var(--border-strong); background: var(--surface-2);
          color: var(--text-muted); font-size: 0.68rem; font-weight: 700;
          font-family: var(--font-mono); line-height: 1; vertical-align: middle;
        }
        .field__info:hover, .field__info:focus-visible { color: var(--text); border-color: var(--text-subtle); }
        /* auto-fit keeps every tile the same width and lets the row reflow down to one
           column on a phone, with no breakpoint to keep in sync with the tile count. */
        .bsc-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); gap: var(--space-2); }
        .bsc-stat {
          display: flex; flex-direction: column; gap: 0.15rem; padding: var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);
          text-align: center; align-items: center;
        }
        .bsc-stat--link { text-decoration: none; color: inherit; }
        .bsc-stat--link:hover { border-color: var(--text-subtle); background: var(--surface-2); }
        .bsc-stat__value { font-size: var(--text-lg, 1.15rem); font-weight: 700; color: var(--text); }
        .bsc-stat__label { font-size: var(--text-xs); color: var(--text-muted); }
        .bsc-spark { margin: var(--space-3) 0 0; color: var(--accent); }
        .bsc-spark svg { width: 100%; height: 3rem; display: block; }
        .bsc-topics { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-3) 0 0; }
        .bsc-speeds { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
        .bsc-speeds li { display: flex; justify-content: space-between; padding: 0.2rem 0; border-bottom: 1px solid var(--border); font-size: var(--text-sm); }
        .bsc-speeds li:last-child { border-bottom: none; }
        .bsc-speeds__label { color: var(--text-muted); }
        /* Shown in full, unclipped: it is the last thing on the page, so its length
           costs the reader nothing — there is no result below it to push out of reach. */
        .bsc-readme {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4);
        }
        .bsc-readme__body { font-size: var(--text-sm); line-height: 1.65; overflow-wrap: anywhere; }
        .bsc-readme__body > :first-child { margin-top: 0; }
        .bsc-readme__body h1, .bsc-readme__body h2, .bsc-readme__body h3 { margin: var(--space-4) 0 var(--space-2); line-height: 1.3; }
        .bsc-readme__body h1 { font-size: 1.4rem; }
        .bsc-readme__body h2 { font-size: 1.2rem; }
        .bsc-readme__body h3 { font-size: 1.05rem; }
        .bsc-readme__body p, .bsc-readme__body ul, .bsc-readme__body ol { margin: 0 0 var(--space-3); }
        .bsc-readme__body img { max-width: 100%; height: auto; }
        .bsc-readme__body pre {
          overflow-x: auto; padding: var(--space-3); border-radius: var(--radius);
          background: var(--surface-2); font-family: var(--font-mono); font-size: var(--text-xs);
        }
        .bsc-readme__body code { font-family: var(--font-mono); font-size: 0.9em; }
        .bsc-readme__body :not(pre) > code { background: var(--surface-2); padding: .1em .35em; border-radius: 4px; }
        .bsc-readme__body table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; }
        .bsc-readme__body th, .bsc-readme__body td { border: 1px solid var(--border); padding: 0.35rem 0.6rem; text-align: left; }
        .bsc-readme__body blockquote { margin: 0 0 var(--space-3); padding-left: var(--space-3); border-left: 3px solid var(--border-strong); color: var(--text-muted); }
        .bsc-chart { margin: 0; }
        /* A grid, not nested flex columns: every bar's row is a fixed 8rem track, so a
           taller two-line label (the "current" tag) below one bar can never push that
           bar's own baseline out of alignment with the others — each row aligns across
           every column independently of what any other row in that column contains. */
        .bsc-chart__bars {
          display: grid; grid-auto-flow: column; grid-auto-columns: minmax(2.75rem, 6rem);
          justify-content: center;
          grid-template-rows: auto 8rem auto; column-gap: var(--space-4);
          padding: 0 var(--space-2); border-bottom: 1px solid var(--border-strong);
        }
        .bsc-chart__col { display: contents; }
        .bsc-chart__value {
          grid-row: 1; align-self: end; padding-bottom: 0.3rem; text-align: center;
          font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-muted); white-space: nowrap;
        }
        .bsc-chart__bar {
          grid-row: 2; align-self: end; justify-self: center;
          width: 2.25rem; max-width: 100%; background: var(--text-subtle);
          border-radius: 4px 4px 0 0; min-height: 3px;
        }
        .bsc-chart__bar--current { background: var(--accent); }
        .bsc-chart__label {
          grid-row: 3; align-self: start; padding-top: 0.35rem; text-align: center;
          font-size: var(--text-xs); color: var(--text-muted); font-family: var(--font-mono); line-height: 1.4;
        }
        .bsc-chart__label-version { color: var(--text-subtle); font-size: 0.7rem; }
        .bsc-chart__current-tag { color: var(--accent); font-weight: 700; text-transform: uppercase; letter-spacing: .04em; font-size: 0.65rem; }
        .bsc-details { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-3) var(--space-4); background: var(--surface); }
        .bsc-details summary { cursor: pointer; font-weight: 600; font-size: var(--text-sm); }
        .bsc-details > *:not(summary) { margin-top: var(--space-3); }
        .bsc-bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
        .bsc-bars li { display: grid; grid-template-columns: minmax(6rem, 10rem) 1fr auto; gap: var(--space-2); align-items: center; font-size: var(--text-sm); }
        .bsc-bars__name.bsc-inspect { min-width: 0; }
        .bsc-bars__name { font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bsc-inspect {
          background: none; border: none; padding: 0; font: inherit; cursor: pointer;
          color: var(--accent); text-align: left; text-decoration: underline;
          text-decoration-style: dotted; text-underline-offset: 2px;
        }
        .bsc-inspect:hover { text-decoration-style: solid; }
        .bsc-bars__track { height: 0.6rem; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
        .bsc-bars__fill { display: block; height: 100%; background: var(--accent); border-radius: 99px; }
        .bsc-bars__value { font-size: var(--text-xs); color: var(--text-muted); }
        .bsc-bars__error { font-size: var(--text-xs); color: var(--warning); }
        .bsc-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
        .bsc-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
        .bsc-table th, .bsc-table td { padding: 0.45rem 0.65rem; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
        .bsc-table thead th { background: var(--surface-2); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); }
        .bsc-table tfoot td { border-top: 2px solid var(--border-strong); border-bottom: none; background: var(--surface-2); }
        .bsc-sort { background: none; border: none; padding: 0; font: inherit; font-size: inherit; text-transform: inherit; letter-spacing: inherit; color: inherit; cursor: pointer; }
      `}</style>
    </div>
  );
}
