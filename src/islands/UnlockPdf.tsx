import { useEffect, useRef, useState } from 'preact/hooks';
import { OPENED_WITH_LABELS, unlockedFileName, validatePdfFile, type PdfUnlockReport, type PdfUnlockSourceInfo } from '../lib/tools/pdfUnlock';
import { formatBytes } from './shared/formatBytes';
import { ErrorMessage } from './shared/ErrorMessage';
import { FileDropzone } from './shared/FileDropzone';
import { PdfPreview } from './shared/PdfPreview';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import UnlockPdfWorker from '../workers/pdfUnlock.worker?worker';
import type { PdfUnlockWorkerRequest, PdfUnlockWorkerResult } from '../workers/pdfUnlock.worker';

// Deliberately no ShareLinkButton — the input is a binary PDF from the visitor's own disk, and
// the other input is a password, which must never travel in a URL. A link carrying neither
// would share nothing.

/** The password of the "Load example" sample, shown in the field so the visitor can see it. */
const EXAMPLE_PASSWORD = 'Sample-Pass-42';

interface Unlocked {
  url: string;
  name: string;
  report: PdfUnlockReport;
}

type Status = 'idle' | 'inspecting' | 'ready' | 'unlocking' | 'done' | 'error';

export default function UnlockPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<PdfUnlockSourceInfo | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Unlocked | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);

  const worker = useWorkerTask<PdfUnlockWorkerRequest, PdfUnlockWorkerResult>(() => new UnlockPdfWorker());
  const resultRef = useRef<Unlocked | null>(null);
  /** Bumped whenever the file changes or is cleared, so a slow answer for the previous file is dropped. */
  const latestRequestRef = useRef(0);

  const replaceResult = (next: Unlocked | null) => {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    resultRef.current = next;
    setResult(next);
  };
  useEffect(() => () => replaceResult(null), []);

  const lockedInfo = info && info.encrypted ? info : null;
  const unsupported = lockedInfo?.unsupported ?? null;
  const canUnlock = file !== null && lockedInfo !== null && unsupported === null && status !== 'unlocking' && status !== 'inspecting';

  /** Any edit makes a finished result stale: it no longer matches what's on screen. */
  const edit = (change: () => void) => {
    change();
    setError(null);
    if (result) {
      replaceResult(null);
      setStatus('ready');
    }
  };

  const selectFile = async (next: File | null): Promise<void> => {
    const requestId = (latestRequestRef.current += 1);
    replaceResult(null);
    setError(null);
    setInfo(null);
    setFile(null);
    setConfirmRemoval(false);
    if (!next) {
      setStatus('idle');
      return;
    }
    const checked = validatePdfFile(next);
    if (!checked.ok) {
      setError(checked.error);
      setStatus('error');
      return;
    }
    setFile(next);
    setStatus('inspecting');
    try {
      const bytes = new Uint8Array(await next.arrayBuffer());
      const response = await worker.run({ kind: 'inspect', bytes }, { transfer: [bytes.buffer] });
      if (requestId !== latestRequestRef.current) return;
      if (response.kind !== 'inspect') throw new Error('Unexpected response from the PDF worker.');
      if (!response.ok) {
        setFile(null);
        setError(response.error);
        setStatus('error');
        return;
      }
      setInfo(response.info);
      setStatus('ready');
    } catch (thrown: unknown) {
      if (requestId !== latestRequestRef.current) return;
      setFile(null);
      setError(thrown instanceof Error && thrown.message ? `Couldn’t read this PDF: ${thrown.message}` : 'Couldn’t read this PDF. Try reloading the page, or a smaller file.');
      setStatus('error');
    }
  };

  const unlock = async (): Promise<void> => {
    if (!file || !lockedInfo) return;
    const requestId = (latestRequestRef.current += 1);
    setError(null);
    setStatus('unlocking');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const response = await worker.run({ kind: 'unlock', bytes, options: { password, confirmRestrictionRemoval: confirmRemoval } }, { transfer: [bytes.buffer] });
      if (requestId !== latestRequestRef.current) return;
      if (response.kind !== 'unlock') throw new Error('Unexpected response from the PDF worker.');
      if (!response.ok) {
        setError(response.error);
        setStatus('ready');
        return;
      }
      const { output } = response;
      replaceResult({
        url: URL.createObjectURL(new Blob([output.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })),
        name: unlockedFileName(file.name),
        report: output.report,
      });
      setStatus('done');
    } catch (thrown: unknown) {
      if (requestId !== latestRequestRef.current) return;
      setError(thrown instanceof Error && thrown.message ? `Unlocking failed: ${thrown.message}` : 'Unlocking failed unexpectedly. Try reloading the page, or a smaller file.');
      setStatus('ready');
    }
  };

  const clearAll = () => {
    void selectFile(null);
    setPassword('');
    setShowPassword(false);
  };

  const loadExample = async () => {
    setLoadingExample(true);
    setError(null);
    try {
      const response = await worker.run({ kind: 'sample' });
      if (response.kind !== 'sample') throw new Error('Unexpected response from the PDF worker.');
      setPassword(EXAMPLE_PASSWORD);
      setShowPassword(true);
      await selectFile(new File([response.bytes as Uint8Array<ArrayBuffer>], 'quarterly-report-protected.pdf', { type: 'application/pdf' }));
    } catch (thrown: unknown) {
      setError(`Couldn’t generate the example PDF${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}`);
      setStatus('error');
    } finally {
      setLoadingExample(false);
    }
  };

  const pristine = !file && !error && !password;

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="field__hint">Remove a PDF’s password or restrictions, when you know the password — all on your device.</span>
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={() => void loadExample()} disabled={loadingExample} title="Generate a password-protected sample PDF and fill in its password">
          {loadingExample ? 'Generating…' : 'Load example'}
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={pristine} title="Remove the PDF and clear the password">
          Clear
        </button>
      </div>

      <FileDropzone file={file} onFileSelected={(next) => void selectFile(next)} chooseLabel="Choose a PDF to unlock" accept="application/pdf,.pdf" />

      {status === 'inspecting' && (
        <p class="field__hint" role="status">
          <span class="job__spinner" aria-hidden="true" /> Reading the PDF…
        </p>
      )}

      {info && !info.encrypted && (
        <p class="msg msg--info" role="status">
          <span class="msg__icon" aria-hidden="true">
            i
          </span>
          <span>This PDF isn’t password-protected, so there’s nothing to unlock. You can open it in any PDF viewer as it is.</span>
        </p>
      )}

      {lockedInfo && unsupported && <ErrorMessage message={unsupported} />}

      {lockedInfo && !unsupported && (
        <ul class="unlock-facts">
          <li>
            Encryption: <strong>{lockedInfo.cipher}</strong>
            {file ? ` · ${formatBytes(file.size)}` : ''}
          </li>
          <li>{lockedInfo.needsPassword ? 'It needs a password to open.' : 'It opens without a password — it only restricts what readers may do.'}</li>
          {lockedInfo.restrictions.length > 0 && <li>Restricts: {lockedInfo.restrictions.join(', ')}.</li>}
        </ul>
      )}

      {lockedInfo && !unsupported && (
        <div class="unlock-form">
          <div class="field">
            <div class="field__label">
              <label for="unlock-password">Password</label>
              <label class="checkbox" title="Reveal the password to check it for typos">
                <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword((event.target as HTMLInputElement).checked)} />
                Show
              </label>
            </div>
            <input
              id="unlock-password"
              class="input"
              type={showPassword ? 'text' : 'password'}
              spellcheck={false}
              autocomplete="off"
              placeholder={lockedInfo.needsPassword ? 'The open password' : 'Leave empty — this file needs none'}
              value={password}
              onInput={(event) => edit(() => setPassword((event.target as HTMLInputElement).value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canUnlock) void unlock();
              }}
            />
            <span class="field__hint">The open password, or the permissions password if the file has one. Passwords are case-sensitive and are never sent anywhere.</span>
          </div>

          {lockedInfo.restrictions.length > 0 && (
            <label class="checkbox" title="Needed to remove restrictions when you only have the open password. The permissions password does not need this.">
              <input type="checkbox" checked={confirmRemoval} onChange={(event) => edit(() => setConfirmRemoval((event.target as HTMLInputElement).checked))} />
              <span>I own this document or have permission to remove its restrictions</span>
            </label>
          )}
        </div>
      )}

      <div class="unlock-actions">
        <button type="button" class="btn btn--primary" onClick={() => void unlock()} disabled={!canUnlock} title={file ? 'Remove the protection and build an unlocked copy' : 'Choose a PDF first'}>
          {status === 'unlocking' ? 'Unlocking…' : 'Unlock PDF'}
        </button>
      </div>

      <ErrorMessage message={lockedInfo && unsupported ? null : error} />

      {status === 'unlocking' && (
        <p class="field__hint" role="status">
          <span class="job__spinner" aria-hidden="true" /> Decrypting… large PDFs can take a few seconds.
        </p>
      )}

      {result && file && (
        <div class="unlock-result" data-testid="pdf-result">
          <p class="msg msg--success" role="status">
            <span class="msg__icon" aria-hidden="true">
              ✓
            </span>
            <span>
              Unlocked · {result.report.pageCount} {result.report.pageCount === 1 ? 'page' : 'pages'} · {formatBytes(result.report.outputBytes)}
            </span>
          </p>
          <ul class="unlock-facts">
            <li>{OPENED_WITH_LABELS[result.report.openedWith]}</li>
            <li>
              {result.report.removedRestrictions.length > 0
                ? `Restrictions removed: ${result.report.removedRestrictions.join(', ')}.`
                : 'The file had no permission restrictions.'}
            </li>
            {result.report.signed && <li>This PDF is digitally signed; unlocking rewrites the file, so the signature will no longer verify.</li>}
          </ul>
          <button type="button" class="btn btn--primary" onClick={() => downloadUrl(result.url, result.name)} title={`Save as ${result.name}`}>
            <span aria-hidden="true">⭳</span> Download {result.name}
          </button>
          <p class="field__hint">The unlocked copy has no password. Keep it somewhere private, and delete it when you no longer need it. Your original file is unchanged.</p>
          <PdfPreview url={result.url} heading="Unlocked document" frameTitle="Unlocked PDF preview" />
        </div>
      )}

      <style>{`
        .unlock-facts { margin: var(--space-3) 0 0; padding-left: var(--space-5); color: var(--text-muted); font-size: var(--text-sm); }
        .unlock-facts li + li { margin-top: var(--space-1); }
        .unlock-form { display: flex; flex-direction: column; gap: var(--space-3); max-width: 36rem; margin-top: var(--space-4); }
        .unlock-actions { margin-top: var(--space-4); }
        .unlock-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
        .unlock-result .unlock-facts { margin-bottom: var(--space-3); }
      `}</style>
    </div>
  );
}
