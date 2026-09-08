import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchPackageOverview,
  fetchResolvedVersion,
  fetchWeeklyDownloads,
  fetchBundledSource,
  searchPackages,
  runWithConcurrency,
  fetchRepoStats,
  fetchCommitActivity,
  fetchReadme,
  fetchDownloadTrend,
} from './npmRegistry';

function fakeResponse({
  ok = true,
  status = 200,
  headers = {},
  json,
  text,
}: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
}) {
  return {
    ok,
    status,
    headers: {
      get: (key: string) => ({ 'content-type': 'application/javascript; charset=utf-8', ...headers })[key.toLowerCase()] ?? null,
    },
    json: async () => json,
    text: async () => text ?? (json !== undefined ? JSON.stringify(json) : ''),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPackageOverview', () => {
  it('parses dist-tags and versions from the abbreviated registry response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({ json: { 'dist-tags': { latest: '4.17.21' }, versions: { '4.17.20': {}, '4.17.21': {} } } })
      )
    );

    const result = await fetchPackageOverview('lodash');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.distTags.latest).toBe('4.17.21');
      expect(result.value.versions.sort()).toEqual(['4.17.20', '4.17.21']);
    }
  });

  it('reports a clear error for an unknown package (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 404, json: {} })));

    const result = await fetchPackageOverview('this-package-does-not-exist-xyz');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/isn't a package/i);
  });

  it('reports an error for a package with no published versions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: { 'dist-tags': {}, versions: {} } })));

    const result = await fetchPackageOverview('empty-pkg');
    expect(result.ok).toBe(false);
  });

  it('returns an error result instead of throwing when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await fetchPackageOverview('lodash');
    expect(result.ok).toBe(false);
  });
});

describe('fetchResolvedVersion', () => {
  it('reads license, dependencies, unpacked size and ESM signals from a version document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          json: {
            version: '4.17.21',
            license: 'MIT',
            description: 'Lodash modular utilities.',
            dependencies: {},
            dist: { unpackedSize: 1_400_000, fileCount: 1_050 },
            module: 'lodash.js',
          },
        })
      )
    );

    const result = await fetchResolvedVersion('lodash', '4.17.21');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.license).toBe('MIT');
      expect(result.value.unpackedSize).toBe(1_400_000);
      expect(result.value.esm.hasEsmEntry).toBe(true);
    }
  });

  it('normalises a missing/legacy license and dependencies gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: { version: '1.0.0' } })));

    const result = await fetchResolvedVersion('some-old-pkg', '1.0.0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.license).toBeNull();
      expect(result.value.dependencies).toEqual({});
    }
  });

  it('reports a clear error when the version was not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 404, json: {} })));

    const result = await fetchResolvedVersion('lodash', '999.999.999');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
  });
});

describe('fetchWeeklyDownloads', () => {
  it('reads the downloads count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: { downloads: 12_345_678 } })));

    const result = await fetchWeeklyDownloads('lodash');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(12_345_678);
  });

  it('fails gracefully when the stats endpoint has no data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: {} })));

    const result = await fetchWeeklyDownloads('some-obscure-pkg');
    expect(result.ok).toBe(false);
  });
});

describe('fetchBundledSource', () => {
  it('returns the bundled JS source when the entry response has no further imports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ headers: { 'content-type': 'application/javascript; charset=utf-8' }, text: 'export default 1;' }))
    );

    const result = await fetchBundledSource('lodash', '4.17.21');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('export default 1;');
  });

  it('follows same-origin re-export facades and concatenates the real chunk files (the esm.sh ?standalone shape)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://esm.sh/react@18.3.1?standalone') {
        return fakeResponse({ text: 'export * from "/react@18.3.1/es2022/react.bundle.mjs";' });
      }
      if (url === 'https://esm.sh/react@18.3.1/es2022/react.bundle.mjs') {
        return fakeResponse({ text: 'var REAL_REACT_CODE = 1;' });
      }
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBundledSource('react', '18.3.1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('REAL_REACT_CODE');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it('follows multiple relative imports and never re-fetches the same file twice', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://esm.sh/pkg@1.0.0?standalone') {
        return fakeResponse({ text: 'import "/pkg@1.0.0/a.mjs";\nimport "/pkg@1.0.0/b.mjs";\nimport "/pkg@1.0.0/a.mjs";' });
      }
      if (url === 'https://esm.sh/pkg@1.0.0/a.mjs') return fakeResponse({ text: 'var A = 1;' });
      if (url === 'https://esm.sh/pkg@1.0.0/b.mjs') return fakeResponse({ text: 'var B = 2;' });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBundledSource('pkg', '1.0.0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('var A = 1;');
      expect(result.value).toContain('var B = 2;');
    }
    expect(fetchMock).toHaveBeenCalledTimes(3); // entry + a.mjs + b.mjs, a.mjs only once
  });

  it('does not follow a bare/external specifier — only same-origin paths', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ text: 'import "some-other-package"; export default 1;' }))
    );

    const result = await fetchBundledSource('lodash', '4.17.21');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('export default 1');
  });

  it('treats a non-JS response as a bundling failure with a helpful message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 500, headers: { 'content-type': 'text/plain' }, text: 'build failed: no matching export' }))
    );

    const result = await fetchBundledSource('some-cjs-only-pkg', '1.0.0', ['namedThing']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not bundle/i);
  });

  it('returns an error result instead of throwing when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await fetchBundledSource('lodash', '4.17.21');
    expect(result.ok).toBe(false);
  });
});

