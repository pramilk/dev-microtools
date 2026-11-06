import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  analyzeQrContent,
  compareToIntended,
  type Finding,
  type IntendedMatch,
  type Severity,
  type Verdict,
} from '../lib/tools/qrLinkCheck';
import { SCAN_SIZES, decodeQrFromPixels } from '../lib/tools/qrDecode';
import { readShareStateFromLocation } from '../lib/shareLink';
import { readImagePixels } from './shared/imagePixels';
import { FileDropzone } from './shared/FileDropzone';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

// Matches the worked example in qr-code-link-checker.mdx: a dynamic-QR vendor short link,
// the exact case this tool exists to expose.
const SAMPLE_CONTENT = 'https://qrco.de/bgK4mP?utm_source=poster';
const SAMPLE_INTENDED = 'https://acme-bakery.com/menu';

/**
 * Code types whose payload is a credential (Wi-Fi password, 2FA secret, payment request).
 * The share-link button is omitted for these on purpose: a shared URL would carry the secret.
 */
const SECRET_KINDS = new Set(['wifi', 'otp', 'payment']);

interface ShareState {
  content: string;
  intended: string;
}

const VERDICT_STYLE: Record<Verdict, { cls: string; icon: string }> = {
  direct: { cls: 'msg--success', icon: '✓' },
  indirect: { cls: 'msg--warning', icon: '⇄' },
  caution: { cls: 'msg--warning', icon: '!' },
  danger: { cls: 'msg--error', icon: '✕' },
  'not-link': { cls: 'msg--info', icon: 'i' },
};

const SEVERITY_LABEL: Record<Severity, string> = {
  danger: 'Danger',
  warning: 'Warning',
  info: 'Note',
  ok: 'OK',
};

const MATCH_STYLE: Record<IntendedMatch, string> = {
  exact: 'msg--success',
  'same-site': 'msg--warning',
  'via-redirect': 'msg--warning',
  different: 'msg--error',
  'invalid-intended': 'msg--error',
};

function FindingRow({ item }: { item: Finding }) {
  return (
    <li class={`qlc-finding qlc-finding--${item.severity}`}>
      <span class="qlc-finding__tag">{SEVERITY_LABEL[item.severity]}</span>
      <div>
        <p class="qlc-finding__title">{item.title}</p>
        <p class="qlc-finding__detail">{item.detail}</p>
      </div>
    </li>
  );
}

