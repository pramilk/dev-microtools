import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import BrowserFingerprintInspector from './BrowserFingerprintInspector';

class FakeCanvas2DContext {
  font = '';
  fillStyle = '';
  strokeStyle = '';
  textBaseline = '';
  fillRect() {}
  fillText() {}
  beginPath() {}
  arc() {}
  stroke() {}
  // "Georgia" measures wider than the generic baseline to simulate a detected font;
  // every other candidate matches the baseline, i.e. is reported as not installed.
  measureText(_text: string) {
    return { width: this.font.includes('Georgia') ? 999 : 100 };
  }
}

class FakeWebglContext {
  VENDOR = 1;
  RENDERER = 2;
  getParameter(pname: number) {
    switch (pname) {
      case this.VENDOR:
        return 'WebKit';
      case this.RENDERER:
        return 'WebKit WebGL';
      case 3:
        return 'Google Inc. (NVIDIA)';
      case 4:
        return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11)';
      default:
        return 'unknown';
    }
  }
  getExtension(name: string) {
    if (name !== 'WEBGL_debug_renderer_info') return null;
    return { UNMASKED_VENDOR_WEBGL: 3, UNMASKED_RENDERER_WEBGL: 4 };
  }
}

function mockWorkingCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    id: string
  ) {
    if (id === '2d') return new FakeCanvas2DContext();
    if (id === 'webgl') return new FakeWebglContext();
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,fake');
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<BrowserFingerprintInspector />', () => {
  it('collects and displays every category on mount', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);

    expect(await screen.findByText('Identity')).toBeInTheDocument();
    // "Network request" is both the category heading and (as its fallback row's hint
    // target) present here too, since window.__SERVER_REQUEST_INFO__ is never injected
    // outside the real Cloudflare Worker.
    expect(screen.getAllByText('Network request').length).toBeGreaterThan(0);
    expect(screen.getByText('Not available in this environment')).toBeInTheDocument();
    expect(screen.getByText('Display & hardware')).toBeInTheDocument();
    // "Timezone" is both the category heading and a row label within it, so it matches twice.
    expect(screen.getAllByText('Timezone').length).toBeGreaterThan(0);
    expect(screen.getByText('UTC offset')).toBeInTheDocument();
    expect(screen.getByText('Privacy signals')).toBeInTheDocument();
    expect(screen.getByText('Permissions')).toBeInTheDocument();
    expect(screen.getByText('Rendering fingerprint')).toBeInTheDocument();
    expect(screen.getByText('Fonts detected')).toBeInTheDocument();
  });

  it('shows the "Browser" section before the "Server" section', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);

    const headings = (await screen.findAllByRole('heading', { level: 3 })).map((h) => h.textContent);
    expect(headings).toEqual(['What your browser reveals', 'What the server already saw']);
  });

  it('shows the collected signal count summary', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);

    expect(await screen.findByText(/signals collected across 8 categories/i)).toBeInTheDocument();
  });

  it('resolves plugins, battery, ad-blocker, and permission checks to their jsdom defaults', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);

    // jsdom has no Permissions API and no ad-blocker CSS, so these should settle to
    // deterministic, testable defaults rather than stay stuck on "Checking…"/"Computing…".
    await waitFor(() => {
      expect(screen.queryByText('Checking…')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Not detected')).toBeInTheDocument();
    expect(screen.getAllByText('Not supported by this browser').length).toBeGreaterThan(0);
    expect(screen.getByText(/Not supported by this browser \(removed from Firefox and Safari/)).toBeInTheDocument();
  });

  it('reads server-side signals injected by the Cloudflare Worker into window.__SERVER_REQUEST_INFO__', async () => {
    mockWorkingCanvas();
    (window as Window & { __SERVER_REQUEST_INFO__?: unknown }).__SERVER_REQUEST_INFO__ = {
      ip: '203.0.113.42',
      city: 'New York',
      region: 'New York',
      country: 'US',
      continent: 'NA',
      postalCode: '10001',
      latitude: '40.71427',
      longitude: '-74.00597',
      timezone: 'America/New_York',
      colo: 'EWR',
      asn: 7922,
      asOrganization: 'Comcast Cable',
      httpProtocol: 'HTTP/3',
      tlsVersion: 'TLSv1.3',
      tlsCipher: 'AEAD-AES128-GCM-SHA256',
      cookiesSent: false,
      headers: { 'user-agent': 'Mozilla/5.0 (Test)' },
    };

    try {
      render(<BrowserFingerprintInspector />);
      expect(await screen.findByText('203.0.113.42')).toBeInTheDocument();
      expect(screen.getByText('New York, New York, US')).toBeInTheDocument();
      expect(screen.getByText('AS7922')).toBeInTheDocument();
    } finally {
      delete (window as Window & { __SERVER_REQUEST_INFO__?: unknown }).__SERVER_REQUEST_INFO__;
    }
  });

  it('resolves the canvas hash asynchronously instead of leaving it stuck on "Computing…"', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);

    await screen.findByText('Identity');
    await waitFor(() => {
      expect(screen.queryByText('Computing…')).not.toBeInTheDocument();
    });
  });

  it('detects a font whose measured width differs from the generic baseline', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);

    expect(await screen.findByText(/Georgia/)).toBeInTheDocument();
  });

  it('shows the unmasked WebGL renderer when the debug extension is available', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);

    expect(await screen.findByText(/GeForce GTX 1080/)).toBeInTheDocument();
  });

  it('falls back gracefully when canvas and WebGL are unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<BrowserFingerprintInspector />);

    await screen.findByText('Identity');
    expect((await screen.findAllByText('Not exposed by this browser')).length).toBeGreaterThan(0);
    expect(screen.getByText('None of the tested fonts were detected')).toBeInTheDocument();
  });

  it('re-collects every signal when Rescan is pressed', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);
    await screen.findByText('Identity');

    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL');
    fireEvent.click(screen.getByRole('button', { name: /rescan/i }));

    expect(spy).toHaveBeenCalled();
    expect(screen.getByText('Identity')).toBeInTheDocument();
  });

  it('shows an actionable warning with steps when no ad blocker is detected', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);

    await waitFor(() => {
      expect(screen.getByText('Not detected')).toBeInTheDocument();
    });
    expect(screen.getByText(/No ad blocker was detected/)).toBeInTheDocument();
    expect(screen.getByText(/Install a reputable content blocker/)).toBeInTheDocument();
  });

  it('shows an actionable warning when the real GPU is exposed via unmasked WebGL', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);

    expect(await screen.findByText(/Your real GPU model is exposed/)).toBeInTheDocument();
  });

  it('copies the full report as text', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);
    await screen.findByText('Identity');

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
    const [copiedText] = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(copiedText).toContain('Identity');
    expect(copiedText).toContain('User-Agent');
  });

  it('has no Share link or Load example controls, since there is no input state to encode or sample', async () => {
    mockWorkingCanvas();
    render(<BrowserFingerprintInspector />);
    await screen.findByText('Identity');

    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load example/i })).not.toBeInTheDocument();
  });
});
