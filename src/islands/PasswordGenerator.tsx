import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import {
  generatePassword,
  generatePasswords,
  passwordEntropyBits,
  passwordStrength,
  DEFAULT_PASSWORD_OPTIONS,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  type PasswordOptions,
} from '../lib/tools/password';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { CopyButton } from './shared/CopyButton';
import { DownloadButton } from './shared/DownloadButton';

// Deliberately no ShareLinkButton — the output is a password. Sharing the generated value
// defeats the tool, and even sharing only the settings would produce a URL that looks like
// it carries the password, which is a trap worth not setting. No "Load example" either:
// the whole point is fresh randomness, so there is no meaningful sample input (same
// exemption AGENTS.md grants the UUID Generator).

type CharsetKey = 'uppercase' | 'lowercase' | 'numbers' | 'symbols';

const CHARSET_TOGGLES: { key: CharsetKey; label: string; hint: string }[] = [
  { key: 'uppercase', label: 'A-Z', hint: 'Uppercase letters' },
  { key: 'lowercase', label: 'a-z', hint: 'Lowercase letters' },
  { key: 'numbers', label: '0-9', hint: 'Digits' },
  { key: 'symbols', label: '!@#', hint: 'Symbols' },
];

export default function PasswordGenerator() {
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [batchCount, setBatchCount] = useState(10);
  const [batch, setBatch] = useState<string[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);

  const generate = useCallback((opts: PasswordOptions) => {
    const result = generatePassword(opts);
    if (result.ok) {
      setPassword(result.value);
      setError(null);
    } else {
      setPassword('');
      setError(result.error);
    }
  }, []);

  // Generate a password immediately, and again whenever the options change, so the
  // tool always shows something that matches the current settings.
  useEffect(() => {
    generate(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on option change
  }, [options]);

  const toggleCharset = (key: CharsetKey) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const entropy = useMemo(() => passwordEntropyBits(options), [options]);
  const strength = useMemo(() => passwordStrength(entropy), [entropy]);
  const strengthPercent = Math.min(100, Math.round((entropy / 100) * 100));

  const generateBatch = () => {
    const result = generatePasswords(batchCount, options);
    if (result.ok) {
      setBatch(result.value);
      setBatchError(null);
    } else {
      setBatch([]);
      setBatchError(result.error);
    }
  };

  const batchOutput = batch.join('\n');

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="field" style="flex:1 1 14rem">
          <label class="field__label" for="password-length">
            <span>Length</span>
            <span class="field__hint tnum">{options.length} characters</span>
          </label>
          <input
            id="password-length"
            type="range"
            min={MIN_PASSWORD_LENGTH}
            max={MAX_PASSWORD_LENGTH}
            value={options.length}
            style="width:100%;accent-color:var(--accent)"
            onInput={(event) =>
              setOptions((prev) => ({ ...prev, length: Number((event.target as HTMLInputElement).value) }))
            }
          />
        </div>

        <button
          type="button"
          class="btn btn--primary"
          onClick={() => generate(options)}
          title="Create a new password with the current settings"
        >
          <span aria-hidden="true">↻</span> Generate
        </button>
      </div>

      <div class="tool-bar" role="group" aria-label="Character types">
        {CHARSET_TOGGLES.map(({ key, label, hint }) => (
          <button
            key={key}
            type="button"
            class="seg__btn charset-btn"
            aria-pressed={options[key]}
            title={hint}
            onClick={() => toggleCharset(key)}
          >
            {label}
          </button>
        ))}
        <label class="checkbox" title="Skip characters that are easy to misread, like 0/O and 1/l/I">
          <input
            type="checkbox"
            checked={options.excludeAmbiguous}
            onChange={() => setOptions((prev) => ({ ...prev, excludeAmbiguous: !prev.excludeAmbiguous }))}
          />
          <span>Exclude ambiguous characters</span>
        </label>
      </div>

      <ErrorMessage message={error} />

      {password && (
        <div class="field">
          <div class="field__label">
            <span>Password</span>
            <CopyButton value={password} describe="password" />
          </div>
          <output class="password-display tnum" aria-live="polite">
            {password}
          </output>
          <div class="strength">
            <div class="strength__bar">
              <div class={`strength__fill strength__fill--${strength.tone}`} style={`width:${strengthPercent}%`} />
            </div>
            <span class={`badge badge--${strength.tone}`}>{strength.label}</span>
            <span class="field__hint">~{strength.bits} bits of entropy</span>
          </div>
        </div>
      )}

      <hr style="border:0;border-top:1px solid var(--border);margin:0" />

      <div class="tool-bar">
        <label class="checkbox" title="How many passwords to create the next time you press Generate batch">
          <span class="field__hint">Batch size</span>
          <input
            type="number"
            class="input"
            style="width:6rem"
            min={1}
            max={100}
            value={batchCount}
            aria-label="Number of passwords to generate"
            onInput={(event) => setBatchCount(Number((event.target as HTMLInputElement).value))}
          />
        </label>
        <button type="button" class="btn" onClick={generateBatch} title="Generate several passwords at once, e.g. for provisioning several accounts">
          Generate batch
        </button>
        <span class="tool-bar__spacer" />
        <DownloadButton value={batchOutput} filename="passwords.txt" describe="passwords" />
      </div>

      <ErrorMessage message={batchError} />

      {batch.length > 0 && (
        <OutputPane label="Batch" value={batchOutput} placeholder="" describe="passwords" tall />
      )}

      <style>{`
        .charset-btn { min-width: 3.5rem; }
        .password-display {
          display: block;
          padding: 0.75rem 1rem;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface-2);
          font-family: var(--font-mono);
          font-size: var(--text-lg);
          letter-spacing: 0.04em;
          word-break: break-all;
        }
        .strength { display: flex; align-items: center; gap: var(--space-3); }
        .strength__bar {
          flex: 1 1 auto; height: 0.4rem; border-radius: 99px;
          background: var(--surface-3); overflow: hidden; min-width: 4rem;
        }
        .strength__fill { height: 100%; transition: width 0.15s ease; }
        .strength__fill--error { background: var(--danger); }
        .strength__fill--warning { background: var(--warning); }
        .strength__fill--success { background: var(--success); }
        .badge {
          font-size: var(--text-xs); font-weight: 600; padding: .1em .6em;
          border-radius: 99px; border: 1px solid; white-space: nowrap;
        }
        .badge--success { color: var(--success); background: var(--success-subtle); border-color: var(--success-border); }
        .badge--warning { color: var(--warning); background: var(--warning-subtle); border-color: var(--warning-border); }
        .badge--error { color: var(--danger); background: var(--danger-subtle); border-color: var(--danger-border); }
      `}</style>
    </div>
  );
}
