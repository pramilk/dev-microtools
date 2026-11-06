import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  DEFAULT_TOTP_SETTINGS,
  TOTP_ALGORITHMS,
  TOTP_DIGITS,
  MAX_PERIOD,
  MIN_PERIOD,
  buildOtpauthUri,
  codeWindow,
  counterAt,
  generateSecret,
  parseOtpauthUri,
  parseSecret,
  secondsRemaining,
  validateCode,
  validatePeriod,
  type CodeWindow,
  type TotpAlgorithm,
  type TotpDigits,
  type TotpSettings,
} from '../lib/tools/totp';
import { generateQrMatrix, matrixToSvg } from '../lib/tools/qrcode';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { CollapsibleHelp } from './shared/CollapsibleHelp';

// NO share link, on purpose: the whole input of this tool is a TOTP shared secret, which is
// a credential (anyone holding it can generate every future login code). Putting it in a
// shareable URL would leak it into browser history, chat previews and server logs, which is
// exactly what CLAUDE.md's rule on secret inputs forbids. Nothing here is persisted either.

// The RFC 4226 / 6238 appendix test secret ("12345678901234567890"), so a first-time visitor
// sees a working code immediately and can compare it with the published test vectors.
// Matches `example.input` in totp-generator.mdx.
const SAMPLE_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const TICK_MS = 250;

/** Groups a code for reading aloud: 6 → "123 456", 8 → "1234 5678". */
function groupCode(code: string): string {
  const split = Math.ceil(code.length / 2);
  return `${code.slice(0, split)} ${code.slice(split)}`;
}

