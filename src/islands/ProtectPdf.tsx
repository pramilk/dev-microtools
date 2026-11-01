import { useEffect, useRef, useState } from 'preact/hooks';
import {
  ALL_PERMITTED,
  DEFAULT_PROTECT_OPTIONS,
  ENCRYPTION_HINTS,
  ENCRYPTION_LABELS,
  PRINT_LABELS,
  protectedFileName,
  rateOpenPassword,
  validatePdfFile,
  validateProtectOptions,
  type PdfEncryption,
  type PdfPermissions,
  type PdfProtectReport,
  type PdfProtectSourceInfo,
  type PrintPermission,
} from '../lib/tools/pdfProtect';
import { generatePassword } from '../lib/tools/password';
import { formatBytes } from './shared/formatBytes';
import { ErrorMessage } from './shared/ErrorMessage';
import { FileDropzone } from './shared/FileDropzone';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import ProtectPdfWorker from '../workers/pdfProtect.worker?worker';
import type { PdfProtectWorkerRequest, PdfProtectWorkerResult } from '../workers/pdfProtect.worker';

// Deliberately no ShareLinkButton — the input is a binary PDF from the visitor's own disk, and
// the other input is a password, which must never travel in a URL. Sharing only the encryption
// and permission settings would produce a link that does nothing useful without the file.

/** The password the "Load example" sample is protected with — shown in the field, so the
 *  visitor can see it and try opening the result. */
const EXAMPLE_PASSWORD = 'Sample-Pass-42';
const EXAMPLE_PERMISSIONS: PdfPermissions = { ...ALL_PERMITTED, copy: false, edit: false };

const PRINT_CHOICES: PrintPermission[] = ['full', 'low', 'none'];

interface Protected {
  url: string;
  name: string;
  report: PdfProtectReport;
}

type Status = 'idle' | 'inspecting' | 'ready' | 'protecting' | 'done' | 'error';

const PERMISSION_CHECKS: { key: Exclude<keyof PdfPermissions, 'print'>; label: string; title: string }[] = [
  { key: 'copy', label: 'Allow copying text and images', title: 'Lets readers select and copy text and extract images' },
  { key: 'edit', label: 'Allow editing content', title: 'Lets readers change the document’s text, images and layout' },
  { key: 'annotate', label: 'Allow comments and annotations', title: 'Lets readers add comments, highlights and sticky notes' },
  { key: 'fillForms', label: 'Allow filling in forms', title: 'Lets readers type into form fields and sign' },
  { key: 'assemble', label: 'Allow inserting, deleting and rotating pages', title: 'Lets readers reorder, remove, rotate or add pages' },
  { key: 'accessibility', label: 'Allow screen-reader access', title: 'Lets assistive technology read the text aloud. Turning this off locks out blind and low-vision readers.' },
];

