import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/preact';
import BundleSizeChecker from './BundleSizeChecker';

/**
 * The tool checks itself: there is no "Check size" button, so a check starts from a
 * preset chip, a suggestion, Enter, a dropped file, or a settled edit. The debounces that
 * guard the typed paths are real time (see AUTO_CHECK_DELAY_MS / AUTO_BULK_DELAY_MS in
 * the component), so the tests that exercise those wait for them rather than faking the
 * clock — the wait is the behaviour under test.
 */
const SETTLE_TIMEOUT = 4000;

function fakeJsonResponse(json: unknown, opts: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...opts.headers };
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

function fakeTextResponse(text: string, opts: { ok?: boolean; status?: number; contentType?: string } = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: () => opts.contentType ?? 'application/javascript; charset=utf-8' },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

const DEMO_BUNDLE = 'export default function demo(a, b) {\n  // a real, valid JS module\n  return a + b + a + b;\n}\n';

const DEMO_README = '# demo-package\n\nA demo package for tests.\n\n![logo](assets/logo.png)\n';

function mockRegistryAndCdn() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith('https://api.npmjs.org/downloads/range/')) {
      return fakeJsonResponse({
        downloads: [
          { day: '2026-08-01', downloads: 100 },
          { day: '2026-08-02', downloads: 150 },
        ],
      });
    }
    if (url.startsWith('https://api.npmjs.org/downloads/')) return fakeJsonResponse({ downloads: 4_200_000 });

    if (url.startsWith('https://api.github.com/repos/demo/demo-package/commits')) {
      return fakeJsonResponse([{ html_url: 'https://github.com/demo/demo-package/commit/abc', commit: { message: 'Fix a bug\n\nDetails', author: { name: 'A Dev', date: '2026-08-20T10:00:00Z' } } }], {
        headers: { link: '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/commits?per_page=1&page=87>; rel="last"' },
      });
    }
    if (url.startsWith('https://api.github.com/repos/demo/demo-package')) {
      return fakeJsonResponse({
        stargazers_count: 12_345,
        forks_count: 678,
        subscribers_count: 90,
        open_issues_count: 42,
        created_at: '2016-01-01T00:00:00Z',
        pushed_at: '2026-08-20T10:00:00Z',
        archived: false,
        topics: ['testing'],
        description: 'A demo package for tests.',
        default_branch: 'main',
        html_url: 'https://github.com/demo/demo-package',
      });
    }

    if (url.startsWith('https://data.jsdelivr.com/v1/packages/npm/')) {
      return fakeJsonResponse({ files: [{ name: '/README.md' }, { name: '/index.js' }] });
    }
    if (url.startsWith('https://cdn.jsdelivr.net/npm/')) return fakeTextResponse(DEMO_README, { contentType: 'text/markdown' });

    if (url.startsWith('https://esm.sh/')) return fakeTextResponse(DEMO_BUNDLE);

    if (url.startsWith('https://registry.npmjs.org/-/v1/search')) {
      return fakeJsonResponse({
        objects: [{ package: { name: 'demo-package', version: '1.2.3', description: 'A demo package for tests.' } }],
      });
    }
    if (url.startsWith('https://registry.npmjs.org/')) {
      const rest = url.replace('https://registry.npmjs.org/', '');
      const segments = rest.split('/');
      if (segments.length === 1) {
        return fakeJsonResponse({
          'dist-tags': { latest: '1.2.3' },
          versions: { '1.2.3': {}, '0.9.0': {}, '0.5.0': {} },
          modified: '2026-08-25T00:00:00Z',
        });
      }
      return fakeJsonResponse({
        version: segments[1],
        license: 'MIT',
        description: 'A demo package for tests.',
        dependencies: {},
        dist: { unpackedSize: 5000, fileCount: 4 },
        module: 'index.mjs',
        sideEffects: false,
        repository: { type: 'git', url: 'git+https://github.com/demo/demo-package.git' },
      });
    }
    throw new Error(`Unhandled fetch in test: ${url}`);
  });
}

const typeInto = (element: HTMLElement, value: string) => fireEvent.input(element, { target: { value } });

