import { describe, it, expect } from 'vitest';
import {
  parsePackageSpec,
  packageSearchQuery,
  satisfiesRange,
  maxSatisfying,
  latestPerMajor,
  parsePackageJsonDependencies,
  isResolvableRange,
  detectEsmSupport,
  normalizeLicense,
  compressionRatio,
  estimateDownloadSeconds,
  sortRows,
  measureBundleSize,
  buildEsmStandaloneUrl,
  buildEsmScopedUrl,
  buildRegistryOverviewUrl,
  buildRegistryVersionUrl,
} from './bundleSize';

describe('parsePackageSpec', () => {
  it('parses a bare name with no version', () => {
    const result = parsePackageSpec('lodash');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'lodash', range: null });
  });

  it('parses a name with an exact version', () => {
    const result = parsePackageSpec('lodash@4.17.21');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'lodash', range: '4.17.21' });
  });

  it('parses a name with a semver range', () => {
    const result = parsePackageSpec('react@^18');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'react', range: '^18' });
  });

  it('parses a scoped package with a version', () => {
    const result = parsePackageSpec('@babel/core@7.24.0');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: '@babel/core', range: '7.24.0' });
  });

  it('parses a scoped package with no version', () => {
    const result = parsePackageSpec('@babel/core');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: '@babel/core', range: null });
  });

  it('rejects empty input', () => {
    expect(parsePackageSpec('').ok).toBe(false);
    expect(parsePackageSpec('   ').ok).toBe(false);
  });

  it('rejects input containing whitespace', () => {
    const result = parsePackageSpec('lodash 4.17.21');
    expect(result.ok).toBe(false);
  });

  it('rejects a scoped spec missing the "/name" part', () => {
    const result = parsePackageSpec('@babel');
    expect(result.ok).toBe(false);
  });

  it('rejects a trailing "@" with nothing after it', () => {
    const result = parsePackageSpec('lodash@');
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid package name', () => {
    expect(parsePackageSpec('UPPER_CASE!!').ok).toBe(false);
  });

  it('accepts unicode in the version/range part without crashing', () => {
    // Not a valid range, but must fail gracefully rather than throw.
    expect(() => parsePackageSpec('lodash@✓')).not.toThrow();
  });
});

describe('packageSearchQuery', () => {
  it('returns the whole string when there is no version', () => {
    expect(packageSearchQuery('lodash')).toBe('lodash');
  });

  it('strips a version or range after "@"', () => {
    expect(packageSearchQuery('lodash@4.17.21')).toBe('lodash');
    expect(packageSearchQuery('react@^18')).toBe('react');
  });

  it('keeps the scope and strips only the version for a scoped package', () => {
    expect(packageSearchQuery('@babel/core@7.24.0')).toBe('@babel/core');
    expect(packageSearchQuery('@babel/core')).toBe('@babel/core');
  });

  it('returns an empty string for empty input', () => {
    expect(packageSearchQuery('')).toBe('');
    expect(packageSearchQuery('   ')).toBe('');
  });

  it('returns the input as-is for a bare scope with no "/name" yet', () => {
    expect(packageSearchQuery('@babel')).toBe('@babel');
  });
});

