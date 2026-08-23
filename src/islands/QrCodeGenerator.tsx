import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  generateQrMatrix,
  matrixToSvg,
  buildWifiText,
  buildVCardText,
  buildSmsText,
  buildEmailText,
  buildGeoText,
  isValidGeoCoordinate,
  parseGeoLocationInput,
  QR_ERROR_CORRECTION_LEVELS,
  QR_CONTENT_TYPES,
  WIFI_ENCRYPTION_TYPES,
  MAX_QR_TEXT_LENGTH,
  type QrMatrix,
  type QrErrorCorrectionLevel,
  type QrContentType,
  type WifiEncryptionType,
} from '../lib/tools/qrcode';
import { encodeFileToBase64 } from '../lib/tools/base64';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { FileDropzone } from './shared/FileDropzone';
import { formatBytes } from './shared/formatBytes';

const LEVEL_HINTS: Record<QrErrorCorrectionLevel, string> = {
  L: 'Low — ~7% of the code can be damaged and still scan. Smallest code.',
  M: 'Medium — ~15% damage tolerance. A good default.',
  Q: 'Quartile — ~25% damage tolerance.',
  H: 'High — ~30% damage tolerance. Best if you plan to add a logo on top.',
};

const CONTENT_TYPE_LABELS: Record<QrContentType, string> = {
  text: 'Text / URL',
  wifi: 'Wi-Fi network',
  vcard: 'Contact card',
  sms: 'Text message',
  email: 'Email',
  geo: 'Location',
};

// Short enough to sit side-by-side in a single connected segmented control.
const TYPE_PICKER_LABELS: Record<QrContentType, string> = {
  text: 'Text/URL',
  wifi: 'Wi-Fi',
  vcard: 'Contact',
  sms: 'SMS',
  email: 'Email',
  geo: 'Location',
};

const EMPTY_MESSAGES: Record<QrContentType, string> = {
  text: 'Enter some text or a URL to generate a QR code.',
  wifi: 'Enter a network name (SSID) to generate a Wi-Fi QR code.',
  vcard: 'Enter at least a name to generate a contact QR code.',
  sms: 'Enter a phone number to generate a text-message QR code.',
  email: 'Enter a recipient email address to generate an email QR code.',
  geo: 'Enter a valid latitude and longitude to generate a location QR code.',
};

const DOWNLOAD_SIZES = [256, 512, 1024] as const;
const MAX_LOGO_BYTES = 1_000_000;
const LOGO_SIZE_RATIO = 0.22;
const DEFAULT_DARK = '#000000';
const DEFAULT_LIGHT = '#ffffff';

// Simple, self-drawn glyphs — one per content type, reused both as the content-type
// picker's icons and as ready-made "logo" presets, so there's no dependency on any
// third-party icon set or brand mark (see the Facebook/X logo discussion this project
// deliberately avoided: real trademarks carry brand-guideline risk on a monetized site).
// Each is plain path/shape markup (no wrapping <svg>) so it can be dropped into either a
// live JSX icon (colored via CSS `currentColor`) or a standalone data-URL SVG for the
// QR overlay (colored via an inline `style="color:…"` on the root, which `currentColor`
// resolves against too).
const TYPE_ICON_PATHS: Record<QrContentType, string> = {
  text: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3.2 3 3.2 15 0 18"/><path d="M12 3c-3.2 3-3.2 15 0 18"/>',
  wifi: '<path d="M4 9a12 12 0 0 1 16 0"/><path d="M7 12.5a7.5 7.5 0 0 1 10 0"/><path d="M10 16a3 3 0 0 1 4 0"/><circle cx="12" cy="19.2" r="1.2" fill="currentColor" stroke="none"/>',
  vcard: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/>',
  sms: '<rect x="3" y="5" width="18" height="12" rx="3"/><path d="M8 17l-1.6 3v-3"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  geo: '<path d="M12 21s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/>',
};

function TypeIcon({ type }: { type: QrContentType }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: TYPE_ICON_PATHS[type] }}
    />
  );
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Renders a content-type icon as a standalone SVG data URL, for use as a logo preset. */
function typeIconDataUrl(type: QrContentType, color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:${color}">` +
    `${TYPE_ICON_PATHS[type]}</svg>`;
  return svgToDataUrl(svg);
}