export default function QrLinkChecker() {
  const [content, setContent] = useState('');
  const [intended, setIntended] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const lastDecoded = useRef<string | null>(null);
  const scanId = useRef(0);

  // Preview of the loaded image, so the visitor can confirm the right picture was read.
  // An object URL is revoked as soon as the file changes or the tool unmounts.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Restore a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setContent(restored.value.content ?? '');
      setIntended(restored.value.intended ?? '');
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const scan = async (image: Blob, name: string): Promise<void> => {
    const id = (scanId.current += 1);
    setScanning(true);
    setScanError(null);
    let failure = 'No QR code was found in that image.';
    for (const size of SCAN_SIZES) {
      const pixels = await readImagePixels(image, size);
      if (id !== scanId.current) return;
      if (!pixels.ok) {
        failure = pixels.error;
        break;
      }
      const decoded = await decodeQrFromPixels(pixels.value);
      if (id !== scanId.current) return;
      if (decoded.ok) {
        lastDecoded.current = decoded.value;
        setContent(decoded.value);
        setScanning(false);
        return;
      }
      failure = decoded.error;
    }
    setScanning(false);
    setScanError(`${name}: ${failure}`);
  };

  const chooseFile = (next: File | null) => {
    setFile(next);
    setScanError(null);
    if (next) {
      void scan(next, next.name);
    } else {
      scanId.current += 1;
      setScanning(false);
      if (lastDecoded.current !== null && content === lastDecoded.current) setContent('');
      lastDecoded.current = null;
    }
  };

  // Pasting a screenshot (Ctrl+V) is the quickest way to check a code seen on screen.
  const onPaste = (event: ClipboardEvent) => {
    const image = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    chooseFile(image);
  };

  const analysis = useMemo(() => (content.trim() === '' ? null : analyzeQrContent(content)), [content]);
  const comparison = useMemo(
    () => (analysis ? compareToIntended(analysis, intended) : null),
    [analysis, intended]
  );

  const clearAll = () => {
    scanId.current += 1;
    setContent('');
    setIntended('');
    setFile(null);
    setScanning(false);
    setScanError(null);
    lastDecoded.current = null;
  };

  const loadExample = () => {
    scanId.current += 1;
    setFile(null);
    setScanning(false);
    setScanError(null);
    lastDecoded.current = null;
    setContent(SAMPLE_CONTENT);
    setIntended(SAMPLE_INTENDED);
  };

  const showShare = !analysis || !SECRET_KINDS.has(analysis.kind);
  const verdictStyle = analysis ? VERDICT_STYLE[analysis.verdict] : null;

  return (
    <div class="tool" onPaste={onPaste as unknown as (event: Event) => void}>
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        {showShare && <ShareLinkButton getState={() => ({ content, intended })} describe="this QR code check" />}
        <CopyButton value={content.trim()} label="Copy contents" describe="decoded QR code contents" />
        <button
          type="button"
          class="btn"
          onClick={loadExample}
          title="Fill in a sample QR code that routes through a dynamic-QR service"
        >
          Load example
        </button>
        <button
          type="button"
          class="btn"
          onClick={clearAll}
          disabled={content === '' && intended === '' && file === null}
          title="Clear the image, the decoded contents and the expected address"
        >
          Clear
        </button>
      </div>

      <FileDropzone
        file={file}
        onFileSelected={chooseFile}
        chooseLabel="Choose an image containing a QR code"
        accept="image/*"
      />
      {previewUrl && (
        <div class="qlc-preview">
          <img class="qlc-preview__img" src={previewUrl} alt={`Uploaded QR code: ${file?.name ?? 'image'}`} />
        </div>
      )}
      <p class="field__hint">
        Drop, choose or paste (Ctrl+V) a photo or screenshot of the code. The image is read in your browser and never uploaded.
      </p>
      {scanning && (
        <p class="msg msg--info" role="status">
          <span class="msg__icon" aria-hidden="true">…</span>
          <span>Reading the QR code…</span>
        </p>
      )}
      <ErrorMessage message={scanError} />

      <div class="field">
        <label class="field__label" for="qlc-content">
          <span>QR code contents</span>
        </label>
        <textarea
          id="qlc-content"
          class="textarea"
          rows={3}
          spellcheck={false}
          autocomplete="off"
          placeholder="Appears here after you scan an image — or paste a link / the text your scanner app shows."
          value={content}
          onInput={(event) => {
            setContent((event.target as HTMLTextAreaElement).value);
            lastDecoded.current = null;
          }}
        />
      </div>

      <div class="field">
        <label class="field__label" for="qlc-intended">
          <span>Address you expected (optional)</span>
        </label>
        <input
          id="qlc-intended"
          class="input"
          type="text"
          spellcheck={false}
          autocomplete="off"
          placeholder="https://acme-bakery.com/menu"
          value={intended}
          title="The website this QR code is supposed to open. The tool checks whether the code really leads there."
          onInput={(event) => setIntended((event.target as HTMLInputElement).value)}
        />
        <p class="field__hint">Enter the site the code should open and the tool will tell you whether it does.</p>
      </div>

      {analysis && verdictStyle && (
        <div class="qlc-result">
          <div class={`msg ${verdictStyle.cls} qlc-verdict`} role="status">
            <span class="msg__icon" aria-hidden="true">{verdictStyle.icon}</span>
            <div>
              <p class="qlc-verdict__headline">{analysis.headline}</p>
              {analysis.summary && <p class="qlc-verdict__summary">{analysis.summary}</p>}
            </div>
          </div>

          {comparison && (
            <p class={`msg ${MATCH_STYLE[comparison.match]}`} role="status">
              <span class="msg__icon" aria-hidden="true">{comparison.match === 'exact' ? '✓' : '!'}</span>
              <span>{comparison.message}</span>
            </p>
          )}

          <div class="qlc-card">
            <h3 class="qlc-card__title">What was checked</h3>
            <ul class="qlc-findings">
              {analysis.findings.map((item) => (
                <FindingRow key={item.id} item={item} />
              ))}
            </ul>
          </div>

          {analysis.verdict === 'indirect' && (
            <div class="qlc-card">
              <h3 class="qlc-card__title">If you own or paid for this code</h3>
              <p class="qlc-note">
                A redirecting code only works while the service behind it does. If it is about to start charging, you can
                make a <a href="/qr-code-generator/">static QR code</a> that holds your real address directly. It never
                expires and has no middleman, though you cannot track scans or change the destination without reprinting.
              </p>
            </div>
          )}

          <p class="field__hint">
            This tool reads only what is inside the code. It never contacts the address, so it cannot see redirects the
            server adds afterwards.
          </p>
        </div>
      )}

      <style>{`
        .qlc-preview {
          display: flex; justify-content: center; padding: var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius);
          background: #fff; height: 14rem;
        }
        .qlc-preview__img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .qlc-result { display: flex; flex-direction: column; gap: var(--space-3); }
        .qlc-verdict { align-items: flex-start; }
        .qlc-verdict__headline { margin: 0; font-weight: 700; font-size: var(--text-base); }
        .qlc-verdict__summary { margin: var(--space-1) 0 0; color: var(--text); }
        .qlc-card {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-3);
        }
        .qlc-card__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
        }
        .qlc-findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
        .qlc-finding { display: grid; grid-template-columns: 4.5rem 1fr; gap: var(--space-3); align-items: start; }
        .qlc-finding__tag {
          font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 700;
          text-transform: uppercase; text-align: center; padding: 2px var(--space-2);
          border-radius: var(--radius-sm, 4px); border: 1px solid var(--border);
        }
        .qlc-finding--danger .qlc-finding__tag { color: var(--danger); background: var(--danger-subtle); border-color: var(--danger-border); }
        .qlc-finding--warning .qlc-finding__tag { color: var(--warning); background: var(--warning-subtle); border-color: var(--warning-border); }
        .qlc-finding--ok .qlc-finding__tag { color: var(--success); background: var(--success-subtle); border-color: var(--success-border); }
        .qlc-finding--info .qlc-finding__tag { color: var(--text-muted); background: var(--surface); }
        .qlc-finding__title { margin: 0; font-weight: 600; color: var(--text); font-size: var(--text-sm); }
        .qlc-finding__detail { margin: var(--space-1) 0 0; color: var(--text-muted); font-size: var(--text-sm); }
        .qlc-note { margin: 0; color: var(--text-muted); font-size: var(--text-sm); }
        @media (max-width: 36rem) {
          .qlc-finding { grid-template-columns: 1fr; gap: var(--space-1); }
          .qlc-finding__tag { justify-self: start; }
        }
      `}</style>
    </div>
  );
}
