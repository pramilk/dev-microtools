import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import {
  buildFingerprintReport,
  countSignals,
  reportToText,
  detectAvailableFonts,
  hashCanvasData,
  FONT_CANDIDATES,
  FONT_TEST_STRING,
  GENERIC_FAMILIES,
  type RawSignals,
  type FontDetectionResult,
  type FontMeasurement,
  type GenericFamily,
  type ServerSignals,
  type PermissionState,
  type PermissionSignals,
} from '../lib/tools/browserFingerprint';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';

/**
 * Deliberately no ShareLinkButton and no "Load example": there is no input state to
 * encode — every value shown is read live from the visitor's own browser, the same way
 * UUID Generator and Password Generator have no sample input for a tool whose entire
 * point is a fresh, real result each time. Sharing a fingerprint report would also be
 * actively unhelpful: the link's state-in-URL model shares *settings*, but there are
 * none here, and pasting your own report somewhere public is precisely the kind of
 * identifying data this tool exists to surface, not to encourage sharing.
 *
 * "Clear" doesn't apply for the same reason there's no input to clear; "Rescan" fills
 * that role instead, re-running every check from scratch.
 */

/**
 * Set by a Cloudflare Worker that injects a <script> into this page's <head> before the
 * response reaches the browser — see src/worker/index.ts. It runs as a plain blocking
 * script, so it has already executed by the time this island hydrates. `null` wherever
 * that Worker doesn't run (local dev, the test build, a cached response).
 */
function readInjectedServerSignals(): ServerSignals | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { __SERVER_REQUEST_INFO__?: ServerSignals }).__SERVER_REQUEST_INFO__ ?? null;
}

interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

interface ExtendedNavigator extends Navigator {
  deviceMemory?: number;
  globalPrivacyControl?: boolean;
  getBattery?: () => Promise<{ level: number; charging: boolean }>;
  connection?: NetworkInformation;
}

function safeStorageCheck(getStorage: () => Storage): boolean {
  const probeKey = '__browser_fingerprint_probe__';
  try {
    const storage = getStorage();
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

interface WebglInfo {
  vendor: string | null;
  renderer: string | null;
  unmaskedVendor: string | null;
  unmaskedRenderer: string | null;
}

function collectWebglInfo(): WebglInfo {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (!gl) return { vendor: null, renderer: null, unmaskedVendor: null, unmaskedRenderer: null };

    const vendor = String(gl.getParameter(gl.VENDOR));
    const renderer = String(gl.getParameter(gl.RENDERER));
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const unmaskedVendor = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : null;
    const unmaskedRenderer = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : null;

    return { vendor, renderer, unmaskedVendor, unmaskedRenderer };
  } catch {
    return { vendor: null, renderer: null, unmaskedVendor: null, unmaskedRenderer: null };
  }
}

/** Draws a small, deterministic image whose exact pixels depend on the browser's font
 *  rasterizer, GPU, and OS — the classic canvas-fingerprinting technique. */
function renderCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 60, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('BrowserFingerprint 😀', 2, 15);
    ctx.strokeStyle = 'rgba(120, 20, 200, 0.7)';
    ctx.beginPath();
    ctx.arc(50, 20, 15, 0, Math.PI * 2);
    ctx.stroke();

    return canvas.toDataURL();
  } catch {
    return '';
  }
}

