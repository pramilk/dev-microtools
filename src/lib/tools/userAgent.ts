import { type ToolResult, ok, err } from './result';

export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot';

export interface UserAgentInfo {
  browser: { name: string; version: string };
  os: { name: string; version: string };
  engine: string;
  device: DeviceType;
  /** Specific hardware, e.g. "iPhone", "Pixel 8", "SM-S918B". Null when the UA carries no model token (most desktops). */
  deviceModel: string | null;
  /** CPU architecture as reported by the UA — not necessarily the real chip, see the FAQ note on Apple Silicon Macs. */
  architecture: string | null;
  /** The host app if this is an embedded/in-app browser (Instagram, Facebook, TikTok, ...), otherwise null. */
  inApp: string | null;
}

interface Matcher {
  name: string;
  /** First capture group, if present, is the version. */
  pattern: RegExp;
}

/**
 * Order matters: several browsers embed another browser's name in their UA string
 * (Edge and Opera both contain "Chrome", mobile Safari contains "like Gecko"), so more
 * specific signatures must be checked before the general ones they would otherwise
 * false-match.
 */
const BOT_MATCHERS: Matcher[] = [
  { name: 'Googlebot', pattern: /Googlebot\/([\d.]+)/ },
  { name: 'Bingbot', pattern: /bingbot\/([\d.]+)/ },
  { name: 'DuckDuckBot', pattern: /DuckDuckBot\/([\d.]+)/ },
  { name: 'Yandexbot', pattern: /YandexBot\/([\d.]+)/ },
  { name: 'Baiduspider', pattern: /Baiduspider\/([\d.]+)/ },
  { name: 'Applebot', pattern: /Applebot\/([\d.]+)/ },
  { name: 'Slurp', pattern: /Slurp\/([\d.]+)/ },
  { name: 'AhrefsBot', pattern: /AhrefsBot\/([\d.]+)/ },
  { name: 'SemrushBot', pattern: /SemrushBot\/([\d.]+)/ },
  { name: 'GPTBot', pattern: /GPTBot\/([\d.]+)/ },
  { name: 'ClaudeBot', pattern: /ClaudeBot\/([\d.]+)/ },
];

const BROWSER_MATCHERS: Matcher[] = [
  { name: 'Samsung Internet', pattern: /SamsungBrowser\/([\d.]+)/ },
  { name: 'Edge', pattern: /Edg(?:A|iOS)?\/([\d.]+)/ },
  { name: 'Opera', pattern: /(?:OPR|Opera)\/([\d.]+)/ },
  { name: 'Firefox', pattern: /Firefox\/([\d.]+)/ },
  { name: 'Internet Explorer', pattern: /(?:MSIE ([\d.]+)|rv:([\d.]+)\) like Gecko)/ },
  // Chrome (and Chromium-based browsers not already matched above) must come before
  // Safari, since every one of them also carries "Safari/xxx" in its UA string.
  { name: 'Chrome', pattern: /(?:Chrome|CriOS)\/([\d.]+)/ },
  // Safari must come last among engine-sharing browsers: its own UA has no "Chrome"
  // or "Edg" token, only "Version/x.y ... Safari/x.y" — the Version number is the one
  // that actually identifies the Safari release.
  { name: 'Safari', pattern: /Version\/([\d.]+).*Safari/ },
  // Last resort: several in-app WebViews (notably Facebook's) carry a Safari build
  // number but, unlike real Safari, no "Version/x.y" token — this catches those as a
  // generic WebKit WebView instead of failing to recognise the browser at all.
  { name: 'WebKit WebView', pattern: /AppleWebKit\/[\d.]+.*Safari\/([\d.]+)/ },
];

const OS_MATCHERS: Matcher[] = [
  { name: 'iOS', pattern: /(?:iPhone|iPad|iPod).*OS ([\d_]+)/ },
  { name: 'Android', pattern: /Android ([\d.]+)/ },
  { name: 'Windows', pattern: /Windows NT ([\d.]+)/ },
  { name: 'macOS', pattern: /Mac OS X ([\d_]+)/ },
  { name: 'ChromeOS', pattern: /CrOS \w+ ([\d.]+)/ },
  { name: 'Linux', pattern: /(Linux)/ },
];

const WINDOWS_VERSION_NAMES: Record<string, string> = {
  '10.0': '10/11',
  '6.3': '8.1',
  '6.2': '8',
  '6.1': '7',
  '6.0': 'Vista',
  '5.2': 'XP x64',
  '5.1': 'XP',
};