export default function TotpGenerator() {
  const [secretInput, setSecretInput] = useState('');
  const [settings, setSettings] = useState<TotpSettings>(DEFAULT_TOTP_SETTINGS);
  const [periodInput, setPeriodInput] = useState(String(DEFAULT_TOTP_SETTINGS.period));
  const [issuer, setIssuer] = useState('');
  const [account, setAccount] = useState('');
  const [checkCode, setCheckCode] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [codes, setCodes] = useState<CodeWindow | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ message: string; ok: boolean } | null>(null);
  const [qrSvg, setQrSvg] = useState('');
  const [importNote, setImportNote] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const trimmed = secretInput.trim();
  const isLink = /^otpauth:\/\//i.test(trimmed);
  const parsed = useMemo(() => (trimmed === '' || isLink ? null : parseSecret(secretInput)), [secretInput, trimmed, isLink]);
  const secret = parsed?.ok ? parsed.value : null;
  const secretError = parsed && !parsed.ok ? parsed.error : null;

  const period = useMemo(() => validatePeriod(Number(periodInput)), [periodInput]);
  const periodError = !period.ok ? period.error : null;
  const effective: TotpSettings = period.ok ? { ...settings, period: period.value } : settings;

  // Pasting an otpauth:// link (from an authenticator export or a site's setup page) fills
  // every field at once, so the visitor never has to copy the pieces by hand.
  useEffect(() => {
    if (!isLink) return;
    const imported = parseOtpauthUri(trimmed);
    if (!imported.ok) {
      setImportNote(imported.error);
      return;
    }
    setImportNote(null);
    setSecretInput(imported.value.secret);
    setSettings({ algorithm: imported.value.algorithm, digits: imported.value.digits, period: imported.value.period });
    setPeriodInput(String(imported.value.period));
    setIssuer(imported.value.issuer);
    setAccount(imported.value.account);
  }, [isLink, trimmed]);

  const counter = counterAt(now, effective.period);

  // Recompute codes only when the step changes (or an input does), not on every tick.
  useEffect(() => {
    if (!secret || periodError) {
      setCodes(null);
      setCodeError(null);
      return undefined;
    }
    let stale = false;
    void codeWindow(secret.bytes, counter * effective.period * 1000, effective).then((result) => {
      if (stale) return;
      if (result.ok) {
        setCodes(result.value);
        setCodeError(null);
      } else {
        setCodes(null);
        setCodeError(result.error);
      }
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `effective` is derived from the listed inputs
  }, [secret, counter, settings.algorithm, settings.digits, effective.period, periodError]);

  // Check an entered code against the current step ±1, as a server would.
  useEffect(() => {
    if (!secret || periodError || checkCode.trim() === '') {
      setValidation(null);
      return undefined;
    }
    let stale = false;
    void validateCode(secret.bytes, checkCode, now, effective).then((result) => {
      if (stale) return;
      if (!result.ok) {
        setValidation({ ok: false, message: result.error });
      } else if (result.value.valid) {
        const where = result.value.offset === 0 ? 'the current code' : result.value.offset === -1 ? 'the previous code (about one step old)' : 'the next code (about one step ahead)';
        setValidation({ ok: true, message: `Valid: this is ${where}.` });
      } else {
        setValidation({ ok: false, message: 'Not valid: it does not match the current, previous or next code. Check the secret, settings and your clock.' });
      }
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check on each new step, not each tick
  }, [secret, checkCode, counter, settings.algorithm, settings.digits, effective.period, periodError]);

  const uri = useMemo(() => {
    if (!secret || periodError) return null;
    return buildOtpauthUri({ ...effective, secret: secretInput, issuer, account });
  }, [secret, secretInput, issuer, account, effective.algorithm, effective.digits, effective.period, periodError]);

  useEffect(() => {
    if (!uri || !uri.ok) {
      setQrSvg('');
      return undefined;
    }
    let stale = false;
    void generateQrMatrix(uri.value, 'M').then((matrix) => {
      if (stale) return;
      setQrSvg(matrix.ok ? matrixToSvg(matrix.value, { cellSize: 6, darkColor: '#000000', lightColor: '#ffffff' }) : '');
    });
    return () => {
      stale = true;
    };
  }, [uri]);

  const remaining = secondsRemaining(now, effective.period);
  const elapsedFraction = 1 - (remaining - (now % 1000) / 1000) / effective.period;

  const reset = () => {
    setSecretInput('');
    setSettings(DEFAULT_TOTP_SETTINGS);
    setPeriodInput(String(DEFAULT_TOTP_SETTINGS.period));
    setIssuer('');
    setAccount('');
    setCheckCode('');
    setImportNote(null);
  };

  const loadExample = () => {
    setSecretInput(SAMPLE_SECRET);
    setSettings(DEFAULT_TOTP_SETTINGS);
    setPeriodInput(String(DEFAULT_TOTP_SETTINGS.period));
    setIssuer('Example');
    setAccount('alice@example.com');
    setCheckCode('');
    setImportNote(null);
  };

  const hasInput = secretInput !== '' || issuer !== '' || account !== '' || checkCode !== '';

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={loadExample} title="Fill in the RFC 6238 test secret so you can compare with the published test vectors">
          Load example
        </button>
        <button type="button" class="btn" onClick={reset} disabled={!hasInput} title="Clear the secret and all settings">
          Clear
        </button>
      </div>

      <CollapsibleHelp summary="Where do I find the secret key, and what is this for?">
        <div class="help-callout__grid">
          <section>
            <h3>Where the secret comes from</h3>
            <ol>
              <li>
                When a site offers two-factor authentication it shows a QR code. Next to it is usually a link such as{' '}
                <strong>Can&apos;t scan it?</strong> or <strong>Enter this key manually</strong>.
              </li>
              <li>
                Copy that text key, a base32 string like <code>JBSW Y3DP EHPK 3PXP</code>, and paste it into the Secret box.
              </li>
              <li>
                You can also paste a whole <code>otpauth://</code> link and every field is filled in for you.
              </li>
            </ol>
          </section>
          <section>
            <h3>What you can do here</h3>
            <ol>
              <li>See the live six-digit code and its countdown, to test a login flow or recover access.</li>
              <li>Check a code you were given against the secret and see whether it is valid.</li>
              <li>Generate a new random secret, then scan the QR code with your authenticator app.</li>
            </ol>
          </section>
        </div>
        <p class="help-callout__note">
          Everything runs in your browser and nothing is stored or sent. Even so, avoid pasting the secret for a high-value account
          (a bank, your email) into any web page you do not fully trust. For those, use your authenticator app.
        </p>
      </CollapsibleHelp>

      <div class="field">
        <label class="field__label" for="totp-secret">
          <span>Secret (base32) or otpauth:// link</span>
          <span class="field__hint">Spaces, dashes and lower case are fine</span>
        </label>
        <div class="totp-secret-row">
          <input
            id="totp-secret"
            class="input"
            type="text"
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            placeholder="JBSW Y3DP EHPK 3PXP"
            value={secretInput}
            aria-invalid={secretError !== null}
            onInput={(event) => setSecretInput((event.target as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="btn"
            onClick={() => {
              setImportNote(null);
              setSecretInput(generateSecret());
            }}
            title="Create a new random 160-bit secret using your browser's secure random generator"
          >
            Generate secret
          </button>
        </div>
      </div>

      <ErrorMessage message={secretError ?? importNote} />
      {secret?.weakWarning && (
        <p class="msg msg--warning" role="status">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <span>{secret.weakWarning}</span>
        </p>
      )}

      <div class="totp-settings">
        <div class="field">
          <label class="field__label" for="totp-algorithm">
            <span>Algorithm</span>
          </label>
          <select
            id="totp-algorithm"
            class="select"
            value={settings.algorithm}
            title="The hash used by the code. Almost every service uses SHA-1, even though SHA-256 and SHA-512 exist."
            onChange={(event) => setSettings({ ...settings, algorithm: (event.target as HTMLSelectElement).value as TotpAlgorithm })}
          >
            {TOTP_ALGORITHMS.map((algorithm) => (
              <option key={algorithm} value={algorithm}>
                {algorithm}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="totp-digits">
            <span>Digits</span>
          </label>
          <select
            id="totp-digits"
            class="select"
            value={settings.digits}
            title="How many digits each code has. 6 is the standard."
            onChange={(event) => setSettings({ ...settings, digits: Number((event.target as HTMLSelectElement).value) as TotpDigits })}
          >
            {TOTP_DIGITS.map((digits) => (
              <option key={digits} value={digits}>
                {digits}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="totp-period">
            <span>Period (seconds)</span>
          </label>
          <input
            id="totp-period"
            class="input"
            type="number"
            inputMode="numeric"
            min={MIN_PERIOD}
            max={MAX_PERIOD}
            value={periodInput}
            aria-invalid={periodError !== null}
            title="How long each code stays valid. 30 seconds is the standard."
            onInput={(event) => setPeriodInput((event.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <ErrorMessage message={periodError} />

      {!secret && !secretError && !importNote && (
        <p class="field__hint">Enter a secret, paste an otpauth:// link, or press Generate secret to see a live code.</p>
      )}

      {secret && !periodError && (
        <div class="totp-result">
          <div class="result-card">
            <h3 class="result-card__title">Current code</h3>
            {codeError ? (
              <ErrorMessage message={codeError} />
            ) : (
              <>
                <div class="totp-code-row">
                  <output class="totp-code" aria-live="off" aria-label="Current one-time code">
                    {codes ? groupCode(codes.current) : '······'}
                  </output>
                  <CopyButton value={codes?.current ?? ''} label="Copy code" describe="one-time code" />
                </div>
                <div class="totp-timer">
                  <div
                    class="totp-timer__bar"
                    role="progressbar"
                    aria-label="Time until the code changes"
                    aria-valuemin={0}
                    aria-valuemax={effective.period}
                    aria-valuenow={remaining}
                  >
                    <div class={`totp-timer__fill${remaining <= 5 ? ' totp-timer__fill--low' : ''}`} style={{ width: `${Math.min(100, Math.max(0, elapsedFraction * 100))}%` }} />
                  </div>
                  <span class="totp-timer__label">Changes in {remaining}s</span>
                </div>
                <dl class="totp-neighbours">
                  <dt>Previous</dt>
                  <dd>{codes ? groupCode(codes.previous) : '—'}</dd>
                  <dt>Next</dt>
                  <dd>{codes ? groupCode(codes.next) : '—'}</dd>
                </dl>
              </>
            )}
          </div>

          <div class="result-card">
            <h3 class="result-card__title">Check a code</h3>
            <div class="field">
              <label class="field__label" for="totp-check">
                <span>Code to check</span>
                <span class="field__hint">Accepts the current code and one step either side, like most servers</span>
              </label>
              <input
                id="totp-check"
                class="input"
                type="text"
                inputMode="numeric"
                autocomplete="off"
                placeholder={'0'.repeat(effective.digits)}
                value={checkCode}
                onInput={(event) => setCheckCode((event.target as HTMLInputElement).value)}
              />
            </div>
            {validation && (
              <p class={`msg ${validation.ok ? 'msg--success' : 'msg--error'}`} role={validation.ok ? 'status' : 'alert'}>
                <span class="msg__icon" aria-hidden="true">
                  {validation.ok ? '✓' : '✕'}
                </span>
                <span>{validation.message}</span>
              </p>
            )}
          </div>

          <div class="result-card">
            <h3 class="result-card__title">Add to an authenticator app</h3>
            <div class="totp-enroll">
              <div class="field">
                <label class="field__label" for="totp-issuer">
                  <span>Issuer (optional)</span>
                </label>
                <input
                  id="totp-issuer"
                  class="input"
                  type="text"
                  autocomplete="off"
                  placeholder="Example Co"
                  value={issuer}
                  title="The service name shown above the code in the app"
                  onInput={(event) => setIssuer((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="field">
                <label class="field__label" for="totp-account">
                  <span>Account name</span>
                </label>
                <input
                  id="totp-account"
                  class="input"
                  type="text"
                  autocomplete="off"
                  placeholder="alice@example.com"
                  value={account}
                  title="The account label shown under the issuer in the app"
                  onInput={(event) => setAccount((event.target as HTMLInputElement).value)}
                />
              </div>
            </div>
            {uri && !uri.ok && <p class="field__hint">{uri.error}</p>}
            {uri?.ok && (
              <div class="totp-qr-row">
                <div class="totp-qr" aria-label="QR code for authenticator apps" role="img" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                <div class="totp-uri">
                  <p class="field__hint">Scan with Google Authenticator, Authy, 1Password, Microsoft Authenticator or similar.</p>
                  <code class="totp-uri__text">{uri.value}</code>
                  <div>
                    <CopyButton value={uri.value} label="Copy otpauth link" describe="otpauth link" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {secret.weakWarning === null && (
            <p class="field__hint">
              Codes are computed from the secret and your device clock using HMAC (RFC 6238). If a code is rejected, the usual causes
              are a wrong secret, mismatched settings, or a clock that is off by more than about 30 seconds.
            </p>
          )}
        </div>
      )}

      <style>{`
        .totp-secret-row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        .totp-secret-row .input { flex: 1 1 16rem; min-width: 0; font-family: var(--font-mono); }
        .totp-settings { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--space-3); }
        .totp-result { display: flex; flex-direction: column; gap: var(--space-3); }
        .totp-code-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
        .totp-code {
          font-family: var(--font-mono); font-size: 2.5rem; font-weight: 700; letter-spacing: .08em;
          color: var(--text); font-variant-numeric: tabular-nums; min-height: 3rem; line-height: 3rem;
        }
        .totp-timer { display: flex; align-items: center; gap: var(--space-3); }
        .totp-timer__bar { flex: 1; height: .5rem; border-radius: 99px; background: var(--surface-2); overflow: hidden; border: 1px solid var(--border); }
        .totp-timer__fill { height: 100%; background: var(--accent); }
        .totp-timer__fill--low { background: var(--warning); }
        .totp-timer__label { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); min-width: 6.5rem; text-align: right; }
        .totp-neighbours {
          display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-4); margin: 0;
          font-size: var(--text-sm);
        }
        .totp-neighbours dt { color: var(--text-muted); font-family: var(--font-mono); font-size: var(--text-xs); }
        .totp-neighbours dd { margin: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
        .totp-enroll { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: var(--space-3); }
        .totp-qr-row { display: flex; gap: var(--space-4); flex-wrap: wrap; align-items: flex-start; }
        .totp-qr {
          width: 11rem; height: 11rem; flex: none; background: #fff; padding: .5rem;
          border: 1px solid var(--border); border-radius: var(--radius);
        }
        .totp-qr svg { width: 100%; height: 100%; display: block; }
        .totp-uri { flex: 1 1 14rem; display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
        .totp-uri__text { font-family: var(--font-mono); font-size: var(--text-xs); word-break: break-all; color: var(--text); }
      `}</style>
    </div>
  );
}
