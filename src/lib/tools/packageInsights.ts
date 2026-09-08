/**
 * Pure helpers for everything the Bundle Size Checker shows *around* the size number —
 * where a package's source lives, its README, and the repository/download stats that say
 * whether it is actively maintained.
 *
 * Kept separate from `bundleSize.ts` (which is about measuring bytes) because these
 * answer a different question: "should I depend on this at all?" rather than "how big is
 * it?". As with `bundleSize.ts`, nothing here performs a `fetch` — URL building and
 * response *shaping* are pure and unit-tested; the requests themselves live in
 * `lib/npmRegistry.ts`.
 */

// --------------------------------------------------------------------- Repository links

export type RepositoryHost = 'github' | 'gitlab' | 'bitbucket' | 'other';

export interface RepositoryRef {
  host: RepositoryHost;
  /** Owner/org — only resolved for the hosts whose URL shape is known. */
  owner: string | null;
  repo: string | null;
  /** A browsable https URL, safe to render as a link. */
  url: string;
  /** Sub-path within a monorepo, from the registry's `repository.directory` field. */
  directory: string | null;
}

const HOST_BY_DOMAIN: Record<string, RepositoryHost> = {
  'github.com': 'github',
  'www.github.com': 'github',
  'gitlab.com': 'gitlab',
  'www.gitlab.com': 'gitlab',
  'bitbucket.org': 'bitbucket',
  'www.bitbucket.org': 'bitbucket',
};

/**
 * Normalises the many shapes npm's `repository` field takes into one browsable https URL
 * plus, where the host is recognised, the owner/repo pair that host's API needs.
 *
 * The registry has accumulated every form git itself accepts over the years:
 * `git+https://github.com/o/r.git`, `git://…`, `git+ssh://git@github.com/o/r.git`, the
 * scp-style `git@github.com:o/r.git`, the `github:o/r` shorthand, and the bare `o/r`
 * shorthand. They all mean the same repository, and none of them is a URL a browser can
 * open as written.
 */