// The label carries a hint span, so the field is addressed by its combobox role.
const packageField = () => screen.getByRole('combobox');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<BundleSizeChecker /> — single package mode', () => {
  it('starts on single-package mode with popular-package presets and no separate check button', () => {
    render(<BundleSizeChecker />);

    expect(screen.getByRole('button', { name: 'Single package' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'react' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /check size/i })).not.toBeInTheDocument();
  });

  it('checks a package straight from a preset chip, with no second click needed', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'lodash' }));

    expect(packageField()).toHaveValue('lodash');
    expect(await screen.findByText('Minified + gzipped')).toBeInTheDocument();
  });

  it('checks a package on Enter and shows its measured minified + gzipped size', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(packageField(), 'demo-package');
    fireEvent.keyDown(packageField(), { key: 'Enter' });

    expect(await screen.findByText('Minified + gzipped')).toBeInTheDocument();
    expect(screen.getByText('MIT')).toBeInTheDocument();
    // Scoped to the badge: the on-page explainer below defines the same terms.
    expect(screen.getByText('ESM only', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('side-effect free', { selector: '.badge' })).toBeInTheDocument();
  });

  it('checks a settled edit on its own, once the typed name is a package that exists', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(packageField(), 'demo-package');

    // No Enter, no click — the suggestions confirm the package is real and the check runs.
    expect(await screen.findByText('Minified + gzipped', {}, { timeout: SETTLE_TIMEOUT })).toBeInTheDocument();
  });

  it('shows a visible error for an invalid package spec instead of failing silently', async () => {
    render(<BundleSizeChecker />);

    typeInto(packageField(), 'not a valid spec');
    fireEvent.keyDown(packageField(), { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a valid package spec/i);
  });

  it('shows a visible error when the registry has no such package', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse({}, { ok: false, status: 404 })));
    render(<BundleSizeChecker />);

    typeInto(packageField(), 'this-package-does-not-exist');
    fireEvent.keyDown(packageField(), { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a package on the npm registry/i);
  });

  it('offers a retry link next to a failed package lookup, which re-fetches on click', async () => {
    const fetchMock = mockRegistryAndCdn();
    fetchMock.mockImplementationOnce(async () => fakeJsonResponse({}, { ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<BundleSizeChecker />);
    typeInto(packageField(), 'demo-package');
    fireEvent.keyDown(packageField(), { key: 'Enter' });

    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }));

    // The retry re-runs the same lookup, which succeeds against the fallback mock this time.
    expect(await screen.findByText('Minified + gzipped')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the package description alongside the result, not only in the suggestion list', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'lodash' }));
    await screen.findByText('Minified + gzipped');

    expect(screen.getByText('A demo package for tests.')).toBeInTheDocument();
  });

  it('shows repository stats — stars, forks, issues, commits and last commit', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'lodash' }));
    await screen.findByText('Minified + gzipped');

    expect(await screen.findByText('Stars')).toBeInTheDocument();
    expect(screen.getByText('Forks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forks/i })).toHaveAttribute(
      'href',
      'https://github.com/demo/demo-package/forks'
    );
    expect(screen.getByText('Open issues + PRs')).toBeInTheDocument();
    // 87 pages of one commit each is 87 commits — read from the Link header, not the body.
    expect(screen.getByText('Commits')).toBeInTheDocument();
    expect(screen.getByTitle(/87 commits/)).toBeInTheDocument();
    expect(screen.getByText('Last commit')).toBeInTheDocument();
    expect(screen.getByText('Project age')).toBeInTheDocument();
  });

  it('does not link the stat tiles GitHub has no page for', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'lodash' }));
    await screen.findByText('Minified + gzipped');
    await screen.findByText('Stars');

    // GitHub retired /stargazers and /watchers — both 404 now, and its own repo page
    // links neither — so those tiles are plain figures rather than dead links.
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toMatch(/\/(stargazers|watchers)$/);
    }
    expect(screen.queryByRole('link', { name: /stars/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /watchers/i })).not.toBeInTheDocument();
  });

  it('links to the package on npm and to its git repository', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'lodash' }));
    await screen.findByText('Minified + gzipped');

    expect(screen.getByRole('link', { name: 'npm' })).toHaveAttribute('href', 'https://www.npmjs.com/package/lodash');
    expect(await screen.findByRole('link', { name: /github repo/i })).toHaveAttribute(
      'href',
      'https://github.com/demo/demo-package'
    );
  });

  it('renders the published README, with its relative image paths resolved against the repository', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'lodash' }));
    await screen.findByText('Minified + gzipped');

    const readmeHeading = await screen.findByRole('heading', { name: 'demo-package' });
    expect(readmeHeading).toBeInTheDocument();

    const logo = document.querySelector('.bsc-readme__body img');
    expect(logo).toHaveAttribute('src', 'https://raw.githubusercontent.com/demo/demo-package/HEAD/assets/logo.png');
  });

  it('explains what the module-format and sideEffects badges mean, on the page itself', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'lodash' }));
    await screen.findByText('Minified + gzipped');

    fireEvent.click(screen.getByText(/what do "commonjs only" and "sideeffects unspecified" mean\?/i));
    expect(screen.getByText(/it is the absence of a statement either way/i)).toBeInTheDocument();
    expect(screen.getByText(/has to include the whole module/i)).toBeInTheDocument();
  });

  it('explains what the Named imports field is for', () => {
    render(<BundleSizeChecker />);

    // The short version is an ⓘ tooltip on the label; the long version is the details below.
    expect(screen.getByRole('note')).toHaveAttribute('title', expect.stringMatching(/leave empty to size the whole package/i));
    fireEvent.click(screen.getByText(/when does "named imports" actually make a difference\?/i));
    expect(screen.getByText(/it fails with an error\./i)).toBeInTheDocument();
  });

  it('shows the resolved package@version prominently, not just in the copyable summary', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(packageField(), 'demo-package');
    fireEvent.keyDown(packageField(), { key: 'Enter' });
    await screen.findByText('Minified + gzipped');

    expect(screen.getByText('demo-package@1.2.3', { selector: 'code' })).toBeInTheDocument();
  });

  it('shows the major-version comparison as a chart automatically, with no extra click needed', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(packageField(), 'demo-package');
    fireEvent.keyDown(packageField(), { key: 'Enter' });
    await screen.findByText('Minified + gzipped');

    const chart = await screen.findByRole('img', { name: /gzipped size of demo-package/i });
    expect(within(chart).getByText('v1')).toBeInTheDocument();
    expect(within(chart).getByText('v0')).toBeInTheDocument();
    expect(within(chart).getByText('current')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Show as a table'));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('v1')).toBeInTheDocument();
  });

  it('shows matching package suggestions as you type, and selecting one runs the check immediately', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(packageField(), 'demo');

    const option = await screen.findByRole('option', { name: /demo-package/ });
    fireEvent.mouseDown(option);

    expect(packageField()).toHaveValue('demo-package');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(await screen.findByText('Minified + gzipped')).toBeInTheDocument();
  });

  it('copies the plain-text summary to the clipboard', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<BundleSizeChecker />);
    typeInto(packageField(), 'demo-package');
    fireEvent.keyDown(packageField(), { key: 'Enter' });
    await screen.findByText('Minified + gzipped');

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('demo-package@1.2.3'));
  });

  it('clears the input and results', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(packageField(), 'demo-package');
    fireEvent.keyDown(packageField(), { key: 'Enter' });
    await screen.findByText('Minified + gzipped');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(packageField()).toHaveValue('');
    expect(screen.queryByText('Minified + gzipped')).not.toBeInTheDocument();
  });
});