function matchFirst(ua: string, matchers: Matcher[]): { name: string; version: string } | null {
  for (const matcher of matchers) {
    const match = matcher.pattern.exec(ua);
    if (match) {
      const version = (match[1] ?? match[2] ?? '').replace(/_/g, '.');
      return { name: matcher.name, version };
    }
  }
  return null;
}

function detectEngine(ua: string): string {
  if (/Edg\//.test(ua)) return 'Blink (Chromium)';
  if (/Gecko\/\d|Firefox\//.test(ua) && !/like Gecko/.test(ua)) return 'Gecko';
  if (/AppleWebKit/.test(ua) && !/Chrome|CriOS|Chromium|OPR|Edg/.test(ua)) return 'WebKit';
  if (/Chrome|CriOS|Chromium|OPR/.test(ua)) return 'Blink (Chromium)';
  if (/Trident|MSIE/.test(ua)) return 'Trident';
  return 'Unknown';
}

function detectDevice(ua: string, isBot: boolean): DeviceType {
  if (isBot) return 'bot';
  if (/iPad/.test(ua)) return 'tablet';
  if (/iPhone|iPod/.test(ua)) return 'mobile';
  if (/Android/.test(ua)) {
    // Android phones always carry a "Mobile" token; tablets omit it. Checking for
    // "Mobile" anywhere in the string (rather than only right after "Android") matters
    // because some in-app browsers (Instagram, Facebook) append a second, bare
    // "Android" token after their own app identifier, with nothing after *that* one —
    // a lookahead anchored to the first "Android" match would misread that as a tablet.
    return /Mobile/.test(ua) ? 'mobile' : 'tablet';
  }
  if (/Tablet/.test(ua)) return 'tablet';
  if (/Mobi/.test(ua)) return 'mobile';
  return 'desktop';
}

/** Specific hardware named in the UA, where the platform provides one. */
function detectDeviceModel(ua: string): string | null {
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPod/.test(ua)) return 'iPod touch';

  // Android UAs name the device between the OS version and the build tag, e.g.
  // "Android 14; Pixel 8)" or "Android 14; SM-S918B Build/UP1A.231005.007)".
  const androidModel = /Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/[\w.]+)?\)/.exec(ua);
  if (androidModel) {
    const model = androidModel[1]!.trim();
    // Some Android UAs put "K" or nothing meaningful in this slot when the vendor
    // doesn't report a real model — not worth surfacing as if it were one.
    if (model !== '' && model.toLowerCase() !== 'k') return model;
  }

  return null;
}

/**
 * CPU architecture as the UA reports it. Note this reflects what the OS/browser
 * declares, not necessarily the real chip — see the FAQ entry on Apple Silicon Macs,
 * which still report "Intel" for web compatibility.
 */
function detectArchitecture(ua: string): string | null {
  if (/Win64;\s*x64|WOW64/.test(ua)) return 'x64';
  if (/Windows NT[^;]*;\s*ARM/.test(ua)) return 'ARM';
  if (/x86_64|amd64/i.test(ua)) return 'x86_64';
  if (/aarch64|arm64/i.test(ua)) return 'arm64';
  if (/Intel/.test(ua)) return 'Intel (x64)';
  if (/i686|i386/.test(ua)) return 'x86 (32-bit)';
  return null;
}

