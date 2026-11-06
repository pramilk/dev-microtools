import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  analyzePhishingEmail,
  formatReport,
  type AuthResults,
  type FindingCategory,
  type PhishingFinding,
  type RiskLevel,
  type Severity,
} from '../lib/tools/phishingEmail';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

// Matches the worked example in phishing-email-checker.mdx exactly, so the page and the
// button can never drift apart. All addresses use reserved example domains.
const SAMPLE_EMAIL = [
  'From: "PayPal Support" <service@paypa1-secure.top>',
  'Reply-To: helpdesk@mail-recovery.example',
  'Return-Path: <bounce@mailer.example.net>',
  'To: you@example.com',
  'Subject: Urgent: your account has been suspended',
  'Date: Tue, 03 Nov 2026 08:14:09 +0000',
  'Message-ID: <8841.2210@mailer.example.net>',
  'Authentication-Results: mx.example.com; spf=fail smtp.mailfrom=mailer.example.net; dkim=none; dmarc=fail header.from=paypa1-secure.top',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Dear customer,</p>',
  '<p>We detected unauthorized activity. Your account will be closed within 24 hours unless you verify your password immediately.</p>',
  '<p><a href="http://198.51.100.7/login">https://www.paypal.com/verify</a></p>',
].join('\n');

/** Above this many characters, analysis waits for typing to pause so a big paste stays responsive. */
const DEBOUNCE_ABOVE = 20_000;
const DEBOUNCE_MS = 250;

interface ShareState {
  input: string;
}

const LEVEL_STYLE: Record<RiskLevel, { cls: string; icon: string }> = {
  high: { cls: 'msg--error', icon: '✕' },
  elevated: { cls: 'msg--warning', icon: '!' },
  low: { cls: 'msg--info', icon: 'i' },
};

const SEVERITY_LABEL: Record<Severity, string> = {
  danger: 'Danger',
  warning: 'Warning',
  info: 'Note',
  ok: 'OK',
};

const CATEGORY_LABEL: Record<FindingCategory, string> = {
  sender: 'Sender',
  authentication: 'Authentication (SPF · DKIM · DMARC)',
  links: 'Links',
  content: 'Message content',
  attachments: 'Attachments',
};

const CATEGORY_ORDER: FindingCategory[] = ['sender', 'authentication', 'links', 'content', 'attachments'];

function FindingRow({ item }: { item: PhishingFinding }) {
  return (
    <li class={`pec-finding pec-finding--${item.severity}`}>
      <span class="pec-finding__tag">{SEVERITY_LABEL[item.severity]}</span>
      <div>
        <p class="pec-finding__title">{item.title}</p>
        <p class="pec-finding__detail">{item.detail}</p>
      </div>
    </li>
  );
}

function authClass(kind: 'spf' | 'dkim' | 'dmarc', value: string | null): string {
  if (!value) return 'pec-pill';
  if (value === 'pass') return 'pec-pill pec-pill--ok';
  if (value === 'fail') return 'pec-pill pec-pill--danger';
  if (value === 'softfail' || (kind === 'dkim' && value === 'permerror')) return 'pec-pill pec-pill--warning';
  return 'pec-pill';
}

function AuthPills({ auth }: { auth: AuthResults }) {
  return (
    <span class="pec-pills">
      {(['spf', 'dkim', 'dmarc'] as const).map((kind) => (
        <span key={kind} class={authClass(kind, auth[kind])}>
          {kind.toUpperCase()}: {auth[kind] ?? 'not recorded'}
        </span>
      ))}
    </span>
  );
}