function measureFonts(): { baseline: Record<GenericFamily, number>; measurements: FontMeasurement[] } {
  const fallbackBaseline = { serif: 0, 'sans-serif': 0, monospace: 0 } as Record<GenericFamily, number>;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { baseline: fallbackBaseline, measurements: FONT_CANDIDATES.map((candidate) => ({ candidate, widths: {} })) };
    }

    const measure = (fontFamily: string): number => {
      ctx.font = `72px ${fontFamily}`;
      return ctx.measureText(FONT_TEST_STRING).width;
    };

    const baseline = GENERIC_FAMILIES.reduce((acc, generic) => {
      acc[generic] = measure(generic);
      return acc;
    }, {} as Record<GenericFamily, number>);

    const measurements = FONT_CANDIDATES.map((candidate) => ({
      candidate,
      widths: GENERIC_FAMILIES.reduce((acc, generic) => {
        acc[generic] = measure(`"${candidate}", ${generic}`);
        return acc;
      }, {} as Partial<Record<GenericFamily, number>>),
    }));

    return { baseline, measurements };
  } catch {
    return { baseline: fallbackBaseline, measurements: FONT_CANDIDATES.map((candidate) => ({ candidate, widths: {} })) };
  }
}

function collectPluginNames(): string[] {
  try {
    return Array.from(navigator.plugins ?? []).map((plugin) => plugin.name);
  } catch {
    return [];
  }
}

