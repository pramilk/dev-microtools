import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import BundleSizeChecker from './BundleSizeChecker';

function fakeJsonResponse(json: unknown, opts: { ok?: boolean; status?: number } = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: () => 'application/json' },
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

function mockRegistryAndCdn() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://api.npmjs.org/downloads/')) return fakeJsonResponse({ downloads: 4_200_000 });
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
        });
      }
      return fakeJsonResponse({
        version: segments[1],
        license: 'MIT',
        dependencies: {},
        dist: { unpackedSize: 5000, fileCount: 4 },
        module: 'index.mjs',
        sideEffects: false,
      });
    }
    throw new Error(`Unhandled fetch in test: ${url}`);
  });
}

const typeInto = (element: HTMLElement, value: string) => fireEvent.input(element, { target: { value } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<BundleSizeChecker /> — single package mode', () => {
  it('starts on single-package mode with popular-package presets and a disabled Check size button', () => {
    render(<BundleSizeChecker />);

    expect(screen.getByRole('button', { name: 'Single package' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'react' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check size/i })).toBeDisabled();
  });

  it('fills the package field from a preset chip', () => {
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'lodash' }));
    expect(screen.getByLabelText(/^package/i)).toHaveValue('lodash');
  });

  it('checks a package and shows its measured minified + gzipped size', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(screen.getByLabelText(/^package/i), 'demo-package');
    fireEvent.click(screen.getByRole('button', { name: /check size/i }));

    expect(await screen.findByText('Minified + gzipped')).toBeInTheDocument();
    expect(screen.getByText('MIT')).toBeInTheDocument();
    expect(screen.getByText('ESM entry point')).toBeInTheDocument();
    expect(screen.getByText('side-effect free')).toBeInTheDocument();
  });

  it('shows a visible error for an invalid package spec instead of failing silently', async () => {
    render(<BundleSizeChecker />);

    typeInto(screen.getByLabelText(/^package/i), 'not a valid spec');
    fireEvent.click(screen.getByRole('button', { name: /check size/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a valid package spec/i);
  });

  it('shows a visible error when the registry has no such package', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeJsonResponse({}, { ok: false, status: 404 }))
    );
    render(<BundleSizeChecker />);

    typeInto(screen.getByLabelText(/^package/i), 'this-package-does-not-exist');
    fireEvent.click(screen.getByRole('button', { name: /check size/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a package on the npm registry/i);
  });

  it('offers a retry link next to a failed package lookup, which re-fetches on click', async () => {
    const fetchMock = mockRegistryAndCdn();
    fetchMock.mockImplementationOnce(async () => fakeJsonResponse({}, { ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<BundleSizeChecker />);
    typeInto(screen.getByLabelText(/^package/i), 'demo-package');
    fireEvent.click(screen.getByRole('button', { name: /check size/i }));

    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: /retry/i });

    fireEvent.click(retry);

    // The retry re-runs the same lookup, which succeeds against the fallback mock this time.
    expect(await screen.findByText('Minified + gzipped')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('copies the plain-text summary to the clipboard', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<BundleSizeChecker />);
    typeInto(screen.getByLabelText(/^package/i), 'demo-package');
    fireEvent.click(screen.getByRole('button', { name: /check size/i }));
    await screen.findByText('Minified + gzipped');

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('demo-package@1.2.3'));
  });

  it('shows the resolved package@version prominently, not just in the copyable summary', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(screen.getByLabelText(/^package/i), 'demo-package');
    fireEvent.click(screen.getByRole('button', { name: /check size/i }));
    await screen.findByText('Minified + gzipped');

    expect(screen.getByText('demo-package@1.2.3', { selector: 'code' })).toBeInTheDocument();
  });

  it('shows the major-version comparison as a chart automatically, with no extra click needed', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(screen.getByLabelText(/^package/i), 'demo-package');
    fireEvent.click(screen.getByRole('button', { name: /check size/i }));
    await screen.findByText('Minified + gzipped');

    // The chart itself appears without clicking anything else.
    const chart = await screen.findByRole('img', { name: /gzipped size of demo-package/i });
    expect(within(chart).getByText('v1')).toBeInTheDocument();
    expect(within(chart).getByText('v0')).toBeInTheDocument();
    expect(within(chart).getByText('current')).toBeInTheDocument();

    // The exact numbers are still available as a table, one click away.
    fireEvent.click(screen.getByText('Show as a table'));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('v1')).toBeInTheDocument();
  });

  it('shows matching package suggestions as you type, and selecting one runs the check immediately', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(screen.getByLabelText(/^package/i), 'demo');

    const option = await screen.findByRole('option', { name: /demo-package/ });
    fireEvent.mouseDown(option);

    expect(screen.getByLabelText(/^package/i)).toHaveValue('demo-package');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Selecting a suggestion is a complete choice — it checks the size right away,
    // without needing a separate press of "Check size".
    expect(await screen.findByText('Minified + gzipped')).toBeInTheDocument();
  });

  it('clears the input and results', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    typeInto(screen.getByLabelText(/^package/i), 'demo-package');
    fireEvent.click(screen.getByRole('button', { name: /check size/i }));
    await screen.findByText('Minified + gzipped');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.getByLabelText(/^package/i)).toHaveValue('');
    expect(screen.queryByText('Minified + gzipped')).not.toBeInTheDocument();
  });
});

describe('<BundleSizeChecker /> — package.json mode', () => {
  it('switches to package.json mode', () => {
    render(<BundleSizeChecker />);
    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    expect(screen.getByLabelText(/^package\.json$/i)).toBeInTheDocument();
  });

  it('fills in a sample package.json via Load example', () => {
    render(<BundleSizeChecker />);
    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect((screen.getByLabelText(/^package\.json$/i) as HTMLTextAreaElement).value).toContain('"dependencies"');
  });

  it('shows a visible error for invalid JSON instead of failing silently', async () => {
    render(<BundleSizeChecker />);
    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));

    typeInto(screen.getByLabelText(/^package\.json$/i), '{ not valid json');
    fireEvent.click(screen.getByRole('button', { name: /check all dependencies/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't valid json/i);
  });

  it('shows dependencies and devDependencies in separate tables, each with its own total, not mixed together', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /include devdependencies/i }));
    typeInto(
      screen.getByLabelText(/^package\.json$/i),
      JSON.stringify({ dependencies: { 'demo-package': '^1.0.0' }, devDependencies: { vitest: '^4.0.0' } })
    );
    fireEvent.click(screen.getByRole('button', { name: /check all dependencies/i }));

    await screen.findByText('Dependencies (1)');
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
      screen.getByLabelText(/^package\.json$/i),
      JSON.stringify({ dependencies: { 'demo-package': '^1.0.0' }, devDependencies: { vitest: '^4.0.0' } })
    );
    fireEvent.click(screen.getByRole('button', { name: /check all dependencies/i }));

    await screen.findByText('Dependencies (1)');
    expect(screen.queryByText(/Dev Dependencies/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('checks every dependency and shows a sortable table with a total row', async () => {
    vi.stubGlobal('fetch', mockRegistryAndCdn());
    render(<BundleSizeChecker />);

    fireEvent.click(screen.getByRole('button', { name: 'package.json' }));
    typeInto(screen.getByLabelText(/^package\.json$/i), JSON.stringify({ dependencies: { 'demo-package': '^1.0.0' } }));
    fireEvent.click(screen.getByRole('button', { name: /check all dependencies/i }));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('demo-package')).toBeInTheDocument();
    expect(within(table).getByText('Total')).toBeInTheDocument();
  });
});