/** Steps for getting the full message source out of the two most common mail apps. */
function RawEmailHelp({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  return (
    <details class="pec-help" open={open} onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>How do I get the raw email? (Gmail, Outlook)</summary>
      <div class="pec-help__grid">
        <section>
          <h3>Gmail</h3>
          <ol>
            <li>Open the suspicious email. Do not click anything inside it.</li>
            <li>
              Click the <strong>⋮ More</strong> menu (three dots) at the top right of the message, next to Reply.
            </li>
            <li>
              Choose <strong>Show original</strong>. A new tab opens with the full source.
            </li>
            <li>
              Click <strong>Copy to clipboard</strong>, then paste it into the box above. (<strong>Download original</strong> saves a{' '}
              <code>.eml</code> file you can drop onto the box instead.)
            </li>
          </ol>
        </section>
        <section>
          <h3>Outlook on the web &amp; new Outlook</h3>
          <ol>
            <li>Open the message, or select it in the list.</li>
            <li>
              Click <strong>⋯ More actions</strong> at the top right of the message.
            </li>
            <li>
              Choose <strong>View</strong> → <strong>View message source</strong>.
            </li>
            <li>Select everything in the window that opens (Ctrl+A), copy it and paste it into the box above.</li>
          </ol>
        </section>
        <section>
          <h3>Outlook for Windows (classic)</h3>
          <ol>
            <li>Double-click the message so it opens in its own window.</li>
            <li>
              Choose <strong>File</strong> → <strong>Properties</strong>.
            </li>
            <li>
              Copy the whole <strong>Internet headers</strong> box at the bottom and paste it above.
            </li>
          </ol>
          <p class="pec-help__note">
            This gives the headers only: enough to check the sender and SPF/DKIM/DMARC, but not the links or attachments. To check those
            too, paste the message text below the headers.
          </p>
        </section>
      </div>
      <p class="pec-help__note">
        Always use the original source, not a forwarded copy. Forwarding rewrites the headers and hides the evidence. Prefer{' '}
        <strong>Forward as attachment</strong> if you must send it to someone else.
      </p>
    </details>
  );
}

export default function PhishingEmailChecker() {
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  // Restore a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input ?? '');
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  useEffect(() => {
    if (input.length <= DEBOUNCE_ABOVE) {
      setDebounced(input);
      return undefined;
    }
    const timer = setTimeout(() => setDebounced(input), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const drop = useTextFileDrop(setInput);

  const effective = input.length <= DEBOUNCE_ABOVE ? input : debounced;
  const result = useMemo(() => (effective.trim() === '' ? null : analyzePhishingEmail(effective)), [effective]);
  const analysis = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;
  const report = useMemo(() => (analysis ? formatReport(analysis) : ''), [analysis]);

  const grouped = useMemo(() => {
    if (!analysis) return [];
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: analysis.findings.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0);
  }, [analysis]);

  const style = analysis ? LEVEL_STYLE[analysis.level] : null;

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input })} describe="this email check (the pasted email is stored inside the link)" />
        <CopyButton value={report} label="Copy report" describe="phishing check report" />
        <button
          type="button"
          class="btn"
          onClick={() => setInput(SAMPLE_EMAIL)}
          title="Fill in a sample phishing email so you can see what the tool reports"
        >
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the pasted email">
          Clear
        </button>
      </div>

      {/* Collapsed by default, but highlighted: most visitors have never had to find an email's source. */}
      <RawEmailHelp open={helpOpen} onToggle={setHelpOpen} />

      <div class="field">
        <label class="field__label" for="pec-input">
          <span>Email source</span>
          <span class="field__hint">Full message with headers works best. Drop a .eml file here too.</span>
        </label>
        <textarea
          id="pec-input"
          class={`textarea textarea--tall${drop.isDragActive ? ' textarea--drag-active' : ''}`}
          spellcheck={false}
          autocomplete="off"
          placeholder={'Paste the raw email here, starting with "Delivered-To:" or "From:"…'}
          value={input}
          aria-invalid={error !== null}
          onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          {...drop.dropHandlers}
        />
      </div>

      <ErrorMessage message={error} />

      {analysis && style && (
        <div class="pec-result">
          <div class={`msg ${style.cls} pec-verdict`} role="status">
            <span class="msg__icon" aria-hidden="true">
              {style.icon}
            </span>
            <div>
              <p class="pec-verdict__headline">{analysis.headline}</p>
              <p class="pec-verdict__summary">{analysis.summary}</p>
              <p class="pec-verdict__score">Risk score: {analysis.score} / 100</p>
            </div>
          </div>

          {analysis.message.hasHeaders && (
            <div class="pec-card">
              <h3 class="pec-card__title">Message details</h3>
              <dl class="pec-grid">
                {analysis.message.from && (
                  <>
                    <dt>From</dt>
                    <dd>
                      {analysis.message.from.displayName && <span>{analysis.message.from.displayName} </span>}
                      <code>{analysis.message.from.address}</code>
                    </dd>
                  </>
                )}
                {analysis.message.replyTo && (
                  <>
                    <dt>Reply-To</dt>
                    <dd>
                      <code>{analysis.message.replyTo.address}</code>
                    </dd>
                  </>
                )}
                {analysis.message.returnPath && (
                  <>
                    <dt>Return-Path</dt>
                    <dd>
                      <code>{analysis.message.returnPath.address}</code>
                    </dd>
                  </>
                )}
                {analysis.message.subject && (
                  <>
                    <dt>Subject</dt>
                    <dd>{analysis.message.subject}</dd>
                  </>
                )}
                {analysis.message.date && (
                  <>
                    <dt>Date</dt>
                    <dd>{analysis.message.date}</dd>
                  </>
                )}
                <dt>Authentication</dt>
                <dd>{analysis.auth.present ? <AuthPills auth={analysis.auth} /> : 'No results recorded in these headers'}</dd>
              </dl>
            </div>
          )}

          {grouped.length === 0 ? (
            <p class="msg msg--info" role="status">
              <span class="msg__icon" aria-hidden="true">
                i
              </span>
              <span>Nothing suspicious was found in the parts of the message that could be checked.</span>
            </p>
          ) : (
            grouped.map((group) => (
              <div class="pec-card" key={group.category}>
                <h3 class="pec-card__title">{CATEGORY_LABEL[group.category]}</h3>
                <ul class="pec-findings">
                  {group.items.map((item) => (
                    <FindingRow key={item.id} item={item} />
                  ))}
                </ul>
              </div>
            ))
          )}

          {analysis.links.length > 0 && (
            <div class="pec-card">
              <h3 class="pec-card__title">Links found ({analysis.links.length})</h3>
              <p class="pec-note">Shown as plain text on purpose, so nothing here can be clicked by accident.</p>
              <ul class="pec-links">
                {analysis.links.map((link, index) => (
                  <li key={`${link.href}-${index}`} class={`pec-link pec-link--${link.severity}`}>
                    {link.text && <span class="pec-link__text">Shown as: {link.text}</span>}
                    <code class="pec-link__href">{link.href}</code>
                    {link.flags.length > 0 && <span class="pec-link__flags">{link.flags.join(' · ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.attachments.length > 0 && (
            <div class="pec-card">
              <h3 class="pec-card__title">Attachments ({analysis.attachments.length})</h3>
              <ul class="pec-links">
                {analysis.attachments.map((attachment, index) => (
                  <li key={`${attachment.filename}-${index}`} class={`pec-link pec-link--${attachment.severity}`}>
                    <code class="pec-link__href">{attachment.filename}</code>
                    {attachment.reason && <span class="pec-link__flags">{attachment.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.hops.length > 0 && (
            <div class="pec-card">
              <h3 class="pec-card__title">Route the message took (oldest first)</h3>
              <ol class="pec-hops">
                {analysis.hops.map((hop, index) => (
                  <li key={index}>
                    <code>{hop.from ?? 'unknown'}</code> → <code>{hop.by ?? 'unknown'}</code>
                    {hop.ip && <span class="pec-hop__ip"> [{hop.ip}]</span>}
                    {hop.date && <span class="pec-hop__date"> · {hop.date}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p class="field__hint">
            This check runs entirely in your browser and never contacts any address in the email. That also means it cannot look up
            domain reputation or age, or verify SPF/DKIM itself: it reads the results your mail provider already recorded. A low score
            is not proof an email is genuine.
          </p>
        </div>
      )}

      <style>{`
        .pec-help {
          border: 1px solid var(--accent); border-left-width: 4px; border-radius: var(--radius);
          background: var(--accent-subtle); padding: var(--space-3) var(--space-4);
        }
        .pec-help > summary {
          cursor: pointer; font-weight: 700; font-size: var(--text-sm); color: var(--accent);
        }
        .pec-help > summary::marker { color: var(--accent); }
        .pec-help > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .pec-help__grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
          gap: var(--space-4); margin-top: var(--space-3);
        }
        .pec-help h3 { margin: 0 0 var(--space-2); font-size: var(--text-sm); }
        .pec-help ol { margin: 0; padding-left: 1.25rem; font-size: var(--text-sm); color: var(--text-muted); display: flex; flex-direction: column; gap: var(--space-1); }
        .pec-help strong { color: var(--text); }
        .pec-help code { font-family: var(--font-mono); font-size: var(--text-xs); }
        .pec-help__note { margin: var(--space-3) 0 0; font-size: var(--text-sm); color: var(--text-muted); }
        .pec-result { display: flex; flex-direction: column; gap: var(--space-3); }
        .pec-verdict { align-items: flex-start; }
        .pec-verdict__headline { margin: 0; font-weight: 700; font-size: var(--text-base); }
        .pec-verdict__summary { margin: var(--space-1) 0 0; color: var(--text); }
        .pec-verdict__score { margin: var(--space-2) 0 0; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }
        .pec-card {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-3);
        }
        .pec-card__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
        }
        .pec-grid {
          display: grid; grid-template-columns: minmax(8rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0; font-size: var(--text-sm);
        }
        .pec-grid dt { font-family: var(--font-mono); color: var(--text-muted); font-size: var(--text-xs); letter-spacing: .06em; align-self: center; }
        .pec-grid dd { margin: 0; word-break: break-word; }
        .pec-grid code, .pec-link__href, .pec-hops code { font-family: var(--font-mono); font-size: var(--text-xs); }
        .pec-pills { display: inline-flex; flex-wrap: wrap; gap: var(--space-2); }
        .pec-pill {
          font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 600;
          padding: .1em .6em; border-radius: 99px; border: 1px solid var(--border); color: var(--text-muted);
        }
        .pec-pill--ok { color: var(--success); background: var(--success-subtle); border-color: var(--success-border); }
        .pec-pill--warning { color: var(--warning); background: var(--warning-subtle); border-color: var(--warning-border); }
        .pec-pill--danger { color: var(--danger); background: var(--danger-subtle); border-color: var(--danger-border); }
        .pec-findings, .pec-links { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
        .pec-finding { display: grid; grid-template-columns: 4.5rem 1fr; gap: var(--space-3); align-items: start; }
        .pec-finding__tag {
          font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 700;
          text-transform: uppercase; text-align: center; padding: 2px var(--space-2);
          border-radius: var(--radius-sm, 4px); border: 1px solid var(--border);
        }
        .pec-finding--danger .pec-finding__tag { color: var(--danger); background: var(--danger-subtle); border-color: var(--danger-border); }
        .pec-finding--warning .pec-finding__tag { color: var(--warning); background: var(--warning-subtle); border-color: var(--warning-border); }
        .pec-finding--ok .pec-finding__tag { color: var(--success); background: var(--success-subtle); border-color: var(--success-border); }
        .pec-finding--info .pec-finding__tag { color: var(--text-muted); background: var(--surface); }
        .pec-finding__title { margin: 0; font-weight: 600; color: var(--text); font-size: var(--text-sm); }
        .pec-finding__detail { margin: var(--space-1) 0 0; color: var(--text-muted); font-size: var(--text-sm); }
        .pec-note { margin: 0; color: var(--text-muted); font-size: var(--text-sm); }
        .pec-link { display: flex; flex-direction: column; gap: 2px; padding-left: var(--space-3); border-left: 3px solid var(--border); }
        .pec-link--danger { border-left-color: var(--danger); }
        .pec-link--warning { border-left-color: var(--warning); }
        .pec-link--info { border-left-color: var(--text-subtle); }
        .pec-link__text { font-size: var(--text-sm); color: var(--text-muted); word-break: break-word; }
        .pec-link__href { word-break: break-all; color: var(--text); }
        .pec-link__flags { font-size: var(--text-xs); color: var(--text-muted); }
        .pec-hops { margin: 0; padding-left: 1.25rem; font-size: var(--text-sm); display: flex; flex-direction: column; gap: var(--space-1); }
        .pec-hop__ip, .pec-hop__date { color: var(--text-muted); font-size: var(--text-xs); }
        @media (max-width: 36rem) {
          .pec-finding { grid-template-columns: 1fr; gap: var(--space-1); }
          .pec-finding__tag { justify-self: start; }
          .pec-grid { grid-template-columns: 1fr; gap: 0; }
          .pec-grid dd { margin-bottom: var(--space-2); }
        }
      `}</style>
    </div>
  );
}