/** `getBattery()`'s resolved values, or nulls if unsupported or the promise rejects — callers check `batterySupported` (a synchronous feature check) to tell "unsupported" apart from "still pending". */
async function collectBatteryDetails(): Promise<{ level: number | null; charging: boolean | null }> {
  const nav = navigator as ExtendedNavigator;
  if (typeof nav.getBattery !== 'function') return { level: null, charging: null };
  try {
    const battery = await nav.getBattery();
    return { level: battery.level, charging: battery.charging };
  } catch {
    return { level: null, charging: null };
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

/**
 * The standard "bait element" technique many sites themselves use to detect an ad
 * blocker: append a hidden element named and sized like a typical ad slot, then check
 * whether an ad blocker's cosmetic filters hid it. Best-effort — a blocker using only
 * network-request blocking, or one that specifically evades this exact check, won't be
 * caught, so a "Not detected" result here isn't a guarantee.
 */
async function detectAdBlocker(): Promise<boolean> {
  try {
    const bait = document.createElement('div');
    bait.className = 'ad ads adsbox ad-banner adsbygoogle pub_300x250 textAd text-ad';
    bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;';
    document.body.appendChild(bait);
    await nextFrame();
    const blocked = getComputedStyle(bait).display === 'none';
    bait.remove();
    return blocked;
  } catch {
    return false;
  }
}

/** Checking a permission's status never triggers the browser's own permission prompt — only actually using the API (e.g. `getCurrentPosition`) does. */
async function queryPermission(name: keyof PermissionSignals): Promise<PermissionState> {
  try {
    if (!navigator.permissions?.query) return 'unsupported';
    const status = await navigator.permissions.query({ name });
    return status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

async function collectPermissions(): Promise<PermissionSignals> {
  const [geolocation, camera, microphone, notifications] = await Promise.all([
    queryPermission('geolocation'),
    queryPermission('camera'),
    queryPermission('microphone'),
    queryPermission('notifications'),
  ]);
  return { geolocation, camera, microphone, notifications };
}

function collectRawSignals(): Omit<RawSignals, 'canvasHash' | 'batteryLevel' | 'batteryCharging' | 'adBlockerDetected' | 'permissions'> {
  const nav = navigator as ExtendedNavigator;
  const webgl = collectWebglInfo();

  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = '';
  }

  return {
    userAgent: nav.userAgent,
    platform: nav.platform ?? '',
    language: nav.language ?? '',
    languages: nav.languages ? Array.from(nav.languages) : [],
    cookieEnabled: nav.cookieEnabled,
    doNotTrack: nav.doNotTrack ?? null,
    globalPrivacyControl: typeof nav.globalPrivacyControl === 'boolean' ? nav.globalPrivacyControl : null,
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    screenWidth: screen.width,
    screenHeight: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio || 1,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    timeZone,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    localStorageAvailable: safeStorageCheck(() => window.localStorage),
    sessionStorageAvailable: safeStorageCheck(() => window.sessionStorage),
    indexedDbAvailable: typeof indexedDB !== 'undefined',
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer,
    webglUnmaskedVendor: webgl.unmaskedVendor,
    webglUnmaskedRenderer: webgl.unmaskedRenderer,
    pluginNames: collectPluginNames(),
    batterySupported: typeof nav.getBattery === 'function',
    connectionType: nav.connection?.effectiveType ?? null,
    connectionDownlinkMbps: typeof nav.connection?.downlink === 'number' ? nav.connection.downlink : null,
    connectionRttMs: typeof nav.connection?.rtt === 'number' ? nav.connection.rtt : null,
    connectionSaveData: typeof nav.connection?.saveData === 'boolean' ? nav.connection.saveData : null,
  };
}

export default function BrowserFingerprintInspector() {
  const [raw, setRaw] = useState<RawSignals | null>(null);
  const [fonts, setFonts] = useState<FontDetectionResult>({ available: [], unavailable: [] });
  const [error, setError] = useState<string | null>(null);
  // Read once: this is baked into the page's HTML at request time, so it can't change
  // without a full reload — "Rescan" only re-runs the client-side checks below.
  const [server] = useState<ServerSignals | null>(() => readInjectedServerSignals());

  const scan = useCallback(() => {
    setError(null);
    try {
      const base = collectRawSignals();
      setRaw({
        ...base,
        canvasHash: null,
        batteryLevel: null,
        batteryCharging: null,
        adBlockerDetected: null,
        permissions: { geolocation: null, camera: null, microphone: null, notifications: null },
      });

      const { baseline, measurements } = measureFonts();
      setFonts(detectAvailableFonts(measurements, baseline));

      const dataUrl = renderCanvasFingerprint();
      void hashCanvasData(dataUrl).then((result) => {
        setRaw((prev) => (prev ? { ...prev, canvasHash: result.ok ? result.value : 'Not available' } : prev));
      });

      void collectBatteryDetails().then(({ level, charging }) => {
        setRaw((prev) => (prev ? { ...prev, batteryLevel: level, batteryCharging: charging } : prev));
      });

      void detectAdBlocker().then((detected) => {
        setRaw((prev) => (prev ? { ...prev, adBlockerDetected: detected } : prev));
      });

      void collectPermissions().then((permissions) => {
        setRaw((prev) => (prev ? { ...prev, permissions } : prev));
      });
    } catch {
      setError('Could not collect browser signals — a privacy extension or browser setting may be blocking access.');
    }
  }, []);

  useEffect(() => {
    scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const report = useMemo(() => (raw ? buildFingerprintReport(raw, fonts, server) : []), [raw, fonts, server]);
  const reportText = useMemo(() => reportToText(report), [report]);
  const totalSignals = useMemo(() => countSignals(report), [report]);

  return (
    <div class="tool">
      <p class="msg msg--info">
        <span class="msg__icon" aria-hidden="true">
          i
        </span>
        <span>
          Most of what's below is read directly from your own browser and computed locally — nothing about it is
          uploaded anywhere. The one exception is "Network request": that data was already visible to this site's
          server the instant your browser requested this page, the same way it's visible to every server you visit —
          this tool just shows it back to you instead of discarding it, and makes no extra request of its own to do
          so.
        </span>
      </p>

      <div class="tool-bar" role="group" aria-label="Actions">
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={scan} title="Re-run every browser-side check below (the server section only changes on a full page reload)">
          Rescan
        </button>
        <CopyButton value={reportText} describe="the full fingerprint report" />
      </div>

      <ErrorMessage message={error} />

      {raw && (
        <>
          <p class="field__hint">
            {totalSignals.toLocaleString()} signals collected across {report.reduce((n, section) => n + section.categories.length, 0)} categories.
          </p>

          {report.map((section) => (
            <section class="bfi-section" key={section.id} aria-labelledby={`bfi-section-${section.id}`}>
              <h3 id={`bfi-section-${section.id}`} class="bfi-section__title">
                {section.label}
              </h3>
              <p class="field__hint">{section.description}</p>

              {section.categories.map((category) => (
                <div class="field" key={category.id}>
                  <span class="field__label">
                    <span>{category.label}</span>
                  </span>
                  <dl class="bfi-grid">
                    {category.rows.map((row) => (
                      <>
                        <dt key={`t-${row.label}`} title={row.hint}>
                          {row.warning && (
                            <span class="bfi-warning__badge" aria-hidden="true" title="Action recommended — see below">
                              ⚠
                            </span>
                          )}
                          {row.caveat && (
                            <span class="bfi-caveat__badge" aria-hidden="true" title="This value may not be fully accurate — see below">
                              ℹ
                            </span>
                          )}
                          {row.label}
                        </dt>
                        <dd key={`d-${row.label}`}>
                          {row.value}
                          {row.warning && (
                            <div class="bfi-warning">
                              <p class="bfi-warning__message">
                                <span class="bfi-warning__icon" aria-hidden="true">
                                  ⚠
                                </span>
                                <span>
                                  <span class="sr-only">Action recommended: </span>
                                  {row.warning.message}
                                </span>
                              </p>
                              <ol class="bfi-warning__steps">
                                {row.warning.steps.map((step, index) => (
                                  <li key={index}>{step}</li>
                                ))}
                              </ol>
                            </div>
                          )}
                          {row.caveat && (
                            <p class="bfi-caveat">
                              <span class="bfi-caveat__icon" aria-hidden="true">
                                ℹ
                              </span>
                              <span>
                                <span class="sr-only">Note: </span>
                                {row.caveat}
                              </span>
                            </p>
                          )}
                        </dd>
                      </>
                    ))}
                  </dl>
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      <style>{`
        .bfi-grid {
          display: grid; grid-template-columns: minmax(11rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4); font-size: var(--text-sm);
        }
        .bfi-grid dt {
          font-family: var(--font-mono); color: var(--text-muted);
          font-size: var(--text-xs); letter-spacing: .06em; align-self: start;
          cursor: help;
        }
        .bfi-grid dd {
          margin: 0; align-self: start; word-break: break-word;
          font-family: var(--font-mono);
        }
        .bfi-section {
          display: flex; flex-direction: column; gap: var(--space-3);
          padding-top: var(--space-5); margin-top: var(--space-5);
          border-top: 1px solid var(--border);
        }
        .bfi-section:first-of-type { padding-top: 0; margin-top: 0; border-top: none; }
        .bfi-section__title {
          font-size: var(--text-lg); font-weight: 650; margin: 0;
        }
        .bfi-warning__badge {
          display: inline-block; margin-right: 0.3em; color: var(--warning);
        }
        .bfi-warning {
          margin-top: var(--space-2); padding: var(--space-3);
          border: 1px solid var(--warning-border); border-radius: var(--radius);
          background: var(--warning-subtle);
        }
        .bfi-warning__message {
          display: flex; gap: 0.4em; align-items: flex-start;
          margin: 0; color: var(--text); font-family: var(--font-sans);
        }
        .bfi-warning__icon {
          color: var(--warning); flex-shrink: 0;
        }
        .bfi-warning__steps {
          margin: var(--space-2) 0 0; padding-left: 1.4em;
          font-family: var(--font-sans); color: var(--text-muted);
          display: flex; flex-direction: column; gap: 0.3em;
        }
        .bfi-caveat__badge {
          display: inline-block; margin-right: 0.3em; color: var(--accent);
        }
        .bfi-caveat {
          display: flex; gap: 0.4em; align-items: flex-start;
          margin: var(--space-2) 0 0; padding: var(--space-2) var(--space-3);
          border: 1px solid var(--accent-border); border-radius: var(--radius);
          background: var(--accent-subtle); color: var(--text-muted);
          font-family: var(--font-sans); font-size: var(--text-xs);
        }
        .bfi-caveat__icon {
          color: var(--accent); flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
