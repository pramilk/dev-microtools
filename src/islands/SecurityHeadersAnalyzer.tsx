import { useEffect, useMemo, useState } from 'preact/hooks';
import { analyzeSecurityHeaders, formatHeadersReport, type Grade } from '../lib/tools/securityHeaders';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { FindingList } from './shared/FindingList';
import { CollapsibleHelp } from './shared/CollapsibleHelp';
import { useTextFileDrop } from './shared/useTextFileDrop';

// Matches the worked example in security-headers-analyzer.mdx exactly, so the page and the
// button can never drift apart.
const SAMPLE_HEADERS = [
  'HTTP/2 200',
  'content-type: text/html; charset=utf-8',
  'server: nginx/1.18.0',
  'x-powered-by: Express',
  'strict-transport-security: max-age=300',
  "content-security-policy: default-src *; script-src 'self' 'unsafe-inline'",
  'x-xss-protection: 1; mode=block',
  'set-cookie: sessionid=9f2c1; Path=/',
].join('\n');

interface ShareState {
  input: string;
}

const GRADE_CLASS: Record<Grade, string> = {
  'A+': 'msg--success',
  A: 'msg--success',
  B: 'msg--info',
  C: 'msg--warning',
  D: 'msg--warning',
  F: 'msg--error',
};

const GRADE_SUMMARY: Record<Grade, string> = {
  'A+': 'Every header checked is present and sound.',
  A: 'Strong. Only minor improvements remain.',
  B: 'Good, with a few gaps worth closing.',
  C: 'Several protections are missing or weak.',
  D: 'Most protections are missing or weak.',
  F: 'Little or no protection from headers. Start with the warnings below.',
};

