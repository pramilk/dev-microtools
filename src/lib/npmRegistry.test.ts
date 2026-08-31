import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchPackageOverview,
  fetchResolvedVersion,
  fetchWeeklyDownloads,
  fetchBundledSource,
  searchPackages,
  runWithConcurrency,
} from './npmRegistry';

function fakeResponse({
  ok = true,
  status = 200,
  headers = { 'content-type': 'application/javascript; charset=utf-8' },
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
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
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