describe('satisfiesRange / maxSatisfying', () => {
  it('matches an exact version', () => {
    expect(satisfiesRange('4.17.21', '4.17.21')).toBe(true);
    expect(satisfiesRange('4.17.20', '4.17.21')).toBe(false);
  });

  it('matches a caret range within the same major version', () => {
    expect(satisfiesRange('1.9.9', '^1.2.3')).toBe(true);
    expect(satisfiesRange('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesRange('1.2.2', '^1.2.3')).toBe(false);
  });

  it('treats a 0.x caret range as locked to the minor version', () => {
    expect(satisfiesRange('0.2.9', '^0.2.3')).toBe(true);
    expect(satisfiesRange('0.3.0', '^0.2.3')).toBe(false);
  });

  it('matches a tilde range within the same minor version', () => {
    expect(satisfiesRange('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2.3')).toBe(false);
  });

  it('matches x-ranges', () => {
    expect(satisfiesRange('1.5.2', '1.x')).toBe(true);
    expect(satisfiesRange('2.0.0', '1.x')).toBe(false);
    expect(satisfiesRange('1.2.9', '1.2.x')).toBe(true);
    expect(satisfiesRange('1.3.0', '1.2.x')).toBe(false);
  });

  it('matches "*" and empty ranges against any non-prerelease version', () => {
    expect(satisfiesRange('9.9.9', '*')).toBe(true);
    expect(satisfiesRange('9.9.9', '')).toBe(true);
  });

  it('matches plain comparators', () => {
    expect(satisfiesRange('3.0.0', '>=2.0.0')).toBe(true);
    expect(satisfiesRange('1.0.0', '>=2.0.0')).toBe(false);
    expect(satisfiesRange('2.0.0', '<3.0.0 >=2.0.0')).toBe(true);
  });

  it('matches a hyphen range inclusively', () => {
    expect(satisfiesRange('1.2.3', '1.2.3 - 2.3.4')).toBe(true);
    expect(satisfiesRange('2.3.4', '1.2.3 - 2.3.4')).toBe(true);
    expect(satisfiesRange('2.3.5', '1.2.3 - 2.3.4')).toBe(false);
  });

  it('matches an OR group', () => {
    expect(satisfiesRange('1.5.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfiesRange('2.5.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfiesRange('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
  });

  it('excludes a prerelease version from a general range', () => {
    expect(satisfiesRange('2.0.0-beta.1', '^1.0.0')).toBe(false);
  });

  it('includes a prerelease version when the range targets that exact major.minor.patch', () => {
    expect(satisfiesRange('2.0.0-beta.1', '>=2.0.0-beta.1')).toBe(true);
  });

  it('returns false for malformed version/range input rather than throwing', () => {
    expect(() => satisfiesRange('not-a-version', '^1.0.0')).not.toThrow();
    expect(satisfiesRange('not-a-version', '^1.0.0')).toBe(false);
    expect(() => satisfiesRange('1.0.0', 'not a valid range at all !!')).not.toThrow();
  });

  it('maxSatisfying picks the highest matching version', () => {
    const versions = ['1.0.0', '1.2.0', '1.9.9', '2.0.0', '2.1.0'];
    expect(maxSatisfying(versions, '^1.0.0')).toBe('1.9.9');
    expect(maxSatisfying(versions, '^2.0.0')).toBe('2.1.0');
  });

  it('maxSatisfying returns null when nothing matches', () => {
    expect(maxSatisfying(['1.0.0', '1.1.0'], '^2.0.0')).toBeNull();
  });

  it('maxSatisfying handles a large version list without timing out', () => {
    const versions = Array.from({ length: 2000 }, (_, i) => `1.${Math.floor(i / 100)}.${i % 100}`);
    expect(maxSatisfying(versions, '^1.0.0')).toBe('1.19.99');
  });
});

describe('latestPerMajor', () => {
  it('picks the highest version within each major, most recent major first', () => {
    const versions = ['1.0.0', '1.5.0', '2.0.0', '2.3.1', '3.0.0-beta.1', '3.0.0'];
    expect(latestPerMajor(versions)).toEqual(['3.0.0', '2.3.1', '1.5.0']);
  });

  it('excludes prerelease versions from consideration', () => {
    const versions = ['1.0.0', '2.0.0-rc.1'];
    expect(latestPerMajor(versions)).toEqual(['1.0.0']);
  });

  it('caps the result at `limit` majors', () => {
    const versions = ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0'];
    expect(latestPerMajor(versions, 2)).toEqual(['5.0.0', '4.0.0']);
  });

  it('returns an empty array for no valid versions', () => {
    expect(latestPerMajor([])).toEqual([]);
    expect(latestPerMajor(['not-a-version', 'also-bad'])).toEqual([]);
  });

  it('handles a single major with many versions', () => {
    expect(latestPerMajor(['1.0.0', '1.1.0', '1.2.0'])).toEqual(['1.2.0']);
  });
});

describe('parsePackageJsonDependencies', () => {
  const validJson = JSON.stringify({
    dependencies: { react: '^18.0.0', lodash: '^4.17.21' },
    devDependencies: { vitest: '^4.0.0' },
  });

  it('extracts dependencies by default', () => {
    const result = parsePackageJsonDependencies(validJson, false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { name: 'react', range: '^18.0.0', source: 'dependencies' },
        { name: 'lodash', range: '^4.17.21', source: 'dependencies' },
      ]);
    }
  });

  it('also includes devDependencies when asked', () => {
    const result = parsePackageJsonDependencies(validJson, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      expect(result.value.some((d) => d.name === 'vitest' && d.source === 'devDependencies')).toBe(true);
    }
  });

  it('never duplicates a name already in dependencies', () => {
    const json = JSON.stringify({ dependencies: { react: '^18.0.0' }, devDependencies: { react: '^17.0.0' } });
    const result = parsePackageJsonDependencies(json, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toEqual({ name: 'react', range: '^18.0.0', source: 'dependencies' });
    }
  });

  it('rejects empty input', () => {
    expect(parsePackageJsonDependencies('', false).ok).toBe(false);
    expect(parsePackageJsonDependencies('   ', false).ok).toBe(false);
  });

  it('rejects malformed JSON', () => {
    const result = parsePackageJsonDependencies('{ not json', false);
    expect(result.ok).toBe(false);
  });

  it('rejects JSON that is not an object', () => {
    expect(parsePackageJsonDependencies('[1,2,3]', false).ok).toBe(false);
    expect(parsePackageJsonDependencies('"just a string"', false).ok).toBe(false);
  });

  it('reports no dependencies found when the object has none', () => {
    const result = parsePackageJsonDependencies('{"name":"empty-pkg"}', false);
    expect(result.ok).toBe(false);
  });

  it('handles a very large dependency list', () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i < 500; i += 1) deps[`package-${i}`] = '^1.0.0';
    const result = parsePackageJsonDependencies(JSON.stringify({ dependencies: deps }), false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(500);
  });

  it('handles unicode package.json content without crashing', () => {
    const json = JSON.stringify({ name: '日本語のパッケージ', description: '📦', dependencies: { react: '^18.0.0' } });
    const result = parsePackageJsonDependencies(json, false);
    expect(result.ok).toBe(true);
  });

  it('ignores a non-string version value instead of crashing', () => {
    const json = JSON.stringify({ dependencies: { react: '^18.0.0', broken: 123 } });
    const result = parsePackageJsonDependencies(json, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([{ name: 'react', range: '^18.0.0', source: 'dependencies' }]);
  });
});

describe('isResolvableRange', () => {
  it('accepts ordinary semver ranges', () => {
    expect(isResolvableRange('^1.2.3')).toBe(true);
    expect(isResolvableRange('1.2.3')).toBe(true);
    expect(isResolvableRange('latest')).toBe(true);
  });

  it('rejects workspace/git/file/URL protocol ranges', () => {
    expect(isResolvableRange('workspace:*')).toBe(false);
    expect(isResolvableRange('file:../local-pkg')).toBe(false);
    expect(isResolvableRange('git+https://github.com/foo/bar.git')).toBe(false);
    expect(isResolvableRange('https://example.com/pkg.tgz')).toBe(false);
  });
});

describe('detectEsmSupport', () => {
  it('detects an ESM entry via the module field', () => {
    expect(detectEsmSupport({ module: 'index.mjs' }).hasEsmEntry).toBe(true);
  });

  it('detects an ESM entry via type: module', () => {
    expect(detectEsmSupport({ type: 'module' }).hasEsmEntry).toBe(true);
  });

  it('detects an ESM entry via an exports import condition', () => {
    expect(detectEsmSupport({ exports: { '.': { import: './index.mjs', require: './index.cjs' } } }).hasEsmEntry).toBe(true);
  });

  it('reports no ESM entry for a plain CJS package', () => {
    expect(detectEsmSupport({}).hasEsmEntry).toBe(false);
  });

  it('reads sideEffects: false as free', () => {
    expect(detectEsmSupport({ sideEffects: false }).sideEffects).toBe('free');
  });

  it('reads an empty sideEffects array as free', () => {
    expect(detectEsmSupport({ sideEffects: [] }).sideEffects).toBe('free');
  });

  it('reads a non-empty sideEffects array as having side effects', () => {
    expect(detectEsmSupport({ sideEffects: ['./polyfill.js'] }).sideEffects).toBe('has-side-effects');
  });

  it('reads a missing sideEffects field as unspecified', () => {
    expect(detectEsmSupport({}).sideEffects).toBe('unspecified');
  });

  it('detects bundled types from the types field or an exports types condition', () => {
    expect(detectEsmSupport({ types: 'index.d.ts' }).hasTypes).toBe(true);
    expect(detectEsmSupport({ typings: 'index.d.ts' }).hasTypes).toBe(true);
    expect(detectEsmSupport({ exports: { '.': { types: './index.d.ts' } } }).hasTypes).toBe(true);
    expect(detectEsmSupport({}).hasTypes).toBe(false);
  });
});

describe('normalizeLicense', () => {
  it('passes through a plain string license', () => {
    expect(normalizeLicense('MIT')).toBe('MIT');
  });

  it('reads a legacy {type, url} object', () => {
    expect(normalizeLicense({ type: 'ISC', url: 'https://example.com' })).toBe('ISC');
  });

  it('reads a legacy licenses array', () => {
    expect(normalizeLicense([{ type: 'BSD-3-Clause' }])).toBe('BSD-3-Clause');
  });

  it('returns null for missing or unrecognisable license data', () => {
    expect(normalizeLicense(undefined)).toBeNull();
    expect(normalizeLicense(null)).toBeNull();
    expect(normalizeLicense({})).toBeNull();
    expect(normalizeLicense([])).toBeNull();
  });
});

describe('compressionRatio / estimateDownloadSeconds', () => {
  it('computes the fraction saved by gzip', () => {
    expect(compressionRatio(1000, 250)).toBeCloseTo(0.75);
  });

  it('returns 0 for a zero-byte input rather than dividing by zero', () => {
    expect(compressionRatio(0, 0)).toBe(0);
  });

  it('estimates download time proportional to size and inversely to speed', () => {
    expect(estimateDownloadSeconds(125_000, 1000)).toBeCloseTo(1);
    expect(estimateDownloadSeconds(0, 1000)).toBe(0);
  });
});

describe('sortRows', () => {
  const rows = [
    { name: 'zebra', minifiedBytes: 100, gzipBytes: 30 },
    { name: 'apple', minifiedBytes: 500, gzipBytes: 200 },
    { name: 'mango', minifiedBytes: null, gzipBytes: null },
  ];

  it('sorts by name', () => {
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('sorts by gzip size descending, with unmeasured rows always last', () => {
    expect(sortRows(rows, 'gzip', 'desc').map((r) => r.name)).toEqual(['apple', 'zebra', 'mango']);
  });

  it('sorts by gzip size ascending, with unmeasured rows still last', () => {
    expect(sortRows(rows, 'gzip', 'asc').map((r) => r.name)).toEqual(['zebra', 'apple', 'mango']);
  });

  it('does not mutate the input array', () => {
    const copy = [...rows];
    sortRows(rows, 'name', 'asc');
    expect(rows).toEqual(copy);
  });
});

describe('URL builders', () => {
  it('builds a standalone esm.sh URL', () => {
    expect(buildEsmStandaloneUrl('lodash', '4.17.21')).toBe('https://esm.sh/lodash@4.17.21?standalone');
  });

  it('builds a scoped esm.sh URL with encoded export names', () => {
    expect(buildEsmScopedUrl('lodash', '4.17.21', ['debounce', 'throttle'])).toBe(
      'https://esm.sh/lodash@4.17.21?exports=debounce%2Cthrottle'
    );
  });

  it('builds registry URLs', () => {
    expect(buildRegistryOverviewUrl('lodash')).toBe('https://registry.npmjs.org/lodash');
    expect(buildRegistryVersionUrl('lodash', '4.17.21')).toBe('https://registry.npmjs.org/lodash/4.17.21');
  });
});

describe('measureBundleSize', () => {
  it('minifies and gzips real code, producing a gzip size smaller than the minified size', async () => {
    const code = `export function add(a, b) {\n  // adds two numbers\n  return a + b;\n}\nexport const x = add(1, 2) + add(1, 2) + add(1, 2);\n`;
    const result = await measureBundleSize(code);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minifiedBytes).toBeGreaterThan(0);
      expect(result.value.gzipBytes).toBeGreaterThan(0);
      expect(result.value.gzipBytes).toBeLessThanOrEqual(result.value.minifiedBytes);
    }
  });

  it('handles empty input without throwing', async () => {
    const result = await measureBundleSize('');
    expect(result.ok).toBe(true);
  });

  it('returns an error result instead of throwing for unparseable code', async () => {
    const result = await measureBundleSize('this is not { valid javascript at all (((');
    expect(result.ok).toBe(false);
  });
});