const IN_APP_MATCHERS: { name: string; pattern: RegExp }[] = [
  { name: 'Facebook', pattern: /FBAN|FBAV|FB_IAB/ },
  { name: 'Instagram', pattern: /Instagram/ },
  { name: 'TikTok', pattern: /musical_ly|BytedanceWebview|TikTok/ },
  { name: 'Twitter/X', pattern: /Twitter/ },
  { name: 'LinkedIn', pattern: /LinkedInApp/ },
  { name: 'Snapchat', pattern: /Snapchat/ },
  { name: 'Pinterest', pattern: /Pinterest/ },
  { name: 'WeChat', pattern: /MicroMessenger/ },
  { name: 'Line', pattern: /\bLine\// },
  { name: 'WhatsApp', pattern: /WhatsApp/ },
];

/** The host app if this is an embedded "in-app" browser rather than a standalone one. */
function detectInApp(ua: string): string | null {
  for (const matcher of IN_APP_MATCHERS) {
    if (matcher.pattern.test(ua)) return matcher.name;
  }
  return null;
}

/** Parses a browser User-Agent string into browser, OS, engine and device type. */
export function parseUserAgent(input: string): ToolResult<UserAgentInfo> {
  const ua = input.trim();
  if (ua === '') return err('Paste a User-Agent string to parse it.');

  const bot = matchFirst(ua, BOT_MATCHERS);
  const browser = bot ?? matchFirst(ua, BROWSER_MATCHERS);
  if (!browser) {
    return err('Could not recognise a browser in that string — it may be malformed or from an unlisted client.');
  }

  const osMatch = matchFirst(ua, OS_MATCHERS);
  let os = osMatch ?? { name: 'Unknown', version: '' };
  if (os.name === 'Windows' && WINDOWS_VERSION_NAMES[os.version]) {
    os = { name: 'Windows', version: WINDOWS_VERSION_NAMES[os.version]! };
  }

  return ok({
    browser,
    os,
    engine: detectEngine(ua),
    device: detectDevice(ua, bot !== null),
    deviceModel: detectDeviceModel(ua),
    architecture: detectArchitecture(ua),
    inApp: detectInApp(ua),
  });
}

/** The visitor's own User-Agent, read directly from the browser — null outside a browser. */
export function currentUserAgent(): string | null {
  return typeof navigator === 'undefined' ? null : navigator.userAgent;
}

export interface UaTokenSegment {
  text: string;
  /** Null for the plain punctuation/whitespace between recognised tokens. */
  label: string | null;
  explain: string | null;
}

interface TokenExplanation {
  pattern: RegExp;
  label: string;
  explain: string;
}

/**
 * Ordered most-specific-first, same reasoning as the browser matchers above: several of
 * these tokens are substrings of each other (e.g. "Safari" inside a "Version/x.y Safari"
 * pair), so a more specific pattern has to claim its match before a broader one can.
 */
const TOKEN_EXPLANATIONS: TokenExplanation[] = [
  {
    pattern: /Mozilla\/5\.0/,
    label: 'Mozilla/5.0',
    explain:
      'A historical compatibility token every modern browser includes, even though none of them are the old Netscape/Mozilla browser it originally named. Early sites checked for this string, so every later browser kept it to avoid being blocked or downgraded.',
  },
  {
    pattern: /compatible;/,
    label: 'compatible;',
    explain: 'A convention bots use to signal "I am not a real browser, but treat me like one" — inherited from an old Internet Explorer convention.',
  },
  {
    pattern: /Googlebot\/[\d.]+/,
    label: 'Googlebot',
    explain: "Identifies this request as Google's search-indexing crawler, not a browser at all.",
  },
  {
    pattern: /FBAN|FBAV|FB_IAB/,
    label: 'FBAN / FBAV',
    explain: "Marks this as Facebook's in-app browser — a WebView embedded inside the Facebook app, not a standalone browser.",
  },
  {
    pattern: /Instagram [\d.]+/,
    label: 'Instagram',
    explain: "Marks this as Instagram's in-app browser — a WebView embedded inside the Instagram app.",
  },
  {
    pattern: /SamsungBrowser\/[\d.]+/,
    label: 'SamsungBrowser',
    explain: "Samsung Internet's real identifier, the default browser on Samsung Android devices.",
  },
  {
    pattern: /Edg(?:A|iOS)?\/[\d.]+/,
    label: 'Edg',
    explain: "Microsoft Edge's real identifier. Edge is Chromium-based, so it also carries the Chrome and Safari tokens below for compatibility.",
  },
  {
    pattern: /OPR\/[\d.]+/,
    label: 'OPR',
    explain: "Opera's real identifier. Also Chromium-based, so it carries the Chrome and Safari tokens too.",
  },
  {
    pattern: /Firefox\/[\d.]+/,
    label: 'Firefox',
    explain: 'The actual browser and version — genuine Firefox.',
  },
  {
    pattern: /CriOS\/[\d.]+/,
    label: 'CriOS',
    explain: "Chrome on iOS — named differently from desktop Chrome because Apple's App Store rules require every iOS browser to use Apple's WebKit engine, not Chrome's own Blink engine.",
  },
  {
    pattern: /Chrome\/[\d.]+/,
    label: 'Chrome',
    explain: 'The actual browser and version — genuine Chrome, or a Chromium-based browser that has not identified itself any more specifically.',
  },
  {
    pattern: /Version\/[\d.]+/,
    label: 'Version',
    explain: "Safari's real version number. Only genuine Safari includes this token — it is the one reliable way to tell real Safari apart from every other WebKit-based browser below.",
  },
  {
    pattern: /Safari\/[\d.]+/,
    label: 'Safari',
    explain: 'A legacy WebKit compatibility token carried by every WebKit- or Blink-based browser (Chrome, Edge, Opera, Samsung Internet, real Safari...) — not proof this is actually Safari on its own.',
  },
  {
    pattern: /AppleWebKit\/[\d.]+/,
    label: 'AppleWebKit',
    explain: 'Names the rendering engine family. WebKit (Safari) and Blink (Chrome and its relatives, a WebKit fork) both keep this token for compatibility with sites that check for it.',
  },
  {
    pattern: /\(KHTML, like Gecko\)/,
    label: 'KHTML, like Gecko',
    explain: "Claims compatibility with two other rendering engines — KHTML (WebKit's ancestor) and Gecko (Firefox's engine) — for the same historical compatibility-sniffing reasons as \"Mozilla/5.0\", not a real technical relationship.",
  },
  {
    pattern: /Gecko\/[\d.]+/,
    label: 'Gecko',
    explain: "Firefox's real rendering engine, with a build identifier rather than a meaningful version number in current Firefox releases.",
  },
  {
    pattern: /Trident\/[\d.]+/,
    label: 'Trident',
    explain: "Internet Explorer's real rendering engine.",
  },
  {
    pattern: /MSIE [\d.]+/,
    label: 'MSIE',
    explain: "Internet Explorer's version number, in its older UA format (IE 11 uses \"rv:\" instead, below).",
  },
  {
    pattern: /rv:[\d.]+/,
    label: 'rv:',
    explain: 'The "revision" version number — used by both Firefox and Internet Explorer 11 in different parts of their UA string.',
  },
  {
    pattern: /Windows NT [\d.]+/,
    label: 'Windows NT',
    explain: 'The Windows kernel version. Windows 10 and 11 both report "NT 10.0" — Microsoft stopped changing this number after Windows 10, so the two are indistinguishable from the User-Agent alone.',
  },
  {
    pattern: /Win64;\s*x64/,
    label: 'Win64; x64',
    explain: 'Marks this as the 64-bit version of Windows, running on a 64-bit (x64) processor.',
  },
  {
    pattern: /WOW64/,
    label: 'WOW64',
    explain: '"Windows on Windows 64" — a 32-bit browser process running on a 64-bit version of Windows.',
  },
  {
    pattern: /Macintosh; Intel Mac OS X [\d_]+/,
    label: 'Macintosh; Intel Mac OS X',
    explain: 'The macOS version, underscore-separated. Says "Intel" even on Apple Silicon (M-series) Macs — kept for web compatibility, since real chip detection here would break sites that only ever check for "Intel".',
  },
  {
    pattern: /Android [\d.]+/,
    label: 'Android',
    explain: 'The Android OS version.',
  },
  {
    pattern: /iPhone|iPad|iPod/,
    label: 'iPhone / iPad / iPod',
    explain: 'The Apple device type.',
  },
  {
    pattern: /CPU (?:iPhone )?OS [\d_]+ like Mac OS X/,
    label: 'CPU OS ... like Mac OS X',
    explain: 'The iOS/iPadOS version, underscore-separated, phrased as "like Mac OS X" for the same historical compatibility-sniffing reasons as "KHTML, like Gecko".',
  },
  {
    pattern: /Mobile\/[\dA-Za-z]+/,
    label: 'Mobile',
    explain: 'Marks this as a mobile-optimised build, with an internal build identifier — present on essentially every phone and tablet browser regardless of vendor.',
  },
];

/**
 * Splits a User-Agent string into recognised tokens (each with a label and a plain-
 * language explanation) and the plain punctuation/whitespace between them, so a page can
 * render the raw string with each meaningful part annotated — a UA string reads like
 * nonsense until you know which bits are real and which are decades-old compatibility
 * baggage, which is exactly what a parsed summary alone doesn't show.
 */
export function explainUaTokens(ua: string): UaTokenSegment[] {
  if (ua === '') return [];

  const consumed = new Array<boolean>(ua.length).fill(false);
  const found: { start: number; end: number; label: string; explain: string }[] = [];

  for (const { pattern, label, explain } of TOKEN_EXPLANATIONS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(ua)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start) {
        re.lastIndex += 1;
        continue;
      }
      let overlaps = false;
      for (let i = start; i < end; i += 1) {
        if (consumed[i]) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        for (let i = start; i < end; i += 1) consumed[i] = true;
        found.push({ start, end, label, explain });
      }
    }
  }

  found.sort((a, b) => a.start - b.start);

  const segments: UaTokenSegment[] = [];
  let cursor = 0;
  for (const { start, end, label, explain } of found) {
    if (start > cursor) segments.push({ text: ua.slice(cursor, start), label: null, explain: null });
    segments.push({ text: ua.slice(start, end), label, explain });
    cursor = end;
  }
  if (cursor < ua.length) segments.push({ text: ua.slice(cursor), label: null, explain: null });

  return segments;
}
