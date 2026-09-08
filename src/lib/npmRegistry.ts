/**
 * All the real `fetch()` calls this tool makes — to the public npm registry, npm's
 * download-stats API, and the esm.sh CDN, which bundles a package to a single ES module
 * on the fly. Deliberately kept separate from `lib/tools/bundleSize.ts` (pure logic, no
 * network) the same way `curlCommand.ts`'s request-building stays separate from the one
 * `fetch()` call in `CurlCommandBuilder.tsx` — everything about *what* to fetch and how to
 * read the response is pure and unit-tested; only the act of fetching lives here.
 *
 * This is the one tool on the site that talks to a third party at all — see the FAQ on
 * this tool's content page for what that means for the "nothing you paste ever leaves
 * your browser" promise (short version: a public package name isn't user data, and the
 * request goes straight from your browser to npm/esm.sh, never through any server this
 * site controls).
 */
import { type ToolResult, ok, err, messageFrom } from './tools/result';
import {
  buildEsmScopedUrl,
  buildEsmStandaloneUrl,
  buildPackageSearchUrl,
  buildRegistryOverviewUrl,
  buildRegistryVersionUrl,
  buildWeeklyDownloadsUrl,
  detectEsmSupport,
  normalizeLicense,
  type EsmSupport,
} from './tools/bundleSize';
import {
  buildDownloadsRangeUrl,
  buildGithubCommitsApiUrl,
  buildGithubRepoApiUrl,
  buildJsdelivrFileListUrl,
  buildJsdelivrFileUrl,
  parseLastPageFromLinkHeader,
  pickReadmePath,
  type DownloadDay,
} from './tools/packageInsights';

export interface PackageOverview {
  name: string;
  distTags: Record<string, string>;
  /** Every published version, ascending order as the registry returns them. */
  versions: string[];
  /** When anything about the package was last published, ISO-8601. Null if absent. */
  modified: string | null;
}

export interface ResolvedVersionInfo {
  version: string;
  license: string | null;
  description: string | null;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  unpackedSize: number | null;
  fileCount: number | null;
  esm: EsmSupport;
  repository: string | null;
  /** `repository.directory` — the package's sub-path inside a monorepo, if any. */
  repositoryDirectory: string | null;
  homepage: string | null;
  keywords: string[];
  /** The `deprecated` message npm shows on install, when the version is deprecated. */
  deprecated: string | null;
  /** The `engines.node` range, e.g. ">=18". */
  engineNode: string | null;
  maintainerCount: number | null;
}

/** The registry's lightweight "abbreviated" format (`Accept: application/vnd.npm.install-v1+json`)
 *  — enough to resolve a version, a fraction of the size of the full multi-version document
 *  a popular package like `lodash` would otherwise return. */
export async function fetchPackageOverview(name: string): Promise<ToolResult<PackageOverview>> {
  try {
    const response = await fetch(buildRegistryOverviewUrl(name), {
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
    });
    if (response.status === 404) return err(`"${name}" isn't a package on the npm registry.`);
    if (!response.ok) return err(`The npm registry returned an error (${response.status}) for "${name}".`);

    const json = (await response.json()) as {
      'dist-tags'?: Record<string, string>;
      versions?: Record<string, unknown>;
      modified?: unknown;
    };
    const distTags = json['dist-tags'] ?? {};
    const versions = Object.keys(json.versions ?? {});
    if (versions.length === 0) return err(`"${name}" has no published versions.`);
    return ok({ name, distTags, versions, modified: typeof json.modified === 'string' ? json.modified : null });
  } catch (error) {
    return err(messageFrom(error, `Could not reach the npm registry to look up "${name}".`));
  }
}

/** The full document for one specific version — small (one version, not the whole
 *  history) and carries the fields the abbreviated format omits: license, unpacked size,
 *  `module`/`exports`/`sideEffects` for the ESM/tree-shaking indicators. */
