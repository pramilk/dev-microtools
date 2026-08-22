import { useEffect, useMemo, useState } from 'preact/hooks';
import { decodeJwt, inspectExpiry, signHs256, verifyHs256 } from '../lib/tools/jwt';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';

const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
  '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

type Tab = 'decode' | 'encode';
type Verification = { checked: false } | { checked: true; valid: boolean } | { checked: true; error: string };

const CLAIM_NAMES: Record<string, string> = {
  iss: 'Issuer',
  sub: 'Subject',
  aud: 'Audience',
  exp: 'Expires at',
  nbf: 'Not valid before',
  iat: 'Issued at',
  jti: 'JWT ID',
};

export default function JwtDebugger() {
  const [tab, setTab] = useState<Tab>('decode');

  // Decode side
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [verification, setVerification] = useState<Verification>({ checked: false });

  // Encode side
  const [payloadDraft, setPayloadDraft] = useState('{\n  "sub": "1234567890",\n  "name": "Ada"\n}');
  const [signSecret, setSignSecret] = useState('your-256-bit-secret');
  const [signed, setSigned] = useState('');
  const [signError, setSignError] = useState<string | null>(null);

  const decoded = useMemo(() => (token.trim() === '' ? null : decodeJwt(token)), [token]);
  const value = decoded?.ok ? decoded.value : null;
  const decodeError = decoded && !decoded.ok ? decoded.error : null;

  const expiry = useMemo(() => (value ? inspectExpiry(value.payload) : null), [value]);

  // Re-verify whenever the token or secret changes, rather than on a button press.
  useEffect(() => {
    if (!value || secret === '') {
      setVerification({ checked: false });
      return;
    }

    let cancelled = false;
    void verifyHs256(token, secret).then((result) => {
      if (cancelled) return;
      setVerification(
        result.ok ? { checked: true, valid: result.value } : { checked: true, error: result.error }
      );
    });

    return () => {
      cancelled = true;
    };
  }, [token, secret, value]);

  const sign = async () => {
    setSignError(null);
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(payloadDraft);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setSignError('The payload must be a JSON object.');
        setSigned('');
        return;
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      setSignError('The payload is not valid JSON.');
      setSigned('');
      return;
    }

    const result = await signHs256(payload, signSecret);
    if (result.ok) {
      setSigned(result.value);
    } else {
      setSigned('');
      setSignError(result.error);
    }
  };

  return (
    <div class="tool">
      <p class="msg msg--info">
        <span class="msg__icon" aria-hidden="true">
          ⓘ
        </span>
        <span>
          Tokens are decoded in your browser and never sent anywhere. Even so, treat production
          tokens as secrets — anyone who sees your screen can read them.
        </span>
      </p>

      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Mode">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={tab === 'decode'}
            onClick={() => setTab('decode')}
          >
            Decode &amp; verify
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={tab === 'encode'}
            onClick={() => setTab('encode')}
          >
            Create &amp; sign
          </button>
        </div>

        <span class="tool-bar__spacer" />
        {tab === 'decode' && (
          <>
            <button type="button" class="btn" onClick={() => setToken(SAMPLE)}>
              Load sample
            </button>
            <button type="button" class="btn" onClick={() => setToken('')} disabled={token === ''}>
              Clear
            </button>
          </>
        )}
      </div>

      {tab === 'decode' ? (
        <>
          <div class="field">
            <label class="field__label" for="jwt-token">
              <span>JWT</span>
              <span class="field__hint">header.payload.signature</span>
            </label>
            <textarea
              id="jwt-token"
              class="textarea textarea--short jwt-token"
              spellcheck={false}
              autocomplete="off"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
              value={token}
              aria-invalid={decodeError !== null}
              onInput={(event) => setToken((event.target as HTMLTextAreaElement).value)}
            />
          </div>

          <ErrorMessage message={decodeError} />

          {value && (
            <>
              <div class="panes panes--split">
                <OutputPane
                  label="Header"
                  value={JSON.stringify(value.header, null, 2)}
                  placeholder=""
                  describe="header"
                />
                <OutputPane
                  label="Payload"
                  value={JSON.stringify(value.payload, null, 2)}
                  placeholder=""
                  describe="payload"
                />
              </div>

              {expiry && (
                <div class="claims">
                  <h3 class="claims__title">Registered claims</h3>
                  {expiry.status === 'expired' && (
                    <p class="msg msg--error">
                      <span class="msg__icon" aria-hidden="true">
                        !
                      </span>
                      <span>This token expired on {expiry.expiresAt?.toLocaleString()}.</span>
                    </p>
                  )}
                  {expiry.status === 'valid' && (
                    <p class="msg msg--success">
                      <span class="msg__icon" aria-hidden="true">
                        ✓
                      </span>
                      <span>Not expired — valid until {expiry.expiresAt?.toLocaleString()}.</span>
                    </p>
                  )}
                  {expiry.status === 'not-yet-valid' && (
                    <p class="msg msg--warning">
                      <span class="msg__icon" aria-hidden="true">
                        !
                      </span>
                      <span>Not valid until {expiry.notBefore?.toLocaleString()}.</span>
                    </p>
                  )}
                  {expiry.status === 'no-expiry' && (
                    <p class="msg msg--warning">
                      <span class="msg__icon" aria-hidden="true">
                        !
                      </span>
                      <span>This token has no expiry claim, so it never becomes invalid on its own.</span>
                    </p>
                  )}

                  <dl class="claims__grid">
                    {Object.entries(value.payload)
                      .filter(([key]) => key in CLAIM_NAMES)
                      .map(([key, claim]) => (
                        <>
                          <dt key={`k-${key}`}>
                            <code>{key}</code> {CLAIM_NAMES[key]}
                          </dt>
                          <dd key={`v-${key}`}>
                            {typeof claim === 'number' && ['exp', 'nbf', 'iat'].includes(key)
                              ? `${claim} — ${new Date(claim * 1000).toLocaleString()}`
                              : String(claim)}
                          </dd>
                        </>
                      ))}
                  </dl>
                </div>
              )}

              <div class="field">
                <label class="field__label" for="jwt-secret">
                  <span>Verify signature (HS256)</span>
                  <span class="field__hint">Checked locally — the secret never leaves the page</span>
                </label>
                <input
                  id="jwt-secret"
                  class="input"
                  type="password"
                  spellcheck={false}
                  autocomplete="off"
                  placeholder="Enter the shared secret to check the signature…"
                  value={secret}
                  onInput={(event) => setSecret((event.target as HTMLInputElement).value)}
                />
              </div>

              {verification.checked && 'error' in verification && (
                <ErrorMessage message={verification.error} />
              )}
              {verification.checked && 'valid' in verification && (
                <p class={`msg msg--${verification.valid ? 'success' : 'error'}`}>
                  <span class="msg__icon" aria-hidden="true">
                    {verification.valid ? '✓' : '✗'}
                  </span>
                  <span>
                    {verification.valid
                      ? 'Signature verified — this token was signed with that secret and has not been altered.'
                      : 'Signature does not match. Either the secret is wrong or the token has been tampered with.'}
                  </span>
                </p>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div class="field">
            <label class="field__label" for="jwt-payload">
              <span>Payload</span>
              <span class="field__hint">A JSON object of claims</span>
            </label>
            <textarea
              id="jwt-payload"
              class="textarea textarea--short"
              spellcheck={false}
              autocomplete="off"
              value={payloadDraft}
              aria-invalid={signError !== null}
              onInput={(event) => setPayloadDraft((event.target as HTMLTextAreaElement).value)}
            />
          </div>

          <div class="field">
            <label class="field__label" for="jwt-sign-secret">
              <span>Signing secret (HS256)</span>
            </label>
            <input
              id="jwt-sign-secret"
              class="input"
              type="password"
              spellcheck={false}
              autocomplete="off"
              value={signSecret}
              onInput={(event) => setSignSecret((event.target as HTMLInputElement).value)}
            />
          </div>

          <div class="tool-bar">
            <button type="button" class="btn btn--primary" onClick={() => void sign()}>
              Sign token
            </button>
          </div>

          <ErrorMessage message={signError} />

          <OutputPane
            label="Signed JWT"
            value={signed}
            placeholder="The signed token appears here."
            describe="token"
          />
        </>
      )}

      <style>{`
        .jwt-token { word-break: break-all; }
        .claims {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-3);
        }
        .claims__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
        }
        .claims__grid {
          display: grid; grid-template-columns: minmax(9rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0; font-size: var(--text-sm);
        }
        .claims__grid dt { color: var(--text-muted); }
        .claims__grid dd { margin: 0; word-break: break-word; }
      `}</style>
    </div>
  );
}