/** Rasterises the SVG markup to a PNG blob via an off-screen canvas. */
async function rasterizeToPng(svgMarkup: string, size: number): Promise<Blob> {
  const svgUrl = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not render the QR code as an image.'));
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser does not support canvas image export.');
    context.drawImage(image, 0, 0, size, size);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not export a PNG from this QR code.');
    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

const supportsImageClipboard = (): boolean =>
  typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write;

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadSvg(svgMarkup: string, filename: string): void {
  saveBlob(new Blob([svgMarkup], { type: 'image/svg+xml' }), filename);
}

interface ShareState {
  contentType: QrContentType;
  level: QrErrorCorrectionLevel;
  darkColor: string;
  lightColor: string;
  text: string;
  wifiSsid: string;
  wifiEncryption: WifiEncryptionType;
  wifiHidden: boolean;
  // wifiPassword is deliberately omitted — it's a credential, and this project never puts
  // a secret in a shareable URL (same reasoning as the HMAC key field on Hash Generator).
  vcardName: string;
  vcardOrg: string;
  vcardJobTitle: string;
  vcardPhone: string;
  vcardEmail: string;
  vcardWebsite: string;
  vcardAddress: string;
  smsPhone: string;
  smsMessage: string;
  emailTo: string;
  emailSubject: string;
  emailBody: string;
  geoLat: string;
  geoLng: string;
  logoPresetType: QrContentType | null;
  // An *uploaded* logo image is deliberately excluded — a data URL is far too large for a
  // shareable link, and there's no sensible "restore" for someone else's uploaded image
  // anyway. A preset icon is just its content-type id, so it's cheap to include.
}

export default function QrCodeGenerator() {
  const [contentType, setContentType] = useState<QrContentType>('text');

  const [text, setText] = useState('https://devmicrotools.com');

  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiEncryption, setWifiEncryption] = useState<WifiEncryptionType>('WPA');
  const [wifiHidden, setWifiHidden] = useState(false);

  const [vcardName, setVcardName] = useState('');
  const [vcardOrg, setVcardOrg] = useState('');
  const [vcardJobTitle, setVcardJobTitle] = useState('');
  const [vcardPhone, setVcardPhone] = useState('');
  const [vcardEmail, setVcardEmail] = useState('');
  const [vcardWebsite, setVcardWebsite] = useState('');
  const [vcardAddress, setVcardAddress] = useState('');

  const [smsPhone, setSmsPhone] = useState('');
  const [smsMessage, setSmsMessage] = useState('');

  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  const [geoLat, setGeoLat] = useState('');
  const [geoLng, setGeoLng] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoLocateError, setGeoLocateError] = useState<string | null>(null);
  const [geoLinkInput, setGeoLinkInput] = useState('');
  const [geoLinkError, setGeoLinkError] = useState<string | null>(null);

  const [level, setLevel] = useState<QrErrorCorrectionLevel>('M');
  const [darkColor, setDarkColor] = useState(DEFAULT_DARK);
  const [lightColor, setLightColor] = useState(DEFAULT_LIGHT);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploadedLogoDataUrl, setUploadedLogoDataUrl] = useState<string | null>(null);
  const [logoPresetType, setLogoPresetType] = useState<QrContentType | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [matrix, setMatrix] = useState<QrMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadSize, setDownloadSize] = useState<(typeof DOWNLOAD_SIZES)[number]>(512);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore state from a shared link, if the page was opened with one. Reads a Partial
  // so an older link (saved before a field existed) still restores what it has.
  useEffect(() => {
    void readShareStateFromLocation<Partial<ShareState>>().then((restored) => {
      if (!restored?.ok) return;
      const v = restored.value;
      setContentType(v.contentType ?? 'text');
      setLevel(v.level ?? 'M');
      setDarkColor(v.darkColor ?? DEFAULT_DARK);
      setLightColor(v.lightColor ?? DEFAULT_LIGHT);
      setText(v.text ?? '');
      setWifiSsid(v.wifiSsid ?? '');
      setWifiEncryption(v.wifiEncryption ?? 'WPA');
      setWifiHidden(v.wifiHidden ?? false);
      setVcardName(v.vcardName ?? '');
      setVcardOrg(v.vcardOrg ?? '');
      setVcardJobTitle(v.vcardJobTitle ?? '');
      setVcardPhone(v.vcardPhone ?? '');
      setVcardEmail(v.vcardEmail ?? '');
      setVcardWebsite(v.vcardWebsite ?? '');
      setVcardAddress(v.vcardAddress ?? '');
      setSmsPhone(v.smsPhone ?? '');
      setSmsMessage(v.smsMessage ?? '');
      setEmailTo(v.emailTo ?? '');
      setEmailSubject(v.emailSubject ?? '');
      setEmailBody(v.emailBody ?? '');
      setGeoLat(v.geoLat ?? '');
      setGeoLng(v.geoLng ?? '');
      setLogoPresetType(v.logoPresetType ?? null);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  // Turns the active content type's fields into the payload text, but only once the
  // field(s) that make it meaningful are filled in — otherwise it stays empty, so the
  // tool shows the same "enter something" state as a freshly opened page.
  const payload = useMemo(() => {
    switch (contentType) {
      case 'text':
        return text;
      case 'wifi':
        return wifiSsid.trim() === ''
          ? ''
          : buildWifiText({ ssid: wifiSsid, password: wifiPassword, encryption: wifiEncryption, hidden: wifiHidden });
      case 'vcard':
        return [vcardName, vcardOrg, vcardJobTitle, vcardPhone, vcardEmail, vcardWebsite, vcardAddress].every(
          (v) => v.trim() === ''
        )
          ? ''
          : buildVCardText({
              name: vcardName,
              organization: vcardOrg,
              jobTitle: vcardJobTitle,
              phone: vcardPhone,
              email: vcardEmail,
              website: vcardWebsite,
              address: vcardAddress,
            });
      case 'sms':
        return smsPhone.trim() === '' ? '' : buildSmsText({ phone: smsPhone, message: smsMessage });
      case 'email':
        return emailTo.trim() === '' ? '' : buildEmailText({ to: emailTo, subject: emailSubject, body: emailBody });
      case 'geo':
        return isValidGeoCoordinate(geoLat, geoLng) ? buildGeoText({ latitude: geoLat, longitude: geoLng }) : '';
    }
  }, [
    contentType,
    text,
    wifiSsid,
    wifiPassword,
    wifiEncryption,
    wifiHidden,
    vcardName,
    vcardOrg,
    vcardJobTitle,
    vcardPhone,
    vcardEmail,
    vcardWebsite,
    vcardAddress,
    smsPhone,
    smsMessage,
    emailTo,
    emailSubject,
    emailBody,
    geoLat,
    geoLng,
  ]);

  useEffect(() => {
    const id = (requestId.current += 1);
    setBusy(true);
    void generateQrMatrix(payload, level, { emptyMessage: EMPTY_MESSAGES[contentType] }).then((result) => {
      // Ignore a stale response if the input changed again before this one resolved.
      if (id !== requestId.current) return;
      setBusy(false);
      if (result.ok) {
        setMatrix(result.value);
        setError(null);
      } else {
        setMatrix(null);
        setError(result.error);
      }
    });
  }, [payload, level, contentType]);

  useEffect(() => {
    if (!logoFile) {
      setUploadedLogoDataUrl(null);
      return;
    }
    if (logoFile.size > MAX_LOGO_BYTES) {
      setLogoError(`That image is too large for a logo (max ${formatBytes(MAX_LOGO_BYTES)}).`);
      setLogoFile(null);
      return;
    }
    setLogoError(null);
    let cancelled = false;
    void encodeFileToBase64(logoFile).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setUploadedLogoDataUrl(result.value.dataUrl);
      } else {
        setLogoError(result.error);
        setLogoFile(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [logoFile]);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
    },
    []
  );

  // A chosen preset icon takes priority over an uploaded file — selecting one clears the
  // other (see the `onClick`/`onFileSelected` handlers below), so at most one is ever
  // actually set, but deriving this rather than storing it directly sidesteps any race
  // between the synchronous preset path and the async file-reading effect above.
  const logoDataUrl = logoPresetType ? typeIconDataUrl(logoPresetType, darkColor) : uploadedLogoDataUrl;

  // A logo needs the extra redundancy of error correction level H to stay scannable —
  // lock the level to H automatically whenever a logo is set, rather than letting the
  // tool silently produce a code that a logo would break.
  useEffect(() => {
    if (logoDataUrl && level !== 'H') setLevel('H');
  }, [logoDataUrl, level]);

  const logoOption = useMemo(
    () => (logoDataUrl ? { dataUrl: logoDataUrl, sizeRatio: LOGO_SIZE_RATIO } : undefined),
    [logoDataUrl]
  );
  const previewSvg = useMemo(
    () => (matrix ? matrixToSvg(matrix, { cellSize: 8, darkColor, lightColor, logo: logoOption }) : ''),
    [matrix, darkColor, lightColor, logoOption]
  );
  const customized = darkColor !== DEFAULT_DARK || lightColor !== DEFAULT_LIGHT || logoDataUrl !== null;

  const handleDownloadPng = async () => {
    if (!matrix) return;
    setExportError(null);
    const cellSize = Math.max(1, Math.round(downloadSize / matrix.moduleCount));
    const svg = matrixToSvg(matrix, { cellSize, darkColor, lightColor, logo: logoOption });
    try {
      const blob = await rasterizeToPng(svg, cellSize * matrix.moduleCount);
      saveBlob(blob, 'qr-code.png');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export a PNG from this QR code.');
    }
  };

  const handleDownloadSvg = () => {
    if (!matrix) return;
    setExportError(null);
    downloadSvg(matrixToSvg(matrix, { cellSize: 10, darkColor, lightColor, logo: logoOption }), 'qr-code.svg');
  };

  const handleCopyImage = async () => {
    if (!matrix) return;
    setExportError(null);
    if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);

    try {
      const svg = matrixToSvg(matrix, { cellSize: 10, darkColor, lightColor, logo: logoOption });
      const blob = await rasterizeToPng(svg, 10 * matrix.moduleCount);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    copyResetTimer.current = setTimeout(() => setCopyState('idle'), 1600);
  };

  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoLocateError('This browser does not support geolocation.');
      return;
    }
    setGeoBusy(true);
    setGeoLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoBusy(false);
        setGeoLat(position.coords.latitude.toFixed(6));
        setGeoLng(position.coords.longitude.toFixed(6));
      },
      (geoError) => {
        setGeoBusy(false);
        setGeoLocateError(geoError.message || 'Could not get your location.');
      },
      { timeout: 10_000 }
    );
  };

  // Parses on every keystroke and applies immediately once a coordinate pair is found —
  // no separate "apply" action needed. A failed parse doesn't clear whatever coordinates
  // are already set (the input might just be mid-paste), and doesn't show an error until
  // the field is blurred, so it's silent while still-incomplete text is being typed in.
  const handleGeoLinkInput = (value: string) => {
    setGeoLinkInput(value);
    const parsed = parseGeoLocationInput(value);
    if (parsed) {
      setGeoLinkError(null);
      setGeoLat(parsed.latitude);
      setGeoLng(parsed.longitude);
    }
  };

  const handleGeoLinkBlur = () => {
    if (geoLinkInput.trim() === '' || parseGeoLocationInput(geoLinkInput)) {
      setGeoLinkError(null);
      return;
    }
    setGeoLinkError(
      "Couldn't find coordinates in that. Paste a full Google Maps URL (after centering on the place), or coordinates directly like 40.6892, -74.0445."
    );
  };

  const hasCurrentInput = (): boolean => {
    switch (contentType) {
      case 'text':
        return text !== '';
      case 'wifi':
        return wifiSsid !== '' || wifiPassword !== '';
      case 'vcard':
        return [vcardName, vcardOrg, vcardJobTitle, vcardPhone, vcardEmail, vcardWebsite, vcardAddress].some(
          (v) => v !== ''
        );
      case 'sms':
        return smsPhone !== '' || smsMessage !== '';
      case 'email':
        return emailTo !== '' || emailSubject !== '' || emailBody !== '';
      case 'geo':
        return geoLat !== '' || geoLng !== '' || geoLinkInput !== '';
    }
  };

  const clearCurrent = () => {
    switch (contentType) {
      case 'text':
        setText('');
        break;
      case 'wifi':
        setWifiSsid('');
        setWifiPassword('');
        setWifiEncryption('WPA');
        setWifiHidden(false);
        break;
      case 'vcard':
        setVcardName('');
        setVcardOrg('');
        setVcardJobTitle('');
        setVcardPhone('');
        setVcardEmail('');
        setVcardWebsite('');
        setVcardAddress('');
        break;
      case 'sms':
        setSmsPhone('');
        setSmsMessage('');
        break;
      case 'email':
        setEmailTo('');
        setEmailSubject('');
        setEmailBody('');
        break;
      case 'geo':
        setGeoLat('');
        setGeoLng('');
        setGeoLocateError(null);
        setGeoLinkInput('');
        setGeoLinkError(null);
        break;
    }
  };

  const loadExample = () => {
    switch (contentType) {
      case 'text':
        setText('https://devmicrotools.com');
        break;
      case 'wifi':
        setWifiSsid('CoffeeShop-Guest');
        setWifiPassword('brew-1234');
        setWifiEncryption('WPA');
        setWifiHidden(false);
        break;
      case 'vcard':
        setVcardName('Jordan Lee');
        setVcardOrg('Acme Corp');
        setVcardJobTitle('Product Designer');
        setVcardPhone('+1 555 0100');
        setVcardEmail('jordan@example.com');
        setVcardWebsite('https://example.com');
        setVcardAddress('123 Main St, Springfield');
        break;
      case 'sms':
        setSmsPhone('+15550100');
        setSmsMessage('Running 10 minutes late!');
        break;
      case 'email':
        setEmailTo('hello@example.com');
        setEmailSubject('Quick question');
        setEmailBody('Hi there, ...');
        break;
      case 'geo':
        setGeoLat('40.689200');
        setGeoLng('-74.044500');
        break;
    }
  };

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="type-seg-scroll type-picker--wide">
          <div class="seg" role="group" aria-label="QR code content type">
            {QR_CONTENT_TYPES.map((value) => (
              <button
                key={value}
                type="button"
                class="seg__btn"
                aria-pressed={contentType === value}
                onClick={() => setContentType(value)}
                title={`Encode a ${CONTENT_TYPE_LABELS[value].toLowerCase()}`}
              >
                <TypeIcon type={value} />
                <span>{TYPE_PICKER_LABELS[value]}</span>
              </button>
            ))}
          </div>
        </div>
        <select
          class="select type-picker--narrow"
          value={contentType}
          aria-label="QR code content type"
          onChange={(event) => setContentType((event.target as HTMLSelectElement).value as QrContentType)}
        >
          {QR_CONTENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {CONTENT_TYPE_LABELS[value]}
            </option>
          ))}
        </select>
        <span class="tool-bar__spacer" />
        <ShareLinkButton
          getState={() => ({
            contentType,
            level,
            darkColor,
            lightColor,
            text,
            wifiSsid,
            wifiEncryption,
            wifiHidden,
            vcardName,
            vcardOrg,
            vcardJobTitle,
            vcardPhone,
            vcardEmail,
            vcardWebsite,
            vcardAddress,
            smsPhone,
            smsMessage,
            emailTo,
            emailSubject,
            emailBody,
            geoLat,
            geoLng,
            logoPresetType,
          })}
          describe="this QR code"
        />
        <button type="button" class="btn" onClick={loadExample} title="Fill in a sample so you can see the tool work">
          Load example
        </button>
      </div>

      {contentType === 'text' && (
        <div class="field">
          <label class="field__label" for="qr-text">
            <span>Text or URL</span>
            <span class="field__hint tnum">
              {text.length}/{MAX_QR_TEXT_LENGTH}
            </span>
          </label>
          <textarea
            id="qr-text"
            class="textarea textarea--short"
            spellcheck={false}
            placeholder="https://example.com, or any text"
            value={text}
            aria-invalid={error !== null}
            onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
          />
        </div>
      )}

      {contentType === 'wifi' && (
        <>
          <div class="field-row">
            <div class="field" style="flex:2 1 14rem">
              <label class="field__label" for="qr-wifi-ssid">
                <span>Network name (SSID)</span>
              </label>
              <input
                id="qr-wifi-ssid"
                class="input"
                spellcheck={false}
                autocomplete="off"
                placeholder="MyHomeNetwork"
                value={wifiSsid}
                aria-invalid={error !== null}
                onInput={(event) => setWifiSsid((event.target as HTMLInputElement).value)}
              />
            </div>
            <div class="field" style="flex:1 1 10rem">
              <label class="field__label" for="qr-wifi-security">
                <span>Security</span>
              </label>
              <select
                id="qr-wifi-security"
                class="select"
                value={wifiEncryption}
                onChange={(event) => setWifiEncryption((event.target as HTMLSelectElement).value as WifiEncryptionType)}
              >
                {WIFI_ENCRYPTION_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value === 'nopass' ? 'None (open)' : value === 'WPA' ? 'WPA/WPA2' : 'WEP'}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {wifiEncryption !== 'nopass' && (
            <div class="field">
              <label class="field__label" for="qr-wifi-password">
                <span>Password</span>
              </label>
              <input
                id="qr-wifi-password"
                class="input"
                spellcheck={false}
                autocomplete="off"
                placeholder="Wi-Fi password"
                value={wifiPassword}
                onInput={(event) => setWifiPassword((event.target as HTMLInputElement).value)}
              />
              <span class="field__hint">Not included if you copy a share link — only the QR code carries it.</span>
            </div>
          )}
          <label class="checkbox" title="Tell scanners this network doesn't broadcast its name">
            <input
              type="checkbox"
              checked={wifiHidden}
              onChange={(event) => setWifiHidden((event.target as HTMLInputElement).checked)}
            />
            Hidden network
          </label>
        </>
      )}

      {contentType === 'vcard' && (
        <>
          <div class="field-row">
            <div class="field" style="flex:1 1 14rem">
              <label class="field__label" for="qr-vcard-name">
                <span>Full name</span>
              </label>
              <input
                id="qr-vcard-name"
                class="input"
                autocomplete="off"
                placeholder="Jordan Lee"
                value={vcardName}
                aria-invalid={error !== null}
                onInput={(event) => setVcardName((event.target as HTMLInputElement).value)}
              />
            </div>
            <div class="field" style="flex:1 1 14rem">
              <label class="field__label" for="qr-vcard-org">
                <span>Organization</span>
              </label>
              <input
                id="qr-vcard-org"
                class="input"
                autocomplete="off"
                placeholder="Acme Corp"
                value={vcardOrg}
                onInput={(event) => setVcardOrg((event.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div class="field-row">
            <div class="field" style="flex:1 1 14rem">
              <label class="field__label" for="qr-vcard-title">
                <span>Job title</span>
              </label>
              <input
                id="qr-vcard-title"
                class="input"
                autocomplete="off"
                placeholder="Product Designer"
                value={vcardJobTitle}
                onInput={(event) => setVcardJobTitle((event.target as HTMLInputElement).value)}
              />
            </div>
            <div class="field" style="flex:1 1 14rem">
              <label class="field__label" for="qr-vcard-phone">
                <span>Phone</span>
              </label>
              <input
                id="qr-vcard-phone"
                class="input"
                type="tel"
                autocomplete="off"
                placeholder="+1 555 0100"
                value={vcardPhone}
                onInput={(event) => setVcardPhone((event.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div class="field-row">
            <div class="field" style="flex:1 1 14rem">
              <label class="field__label" for="qr-vcard-email">
                <span>Email</span>
              </label>
              <input
                id="qr-vcard-email"
                class="input"
                type="email"
                autocomplete="off"
                placeholder="jordan@example.com"
                value={vcardEmail}
                onInput={(event) => setVcardEmail((event.target as HTMLInputElement).value)}
              />
            </div>
            <div class="field" style="flex:1 1 14rem">
              <label class="field__label" for="qr-vcard-website">
                <span>Website</span>
              </label>
              <input
                id="qr-vcard-website"
                class="input"
                type="url"
                autocomplete="off"
                placeholder="https://example.com"
                value={vcardWebsite}
                onInput={(event) => setVcardWebsite((event.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="qr-vcard-address">
              <span>Address</span>
            </label>
            <input
              id="qr-vcard-address"
              class="input"
              autocomplete="off"
              placeholder="123 Main St, Springfield"
              value={vcardAddress}
              onInput={(event) => setVcardAddress((event.target as HTMLInputElement).value)}
            />
          </div>
        </>
      )}

      {contentType === 'sms' && (
        <>
          <div class="field">
            <label class="field__label" for="qr-sms-phone">
              <span>Phone number</span>
            </label>
            <input
              id="qr-sms-phone"
              class="input"
              type="tel"
              autocomplete="off"
              placeholder="+15550100"
              value={smsPhone}
              aria-invalid={error !== null}
              onInput={(event) => setSmsPhone((event.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label class="field__label" for="qr-sms-message">
              <span>Message</span>
            </label>
            <textarea
              id="qr-sms-message"
              class="textarea textarea--short"
              placeholder="Running 10 minutes late!"
              value={smsMessage}
              onInput={(event) => setSmsMessage((event.target as HTMLTextAreaElement).value)}
            />
          </div>
        </>
      )}

      {contentType === 'email' && (
        <>
          <div class="field">
            <label class="field__label" for="qr-email-to">
              <span>Recipient email</span>
            </label>
            <input
              id="qr-email-to"
              class="input"
              type="email"
              autocomplete="off"
              placeholder="hello@example.com"
              value={emailTo}
              aria-invalid={error !== null}
              onInput={(event) => setEmailTo((event.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label class="field__label" for="qr-email-subject">
              <span>Subject</span>
            </label>
            <input
              id="qr-email-subject"
              class="input"
              autocomplete="off"
              placeholder="Quick question"
              value={emailSubject}
              onInput={(event) => setEmailSubject((event.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label class="field__label" for="qr-email-body">
              <span>Body</span>
            </label>
            <textarea
              id="qr-email-body"
              class="textarea textarea--short"
              placeholder="Hi there, ..."
              value={emailBody}
              onInput={(event) => setEmailBody((event.target as HTMLTextAreaElement).value)}
            />
          </div>
        </>
      )}

      {contentType === 'geo' && (
        <>
          <div class="field">
            <label class="field__label" for="qr-geo-link">
              <span>Google Maps link (or "lat, lng")</span>
            </label>
            <div class="field-row">
              <input
                id="qr-geo-link"
                class="input"
                style="flex:1 1 14rem"
                autocomplete="off"
                placeholder="Paste a Google Maps link, or 40.6892, -74.0445"
                value={geoLinkInput}
                onInput={(event) => handleGeoLinkInput((event.target as HTMLInputElement).value)}
                onBlur={handleGeoLinkBlur}
              />
              <button
                type="button"
                class="btn"
                onClick={useMyLocation}
                disabled={geoBusy}
                title="Fill in your current coordinates using your browser's location"
              >
                <span aria-hidden="true">📍</span> {geoBusy ? 'Locating…' : 'Use my location'}
              </button>
            </div>
            <span class="field__hint">
              Easier than typing coordinates by hand: open the place in Google Maps, copy the page URL, and paste it
              here — the coordinates fill in automatically. (Shortened maps.app.goo.gl links don't carry coordinates
              in the URL text — use the full address-bar link instead.)
            </span>
            <ErrorMessage message={geoLinkError} />
            <ErrorMessage message={geoLocateError} />
          </div>

          <details class="customize">
            <summary>Enter coordinates manually</summary>
            <div class="customize__body">
              <div class="field-row">
                <div class="field" style="flex:1 1 10rem">
                  <label class="field__label" for="qr-geo-lat">
                    <span>Latitude</span>
                  </label>
                  <input
                    id="qr-geo-lat"
                    class="input"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="40.6892"
                    value={geoLat}
                    aria-invalid={error !== null}
                    onInput={(event) => setGeoLat((event.target as HTMLInputElement).value)}
                  />
                </div>
                <div class="field" style="flex:1 1 10rem">
                  <label class="field__label" for="qr-geo-lng">
                    <span>Longitude</span>
                  </label>
                  <input
                    id="qr-geo-lng"
                    class="input"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="-74.0445"
                    value={geoLng}
                    aria-invalid={error !== null}
                    onInput={(event) => setGeoLng((event.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
            </div>
          </details>
        </>
      )}

      <div class="tool-bar">
        <label class="checkbox" title="How much of the code can be damaged or obscured and still scan">
          <span class="field__hint">Error correction</span>
          <select
            class="select"
            style="width:auto"
            value={level}
            aria-label="Error correction level"
            disabled={logoDataUrl !== null}
            onChange={(event) => setLevel((event.target as HTMLSelectElement).value as QrErrorCorrectionLevel)}
            title={logoDataUrl !== null ? 'Locked to High while a logo is set — logos need the extra redundancy to stay scannable.' : LEVEL_HINTS[level]}
          >
            {QR_ERROR_CORRECTION_LEVELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={clearCurrent} disabled={!hasCurrentInput()} title="Clear this content's fields">
          Clear
        </button>
      </div>

      <details class="customize" open={customized}>
        <summary>Customize appearance (colors &amp; logo)</summary>
        <div class="customize__body">
          <div class="field-row">
            <label class="field__label swatch-field">
              <span>Foreground</span>
              <span class="swatch-field__control">
                <input
                  type="color"
                  class="color-picker"
                  value={darkColor}
                  aria-label="QR code foreground colour"
                  onInput={(event) => setDarkColor((event.target as HTMLInputElement).value)}
                />
                <span class="field__hint tnum">{darkColor}</span>
              </span>
            </label>
            <label class="field__label swatch-field">
              <span>Background</span>
              <span class="swatch-field__control">
                <input
                  type="color"
                  class="color-picker"
                  value={lightColor}
                  aria-label="QR code background colour"
                  onInput={(event) => setLightColor((event.target as HTMLInputElement).value)}
                />
                <span class="field__hint tnum">{lightColor}</span>
              </span>
            </label>
            {(darkColor !== DEFAULT_DARK || lightColor !== DEFAULT_LIGHT) && (
              <button
                type="button"
                class="btn"
                onClick={() => {
                  setDarkColor(DEFAULT_DARK);
                  setLightColor(DEFAULT_LIGHT);
                }}
                title="Reset colours to black on white"
              >
                Reset colours
              </button>
            )}
          </div>

          <div class="field">
            <label class="field__label">
              <span>Logo (optional)</span>
            </label>
            <div class="logo-presets" role="group" aria-label="Preset logo icons">
              {QR_CONTENT_TYPES.map((value) => (
                <button
                  key={value}
                  type="button"
                  class="logo-preset"
                  aria-pressed={logoPresetType === value}
                  title={`Use the ${CONTENT_TYPE_LABELS[value]} icon as the logo`}
                  onClick={() => {
                    setLogoFile(null);
                    setLogoPresetType((current) => (current === value ? null : value));
                  }}
                >
                  <TypeIcon type={value} />
                </button>
              ))}
            </div>
            <span class="field__hint">Pick an icon above, or upload your own image below.</span>
            <FileDropzone
              file={logoFile}
              onFileSelected={(file) => {
                setLogoPresetType(null);
                setLogoFile(file);
              }}
              chooseLabel="Choose a logo image"
              accept="image/*"
            />
            <span class="field__hint">Overlaid on the center of the code. Forces error correction to High.</span>
            <ErrorMessage message={logoError} />
          </div>
        </div>
      </details>

      <ErrorMessage message={error} />

      <div class="qr-preview" style={`background:${lightColor}`} aria-live="polite">
        {matrix ? (
          <div class="qr-preview__image" dangerouslySetInnerHTML={{ __html: previewSvg }} />
        ) : (
          !error && <p class="field__hint">{busy ? 'Generating…' : `Fill in the fields above to generate a ${CONTENT_TYPE_LABELS[contentType].toLowerCase()} QR code.`}</p>
        )}
      </div>

      {matrix && (
        <div class="tool-bar">
          <label class="checkbox">
            <span class="field__hint">Download size</span>
            <select
              class="select"
              style="width:auto"
              value={downloadSize}
              aria-label="PNG download size in pixels"
              onChange={(event) => setDownloadSize(Number((event.target as HTMLSelectElement).value) as (typeof DOWNLOAD_SIZES)[number])}
            >
              {DOWNLOAD_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}×{size}
                </option>
              ))}
            </select>
          </label>
          <button type="button" class="btn btn--primary" onClick={() => void handleDownloadPng()} title="Save as a PNG image">
            <span aria-hidden="true">⭳</span> Download PNG
          </button>
          <button type="button" class="btn" onClick={handleDownloadSvg} title="Save as a scalable SVG image">
            <span aria-hidden="true">⭳</span> Download SVG
          </button>
          {supportsImageClipboard() && (
            <button
              type="button"
              class={`btn${copyState === 'copied' ? ' btn--copied' : ''}`}
              onClick={() => void handleCopyImage()}
              title="Copy the QR code image to your clipboard"
            >
              <span aria-hidden="true">{copyState === 'copied' ? '✓' : '⧉'}</span>{' '}
              {copyState === 'idle' ? 'Copy image' : copyState === 'copied' ? 'Copied' : 'Copy failed'}
            </button>
          )}
        </div>
      )}

      <ErrorMessage message={exportError} />

      <style>{`
        .field-row { display: flex; gap: var(--space-3); flex-wrap: wrap; }
        .qr-preview {
          border: 1px solid var(--border); border-radius: var(--radius-lg);
          min-height: 12rem;
          display: flex; align-items: center; justify-content: center; padding: var(--space-4);
        }
        .qr-preview__image {
          width: 100%; max-width: 14rem; aspect-ratio: 1 / 1;
          background: transparent; border-radius: var(--radius-sm); padding: var(--space-2);
        }
        .qr-preview__image svg { width: 100%; height: 100%; display: block; }
        .customize {
          border: 1px solid var(--border); border-radius: var(--radius-lg);
          background: var(--surface); padding: var(--space-3) var(--space-4);
        }
        .customize summary {
          cursor: pointer; font-size: var(--text-sm); font-weight: 600; color: var(--text);
          list-style: none;
        }
        .customize summary::-webkit-details-marker { display: none; }
        .customize summary::before { content: '▸ '; color: var(--text-subtle); }
        .customize[open] summary::before { content: '▾ '; }
        .customize__body { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-3); }
        .swatch-field { flex: 0 0 auto; }
        .swatch-field__control { display: flex; align-items: center; gap: var(--space-2); }
        .color-picker {
          width: 2.4rem; height: 2.25rem; padding: 2px; cursor: pointer;
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); flex-shrink: 0;
        }
        .type-seg-scroll { overflow-x: auto; flex: 1 1 auto; min-width: 0; }
        .type-seg-scroll .seg__btn {
          display: inline-flex; align-items: center; gap: var(--space-2);
          white-space: nowrap; flex-shrink: 0;
        }
        .type-seg-scroll .seg__btn svg { width: 1rem; height: 1rem; flex-shrink: 0; }
        /* Six connected pills don't fit a phone width without scrolling, and a
           horizontal-scroll control is easy to miss — below the tablet breakpoint this
           swaps to a plain <select> instead of scrolling the pill row. */
        .type-picker--narrow { display: none; }
        @media (max-width: 48rem) {
          .type-picker--wide { display: none; }
          .type-picker--narrow { display: block; width: 100%; }
        }
        .logo-presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .logo-preset {
          width: 2.25rem; height: 2.25rem; padding: 0.35rem;
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); color: var(--text-muted); cursor: pointer; flex-shrink: 0;
        }
        .logo-preset svg { width: 100%; height: 100%; display: block; }
        .logo-preset:hover { background: var(--surface-2); color: var(--text); }
        .logo-preset[aria-pressed='true'] {
          border-color: var(--accent); background: var(--accent-subtle); color: var(--accent);
        }
      `}</style>
    </div>
  );
}
