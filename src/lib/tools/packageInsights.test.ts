import { describe, it, expect } from 'vitest';
import {
  parseRepositoryUrl,
  parseLastPageFromLinkHeader,
  pickReadmePath,
  rewriteReadmeLinks,
  readmeLinkBases,
  sumDownloads,
  sparklinePoints,
  formatCompactNumber,
  formatRelativeTime,
  yearsSince,
  buildGithubRepoApiUrl,
  buildGithubCommitsApiUrl,
  buildNpmPackageUrl,
  buildJsdelivrFileListUrl,
  buildJsdelivrFileUrl,
  buildDownloadsRangeUrl,
} from './packageInsights';

describe('parseRepositoryUrl', () => {
  it('normalises the git+https form npm publishes most often', () => {
    const ref = parseRepositoryUrl('git+https://github.com/lodash/lodash.git');
    expect(ref).toMatchObject({ host: 'github', owner: 'lodash', repo: 'lodash', url: 'https://github.com/lodash/lodash' });
  });

  it('handles a plain https URL with and without the .git suffix', () => {
    expect(parseRepositoryUrl('https://github.com/facebook/react.git')?.url).toBe('https://github.com/facebook/react');
    expect(parseRepositoryUrl('https://github.com/facebook/react')?.repo).toBe('react');
  });

  it('handles the git:// protocol', () => {
    expect(parseRepositoryUrl('git://github.com/foo/bar.git')?.url).toBe('https://github.com/foo/bar');
  });

  it('handles the scp-style git@host:owner/repo form, which is not a URL at all', () => {
    const ref = parseRepositoryUrl('git@github.com:foo/bar.git');
    expect(ref).toMatchObject({ host: 'github', owner: 'foo', repo: 'bar', url: 'https://github.com/foo/bar' });
  });

  it('handles git+ssh URLs', () => {
    expect(parseRepositoryUrl('git+ssh://git@github.com/foo/bar.git')?.url).toBe('https://github.com/foo/bar');
  });

  it('handles the "github:owner/repo" and bare "owner/repo" shorthands', () => {
    expect(parseRepositoryUrl('github:foo/bar')?.url).toBe('https://github.com/foo/bar');
    expect(parseRepositoryUrl('foo/bar')?.url).toBe('https://github.com/foo/bar');
    expect(parseRepositoryUrl('gitlab:foo/bar')).toMatchObject({ host: 'gitlab', url: 'https://gitlab.com/foo/bar' });
    expect(parseRepositoryUrl('bitbucket:foo/bar')).toMatchObject({ host: 'bitbucket', url: 'https://bitbucket.org/foo/bar' });
  });

  it('recognises GitLab and Bitbucket URLs as their own hosts', () => {
    expect(parseRepositoryUrl('https://gitlab.com/a/b.git')?.host).toBe('gitlab');
    expect(parseRepositoryUrl('https://bitbucket.org/a/b')?.host).toBe('bitbucket');
  });

  it('keeps a link for an unrecognised host but resolves no owner/repo for its API', () => {
    const ref = parseRepositoryUrl('https://git.sr.ht/~someone/project');
    expect(ref).toMatchObject({ host: 'other', owner: null, repo: null });
    expect(ref?.url).toContain('git.sr.ht');
  });

  it('carries the monorepo directory through untouched', () => {
    const ref = parseRepositoryUrl('https://github.com/babel/babel', 'packages/babel-core');
    expect(ref?.directory).toBe('packages/babel-core');
  });

  it('returns null for empty or unparseable input rather than a broken link', () => {
    expect(parseRepositoryUrl('')).toBeNull();
    expect(parseRepositoryUrl('   ')).toBeNull();
    expect(parseRepositoryUrl('not a url at all')).toBeNull();
  });

  it('refuses a non-http protocol, which must never become an href', () => {
    expect(parseRepositoryUrl('javascript:alert(1)')).toBeNull();
    expect(parseRepositoryUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('parseLastPageFromLinkHeader', () => {
  it('reads the total page count, which at one commit per page is the commit count', () => {
    const link =
      '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/commits?per_page=1&page=7708>; rel="last"';
    expect(parseLastPageFromLinkHeader(link)).toBe(7708);
  });

  it('returns null when there is no last link — a single page of results', () => {
    expect(parseLastPageFromLinkHeader('<https://api.github.com/x?page=2>; rel="next"')).toBeNull();
    expect(parseLastPageFromLinkHeader(null)).toBeNull();
    expect(parseLastPageFromLinkHeader('')).toBeNull();
  });

  it('returns null rather than NaN for a malformed header', () => {
    expect(parseLastPageFromLinkHeader('<not-a-url>; rel="last"')).toBeNull();
    expect(parseLastPageFromLinkHeader('<https://api.github.com/x>; rel="last"')).toBeNull();
    expect(parseLastPageFromLinkHeader('<https://api.github.com/x?page=abc>; rel="last"')).toBeNull();
  });
});

describe('pickReadmePath', () => {
  it('finds the root README whatever its casing or extension', () => {
    expect(pickReadmePath(['/index.js', '/README.md'])).toBe('/README.md');
    expect(pickReadmePath(['/readme.md'])).toBe('/readme.md');
    expect(pickReadmePath(['/Readme.markdown'])).toBe('/Readme.markdown');
    expect(pickReadmePath(['/README'])).toBe('/README');
  });

  it('prefers a Markdown README when both a .md and a .txt one are published', () => {
    expect(pickReadmePath(['/README.txt', '/README.md'])).toBe('/README.md');
  });

  it('ignores a README that is not at the package root', () => {
    expect(pickReadmePath(['/docs/README.md', '/examples/readme.md'])).toBeNull();
  });

  it('returns null when the package ships no README at all', () => {
    expect(pickReadmePath(['/index.js', '/package.json'])).toBeNull();
    expect(pickReadmePath([])).toBeNull();
  });
});

describe('rewriteReadmeLinks', () => {
  const bases = { image: 'https://raw.example/repo/HEAD', link: 'https://example.com/repo/blob/HEAD' };

  it('rewrites a relative Markdown image against the raw-content base', () => {
    expect(rewriteReadmeLinks('![logo](assets/logo.png)', bases)).toBe(
      '![logo](https://raw.example/repo/HEAD/assets/logo.png)'
    );
  });

  it('rewrites a relative Markdown link against the browsable base', () => {
    expect(rewriteReadmeLinks('[guide](./CONTRIBUTING.md)', bases)).toBe(
      '[guide](https://example.com/repo/blob/HEAD/CONTRIBUTING.md)'
    );
  });

  it('leaves absolute URLs, protocol-relative URLs, data URIs and anchors alone', () => {
    const input =
      '[a](https://x.test/y) ![b](//cdn.test/i.png) ![c](data:image/png;base64,AAA) [d](#install) [e](mailto:a@b.test)';
    expect(rewriteReadmeLinks(input, bases)).toBe(input);
  });

  it('preserves a Markdown link title', () => {
    expect(rewriteReadmeLinks('[x](docs/a.md "The docs")', bases)).toBe(
      '[x](https://example.com/repo/blob/HEAD/docs/a.md "The docs")'
    );
  });

  it('rewrites raw HTML img src and a href, which READMEs use for sizing and alignment', () => {
    expect(rewriteReadmeLinks('<img src="logo.svg" width="80">', bases)).toBe(
      '<img src="https://raw.example/repo/HEAD/logo.svg" width="80">'
    );
    expect(rewriteReadmeLinks("<a href='docs/a.md'>x</a>", bases)).toBe(
      "<a href='https://example.com/repo/blob/HEAD/docs/a.md'>x</a>"
    );
  });

  it('strips a leading slash or ./ so the joined path never doubles up', () => {
    expect(rewriteReadmeLinks('![a](/img/a.png)', bases)).toBe('![a](https://raw.example/repo/HEAD/img/a.png)');
    expect(rewriteReadmeLinks('![a](./img/a.png)', bases)).toBe('![a](https://raw.example/repo/HEAD/img/a.png)');
  });

  it('leaves a README with no links untouched, including an empty one', () => {
    expect(rewriteReadmeLinks('# Title\n\nJust prose.', bases)).toBe('# Title\n\nJust prose.');
    expect(rewriteReadmeLinks('', bases)).toBe('');
  });
});

describe('readmeLinkBases', () => {
  it('points at raw.githubusercontent for images and the blob view for links', () => {
    const ref = parseRepositoryUrl('git+https://github.com/foo/bar.git');
    expect(readmeLinkBases(ref, 'bar', '1.0.0')).toEqual({
      image: 'https://raw.githubusercontent.com/foo/bar/HEAD',
      link: 'https://github.com/foo/bar/blob/HEAD',
    });
  });

  it('includes the monorepo sub-directory so a package README resolves its own assets', () => {
    const ref = parseRepositoryUrl('https://github.com/babel/babel', 'packages/babel-core');
    expect(readmeLinkBases(ref, '@babel/core', '7.0.0').image).toBe(
      'https://raw.githubusercontent.com/babel/babel/HEAD/packages/babel-core'
    );
  });

  it('falls back to the published tarball on jsDelivr when there is no usable GitHub repo', () => {
    expect(readmeLinkBases(null, 'lodash', '4.17.21')).toEqual({
      image: 'https://cdn.jsdelivr.net/npm/lodash@4.17.21',
      link: 'https://cdn.jsdelivr.net/npm/lodash@4.17.21',
    });
    const gitlab = parseRepositoryUrl('https://gitlab.com/a/b');
    expect(readmeLinkBases(gitlab, 'b', '1.0.0').image).toBe('https://cdn.jsdelivr.net/npm/b@1.0.0');
  });
});

describe('sumDownloads', () => {
  it('totals the daily counts', () => {
    expect(sumDownloads([{ day: 'a', downloads: 3 }, { day: 'b', downloads: 4 }])).toBe(7);
  });

  it('is zero for an empty range', () => {
    expect(sumDownloads([])).toBe(0);
  });
});

describe('sparklinePoints', () => {
  it('scales the busiest day to the top of the box and the first day to x=0', () => {
    const points = sparklinePoints(
      [
        { day: 'a', downloads: 0 },
        { day: 'b', downloads: 10 },
      ],
      100,
      40
    );
    expect(points).toBe('0.00,40.00 100.00,0.00');
  });

  it('returns null when there is nothing meaningful to draw', () => {
    expect(sparklinePoints([], 100, 40)).toBeNull();
    expect(sparklinePoints([{ day: 'a', downloads: 5 }], 100, 40)).toBeNull();
    expect(sparklinePoints([{ day: 'a', downloads: 0 }, { day: 'b', downloads: 0 }], 100, 40)).toBeNull();
  });
});

describe('formatCompactNumber', () => {
  it('compacts large counts and leaves small ones readable', () => {
    expect(formatCompactNumber(61_278)).toMatch(/61\.3K/i);
    expect(formatCompactNumber(4_200_000)).toMatch(/4\.2M/i);
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(7)).toBe('7');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-09-07T00:00:00Z');

  it('picks the largest sensible unit', () => {
    expect(formatRelativeTime('2026-09-04T00:00:00Z', now)).toMatch(/3 days ago/);
    expect(formatRelativeTime('2024-09-07T00:00:00Z', now)).toMatch(/2 years ago/);
    expect(formatRelativeTime('2026-09-06T22:00:00Z', now)).toMatch(/2 hours ago/);
  });

  it('falls through to seconds for something that just happened', () => {
    expect(formatRelativeTime('2026-09-07T00:00:00Z', now)).toMatch(/now|second/i);
  });

  it('returns null for a date it cannot parse, instead of "Invalid Date"', () => {
    expect(formatRelativeTime('not a date', now)).toBeNull();
    expect(formatRelativeTime('', now)).toBeNull();
  });
});

describe('yearsSince', () => {
  const now = Date.parse('2026-09-07T00:00:00Z');

  it('floors to whole years, so eleven months is not rounded up to one', () => {
    expect(yearsSince('2012-04-07T00:00:00Z', now)).toBe(14);
    expect(yearsSince('2025-11-01T00:00:00Z', now)).toBe(0);
  });

  it('never reports a negative age for a future date', () => {
    expect(yearsSince('2030-01-01T00:00:00Z', now)).toBe(0);
  });

  it('returns null for an unparseable date', () => {
    expect(yearsSince('nope', now)).toBeNull();
  });
});

describe('URL builders', () => {
  it('builds the API and page URLs each source expects', () => {
    expect(buildGithubRepoApiUrl('lodash', 'lodash')).toBe('https://api.github.com/repos/lodash/lodash');
    expect(buildGithubCommitsApiUrl('lodash', 'lodash')).toBe('https://api.github.com/repos/lodash/lodash/commits?per_page=1');
    expect(buildNpmPackageUrl('@scope/name')).toBe('https://www.npmjs.com/package/@scope/name');
    expect(buildJsdelivrFileListUrl('lodash', '4.17.21')).toBe(
      'https://data.jsdelivr.com/v1/packages/npm/lodash@4.17.21?structure=flat'
    );
    expect(buildDownloadsRangeUrl('lodash')).toBe('https://api.npmjs.org/downloads/range/last-month/lodash');
  });

  it('joins a README path with or without its leading slash', () => {
    expect(buildJsdelivrFileUrl('lodash', '4.17.21', '/README.md')).toBe(
      'https://cdn.jsdelivr.net/npm/lodash@4.17.21/README.md'
    );
    expect(buildJsdelivrFileUrl('lodash', '4.17.21', 'README.md')).toBe(
      'https://cdn.jsdelivr.net/npm/lodash@4.17.21/README.md'
    );
  });

  it('escapes an owner or package name so it cannot break out of the path', () => {
    expect(buildGithubRepoApiUrl('a/b', 'c')).toBe('https://api.github.com/repos/a%2Fb/c');
    expect(buildDownloadsRangeUrl('a b')).toBe('https://api.npmjs.org/downloads/range/last-month/a%20b');
  });
});