export async function fetchResolvedVersion(name: string, version: string): Promise<ToolResult<ResolvedVersionInfo>> {
  try {
    const response = await fetch(buildRegistryVersionUrl(name, version));
    if (response.status === 404) return err(`${name}@${version} was not found on the npm registry.`);
    if (!response.ok) return err(`The npm registry returned an error (${response.status}) for ${name}@${version}.`);

    const pkg = (await response.json()) as {
      version?: string;
      license?: unknown;
      description?: unknown;
      dependencies?: unknown;
      peerDependencies?: unknown;
      dist?: { unpackedSize?: number; fileCount?: number };
      repository?: unknown;
      homepage?: unknown;
      keywords?: unknown;
      deprecated?: unknown;
      engines?: unknown;
      maintainers?: unknown;
      main?: unknown;
      module?: unknown;
      type?: unknown;
      exports?: unknown;
      sideEffects?: unknown;
      types?: unknown;
      typings?: unknown;
    };

    const record = (value: unknown): Record<string, string> =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {};

    // `repository` is either a plain shorthand string or a `{ type, url, directory }`
    // object — the object form is the only one that can point at a package inside a
    // monorepo, which is what `directory` is for.
    const repositoryObject =
      pkg.repository && typeof pkg.repository === 'object' ? (pkg.repository as { url?: unknown; directory?: unknown }) : null;
    const repository =
      typeof pkg.repository === 'string'
        ? pkg.repository
        : typeof repositoryObject?.url === 'string'
          ? repositoryObject.url
          : null;

    const engines = record(pkg.engines);

    return ok({
      version: pkg.version ?? version,
      license: normalizeLicense(pkg.license),
      description: typeof pkg.description === 'string' ? pkg.description : null,
      dependencies: record(pkg.dependencies),
      peerDependencies: record(pkg.peerDependencies),
      unpackedSize: pkg.dist?.unpackedSize ?? null,
      fileCount: pkg.dist?.fileCount ?? null,
      esm: detectEsmSupport(pkg),
      repository,
      repositoryDirectory: typeof repositoryObject?.directory === 'string' ? repositoryObject.directory : null,
      homepage: typeof pkg.homepage === 'string' ? pkg.homepage : null,
      keywords: Array.isArray(pkg.keywords) ? pkg.keywords.filter((k): k is string => typeof k === 'string') : [],
      deprecated: typeof pkg.deprecated === 'string' ? pkg.deprecated : pkg.deprecated === true ? 'This version is deprecated.' : null,
      engineNode: typeof engines.node === 'string' ? engines.node : null,
      maintainerCount: Array.isArray(pkg.maintainers) ? pkg.maintainers.length : null,
    });
  } catch (error) {
    return err(messageFrom(error, `Could not reach the npm registry for ${name}@${version}.`));
  }
}

/** Optional stat, not load-bearing for the core size measurement — a failure here should
 *  never block showing the size results, so callers treat this as best-effort. */
export async function fetchWeeklyDownloads(name: string): Promise<ToolResult<number>> {
  try {
    const response = await fetch(buildWeeklyDownloadsUrl(name));
    if (!response.ok) return err(`Download stats aren't available for "${name}".`);
    const json = (await response.json()) as { downloads?: unknown };
    if (typeof json.downloads !== 'number') return err(`Download stats aren't available for "${name}".`);
    return ok(json.downloads);
  } catch (error) {
    return err(messageFrom(error, 'Could not fetch download stats.'));
  }
}

export interface PackageSuggestion {
  name: string;
  version: string;
  description: string | null;
}

/** Powers the "type to see matching packages" suggestions — best-effort: callers should
 *  treat a failure here as "no suggestions right now," never as a blocking error. */
export async function searchPackages(query: string, signal?: AbortSignal): Promise<ToolResult<PackageSuggestion[]>> {
  try {
    const response = await fetch(buildPackageSearchUrl(query), { signal });
    if (!response.ok) return err(`Search failed (${response.status}).`);
    const json = (await response.json()) as {
      objects?: { package?: { name?: unknown; version?: unknown; description?: unknown } }[];
    };
    const suggestions = (json.objects ?? [])
      .map((o) => o.package)
      .filter((p): p is { name: string; version?: unknown; description?: unknown } => typeof p?.name === 'string')
      .map((p) => ({
        name: p.name,
        version: typeof p.version === 'string' ? p.version : '',
        description: typeof p.description === 'string' ? p.description : null,
      }));
    return ok(suggestions);
  } catch (error) {
    return err(messageFrom(error, 'Could not search for packages.'));
  }
}

const JS_CONTENT_TYPE_RE = /javascript|ecmascript/i;
const ESM_SH_ORIGIN = 'https://esm.sh';