export default function SecurityHeadersAnalyzer() {
  const [input, setInput] = useState('');

  // Restore a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input ?? '');
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const drop = useTextFileDrop(setInput);

  const result = useMemo(() => (input.trim() === '' ? null : analyzeSecurityHeaders(input)), [input]);
  const analysis = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;
  const report = useMemo(() => (analysis ? formatHeadersReport(analysis) : ''), [analysis]);

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input })} describe="these response headers" />
        <CopyButton value={report} label="Copy report" describe="security headers report" />
        <button
          type="button"
          class="btn"
          onClick={() => setInput(SAMPLE_HEADERS)}
          title="Fill in a sample set of response headers with several common mistakes"
        >
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the pasted headers">
          Clear
        </button>
      </div>

      <CollapsibleHelp summary="How do I get the response headers? (curl, Chrome, Firefox, Safari)">
        <div class="help-callout__grid">
          <section>
            <h3>Command line</h3>
            <ol>
              <li>
                Run <code>curl -I https://your-site.example</code> in a terminal.
              </li>
              <li>
                Copy the whole output, including the first <code>HTTP/…</code> line, and paste it into the box below.
              </li>
              <li>
                Use <code>curl -sI -L</code> to follow redirects. Only the last response is graded.
              </li>
            </ol>
          </section>
          <section>
            <h3>Chrome, Edge &amp; Firefox</h3>
            <ol>
              <li>
                Open DevTools (<strong>F12</strong>) and go to the <strong>Network</strong> tab, then reload the page.
              </li>
              <li>Click the first request in the list (the page itself).</li>
              <li>
                In <strong>Headers</strong>, find <strong>Response Headers</strong>, select them all, copy and paste them below.
              </li>
            </ol>
          </section>
          <section>
            <h3>Safari</h3>
            <ol>
              <li>
                Enable <strong>Develop</strong> in Settings → Advanced, then choose Develop → Show Web Inspector.
              </li>
              <li>
                Open <strong>Network</strong>, reload, select the page request and copy its <strong>Response</strong> headers.
              </li>
            </ol>
          </section>
        </div>
        <p class="help-callout__note">
          Grade the headers of an HTML page, not an image or script, since most of these headers matter for documents. This tool only
          reads what you paste: it never contacts the site, so it grades the headers as they were when you copied them.
        </p>
      </CollapsibleHelp>

      <div class="field">
        <label class="field__label" for="sha-input">
          <span>Response headers</span>
          <span class="field__hint">Paste curl -I output or the Response Headers list. Drop a text file here too.</span>
        </label>
        <textarea
          id="sha-input"
          class={`textarea textarea--tall${drop.isDragActive ? ' textarea--drag-active' : ''}`}
          spellcheck={false}
          autocomplete="off"
          placeholder={'HTTP/2 200\ncontent-type: text/html\nstrict-transport-security: max-age=63072000\n…'}
          value={input}
          aria-invalid={error !== null}
          onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          {...drop.dropHandlers}
        />
      </div>

      <ErrorMessage message={error} />

      {analysis && (
        <div class="sha-result">
          <div class={`msg ${GRADE_CLASS[analysis.grade]} sha-grade`} role="status">
            <span class="sha-grade__letter" aria-label={`Grade ${analysis.grade}`}>
              {analysis.grade}
            </span>
            <div>
              <p class="sha-grade__headline">Security headers grade: {analysis.grade}</p>
              <p class="sha-grade__summary">{GRADE_SUMMARY[analysis.grade]}</p>
              <p class="sha-grade__score">Score: {analysis.score} / 100</p>
            </div>
          </div>

          {analysis.note && (
            <p class="msg msg--info" role="status">
              <span class="msg__icon" aria-hidden="true">
                i
              </span>
              <span>{analysis.note}</span>
            </p>
          )}

          <div class="result-card">
            <h3 class="result-card__title">Findings</h3>
            <FindingList items={analysis.findings} />
          </div>

          {analysis.recommended.length > 0 && (
            <div class="result-card">
              <h3 class="result-card__title">Recommended headers</h3>
              <p class="sha-note">A starting point to adapt, not to paste blindly. Test CSP in report-only mode first.</p>
              <pre class="sha-code">{analysis.recommended.join('\n')}</pre>
              <div>
                <CopyButton value={analysis.recommended.join('\n')} label="Copy recommended" describe="recommended headers" />
              </div>
            </div>
          )}

          <div class="result-card">
            <h3 class="result-card__title">Headers received ({analysis.headers.length})</h3>
            <dl class="sha-headers">
              {analysis.headers.map((header, index) => (
                <>
                  <dt key={`n-${index}`}>{header.name}</dt>
                  <dd key={`v-${index}`}>{header.value}</dd>
                </>
              ))}
            </dl>
          </div>

          <p class="field__hint">
            Grades are a guide to common hardening, not a full security audit. Which headers matter depends on the page, and the
            right values depend on how your site works.
          </p>
        </div>
      )}

      <style>{`
        .sha-result { display: flex; flex-direction: column; gap: var(--space-3); }
        .sha-grade { align-items: center; gap: var(--space-4); }
        .sha-grade__letter {
          font-family: var(--font-mono); font-size: 2.5rem; font-weight: 700; line-height: 1;
          min-width: 4rem; text-align: center;
        }
        .sha-grade__headline { margin: 0; font-weight: 700; font-size: var(--text-base); }
        .sha-grade__summary { margin: var(--space-1) 0 0; }
        .sha-grade__score { margin: var(--space-2) 0 0; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }
        .sha-note { margin: 0; color: var(--text-muted); font-size: var(--text-sm); }
        .sha-code {
          margin: 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface-2); font-family: var(--font-mono); font-size: var(--text-xs);
          white-space: pre-wrap; word-break: break-all;
        }
        .sha-headers {
          display: grid; grid-template-columns: minmax(10rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0; font-size: var(--text-sm);
        }
        .sha-headers dt { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); font-weight: 600; }
        .sha-headers dd { margin: 0; font-family: var(--font-mono); font-size: var(--text-xs); word-break: break-all; }
        @media (max-width: 36rem) {
          .sha-headers { grid-template-columns: 1fr; gap: 0; }
          .sha-headers dd { margin-bottom: var(--space-2); }
        }
      `}</style>
    </div>
  );
}
