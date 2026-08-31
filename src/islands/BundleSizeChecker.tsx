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
} from '../lib/tools/bundleSize';
import {
  fetchPackageOverview,
  fetchResolvedVersion,
  fetchWeeklyDownloads,
  fetchBundledSource,
  searchPackages,
  runWithConcurrency,
  type PackageOverview,
  type ResolvedVersionInfo,
  type PackageSuggestion,
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

interface DependencyTableProps {
  title: string;
  rows: BulkRow[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  onToggleSort: (key: SortKey) => void;
}

/** One dependencies/devDependencies table with its own total — factored out because bulk
 *  mode renders this twice (once per `source`) so the two never mix into one list or total. */
function DependencyTable({ title, rows, sortKey, sortDirection, onToggleSort }: DependencyTableProps) {
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
                <td>{r.name}</td>
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

  // ---------------------------------------------------------------- single-package mode
  const [spec, setSpec] = useState('');
  const [namedImports, setNamedImports] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SingleResult | null>(null);
  const [downloads, setDownloads] = useState<number | null>(null);

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

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setMode(state.mode);
      setSpec(state.spec);
      setNamedImports(state.namedImports);
      if (state.bulkDeps.length > 0) {
        setPackageJsonText(
          JSON.stringify({ dependencies: Object.fromEntries(state.bulkDeps.map((d) => [d.name, d.range])) }, null, 2)
        );
      }
      history.replaceState(null, '', window.location.pathname);
    });
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

  const selectSuggestion = (suggestion: PackageSuggestion) => {
    setSpec(suggestion.name);
    setSuggestions([]);
    setSuggestionsOpen(false);
    setHighlightIndex(-1);
    // Picking a suggestion is a complete choice, not a partial edit — run the check right
    // away instead of making the user press "Check size" again for what they just picked.
    void checkSize(suggestion.name);
  };

  // ------------------------------------------------------------------ single: check size

  /** `overrideSpec` lets a caller (like `selectSuggestion`) check a package immediately
   *  without waiting for the `spec` state update to land — reading `spec` here would
   *  still see the *previous* value in that same tick. */
  const checkSize = async (overrideSpec?: string) => {
    const parsed = parsePackageSpec(overrideSpec ?? spec);
    if (!parsed.ok) {
      setError(parsed.error);
      setStatus('error');
      return;
    }

    setStatus('loading');
    setError(null);
    setResult(null);
    setDownloads(null);
    setBreakdown([]);
    setBreakdownStatus('idle');
    setCompareResult(null);
    setCompareStatus('idle');
    setCompareError(null);
    setMajorHistoryStatus('idle');
    setMajorHistoryRows([]);

    const { name, range } = parsed.value;

    const overview = await fetchPackageOverview(name);
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
    if (!versionInfo.ok) {
      setError(versionInfo.error);
      setStatus('error');
      return;
    }

    const exportNames = namedImports
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const source = await fetchBundledSource(name, resolvedVersion, exportNames);
    if (!source.ok) {
      setError(source.error);
      setStatus('error');
      return;
    }

    const size = await measureBundleSize(source.value);
    if (!size.ok) {
      setError(size.error);
      setStatus('error');
      return;
    }

    setResult({ name, resolvedVersion, info: versionInfo.value, size: size.value });
    setStatus('done');

    void fetchWeeklyDownloads(name).then((d) => {
      if (d.ok) setDownloads(d.value);
    });
    // Fires immediately rather than waiting for a click — takes explicit args instead of
    // reading the `result` state, which wouldn't be updated yet in this same tick.
    void loadMajorHistory(name, resolvedVersion, size.value, exportNames);
  };

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

  /** Takes the just-checked package explicitly rather than reading `result` state, which
   *  is called from `checkSize` right after `setResult` — before that state update has
   *  actually landed, a stale read would still see the *previous* check's package. */
  const loadMajorHistory = async (name: string, resolvedVersion: string, currentSize: SizeResult, exportNames: string[]) => {
    setMajorHistoryStatus('loading');

    const overview = await fetchPackageOverview(name);
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
    setSpec('');
    setNamedImports('');
    setSuggestions([]);
    setSuggestionsOpen(false);
    setHighlightIndex(-1);
    setStatus('idle');
    setError(null);
    setResult(null);
    setDownloads(null);
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

  const runBulkCheck = async () => {
    const parsed = parsePackageJsonDependencies(packageJsonText, includeDev);
    if (!parsed.ok) {
      setBulkError(parsed.error);
      setBulkStatus('error');
      setRows([]);
      return;
    }

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

    abortRef.current = null;
    if (controller.signal.aborted) {
      setRows((current) =>
        current.map((r) => (r.status === 'pending' || r.status === 'running' ? { ...r, status: 'error', error: 'Cancelled.' } : r))
      );
    }
    setBulkStatus('done');
  };

  const cancelBulk = () => abortRef.current?.abort();

  const clearBulk = () => {
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

  const shareState = (): ShareState => {
    if (mode === 'bulk') {
      const parsed = parsePackageJsonDependencies(packageJsonText, includeDev);
      return { mode, spec: '', namedImports: '', bulkDeps: parsed.ok ? parsed.value.map((d) => ({ name: d.name, range: d.range })) : [] };
    }
    return { mode, spec, namedImports, bulkDeps: [] };
  };

  return (
    <div class="tool">
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
              <button key={preset} type="button" class="preset-chip" onClick={() => setSpec(preset)} title={`Use "${preset}"`}>
                {preset}
              </button>
            ))}
          </div>

          <div class="bsc-row">
            <div class="field bsc-combobox" style="flex:2">
              <label class="field__label" for="bsc-spec">
                <span>Package</span>
                <span class="field__hint">name, name@version, or name@range</span>
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
                <span>Named imports</span>
                <span class="field__hint">optional</span>
              </label>
              <input
                id="bsc-exports"
                class="input"
                spellcheck={false}
                autocomplete="off"
                placeholder="debounce, throttle"
                title="Measure the cost of importing only these named exports (tree-shaken via esm.sh) instead of the whole package. Doesn't work for CommonJS-only packages."
                value={namedImports}
                onInput={(e) => setNamedImports((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === 'Enter' && void checkSize()}
              />
            </div>
          </div>

          <div class="tool-bar">
            <ShareLinkButton getState={shareState} describe="this package" />
            <button type="button" class="btn" onClick={clearSingle} disabled={spec === '' && status === 'idle'} title="Clear and start over">
              Clear
            </button>
            <span class="tool-bar__spacer" />
            <button
              type="button"
              class="btn btn--primary"
              onClick={() => void checkSize()}
              disabled={status === 'loading' || spec.trim() === ''}
              title="Fetch and bundle this package to measure its size — the one action here that makes a network request"
            >
              {status === 'loading' ? 'Checking…' : 'Check size'}
            </button>
          </div>

          <ErrorMessage message={error} onRetry={() => void checkSize()} />

          {status === 'loading' && (
            <p class="field__hint">
              <span class="job__spinner" aria-hidden="true" /> Fetching and bundling {spec.trim()}…
            </p>
          )}

          {result && (
            <>
              <p class="bsc-version">
                <code>
                  {result.name}@{result.resolvedVersion}
                </code>
              </p>
              <dl class="bsc-grid">
                <dt>Minified</dt>
                <dd class="tnum">{formatBytes(result.size.minifiedBytes)}</dd>

                <dt>Minified + gzipped</dt>
                <dd class="tnum bsc-headline">{formatBytes(result.size.gzipBytes)}</dd>

                <dt>Compression</dt>
                <dd class="tnum">{Math.round(compressionRatio(result.size.minifiedBytes, result.size.gzipBytes) * 100)}% smaller gzipped</dd>

                <dt>Direct dependencies</dt>
                <dd class="tnum">{Object.keys(result.info.dependencies).length}</dd>

                <dt>ESM / tree-shaking</dt>
                <dd>
                  <span class={`badge badge--${result.info.esm.hasEsmEntry ? 'success' : 'warning'}`}>
                    {result.info.esm.hasEsmEntry ? 'ESM entry point' : 'CommonJS only'}
                  </span>{' '}
                  <span
                    class={`badge badge--${result.info.esm.sideEffects === 'free' ? 'success' : result.info.esm.sideEffects === 'has-side-effects' ? 'warning' : 'neutral'}`}
                    title="From the package's own sideEffects field — false or an empty array means a bundler can safely drop unused exports."
                  >
                    {result.info.esm.sideEffects === 'free' ? 'side-effect free' : result.info.esm.sideEffects === 'has-side-effects' ? 'has side effects' : 'sideEffects unspecified'}
                  </span>
                </dd>

                <dt>TypeScript types</dt>
                <dd>{result.info.esm.hasTypes ? 'Bundled' : 'Not bundled'}</dd>

                <dt>License</dt>
                <dd>{result.info.license ?? 'Unknown'}</dd>

                {downloads !== null && (
                  <>
                    <dt>Weekly downloads</dt>
                    <dd class="tnum">{downloads.toLocaleString()}</dd>
                  </>
                )}
              </dl>

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
                              <span class="bsc-bars__name" title={b.name}>
                                {b.name}
                              </span>
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
            </>
          )}
        </>
      ) : (
        <>
          <div class="tool-bar">
            <ShareLinkButton getState={shareState} describe="this dependency list" />
            <button type="button" class="btn" onClick={() => setPackageJsonText(BULK_EXAMPLE)} title="Fill in a sample package.json">
              Load example
            </button>
            <button type="button" class="btn" onClick={clearBulk} disabled={packageJsonText === '' && rows.length === 0} title="Clear and start over">
              Clear
            </button>
            <span class="tool-bar__spacer" />
            <label class="checkbox" title="Also check devDependencies, not just dependencies">
              <input type="checkbox" checked={includeDev} onChange={(e) => setIncludeDev((e.target as HTMLInputElement).checked)} />
              <span>Include devDependencies</span>
            </label>
          </div>

          <FileDropzone
            file={null}
            onFileSelected={(file) => {
              if (!file) return;
              void file.text().then(setPackageJsonText);
            }}
            chooseLabel="Choose a package.json file"
            accept="application/json,.json"
          />

          <div class="field">
            <label class="field__label" for="bsc-pkgjson">
              <span>package.json</span>
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

          <div class="tool-bar">
            {bulkStatus === 'running' ? (
              <button type="button" class="btn" onClick={cancelBulk}>
                Cancel
              </button>
            ) : (
              <button type="button" class="btn btn--primary" onClick={() => void runBulkCheck()} disabled={packageJsonText.trim() === ''}>
                Check all dependencies
              </button>
            )}
            {bulkStatus === 'running' && (
              <span class="field__hint">
                <span class="job__spinner" aria-hidden="true" /> Checked {progress.done} / {progress.total}…
              </span>
            )}
          </div>

          <ErrorMessage message={bulkError} />

          {rows.length > 0 && (
            <>
              <DependencyTable title="Dependencies" rows={dependencyRows} sortKey={sortKey} sortDirection={sortDirection} onToggleSort={toggleSort} />
              {devDependencyRows.length > 0 && (
                <DependencyTable
                  title="Dev Dependencies"
                  rows={devDependencyRows}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onToggleSort={toggleSort}
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
        .bsc-version { margin: 0; font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); }
        .bsc-version code { color: var(--text); font-weight: 600; }
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
        .bsc-speeds { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
        .bsc-speeds li { display: flex; justify-content: space-between; padding: 0.2rem 0; border-bottom: 1px solid var(--border); font-size: var(--text-sm); }
        .bsc-speeds li:last-child { border-bottom: none; }
        .bsc-speeds__label { color: var(--text-muted); }
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
        .bsc-bars__name { font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