function bundleErrorMessage(name: string, version: string, status: number, body: string): string {
  const snippet = body.trim().replace(/\s+/g, ' ').slice(0, 200);
  return (
    `Could not bundle ${name}@${version} (the CDN responded ${status}${snippet ? `: "${snippet}"` : ''}). ` +
    'This can happen for a CommonJS-only package when checking a scoped/named-import cost, ' +
    'a package with native bindings that can\'t run in a browser, or a version that was unpublished.'
  );
}

/** Matches every quoted specifier that follows `from`, a bare side-effect `import "…"`, or
 *  a dynamic `import("…")` — the three ways an ES module can reference another file. */
const IMPORT_SPECIFIER_RE = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;

function extractRelativeImports(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(IMPORT_SPECIFIER_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    // Only same-origin, path-absolute specifiers ("/pkg@1.2.3/…") are esm.sh's own chunk
    // files for *this* package — a bare or absolute-URL specifier would be a genuinely
    // external package, which `?standalone`/`?exports=` already promise to have inlined,
    // so one showing up here is left alone rather than silently fetched.
    if (specifier && specifier.startsWith('/')) found.push(specifier);
  }
  return found;
}

const MAX_GRAPH_FILES = 300;

/**
 * esm.sh doesn't actually inline a package into one HTTP response, even with `?standalone`
 * — fetching the URL alone usually returns a tiny facade like
 * `export * from "/react@18.3.1/es2022/react.bundle.mjs"` that just re-exports from
 * another esm.sh-hosted file (sometimes several, one per internal module — e.g. date-fns
 * ships one file per date function). Terser has no bundler in it and can't follow those
 * imports, so minifying the facade alone silently measures ~150 bytes of re-export syntax
 * instead of the real package. This walks every same-origin (`/…`) import reachable from
 * the entry file — which is always internal to the one package being measured, since a
 * genuinely external dependency is a bare or absolute specifier `?standalone` inlines
 * instead — fetching each exactly once and concatenating the real, already-minified
 * source before it ever reaches `measureBundleSize`.
 */
async function fetchEsmModuleGraph(entryUrl: string, name: string, version: string): Promise<ToolResult<string>> {
  const visited = new Set<string>();
  const queue: string[] = [entryUrl];
  const parts: string[] = [];

  while (queue.length > 0) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    if (visited.size > MAX_GRAPH_FILES) {
      return err(`${name}@${version} is bundled across more than ${MAX_GRAPH_FILES} files — too many to fully measure in the browser.`);
    }

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      return err(messageFrom(error, `Could not bundle ${name}@${version} — the CDN that bundles it may be unreachable.`));
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !JS_CONTENT_TYPE_RE.test(contentType)) {
      const body = await response.text();
      return err(bundleErrorMessage(name, version, response.status, body));
    }

    const code = await response.text();
    parts.push(code);
    for (const specifier of extractRelativeImports(code)) queue.push(`${ESM_SH_ORIGIN}${specifier}`);
  }

  return ok(parts.join('\n'));
}

/**
 * Fetches the package pre-bundled into ES module(s) from esm.sh — `?standalone` inlines
 * every *other* npm package it depends on for a total-cost measurement, or `?exports=a,b`
 * for a tree-shaken "cost of just these named imports" measurement when `exportNames` is
 * given — then walks and concatenates the real module graph (see `fetchEsmModuleGraph`).
 */
export async function fetchBundledSource(name: string, version: string, exportNames: string[] = []): Promise<ToolResult<string>> {
  const url = exportNames.length > 0 ? buildEsmScopedUrl(name, version, exportNames) : buildEsmStandaloneUrl(name, version);
  return fetchEsmModuleGraph(url, name, version);
}