describe('searchPackages', () => {
  it('parses matching packages from the search response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          json: {
            objects: [
              { package: { name: 'react', version: '18.3.1', description: 'React library' } },
              { package: { name: 'react-dom', version: '18.3.1', description: 'React DOM' } },
            ],
          },
        })
      )
    );

    const result = await searchPackages('react');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { name: 'react', version: '18.3.1', description: 'React library' },
        { name: 'react-dom', version: '18.3.1', description: 'React DOM' },
      ]);
    }
  });

  it('handles a response with no results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: { objects: [] } })));

    const result = await searchPackages('this-matches-nothing-xyz');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('returns an error result instead of throwing when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await searchPackages('react');
    expect(result.ok).toBe(false);
  });
});

describe('runWithConcurrency', () => {
  it('runs every item and preserves result order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (n) => n * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('never runs more than `limit` workers at once', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await runWithConcurrency(items, 3, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return null;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('reports progress after each completion', async () => {
    const progress: { done: number; total: number }[] = [];
    await runWithConcurrency([1, 2, 3], 1, async (n) => n, (done, total) => progress.push({ done, total }));
    expect(progress).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it('stops queuing new work once the signal is aborted', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const items = [1, 2, 3, 4, 5];

    const promise = runWithConcurrency(
      items,
      1,
      async (n) => {
        started.push(n);
        if (n === 1) controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 1));
        return n;
      },
      undefined,
      controller.signal
    );

    await promise;
    expect(started).toEqual([1]);
  });

  it('handles an empty item list', async () => {
    const results = await runWithConcurrency([], 3, async (n: number) => n);
    expect(results).toEqual([]);
  });
});

describe('fetchResolvedVersion — repository, deprecation and engines', () => {
  it('reads the repository URL and monorepo directory from the object form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          json: {
            version: '7.0.0',
            repository: { type: 'git', url: 'git+https://github.com/babel/babel.git', directory: 'packages/babel-core' },
            homepage: 'https://babeljs.io',
            keywords: ['babel', 'compiler'],
            engines: { node: '>=6.9.0' },
            peerDependencies: { '@babel/types': '^7.0.0' },
            maintainers: [{ name: 'a' }, { name: 'b' }],
          },
        })
      )
    );

    const result = await fetchResolvedVersion('@babel/core', '7.0.0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.repository).toBe('git+https://github.com/babel/babel.git');
      expect(result.value.repositoryDirectory).toBe('packages/babel-core');
      expect(result.value.homepage).toBe('https://babeljs.io');
      expect(result.value.keywords).toEqual(['babel', 'compiler']);
      expect(result.value.engineNode).toBe('>=6.9.0');
      expect(result.value.peerDependencies).toEqual({ '@babel/types': '^7.0.0' });
      expect(result.value.maintainerCount).toBe(2);
    }
  });

  it('reads the repository from the plain-string shorthand form too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: { version: '1.0.0', repository: 'foo/bar' } })));

    const result = await fetchResolvedVersion('bar', '1.0.0');
    if (result.ok) {
      expect(result.value.repository).toBe('foo/bar');
      expect(result.value.repositoryDirectory).toBeNull();
    }
  });

  it('surfaces a deprecation message, including the bare `true` form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ json: { version: '1.0.0', deprecated: 'Use foo instead.' } }))
    );
    const withMessage = await fetchResolvedVersion('old', '1.0.0');
    if (withMessage.ok) expect(withMessage.value.deprecated).toBe('Use foo instead.');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: { version: '1.0.0', deprecated: true } })));
    const bare = await fetchResolvedVersion('old', '1.0.0');
    if (bare.ok) expect(bare.value.deprecated).toMatch(/deprecated/i);
  });

  it('leaves every optional field null or empty when the version document omits them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: { version: '1.0.0' } })));

    const result = await fetchResolvedVersion('minimal', '1.0.0');
    if (result.ok) {
      expect(result.value.repository).toBeNull();
      expect(result.value.deprecated).toBeNull();
      expect(result.value.engineNode).toBeNull();
      expect(result.value.keywords).toEqual([]);
      expect(result.value.peerDependencies).toEqual({});
    }
  });
});