export function parseRepositoryUrl(raw: string, directory: string | null = null): RepositoryRef | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // `github:owner/repo`, `gitlab:owner/repo`, `bitbucket:owner/repo`, or bare `owner/repo`.
  const shorthand = /^(?:(github|gitlab|bitbucket):)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(trimmed);
  if (shorthand && !trimmed.includes('://') && !trimmed.includes('@')) {
    const host = (shorthand[1]?.toLowerCase() ?? 'github') as RepositoryHost;
    const domain = host === 'gitlab' ? 'gitlab.com' : host === 'bitbucket' ? 'bitbucket.org' : 'github.com';
    const owner = shorthand[2]!;
    const repo = shorthand[3]!;
    return { host, owner, repo, url: `https://${domain}/${owner}/${repo}`, directory };
  }

  // scp-style `git@host:owner/repo.git` is not a URL at all, so rewrite it into one first.
  const scp = /^(?:git\+)?(?:[\w.-]+@)([\w.-]+):(?!\/\/)(.+)$/.exec(trimmed);
  const normalised = scp
    ? `https://${scp[1]}/${scp[2]}`
    : trimmed
        .replace(/^git\+/, '')
        // `git:` and `ssh:` address the same repository a browser reaches over https —
        // and `new URL` would otherwise reject them as a protocol this can't link to.
        .replace(/^(?:git|ssh):\/\//, 'https://')
        // `ssh://git@host/…` carries a username the https URL must not keep.
        .replace(/^(https?:\/\/)[\w.-]+@/, '$1');

  let parsed: URL;
  try {
    parsed = new URL(normalised);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = HOST_BY_DOMAIN[parsed.hostname.toLowerCase()] ?? 'other';
  const segments = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (host === 'other' || segments.length < 2) {
    return {
      host,
      owner: null,
      repo: null,
      url: `https://${parsed.hostname}${parsed.pathname.replace(/\.git$/, '')}`,
      directory,
    };
  }

  const owner = segments[0]!;
  const repo = segments[1]!.replace(/\.git$/, '');
  return { host, owner, repo, url: `https://${parsed.hostname}/${owner}/${repo}`, directory };
}

export function buildGithubRepoApiUrl(owner: string, repo: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** Deliberately asks for a single commit: the *count* comes from the pagination `Link`
 *  header (see `parseLastPageFromLinkHeader`) and the one-item body carries the latest
 *  commit, so one request answers both "how many commits" and "when was the last one". */
export function buildGithubCommitsApiUrl(owner: string, repo: string): string {
  return `${buildGithubRepoApiUrl(owner, repo)}/commits?per_page=1`;
}

/**
 * Reads the total page count out of a GitHub `Link: <…page=2>; rel="next", <…page=7708>;
 * rel="last"` header. With `per_page=1` every page holds exactly one commit, so the last
 * page number *is* the total commit count — the only way to get that number out of the
 * REST API without walking the entire history. Returns null when there is no `rel="last"`
 * link, which means a single page (0 or 1 commits) that the caller resolves itself.
 */
export function parseLastPageFromLinkHeader(link: string | null): number | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="last"/.exec(part.trim());
    if (!match) continue;
    try {
      const page = new URL(match[1]!).searchParams.get('page');
      const parsed = page === null ? Number.NaN : Number(page);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function buildNpmPackageUrl(name: string): string {
  return `https://www.npmjs.com/package/${name}`;
}

export function buildDownloadsRangeUrl(name: string, period = 'last-month'): string {
  return `https://api.npmjs.org/downloads/range/${period}/${encodeURIComponent(name)}`;
}

// ------------------------------------------------------------------------------ README

/** jsDelivr's file-listing API for one published version — used to find whatever the
 *  package actually named its README, since neither the casing nor the extension of that
 *  file is standardised. */
export function buildJsdelivrFileListUrl(name: string, version: string): string {
  return `https://data.jsdelivr.com/v1/packages/npm/${name}@${version}?structure=flat`;
}

export function buildJsdelivrFileUrl(name: string, version: string, path: string): string {
  return `https://cdn.jsdelivr.net/npm/${name}@${version}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Picks the package's own README out of a jsDelivr flat file listing. It has to be at the
 * tarball root, so a `docs/readme.md` or `examples/README.md` is never mistaken for it,
 * and the match is case-insensitive because `README.md`, `readme.md` and `Readme.markdown`
 * are all in wide use.
 */
export function pickReadmePath(paths: string[]): string | null {
  const candidates = paths.filter((p) => /^\/readme(\.(md|markdown|mkd|txt))?$/i.test(p));
  if (candidates.length === 0) return null;
  // Prefer a Markdown README over a plain-text one when a package ships both.
  return candidates.find((p) => /\.(md|markdown|mkd)$/i.test(p)) ?? candidates[0]!;
}

const ABSOLUTE_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

export interface ReadmeLinkBases {
  /** Where a relative image should load from — raw file content. */
  image: string;
  /** Where a relative link should point — a browsable page. */
  link: string;
}

/**
 * Rewrites the relative paths in a README so they still resolve once the file is read
 * outside its own repository. A README is written for the host's project page, where
 * `![logo](assets/logo.png)` and `[contributing](CONTRIBUTING.md)` resolve against the
 * repo; rendered anywhere else, every one of them is a broken image or a dead link.
 *
 * Anything already absolute (`https:`, protocol-relative `//`, `data:`, `mailto:`, or a
 * bare `#fragment`) is left exactly as written.
 */
export function rewriteReadmeLinks(markdown: string, bases: ReadmeLinkBases): string {
  const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}/${path.replace(/^\.?\//, '')}`;

  return (
    markdown
      // Markdown images and links: ![alt](path) / [text](path), with an optional "title".
      .replace(
        /(!?)\[([^\]]*)\]\(\s*([^)\s]+)((?:\s+"[^"]*")?)\s*\)/g,
        (whole: string, bang: string, text: string, url: string, title: string) => {
          if (ABSOLUTE_URL_RE.test(url)) return whole;
          return `${bang}[${text}](${join(bang ? bases.image : bases.link, url)}${title})`;
        }
      )
      // Raw HTML <img src> / <a href>, which READMEs use freely for sizing and alignment.
      .replace(
        /(<(?:img|a)\b[^>]*?\b(?:src|href)=)(["'])([^"']+)\2/gi,
        (whole: string, prefix: string, quote: string, url: string) => {
          if (ABSOLUTE_URL_RE.test(url)) return whole;
          const isImage = /^<img/i.test(whole);
          return `${prefix}${quote}${join(isImage ? bases.image : bases.link, url)}${quote}`;
        }
      )
  );
}

/**
 * Where a README's relative paths should point, given the repository it came from. Falls
 * back to the published tarball on jsDelivr when the package declares no usable
 * repository — that still resolves any asset the package actually ships, just not one
 * that only ever existed in the repo.
 */
export function readmeLinkBases(ref: RepositoryRef | null, name: string, version: string): ReadmeLinkBases {
  if (ref?.host === 'github' && ref.owner && ref.repo) {
    const dir = ref.directory ? `/${ref.directory.replace(/^\/+|\/+$/g, '')}` : '';
    return {
      image: `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/HEAD${dir}`,
      link: `${ref.url}/blob/HEAD${dir}`,
    };
  }
  const cdn = `https://cdn.jsdelivr.net/npm/${name}@${version}`;
  return { image: cdn, link: cdn };
}

// ----------------------------------------------------------------------- Download stats

export interface DownloadDay {
  day: string;
  downloads: number;
}

export function sumDownloads(days: DownloadDay[]): number {
  return days.reduce((total, d) => total + d.downloads, 0);
}

/**
 * An SVG polyline `points` string for a downloads sparkline, scaled to fit `width` x
 * `height` with the busiest day touching the top. Pure, so the shape is unit-testable
 * without rendering anything; null when there is nothing meaningful to draw.
 */
export function sparklinePoints(days: DownloadDay[], width: number, height: number): string | null {
  if (days.length < 2) return null;
  const max = Math.max(...days.map((d) => d.downloads));
  if (max <= 0) return null;
  const step = width / (days.length - 1);
  return days
    .map((d, i) => `${(i * step).toFixed(2)},${(height - (d.downloads / max) * height).toFixed(2)}`)
    .join(' ');
}

/** Compact counts for stat tiles — "61.3K" rather than "61,278", which is what a reader
 *  actually takes away from a star count at a glance. The exact number stays available
 *  in the tile's tooltip. */
export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** "3 days ago" / "2 years ago", via `Intl.RelativeTimeFormat` so it reads naturally in
 *  the visitor's own locale. Null for a date that can't be parsed. */
export function formatRelativeTime(isoDate: string, now: number = Date.now()): string | null {
  const then = Date.parse(isoDate);
  if (Number.isNaN(then)) return null;

  const seconds = (then - now) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(Math.round(seconds), 'second');
}

/** Whole years between `isoDate` and now, for "how old is this project" — floored, so a
 *  repo eleven months old reads as under a year rather than rounding up to one. */
export function yearsSince(isoDate: string, now: number = Date.now()): number | null {
  const then = Date.parse(isoDate);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / 31_536_000_000));
}