/**
 * Runs `worker` over `items` with at most `limit` in flight at once — bulk (package.json)
 * mode can list dozens of dependencies, and firing all their requests simultaneously
 * against a free public CDN and registry would be both slow (connection contention) and
 * inconsiderate of a service this site doesn't run. `onProgress` fires after each
 * completion; passing an already-aborted `signal`, or aborting mid-run, stops queuing new
 * work and resolves once in-flight items finish (results for not-yet-started items are
 * omitted from the returned array, in original order for the ones that did run).
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  let done = 0;
  const total = items.length;

  async function runOne(): Promise<void> {
    for (;;) {
      if (signal?.aborted) return;
      const index = nextIndex;
      if (index >= items.length) return;
      nextIndex += 1;
      const result = await worker(items[index]!, index);
      results[index] = result;
      done += 1;
      onProgress?.(done, total);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runOne());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------- Repository statistics

export interface RepoStats {
  stars: number;
  forks: number;
  watchers: number;
  /** GitHub's `open_issues_count`, which counts open pull requests as issues too — the
   *  REST API exposes no separate open-issue count without a second, far more heavily
   *  rate-limited search request, so this is labelled honestly in the UI rather than
   *  presented as a pure issue count it isn't. */
  openIssuesAndPulls: number;
  /** ISO-8601 creation date — how old the project is. */
  createdAt: string | null;
  /** ISO-8601 date of the most recent push to any branch. */
  pushedAt: string | null;
  archived: boolean;
  topics: string[];
  description: string | null;
  defaultBranch: string | null;
  htmlUrl: string;
}

/** GitHub allows 60 unauthenticated API calls an hour per IP. This tool has no backend
 *  and therefore no token, so a heavy session legitimately runs out — that has to read as
 *  "come back later", not as a broken tool, which is why it gets its own message. */
const GITHUB_RATE_LIMIT_MESSAGE =
  "GitHub's anonymous API rate limit (60 requests an hour) has been reached, so repository stats aren't available right now. Everything else on this page still works.";

