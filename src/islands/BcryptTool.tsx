import { useState } from 'preact/hooks';
import { MIN_BCRYPT_ROUNDS, MAX_BCRYPT_ROUNDS } from '../lib/tools/bcrypt';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { useWorkerTask } from './shared/useWorkerTask';
import BcryptWorker from '../workers/bcrypt.worker?worker';
import type { BcryptWorkerRequest, BcryptWorkerResult } from '../workers/bcrypt.worker';

type Mode = 'generate' | 'verify';

const DEFAULT_ROUNDS = 10;
const SAMPLE_PASSWORD = 'hunter2';

// Deliberately no ShareLinkButton — every field on this tool is a password or a hash of
// one, and this project never puts a secret in a shareable URL (same reasoning as the
// HMAC key field on Hash Generator). "Load example" is still offered in both modes,
// since a placeholder demo string carries none of that risk.

export default function BcryptTool() {
  const [mode, setMode] = useState<Mode>('generate');
  const bcryptWorkerTask = useWorkerTask<BcryptWorkerRequest, BcryptWorkerResult>(() => new BcryptWorker());

  const [password, setPassword] = useState('');
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);
  const [hash, setHash] = useState('');
  const [genError, setGenError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);

  const [verifyPw, setVerifyPw] = useState('');
  const [verifyHash, setVerifyHash] = useState('');
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);

  const generate = async () => {
    setGenBusy(true);
    try {
      const result = await bcryptWorkerTask.run({ kind: 'hash', password, rounds });
      if (result.kind !== 'hash') throw new Error('Unexpected worker response.');
      setHash(result.value);
      setGenError(null);
    } catch (thrown) {
      setHash('');
      setGenError(thrown instanceof Error ? thrown.message : 'Could not compute the bcrypt hash.');
    } finally {
      setGenBusy(false);
    }
  };

  const clearGenerate = () => {
    setPassword('');
    setRounds(DEFAULT_ROUNDS);
    setHash('');
    setGenError(null);
  };

  const verify = async () => {
    setVerifyBusy(true);
    try {
      const result = await bcryptWorkerTask.run({ kind: 'verify', password: verifyPw, hash: verifyHash });
      if (result.kind !== 'verify') throw new Error('Unexpected worker response.');
      setVerifyResult(result.value);
      setVerifyError(null);
    } catch (thrown) {
      setVerifyResult(null);
      setVerifyError(thrown instanceof Error ? thrown.message : 'Could not verify that hash.');
    } finally {
      setVerifyBusy(false);
    }
  };

  const clearVerify = () => {
    setVerifyPw('');
    setVerifyHash('');
    setVerifyResult(null);
    setVerifyError(null);
  };

  const [exampleBusy, setExampleBusy] = useState(false);

  /**
   * In Generate mode, just fills the password field. In Verify mode, computes a real
   * matching hash for the sample password on the spot — a hardcoded example hash would
   * be a lie about what a fresh bcrypt hash of that password actually looks like, since
   * every hash embeds a fresh random salt.
   */
  const loadExample = async () => {
    if (mode === 'generate') {
      setPassword(SAMPLE_PASSWORD);
      return;
    }
    setExampleBusy(true);
    try {
      const result = await bcryptWorkerTask.run({ kind: 'hash', password: SAMPLE_PASSWORD, rounds: DEFAULT_ROUNDS });
      if (result.kind !== 'hash') throw new Error('Unexpected worker response.');
      setVerifyPw(SAMPLE_PASSWORD);
      setVerifyHash(result.value);
      setVerifyResult(null);
      setVerifyError(null);
    } finally {
      setExampleBusy(false);
    }
  };

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Mode">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={mode === 'generate'}
            onClick={() => setMode('generate')}
            title="Hash a password with bcrypt"
          >
            Generate
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={mode === 'verify'}
            onClick={() => setMode('verify')}
            title="Check a password against an existing bcrypt hash"
          >
            Verify
          </button>
        </div>
        <span class="tool-bar__spacer" />
        <button
          type="button"
          class="btn"
          onClick={() => void loadExample()}
          disabled={exampleBusy}
          title={
            mode === 'generate'
              ? 'Fill in a sample password'
              : 'Fill in a sample password and a freshly computed matching hash'
          }
        >
          Load example
        </button>
      </div>

      {exampleBusy && (
        <p class="field__hint">
          <span class="job__spinner" aria-hidden="true" /> Computing a sample hash…
        </p>
      )}

      <p class="msg msg--info">
        <span class="msg__icon" aria-hidden="true">
          i
        </span>
        <span>
          For local development use — checking a hash from a test fixture, seed file or database
          column. Real authentication must hash and verify passwords on the server; a production
          login should never send a plaintext password to a client-side tool like this one.
        </span>
      </p>

      {mode === 'generate' ? (
        <>
          <div class="field">
            <label class="field__label" for="bcrypt-password">
              <span>Password</span>
            </label>
            <input
              id="bcrypt-password"
              class="input"
              type="password"
              spellcheck={false}
              autocomplete="off"
              placeholder="Password to hash…"
              value={password}
              onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
            />
          </div>

          <div class="field">
            <label
              class="field__label"
              for="bcrypt-rounds"
              title="The bcrypt cost factor: the password is hashed 2^rounds times. Higher rounds make each hash slower to compute, which is exactly what makes brute-forcing it slower too."
            >
              <span>Rounds</span>
              <span class="field__hint">{rounds}</span>
            </label>
            <input
              id="bcrypt-rounds"
              class="input"
              type="number"
              style="max-width: 8rem"
              min={MIN_BCRYPT_ROUNDS}
              max={MAX_BCRYPT_ROUNDS}
              value={rounds}
              title="The bcrypt cost factor: the password is hashed 2^rounds times. Higher rounds make each hash slower to compute, which is exactly what makes brute-forcing it slower too."
              onInput={(event) => setRounds(Number((event.target as HTMLInputElement).value))}
            />
            <span class="field__hint">
              Cost factor — higher is slower but more secure. Capped at {MAX_BCRYPT_ROUNDS} so hashing
              in the browser doesn't freeze the tab.
            </span>
          </div>

          <div class="tool-bar">
            <button
              type="button"
              class="btn btn--primary"
              onClick={() => void generate()}
              disabled={password === '' || genBusy}
            >
              Generate hash
            </button>
            <button type="button" class="btn" onClick={clearGenerate} disabled={password === '' && hash === ''}>
              Clear
            </button>
          </div>

          {genBusy && (
            <p class="field__hint">
              <span class="job__spinner" aria-hidden="true" /> Hashing… higher round counts take longer.
            </p>
          )}

          <ErrorMessage message={genError} />

          {hash !== '' && !genBusy && (
            <div class="field">
              <div class="field__label">
                <span>Bcrypt hash</span>
                <CopyButton value={hash} describe="bcrypt hash" />
              </div>
              <code class="output">{hash}</code>
            </div>
          )}
        </>
      ) : (
        <>
          <div class="field">
            <label class="field__label" for="bcrypt-verify-password">
              <span>Password</span>
            </label>
            <input
              id="bcrypt-verify-password"
              class="input"
              type="password"
              spellcheck={false}
              autocomplete="off"
              placeholder="Password to check…"
              value={verifyPw}
              onInput={(event) => setVerifyPw((event.target as HTMLInputElement).value)}
            />
          </div>

          <div class="field">
            <label class="field__label" for="bcrypt-verify-hash">
              <span>Bcrypt hash</span>
            </label>
            <input
              id="bcrypt-verify-hash"
              class="input"
              spellcheck={false}
              autocomplete="off"
              placeholder="$2a$10$…"
              value={verifyHash}
              onInput={(event) => setVerifyHash((event.target as HTMLInputElement).value)}
            />
          </div>

          <div class="tool-bar">
            <button
              type="button"
              class="btn btn--primary"
              onClick={() => void verify()}
              disabled={verifyPw === '' || verifyHash === '' || verifyBusy}
            >
              Verify hash
            </button>
            <button
              type="button"
              class="btn"
              onClick={clearVerify}
              disabled={verifyPw === '' && verifyHash === ''}
            >
              Clear
            </button>
          </div>

          {verifyBusy && (
            <p class="field__hint">
              <span class="job__spinner" aria-hidden="true" /> Checking…
            </p>
          )}

          <ErrorMessage message={verifyError} />

          {verifyResult !== null &&
            !verifyBusy &&
            (verifyResult ? (
              <p class="msg msg--success">
                <span class="msg__icon" aria-hidden="true">
                  ✓
                </span>
                <span>Match — this password produces that hash.</span>
              </p>
            ) : (
              <p class="msg msg--warning">
                <span class="msg__icon" aria-hidden="true">
                  !
                </span>
                <span>Does not match.</span>
              </p>
            ))}
        </>
      )}
    </div>
  );
}
