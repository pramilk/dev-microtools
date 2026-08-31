import { type ToolResult, ok, err, messageFrom } from './result';
import { gzip } from '../compression';

// ------------------------------------------------------------------- Package spec parsing

export interface PackageSpec {
  name: string;
  /** null means "no version given" — resolve to the "latest" dist-tag. */
  range: string | null;
}

// Deliberately permissive rather than a full npm-name spec: this only needs to catch
// obviously-wrong input before a network round trip, not replicate the registry's own
// validation — the registry is the real source of truth for whether a name exists.
const NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** The package-name portion of whatever's been typed so far, stripping any version/range
 *  after "@" — used to query package search while the field is still being edited. */
export function packageSearchQuery(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return '';

  let rest = trimmed;
  let scope = '';
  if (rest.startsWith('@')) {
    const slash = rest.indexOf('/');
    if (slash === -1) return trimmed;
    scope = rest.slice(0, slash + 1);
    rest = rest.slice(slash + 1);
  }
  const at = rest.indexOf('@');
  return scope + (at === -1 ? rest : rest.slice(0, at));
}

/** Parses "lodash", "lodash@4.17.21", "lodash@^4", or "@scope/name@1.2.3" into a name + range. */
export function parsePackageSpec(input: string): ToolResult<PackageSpec> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter a package name, e.g. "lodash" or "lodash@^4".');
  if (/\s/.test(trimmed)) {
    return err(`"${trimmed}" isn't a valid package spec — package names and versions can't contain spaces.`);
  }

  let rest = trimmed;
  let scope = '';
  if (rest.startsWith('@')) {
    const slash = rest.indexOf('/');
    if (slash === -1) {
      return err(`"${trimmed}" looks like a scoped package but is missing the "/name" part, e.g. "@scope/name".`);
    }
    scope = rest.slice(0, slash + 1);
    rest = rest.slice(slash + 1);
  }

  const at = rest.indexOf('@');
  const namePart = at === -1 ? rest : rest.slice(0, at);
  const range = at === -1 ? null : rest.slice(at + 1);
  const name = scope + namePart;

  if (!NAME_RE.test(name)) {
    return err(`"${name}" doesn't look like a valid npm package name.`);
  }
  if (range === '') {
    return err(`"${trimmed}" has a trailing "@" with no version after it.`);
  }
  return ok({ name, range });
}

// ------------------------------------------------------------------------- Semver ranges

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/;