export default function ProtectPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<PdfProtectSourceInfo | null>(null);
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [encryption, setEncryption] = useState<PdfEncryption>(DEFAULT_PROTECT_OPTIONS.encryption);
  const [permissions, setPermissions] = useState<PdfPermissions>(ALL_PERMITTED);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Protected | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);

  const worker = useWorkerTask<PdfProtectWorkerRequest, PdfProtectWorkerResult>(() => new ProtectPdfWorker());
  const resultRef = useRef<Protected | null>(null);
  /** Bumped whenever the file changes or is cleared, so a slow answer for the previous file is dropped. */
  const latestRequestRef = useRef(0);

  const replaceResult = (next: Protected | null) => {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    resultRef.current = next;
    setResult(next);
  };
  useEffect(() => () => replaceResult(null), []);

  const options = { userPassword, ownerPassword, encryption, permissions };
  const validation = validateProtectOptions(options);
  const strength = rateOpenPassword(userPassword);
  const canProtect = file !== null && info !== null && status !== 'protecting' && status !== 'inspecting';

  /** Any settings change makes a finished result stale: it no longer matches what's on screen. */
  const edit = (change: () => void) => {
    change();
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

  const protect = async (): Promise<void> => {
    if (!file || !info) return;
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    const requestId = (latestRequestRef.current += 1);
    setError(null);
    setStatus('protecting');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const response = await worker.run({ kind: 'protect', bytes, options }, { transfer: [bytes.buffer] });
      if (requestId !== latestRequestRef.current) return;
      if (response.kind !== 'protect') throw new Error('Unexpected response from the PDF worker.');
      if (!response.ok) {
        setError(response.error);
        setStatus('ready');
        return;
      }
      const { output } = response;
      replaceResult({
        url: URL.createObjectURL(new Blob([output.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })),
        name: protectedFileName(file.name),
        report: output.report,
      });
      setStatus('done');
    } catch (thrown: unknown) {
      if (requestId !== latestRequestRef.current) return;
      setError(thrown instanceof Error && thrown.message ? `Protecting failed: ${thrown.message}` : 'Protecting failed unexpectedly. Try reloading the page, or a smaller file.');
      setStatus('ready');
    }
  };

  const clearAll = () => {
    void selectFile(null);
    setUserPassword('');
    setOwnerPassword('');
    setShowPasswords(false);
    setEncryption(DEFAULT_PROTECT_OPTIONS.encryption);
    setPermissions(ALL_PERMITTED);
  };

  const loadExample = async () => {
    setLoadingExample(true);
    setError(null);
    try {
      const response = await worker.run({ kind: 'sample' });
      if (response.kind !== 'sample') throw new Error('Unexpected response from the PDF worker.');
      setUserPassword(EXAMPLE_PASSWORD);
      setOwnerPassword('');
      setShowPasswords(true);
      setEncryption('aes256');
      setPermissions(EXAMPLE_PERMISSIONS);
      await selectFile(new File([response.bytes as Uint8Array<ArrayBuffer>], 'quarterly-report.pdf', { type: 'application/pdf' }));
    } catch (thrown: unknown) {
      setError(`Couldn’t generate the example PDF${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}`);
      setStatus('error');
    } finally {
      setLoadingExample(false);
    }
  };

  const suggestPassword = () => {
    const generated = generatePassword({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: encryption === 'aes256', excludeAmbiguous: true });
    if (generated.ok) {
      edit(() => setUserPassword(generated.value));
      setShowPasswords(true);
    }
  };

  const setPermission = (patch: Partial<PdfPermissions>) => edit(() => setPermissions((prev) => ({ ...prev, ...patch })));
  const passwordType = showPasswords ? 'text' : 'password';
  const pristine = !file && !error && !userPassword && !ownerPassword && encryption === 'aes256' && permissions === ALL_PERMITTED;

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="field__hint">Add a password and restrict what readers can do — all on your device.</span>
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={() => void loadExample()} disabled={loadingExample} title="Generate a sample PDF and fill in an example password and restrictions">
          {loadingExample ? 'Generating…' : 'Load example'}
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={pristine} title="Remove the PDF and clear every setting, including the passwords">
          Clear
        </button>
      </div>

      <FileDropzone file={file} onFileSelected={(next) => void selectFile(next)} chooseLabel="Choose a PDF to protect" accept="application/pdf,.pdf" />

      {status === 'inspecting' && (
        <p class="field__hint" role="status">
          <span class="job__spinner" aria-hidden="true" /> Reading the PDF…
        </p>
      )}
      {info && (
        <p class="field__hint">
          {info.pageCount} {info.pageCount === 1 ? 'page' : 'pages'}
          {file ? ` · ${formatBytes(file.size)}` : ''}
        </p>
      )}
      {info?.signed && (
        <p class="msg msg--warning">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <span>This PDF is digitally signed. Protecting it rewrites the file, so the signature will no longer verify.</span>
        </p>
      )}

      <div class="protect-grid">
        <div class="field">
          <div class="field__label">
            <label for="protect-user">Open password</label>
            <label class="checkbox" title="Reveal the passwords to check them for typos">
              <input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords((event.target as HTMLInputElement).checked)} />
              Show
            </label>
          </div>
          <div class="protect-row">
            <input
              id="protect-user"
              class="input"
              type={passwordType}
              spellcheck={false}
              autocomplete="new-password"
              placeholder="Required to open the file"
              value={userPassword}
              onInput={(event) => edit(() => setUserPassword((event.target as HTMLInputElement).value))}
            />
            <button type="button" class="btn" onClick={suggestPassword} title="Fill in a random 20-character password">
              Generate
            </button>
          </div>
          <span class="field__hint">
            {strength ? (
              <>
                Strength: <strong class={`protect-strength protect-strength--${strength.tone}`}>{strength.label}</strong> ·{' '}
              </>
            ) : null}
            Leave empty to let anyone open the file and only restrict what they can do. The password can’t be recovered if you lose it.
          </span>
        </div>

        <div class="field">
          <label class="field__label" for="protect-owner" title="Needed to change these restrictions later. Not needed to open the file.">
            <span>Permissions password (optional)</span>
          </label>
          <input
            id="protect-owner"
            class="input"
            type={passwordType}
            spellcheck={false}
            autocomplete="new-password"
            placeholder="Leave empty to generate a random one"
            value={ownerPassword}
            title="Needed to change these restrictions later. Not needed to open the file."
            onInput={(event) => edit(() => setOwnerPassword((event.target as HTMLInputElement).value))}
          />
          <span class="field__hint">
            Must differ from the open password. If empty, a random one is generated and thrown away, so nobody — including you — can lift the restrictions later.
          </span>
        </div>

        <div class="field">
          <label class="field__label" for="protect-encryption" title="AES-256 is the strong, current standard. AES-128 only exists for very old PDF readers.">
            <span>Encryption</span>
          </label>
          <select
            id="protect-encryption"
            class="select"
            value={encryption}
            onChange={(event) => edit(() => setEncryption((event.target as HTMLSelectElement).value as PdfEncryption))}
          >
            {(Object.keys(ENCRYPTION_LABELS) as PdfEncryption[]).map((value) => (
              <option key={value} value={value}>
                {ENCRYPTION_LABELS[value]}
              </option>
            ))}
          </select>
          <span class="field__hint">{ENCRYPTION_HINTS[encryption]}</span>
        </div>
      </div>

      <fieldset class="protect-permissions">
        <legend class="field__label">What readers may do</legend>
        <div class="field protect-print">
          <label class="field__label" for="protect-print" title="Printing can be allowed at full quality, limited to low resolution, or blocked.">
            <span>Printing</span>
          </label>
          <select id="protect-print" class="select" value={permissions.print} onChange={(event) => setPermission({ print: (event.target as HTMLSelectElement).value as PrintPermission })}>
            {PRINT_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {PRINT_LABELS[choice]}
              </option>
            ))}
          </select>
        </div>
        <div class="protect-checks">
          {PERMISSION_CHECKS.map(({ key, label, title }) => (
            <label key={key} class="checkbox" title={title}>
              <input type="checkbox" checked={permissions[key]} onChange={(event) => setPermission({ [key]: (event.target as HTMLInputElement).checked })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p class="field__hint">
          Restrictions are honoured by well-behaved readers, but they are not encryption: only the open password actually keeps people out. Use a strong one if the content is sensitive.
        </p>
      </fieldset>

      <div class="protect-actions">
        <button type="button" class="btn btn--primary" onClick={() => void protect()} disabled={!canProtect || !validation.ok} title={file ? 'Encrypt the PDF with these settings' : 'Choose a PDF first'}>
          {status === 'protecting' ? 'Protecting…' : 'Protect PDF'}
        </button>
        {file && !validation.ok && <span class="field__hint">{validation.error}</span>}
      </div>

      <ErrorMessage message={error} />

      {status === 'protecting' && (
        <p class="field__hint" role="status">
          <span class="job__spinner" aria-hidden="true" /> Encrypting… large PDFs can take a few seconds.
        </p>
      )}

      {result && file && (
        <div class="protect-result" data-testid="pdf-result">
          <p class="msg msg--success" role="status">
            <span class="msg__icon" aria-hidden="true">
              ✓
            </span>
            <span>
              Protected with {result.report.encryption === 'aes256' ? 'AES-256' : 'AES-128'} · {result.report.pageCount} {result.report.pageCount === 1 ? 'page' : 'pages'} ·{' '}
              {formatBytes(result.report.outputBytes)}
            </span>
          </p>
          <ul class="protect-summary">
            <li>{result.report.openPassword ? 'Asks for the open password to view.' : 'Opens without a password.'}</li>
            <li>
              {result.report.restrictions.length > 0
                ? `Restricted: ${result.report.restrictions.join(', ')}.`
                : 'No permissions are restricted.'}
            </li>
            {result.report.generatedOwnerPassword && result.report.restrictions.length > 0 && (
              <li>The permissions password was generated randomly and not kept, so these restrictions can’t be lifted later.</li>
            )}
          </ul>
          <button type="button" class="btn btn--primary" onClick={() => downloadUrl(result.url, result.name)} title={`Save as ${result.name}`}>
            <span aria-hidden="true">⭳</span> Download {result.name}
          </button>
          <p class="field__hint">Open the downloaded file in your PDF viewer to confirm it asks for the password. Your original file is unchanged.</p>
        </div>
      )}

      <style>{`
        .protect-grid { display: grid; gap: var(--space-4); margin-top: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); align-items: start; }
        .protect-row { display: flex; gap: var(--space-2); }
        .protect-row .input { flex: 1; min-width: 0; }
        .protect-strength--error { color: var(--danger); }
        .protect-strength--warning { color: var(--warning); }
        .protect-strength--success { color: var(--success); }
        .protect-permissions { margin: var(--space-4) 0 0; padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
        .protect-permissions legend { padding: 0 var(--space-2); }
        .protect-permissions .protect-print { flex-direction: row; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
        .protect-permissions .protect-print .field__label { margin: 0; }
        .protect-permissions .protect-print .select { width: auto; min-width: 12rem; }
        .protect-checks { display: grid; gap: var(--space-2) var(--space-4); grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); }
        .protect-permissions .field__hint { margin: var(--space-3) 0 0; }
        .protect-actions { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-4); }
        .protect-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
        .protect-summary { margin: var(--space-3) 0; padding-left: var(--space-5); color: var(--text-muted); font-size: var(--text-sm); }
        .protect-summary li + li { margin-top: var(--space-1); }
      `}</style>
    </div>
  );
}