describe('<BundleSizeChecker /> — ?q= deep link', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('checks the package named in ?q= as soon as the page loads', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    window.history.replaceState(null, '', '/bundle-size-checker/?q=demo-package');

    render(<BundleSizeChecker />);

    expect(packageField()).toHaveValue('demo-package');
    expect(await screen.findByText('Minified + gzipped')).toBeInTheDocument();
  });
});

describe('<BundleSizeChecker /> — package.json mode', () => {
  const pkgJsonField = () => screen.getByLabelText(/^package\.json/i);

  it('switches to package.json mode', () => {
    render(<BundleSizeChecker />);
    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    expect(pkgJsonField()).toBeInTheDocument();
  });

  it('checks the sample package.json straight from Load example, with no second click', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((pkgJsonField() as HTMLTextAreaElement).value).toContain('"dependencies"');
    expect(await screen.findByText(/^Dependencies \(5\)$/)).toBeInTheDocument();
  });

  it('checks a chosen package.json file as soon as it is picked, with no second click', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);
    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));

    const file = new File([JSON.stringify({ dependencies: { 'demo-package': '^1.0.0' } })], 'package.json', {
      type: 'application/json',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('demo-package')).toBeInTheDocument();
  });

  it('shows a visible error for invalid JSON instead of failing silently', async () => {
    render(<BundleSizeChecker />);
    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));

    typeInto(pkgJsonField(), '{ not valid json');

    expect(await screen.findByRole('alert', {}, { timeout: SETTLE_TIMEOUT })).toHaveTextContent(/isn't valid json/i);
  });

  it('shows dependencies and devDependencies in separate tables, each with its own total, not mixed together', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /include devdependencies/i }));
    typeInto(
      pkgJsonField(),
      JSON.stringify({ dependencies: { 'demo-package': '^1.0.0' }, devDependencies: { vitest: '^4.0.0' } })
    );

    await screen.findByText('Dependencies (1)', {}, { timeout: SETTLE_TIMEOUT });
    const devHeading = await screen.findByText('Dev Dependencies (1)');

    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(2);

    const depsTable = tables[0]!;
    const devTable = tables[1]!;
    expect(within(depsTable).getByText('demo-package')).toBeInTheDocument();
    expect(within(depsTable).queryByText('vitest')).not.toBeInTheDocument();
    expect(within(devTable).getByText('vitest')).toBeInTheDocument();
    expect(within(devTable).queryByText('demo-package')).not.toBeInTheDocument();
    expect(devHeading).toBeInTheDocument();
  });

  it('does not show a Dev Dependencies table when devDependencies are not included', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    typeInto(
      pkgJsonField(),
      JSON.stringify({ dependencies: { 'demo-package': '^1.0.0' }, devDependencies: { vitest: '^4.0.0' } })
    );

    await screen.findByText('Dependencies (1)', {}, { timeout: SETTLE_TIMEOUT });
    expect(screen.queryByText(/Dev Dependencies/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('checks every dependency and shows a sortable table with a total row', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    typeInto(pkgJsonField(), JSON.stringify({ dependencies: { 'demo-package': '^1.0.0' } }));

    const table = await screen.findByRole('table', {}, { timeout: SETTLE_TIMEOUT });
    expect(within(table).getByText('demo-package')).toBeInTheDocument();
    expect(within(table).getByText('Total')).toBeInTheDocument();
  });

  it('opens one dependency on its own when its name is selected, keeping the package.json behind it', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    typeInto(pkgJsonField(), JSON.stringify({ dependencies: { 'demo-package': '^1.0.0' } }));
    const table = await screen.findByRole('table', {}, { timeout: SETTLE_TIMEOUT });
    // Wait for the row to resolve a version, so the drill-in pins to it rather than
    // falling back to the range the package.json asked for.
    await within(table).findByText('1.2.3');

    fireEvent.click(within(table).getByRole('button', { name: 'demo-package' }));

    // Now a full single-package result, pinned to the version the table resolved.
    expect(screen.getByRole('button', { name: 'Single package' })).toHaveAttribute('aria-pressed', 'true');
    expect(packageField()).toHaveValue('demo-package@1.2.3');
    expect(await screen.findByText('Minified + gzipped')).toBeInTheDocument();

    // The detour is reversible: the package.json and its table are still there.
    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    expect((pkgJsonField() as HTMLTextAreaElement).value).toContain('demo-package');
    expect(within(await screen.findByRole('table')).getByRole('button', { name: 'demo-package' })).toBeInTheDocument();
  });

  it('does not re-check the same dependency list when unrelated package.json fields change', async () => {
    const fetchMock = mockRegistryAndCdn();
    vi.stubGlobal('fetch', fetchMock);
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    typeInto(pkgJsonField(), JSON.stringify({ name: 'a', dependencies: { 'demo-package': '^1.0.0' } }));
    await screen.findByText('Dependencies (1)', {}, { timeout: SETTLE_TIMEOUT });

    const callsAfterFirstRun = fetchMock.mock.calls.length;
    typeInto(pkgJsonField(), JSON.stringify({ name: 'renamed', dependencies: { 'demo-package': '^1.0.0' } }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(callsAfterFirstRun), { timeout: SETTLE_TIMEOUT });
  });
});