function isGithubRateLimited(response: Response): boolean {
  return (response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0';
}

/** Best-effort, like the download stats: repository metadata enriches the result but must
 *  never block or fail the size measurement that is the point of the tool. */
export async function fetchRepoStats(owner: string, repo: string, signal?: AbortSignal): Promise<ToolResult<RepoStats>> {
  try {
    const response = await fetch(buildGithubRepoApiUrl(owner, repo), {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    });
    if (isGithubRateLimited(response)) return err(GITHUB_RATE_LIMIT_MESSAGE);
    if (response.status === 404) return err(`The repository ${owner}/${repo} no longer exists, or is private.`);
    if (!response.ok) return err(`GitHub returned an error (${response.status}) for ${owner}/${repo}.`);

    const json = (await response.json()) as {
      stargazers_count?: unknown;
      forks_count?: unknown;
      subscribers_count?: unknown;
      open_issues_count?: unknown;
      created_at?: unknown;
      pushed_at?: unknown;
      archived?: unknown;
      topics?: unknown;
      description?: unknown;
      default_branch?: unknown;
      html_url?: unknown;
    };
    const count = (value: unknown): number => (typeof value === 'number' ? value : 0);

    return ok({
      stars: count(json.stargazers_count),
      forks: count(json.forks_count),
      watchers: count(json.subscribers_count),
      openIssuesAndPulls: count(json.open_issues_count),
      createdAt: typeof json.created_at === 'string' ? json.created_at : null,
      pushedAt: typeof json.pushed_at === 'string' ? json.pushed_at : null,
      archived: json.archived === true,
      topics: Array.isArray(json.topics) ? json.topics.filter((t): t is string => typeof t === 'string') : [],
      description: typeof json.description === 'string' ? json.description : null,
      defaultBranch: typeof json.default_branch === 'string' ? json.default_branch : null,
      htmlUrl: typeof json.html_url === 'string' ? json.html_url : `https://github.com/${owner}/${repo}`,
    });
  } catch (error) {
    return err(messageFrom(error, `Could not reach GitHub for ${owner}/${repo}.`));
  }
}

export interface CommitActivity {
  /** Total commits on the default branch, or null when GitHub returned no pagination
   *  information to read a total from (see `parseLastPageFromLinkHeader`). */
  totalCommits: number | null;
  lastCommitDate: string | null;
  lastCommitMessage: string | null;
  lastCommitAuthor: string | null;
  lastCommitUrl: string | null;
}

/**
 * Total commit count plus the most recent commit, from a single request. Asking for one
 * commit per page makes the last page number equal the total commit count, and the one
 * commit that comes back in the body is the newest one — so "how many commits" and "when
 * was the last commit" cost one request between them rather than two, which matters
 * against a 60-per-hour anonymous rate limit.
 */
export async function fetchCommitActivity(
  owner: string,
  repo: string,
  signal?: AbortSignal
): Promise<ToolResult<CommitActivity>> {
  try {
    const response = await fetch(buildGithubCommitsApiUrl(owner, repo), {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    });
    if (isGithubRateLimited(response)) return err(GITHUB_RATE_LIMIT_MESSAGE);
    // 409 is GitHub's answer for a repository that has no commits at all.
    if (response.status === 409) {
      return ok({ totalCommits: 0, lastCommitDate: null, lastCommitMessage: null, lastCommitAuthor: null, lastCommitUrl: null });
    }
    if (!response.ok) return err(`GitHub returned an error (${response.status}) reading commits for ${owner}/${repo}.`);

    const commits = (await response.json()) as {
      html_url?: unknown;
      commit?: { message?: unknown; author?: { name?: unknown; date?: unknown } };
    }[];
    const latest = Array.isArray(commits) ? commits[0] : undefined;
    const message = latest?.commit?.message;
    const authorDate = latest?.commit?.author?.date;
    const authorName = latest?.commit?.author?.name;

    // No `rel="last"` link means a single page, which at one commit per page is 0 or 1.
    const lastPage = parseLastPageFromLinkHeader(response.headers.get('link'));

    return ok({
      totalCommits: lastPage ?? (latest ? 1 : 0),
      lastCommitDate: typeof authorDate === 'string' ? authorDate : null,
      lastCommitMessage: typeof message === 'string' ? (message.split('\n')[0] ?? null) : null,
      lastCommitAuthor: typeof authorName === 'string' ? authorName : null,
      lastCommitUrl: typeof latest?.html_url === 'string' ? latest.html_url : null,
    });
  } catch (error) {
    return err(messageFrom(error, `Could not reach GitHub for the commit history of ${owner}/${repo}.`));
  }
}

// ------------------------------------------------------------------------------ README

/**
 * The package's own README, exactly as published in its tarball, read from the jsDelivr CDN.
 *
 * npm's registry only carries a README on the *full* packument — the document listing
 * every version at once, which for a popular package is megabytes and which this tool
 * deliberately never fetches (see the abbreviated format in `fetchPackageOverview`).
 * jsDelivr serves the published tarball with CORS and no rate limit, so two small
 * requests — list the version's files, then fetch whichever one is the README — get the
 * README for the precise version being measured, not just for whatever `latest` is today.
 */
export async function fetchReadme(name: string, version: string, signal?: AbortSignal): Promise<ToolResult<string>> {
  try {
    const listing = await fetch(buildJsdelivrFileListUrl(name, version), { signal });
    if (!listing.ok) return err(`No README is available for ${name}@${version}.`);

    const json = (await listing.json()) as { files?: { name?: unknown }[] };
    const paths = (json.files ?? []).map((f) => f.name).filter((n): n is string => typeof n === 'string');
    const readmePath = pickReadmePath(paths);
    if (!readmePath) return err(`${name}@${version} doesn't ship a README file in its published package.`);

    const file = await fetch(buildJsdelivrFileUrl(name, version, readmePath), { signal });
    if (!file.ok) return err(`Could not download the README for ${name}@${version} (${file.status}).`);
    return ok(await file.text());
  } catch (error) {
    return err(messageFrom(error, `Could not fetch the README for ${name}@${version}.`));
  }
}

// ----------------------------------------------------------------------- Download trend

/** Per-day download counts for the last month — the shape of the trend says more about a
 *  package's health than one week's total does. Best-effort, like every other stat here. */
export async function fetchDownloadTrend(name: string, signal?: AbortSignal): Promise<ToolResult<DownloadDay[]>> {
  try {
    const response = await fetch(buildDownloadsRangeUrl(name), { signal });
    if (!response.ok) return err(`Download history isn't available for "${name}".`);
    const json = (await response.json()) as { downloads?: { day?: unknown; downloads?: unknown }[] };
    const days = (json.downloads ?? [])
      .filter((d): d is { day: string; downloads: number } => typeof d.day === 'string' && typeof d.downloads === 'number')
      .map((d) => ({ day: d.day, downloads: d.downloads }));
    if (days.length === 0) return err(`Download history isn't available for "${name}".`);
    return ok(days);
  } catch (error) {
    return err(messageFrom(error, 'Could not fetch download history.'));
  }
}
