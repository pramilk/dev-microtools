import { useEffect, useMemo, useState } from 'preact/hooks';
import { parseUserAgent, currentUserAgent, explainUaTokens } from '../lib/tools/userAgent';
import { extractShareFragment, readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

interface ShareState {
  input: string;
}

const DEVICE_LABELS: Record<string, string> = {
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
  bot: 'Bot / crawler',
};

export default function UserAgentParser() {
  const [input, setInput] = useState('');

  const useMine = () => setInput(currentUserAgent() ?? '');

  // Show something useful the moment the page loads, with zero typing required — unless
  // the page was opened from a share link, in which case the shared UA is what the visitor
  // came to see. The fragment is checked synchronously so the shared value never flashes
  // past the visitor's own UA first (decoding it is async).
  useEffect(() => {
    if (extractShareFragment(window.location.hash) === null) {
      useMine();
      return;
    }
    void readShareStateFromLocation<ShareState>().then((restored) => {
      // A corrupt or truncated fragment falls back to the browser's own UA rather than
      // leaving the tool empty with no explanation.
      if (!restored?.ok) {
        useMine();
        return;
      }
      setInput(restored.value.input);
      history.replaceState(null, '', window.location.pathname);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first render only
  }, []);

  const result = useMemo(() => (input.trim() === '' ? null : parseUserAgent(input)), [input]);
  const value = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;

  const tokenSegments = useMemo(() => (value ? explainUaTokens(input) : []), [input, value]);
  const glossary = useMemo(() => {
    const seen = new Set<string>();
    const entries: { label: string; explain: string }[] = [];
    for (const segment of tokenSegments) {
      if (segment.label && segment.explain && !seen.has(segment.label)) {
        seen.add(segment.label);
        entries.push({ label: segment.label, explain: segment.explain });
      }
    }
    return entries;
  }, [tokenSegments]);

  return (
    <div class="tool">
      <div class="field">
        <label class="field__label" for="ua-input">
          <span>User-Agent string</span>
          <span class="field__hint">Paste one, or use your browser's own</span>
        </label>
        <textarea
          id="ua-input"
          class="textarea textarea--short"
          spellcheck={false}
          autocomplete="off"
          placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ..."
          value={input}
          aria-invalid={error !== null}
          onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
        />
      </div>

      <div class="tool-bar">
        <button type="button" class="btn" onClick={useMine} title="Fill in the User-Agent your own browser is sending right now">
          Use my browser's User-Agent
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input })} describe="this User-Agent string" />
        <CopyButton value={input} describe="User-Agent string" />
      </div>

      <ErrorMessage message={error} />

      {value && (
        <dl class="ua-grid">
          <dt>Browser</dt>
          <dd>
            {value.browser.name}
            {value.browser.version && ` ${value.browser.version}`}
          </dd>

          <dt>Operating system</dt>
          <dd>
            {value.os.name}
            {value.os.version && ` ${value.os.version}`}
          </dd>

          <dt>Rendering engine</dt>
          <dd>{value.engine}</dd>

          <dt>Device type</dt>
          <dd>
            <span class={`badge badge--${value.device === 'bot' ? 'warning' : 'success'}`}>
              {DEVICE_LABELS[value.device]}
            </span>
          </dd>

          {value.deviceModel && (
            <>
              <dt>Device model</dt>
              <dd>{value.deviceModel}</dd>
            </>
          )}

          {value.architecture && (
            <>
              <dt>CPU architecture</dt>
              <dd>{value.architecture}</dd>
            </>
          )}

          {value.inApp && (
            <>
              <dt>In-app browser</dt>
              <dd>
                <span class="badge badge--warning">{value.inApp}</span>
              </dd>
            </>
          )}
        </dl>
      )}

      {value && glossary.length > 0 && (
        <div class="field">
          <span class="field__label">What each part means</span>
          <div class="token-string" aria-label="Recognised parts of the User-Agent string, highlighted">
            {tokenSegments.map((segment, index) =>
              segment.label ? (
                <mark key={index} class="token-mark" title={segment.explain ?? undefined}>
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
          </div>
          <dl class="token-glossary">
            {glossary.map((entry) => (
              <>
                <dt key={`t-${entry.label}`}>{entry.label}</dt>
                <dd key={`e-${entry.label}`}>{entry.explain}</dd>
              </>
            ))}
          </dl>
        </div>
      )}

      <style>{`
        .ua-grid {
          display: grid; grid-template-columns: minmax(9rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4); font-size: var(--text-sm);
        }
        .ua-grid dt {
          font-family: var(--font-mono); color: var(--text-muted);
          font-size: var(--text-xs); letter-spacing: .06em; align-self: center;
        }
        .ua-grid dd { margin: 0; align-self: center; }
        .badge {
          font-size: var(--text-xs); font-weight: 600; padding: .1em .6em;
          border-radius: 99px; border: 1px solid;
        }
        .badge--success { color: var(--success); background: var(--success-subtle); border-color: var(--success-border); }
        .badge--warning { color: var(--warning); background: var(--warning-subtle); border-color: var(--warning-border); }
        .token-string {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface-2); padding: var(--space-3);
          font-family: var(--font-mono); font-size: var(--text-sm);
          white-space: pre-wrap; word-break: break-word; line-height: 1.7;
        }
        .token-mark {
          background: var(--accent-subtle); color: var(--text);
          border-bottom: 2px solid var(--accent); border-radius: 2px; padding: 0 1px;
          cursor: help;
        }
        .token-glossary {
          display: grid; grid-template-columns: minmax(9rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4); font-size: var(--text-sm);
        }
        .token-glossary dt {
          font-family: var(--font-mono); color: var(--text-muted);
          font-size: var(--text-xs); letter-spacing: .06em; font-weight: 600;
        }
        .token-glossary dd { margin: 0; color: var(--text-muted); line-height: 1.5; }
      `}</style>
    </div>
  );
}