export function parseVersion(value: string): ParsedVersion | null {
  const match = SEMVER_RE.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareIdentifiers(a: string, b: string): number {
  const aNum = /^\d+$/.test(a) ? Number(a) : null;
  const bNum = /^\d+$/.test(b) ? Number(b) : null;
  if (aNum !== null && bNum !== null) return aNum - bNum;
  if (aNum !== null) return -1; // numeric identifiers sort before alphanumeric ones
  if (bNum !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Standard semver precedence: a version without a prerelease outranks one with. Build
 *  metadata and exotic identifier-comparison edge cases beyond this are out of scope —
 *  this only needs to pick a sensible version to size, not adjudicate disputes. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;
    const cmp = compareIdentifiers(a.prerelease[i]!, b.prerelease[i]!);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

interface Comparator {
  op: '=' | '>=' | '<=' | '>' | '<';
  version: ParsedVersion;
}

/** Expands "1.2.x", "1.x", "*", a bare version, or an explicit operator into >=/< bounds. */
function expandSimpleRange(part: string): Comparator[] | null {
  const trimmed = part.trim();
  if (trimmed === '' || trimmed === '*' || trimmed.toLowerCase() === 'x') return [];

  const caret = /^\^(.+)$/.exec(trimmed);
  if (caret) {
    const v = parseVersion(caret[1]!);
    if (!v) return null;
    const upper =
      v.major > 0
        ? { major: v.major + 1, minor: 0, patch: 0, prerelease: [] }
        : v.minor > 0
          ? { major: 0, minor: v.minor + 1, patch: 0, prerelease: [] }
          : { major: 0, minor: 0, patch: v.patch + 1, prerelease: [] };
    return [
      { op: '>=', version: v },
      { op: '<', version: upper },
    ];
  }

  const tilde = /^~(.+)$/.exec(trimmed);
  if (tilde) {
    const v = parseVersion(tilde[1]!);
    if (!v) return null;
    const upper = { major: v.major, minor: v.minor + 1, patch: 0, prerelease: [] };
    return [
      { op: '>=', version: v },
      { op: '<', version: upper },
    ];
  }

  const xRange = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(trimmed);
  if (xRange && (xRange[2] === undefined || /^[xX*]$/.test(xRange[2]) || xRange[3] === undefined || /^[xX*]$/.test(xRange[3]))) {
    const major = Number(xRange[1]);
    if (xRange[2] === undefined || /^[xX*]$/.test(xRange[2])) {
      return [
        { op: '>=', version: { major, minor: 0, patch: 0, prerelease: [] } },
        { op: '<', version: { major: major + 1, minor: 0, patch: 0, prerelease: [] } },
      ];
    }
    const minor = Number(xRange[2]);
    return [
      { op: '>=', version: { major, minor, patch: 0, prerelease: [] } },
      { op: '<', version: { major, minor: minor + 1, patch: 0, prerelease: [] } },
    ];
  }

  const comparator = /^(>=|<=|>|<|=)?(.+)$/.exec(trimmed);
  if (comparator) {
    const v = parseVersion(comparator[2]!.trim());
    if (!v) return null;
    return [{ op: (comparator[1] as Comparator['op']) ?? '=', version: v }];
  }

  return null;
}

/** Splits "1.2.3 - 2.3.4" (an inclusive hyphen range) into >=/<= comparators. */
function expandHyphenRange(part: string): Comparator[] | null {
  const match = /^(.+?)\s-\s(.+)$/.exec(part.trim());
  if (!match) return null;
  const from = parseVersion(match[1]!.trim());
  const to = parseVersion(match[2]!.trim());
  if (!from || !to) return null;
  return [
    { op: '>=', version: from },
    { op: '<=', version: to },
  ];
}

function satisfiesComparators(version: ParsedVersion, comparators: Comparator[]): boolean {
  return comparators.every(({ op, version: bound }) => {
    const cmp = compareVersions(version, bound);
    if (op === '=') return cmp === 0;
    if (op === '>=') return cmp >= 0;
    if (op === '<=') return cmp <= 0;
    if (op === '>') return cmp > 0;
    return cmp < 0;
  });
}

/**
 * Approximate semver range matching covering the ranges that actually show up in a
 * package.json in practice: exact versions, `^`/`~`, x-ranges/`*`, plain comparators
 * (`>=`, space-separated AND), hyphen ranges, and `||` OR groups. Exotic combinations a
 * full semver implementation would handle (build-metadata comparison, nested OR/AND
 * nesting) fall back to "no match", which callers treat as "resolve to latest instead."
 *
 * A prerelease version (e.g. "2.0.0-beta.1") only matches when the range explicitly
 * targets that same major.minor.patch — mirroring real semver's rule that prereleases
 * are excluded from a general range like "^1.0.0" unless asked for by version.
 */
export function satisfiesRange(versionText: string, range: string): boolean {
  const version = parseVersion(versionText);
  if (!version) return false;

  const trimmedRange = range.trim();
  if (trimmedRange === '' || trimmedRange === '*' || trimmedRange.toLowerCase() === 'latest') return version.prerelease.length === 0;

  const orGroups = trimmedRange.split('||').map((g) => g.trim());
  return orGroups.some((group) => {
    const hyphen = expandHyphenRange(group);
    const comparators = hyphen ?? group.split(/\s+/).flatMap((part) => expandSimpleRange(part) ?? []);
    if (!hyphen && group.split(/\s+/).some((part) => expandSimpleRange(part) === null)) return false;

    const isPrereleaseVersion = version.prerelease.length > 0;
    if (isPrereleaseVersion) {
      const targetsSamePrerelease = comparators.some(
        (c) => c.version.major === version.major && c.version.minor === version.minor && c.version.patch === version.patch && c.version.prerelease.length > 0
      );
      if (!targetsSamePrerelease) return false;
    }

    return satisfiesComparators(version, comparators);
  });
}

/** Highest published version satisfying `range`, or null if none does (or the range
 *  can't be parsed) — callers fall back to the "latest" dist-tag in that case. */
export function maxSatisfying(versions: string[], range: string): string | null {
  const matching = versions.filter((v) => satisfiesRange(v, range));
  if (matching.length === 0) return null;
  matching.sort((a, b) => compareVersions(parseVersion(b)!, parseVersion(a)!));
  return matching[0]!;
}

/**
 * The highest non-prerelease published version for each major release, most recent major
 * first, capped at `limit` majors — e.g. for react's published versions this returns one
 * entry each for majors 19, 18, 17… down to `limit` of them. Powers "compare across major
 * versions": each entry is one real package to fetch and measure, so this only decides
 * *which* versions are worth that cost, not how to measure them.
 */
export function latestPerMajor(versions: string[], limit = 6): string[] {
  const byMajor = new Map<number, ParsedVersion & { text: string }>();
  for (const text of versions) {
    const parsed = parseVersion(text);
    if (!parsed || parsed.prerelease.length > 0) continue;
    const existing = byMajor.get(parsed.major);
    if (!existing || compareVersions(parsed, existing) > 0) byMajor.set(parsed.major, { ...parsed, text });
  }
  return [...byMajor.values()]
    .sort((a, b) => b.major - a.major)
    .slice(0, limit)
    .map((v) => v.text);
}

// ------------------------------------------------------------------- package.json parsing

export interface PackageJsonDependency {
  name: string;
  range: string;
  source: 'dependencies' | 'devDependencies';
}

const UNRESOLVABLE_RANGE_RE = /^(workspace:|file:|link:|git\+|git:|github:|https?:|portal:|patch:)/i;

/** True for a normal registry version range; false for a workspace/git/file/URL
 *  reference that can't be resolved against the public npm registry. */
export function isResolvableRange(range: string): boolean {
  return !UNRESOLVABLE_RANGE_RE.test(range.trim());
}

/** Extracts `dependencies` (and optionally `devDependencies`) from pasted package.json
 *  text. A name already found in `dependencies` is never duplicated from `devDependencies`. */
export function parsePackageJsonDependencies(text: string, includeDevDependencies: boolean): ToolResult<PackageJsonDependency[]> {
  const trimmed = text.trim();
  if (trimmed === '') return err('Paste a package.json, or drop one in below.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return err(`This isn't valid JSON: ${messageFrom(error, 'parse error')}.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err('This is valid JSON, but not a package.json object.');
  }

  const obj = parsed as Record<string, unknown>;
  const deps: PackageJsonDependency[] = [];
  const seen = new Set<string>();

  const collect = (field: 'dependencies' | 'devDependencies') => {
    const value = obj[field];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
    for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
      if (seen.has(name) || typeof range !== 'string') continue;
      seen.add(name);
      deps.push({ name, range, source: field });
    }
  };

  collect('dependencies');
  if (includeDevDependencies) collect('devDependencies');

  if (deps.length === 0) {
    return err(
      includeDevDependencies
        ? 'No "dependencies" or "devDependencies" found in this package.json.'
        : 'No "dependencies" found in this package.json — try including devDependencies too.'
    );
  }
  return ok(deps);
}

// ------------------------------------------------------------------------------ Size measurement

export interface SizeResult {
  minifiedBytes: number;
  gzipBytes: number;
}

let terserModule: typeof import('terser') | null = null;
async function loadTerser(): Promise<typeof import('terser')> {
  terserModule ??= await import('terser');
  return terserModule;
}

/**
 * Re-minifies fetched bundle code with Terser (already a dependency — the same one
 * `html-css-js-minifier` uses) so every package is measured with the same methodology,
 * regardless of whether the CDN that bundled it already minified its own output. Gzip
 * size comes from the browser's native `CompressionStream`, same technique `shareLink.ts`
 * uses for share-link payloads — no bundler or brotli dependency needed for either step.
 */
export async function measureBundleSize(code: string): Promise<ToolResult<SizeResult>> {
  try {
    const terser = await loadTerser();
    const result = await terser.minify(code, { module: true, compress: true, mangle: true });
    const minifiedCode = result.code ?? code;
    const minifiedBytes = new TextEncoder().encode(minifiedCode).length;
    const gzipBytes = (await gzip(new TextEncoder().encode(minifiedCode))).length;
    return ok({ minifiedBytes, gzipBytes });
  } catch (error) {
    return err(messageFrom(error, 'Could not measure the minified size of the bundled code.'));
  }
}

// --------------------------------------------------------------------------------- ESM/size

export interface EsmSupport {
  /** A `module`/`exports.import` field, or `"type": "module"`. */
  hasEsmEntry: boolean;
  sideEffects: 'free' | 'has-side-effects' | 'unspecified';
  hasTypes: boolean;
}

function exportsHasCondition(exportsField: unknown, condition: string): boolean {
  if (exportsField === null || typeof exportsField !== 'object') return false;
  for (const [key, value] of Object.entries(exportsField as Record<string, unknown>)) {
    if (key === condition) return true;
    if (typeof value === 'object' && value !== null && exportsHasCondition(value, condition)) return true;
  }
  return false;
}

export interface RegistryVersionRaw {
  module?: unknown;
  type?: unknown;
  exports?: unknown;
  sideEffects?: unknown;
  types?: unknown;
  typings?: unknown;
}

/** Reads ESM/tree-shaking signals straight from a version's registry package.json data. */
export function detectEsmSupport(pkg: RegistryVersionRaw): EsmSupport {
  const hasEsmEntry =
    typeof pkg.module === 'string' || pkg.type === 'module' || exportsHasCondition(pkg.exports, 'import');

  const sideEffects: EsmSupport['sideEffects'] =
    pkg.sideEffects === false
      ? 'free'
      : Array.isArray(pkg.sideEffects)
        ? pkg.sideEffects.length === 0
          ? 'free'
          : 'has-side-effects'
        : pkg.sideEffects === true
          ? 'has-side-effects'
          : 'unspecified';

  const hasTypes = typeof pkg.types === 'string' || typeof pkg.typings === 'string' || exportsHasCondition(pkg.exports, 'types');

  return { hasEsmEntry, sideEffects, hasTypes };
}

/** Normalises the registry's `license` field, which varies across npm's history: a plain
 *  string today, `{type, url}` or `[{type}, ...]` in packages published before 2015. */
export function normalizeLicense(license: unknown): string | null {
  if (typeof license === 'string') return license;
  if (Array.isArray(license) && license.length > 0) {
    const first = license[0] as { type?: unknown } | undefined;
    return typeof first?.type === 'string' ? first.type : null;
  }
  if (license && typeof license === 'object' && 'type' in license) {
    const type = (license as { type?: unknown }).type;
    return typeof type === 'string' ? type : null;
  }
  return null;
}

// -------------------------------------------------------------------------- Download time

export interface ConnectionSpeed {
  label: string;
  kbps: number;
}

/** Rough, commonly-cited throughput figures (kbit/s) — real-world speed varies far more
 *  than any single number, so these exist to give a sense of scale, not a guarantee. */
export const CONNECTION_SPEEDS: ConnectionSpeed[] = [
  { label: 'Slow 3G', kbps: 400 },
  { label: 'Fast 3G', kbps: 1_600 },
  { label: '4G / LTE', kbps: 12_000 },
  { label: 'Wi-Fi / broadband', kbps: 40_000 },
];

export function estimateDownloadSeconds(gzipBytes: number, kbps: number): number {
  return (gzipBytes * 8) / (kbps * 1000);
}

export function compressionRatio(minifiedBytes: number, gzipBytes: number): number {
  if (minifiedBytes <= 0) return 0;
  return 1 - gzipBytes / minifiedBytes;
}

// --------------------------------------------------------------------------- esm.sh URLs

/** Bundles the package and its (non-peer) dependencies into a single ESM file — used to
 *  measure the full "cost of importing this package" the way it would ship in an app. */
export function buildEsmStandaloneUrl(name: string, version: string): string {
  return `https://esm.sh/${name}@${version}?standalone`;
}

/** esm.sh tree-shakes to only the named exports listed, via esbuild — used for the
 *  "cost of importing just these names" scoped mode. Doesn't work for CJS-only packages. */
export function buildEsmScopedUrl(name: string, version: string, exportNames: string[]): string {
  const list = exportNames
    .map((n) => n.trim())
    .filter(Boolean)
    .join(',');
  return `https://esm.sh/${name}@${version}?exports=${encodeURIComponent(list)}`;
}

export function buildRegistryOverviewUrl(name: string): string {
  return `https://registry.npmjs.org/${name}`;
}

export function buildRegistryVersionUrl(name: string, version: string): string {
  return `https://registry.npmjs.org/${name}/${version}`;
}

export function buildWeeklyDownloadsUrl(name: string): string {
  return `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`;
}

/** npm's own package-search endpoint (also public/CORS-enabled) — powers the "type to see
 *  matching packages" suggestions, the same search npmjs.com's own site box uses. */
export function buildPackageSearchUrl(query: string, size = 8): string {
  return `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`;
}

// ------------------------------------------------------------------------------- Sorting

export interface SizedRow {
  minifiedBytes: number | null;
  gzipBytes: number | null;
}

export type SortKey = 'name' | 'gzip' | 'minified';
export type SortDirection = 'asc' | 'desc';

/** Rows without a measured size (still loading, or errored) always sort last, regardless
 *  of direction — an unknown size should never look like the smallest dependency. */
export function sortRows<T extends SizedRow & { name: string }>(rows: T[], key: SortKey, direction: SortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'name') return sign * a.name.localeCompare(b.name);
    const field = key === 'gzip' ? 'gzipBytes' : 'minifiedBytes';
    const av = a[field];
    const bv = b[field];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sign * (av - bv);
  });
}