describe('fetchRepoStats', () => {
  const repoJson = {
    stargazers_count: 61_278,
    forks_count: 7_190,
    subscribers_count: 817,
    open_issues_count: 104,
    created_at: '2012-04-07T04:11:46Z',
    pushed_at: '2026-07-03T19:48:01Z',
    archived: false,
    topics: ['javascript', 'utilities'],
    description: 'A modern JavaScript utility library.',
    default_branch: 'main',
    html_url: 'https://github.com/lodash/lodash',
  };

  it('reads stars, forks, watchers, open issues and the project dates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: repoJson })));

    const result = await fetchRepoStats('lodash', 'lodash');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stars).toBe(61_278);
      expect(result.value.forks).toBe(7_190);
      expect(result.value.watchers).toBe(817);
      expect(result.value.openIssuesAndPulls).toBe(104);
      expect(result.value.createdAt).toBe('2012-04-07T04:11:46Z');
      expect(result.value.topics).toEqual(['javascript', 'utilities']);
      expect(result.value.archived).toBe(false);
    }
  });

  it('flags an archived repository', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: { ...repoJson, archived: true } })));

    const result = await fetchRepoStats('old', 'project');
    if (result.ok) expect(result.value.archived).toBe(true);
  });

  it('explains the anonymous rate limit rather than showing a bare 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({ ok: false, status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: {} })
      )
    );

    const result = await fetchRepoStats('lodash', 'lodash');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/rate limit/i);
  });

  it('treats a 403 that is not a rate limit as an ordinary error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 403, json: {} })));

    const result = await fetchRepoStats('a', 'b');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/403/);
  });

  it('reports a deleted or private repository clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 404, json: {} })));

    const result = await fetchRepoStats('gone', 'gone');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no longer exists/i);
  });

  it('returns an error result instead of throwing when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect((await fetchRepoStats('a', 'b')).ok).toBe(false);
  });
});

describe('fetchCommitActivity', () => {
  const oneCommit = [
    {
      html_url: 'https://github.com/a/b/commit/abc',
      commit: { message: 'Fix the thing\n\nWith a longer body', author: { name: 'A Dev', date: '2026-07-03T19:48:01Z' } },
    },
  ];

  it('derives the total commit count from the pagination Link header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          json: oneCommit,
          headers: {
            link: '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/commits?per_page=1&page=7708>; rel="last"',
          },
        })
      )
    );

    const result = await fetchCommitActivity('lodash', 'lodash');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalCommits).toBe(7708);
      expect(result.value.lastCommitDate).toBe('2026-07-03T19:48:01Z');
      // Only the subject line — a full commit body would not fit a stat tile's tooltip.
      expect(result.value.lastCommitMessage).toBe('Fix the thing');
      expect(result.value.lastCommitAuthor).toBe('A Dev');
    }
  });

  it('counts a single-page repository as one commit, since there is no last link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: oneCommit })));

    const result = await fetchCommitActivity('a', 'b');
    if (result.ok) expect(result.value.totalCommits).toBe(1);
  });

  it('reports an empty repository as zero commits rather than an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 409, json: {} })));

    const result = await fetchCommitActivity('a', 'empty');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalCommits).toBe(0);
      expect(result.value.lastCommitDate).toBeNull();
    }
  });

  it('explains the anonymous rate limit here too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 429, headers: { 'x-ratelimit-remaining': '0' }, json: {} }))
    );

    const result = await fetchCommitActivity('a', 'b');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/rate limit/i);
  });
});

describe('fetchReadme', () => {
  it('finds the README in the version file listing and downloads it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ json: { files: [{ name: '/index.js' }, { name: '/README.md' }] } }))
      .mockResolvedValueOnce(fakeResponse({ text: '# lodash\n\nUtilities.' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchReadme('lodash', '4.17.21');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('# lodash');
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://cdn.jsdelivr.net/npm/lodash@4.17.21/README.md');
  });

  it('says so plainly when the package ships no README', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: { files: [{ name: '/index.js' }] } })));

    const result = await fetchReadme('bare', '1.0.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't ship a README/i);
  });

  it('reports an error when the file listing itself is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 404, json: {} })));

    expect((await fetchReadme('nope', '1.0.0')).ok).toBe(false);
  });

  it('returns an error result instead of throwing when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect((await fetchReadme('lodash', '4.17.21')).ok).toBe(false);
  });
});

describe('fetchDownloadTrend', () => {
  it('reads the per-day download counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          json: {
            downloads: [
              { day: '2026-08-08', downloads: 13_879_801 },
              { day: '2026-08-09', downloads: 13_775_509 },
            ],
          },
        })
      )
    );

    const result = await fetchDownloadTrend('lodash');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toEqual({ day: '2026-08-08', downloads: 13_879_801 });
    }
  });

  it('drops malformed entries rather than rendering NaN', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({ json: { downloads: [{ day: '2026-08-08', downloads: 5 }, { day: 7, downloads: 'x' }] } })
      )
    );

    const result = await fetchDownloadTrend('lodash');
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('reports an error for a package with no download history at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ json: { downloads: [] } })));

    expect((await fetchDownloadTrend('brand-new')).ok).toBe(false);
  });
});
