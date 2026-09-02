import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  buildCurlCommand,
  buildFetchInit,
  buildSnippet,
  DEFAULT_CURL_OPTIONS,
  HTTP_METHODS,
  SNIPPET_LANGUAGES,
  SNIPPET_LANGUAGE_LABELS,
  type BodyType,
  type CurlHeader,
  type HttpMethod,
  type SnippetLanguage,
} from '../lib/tools/curlCommand';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { JsonTree } from './shared/JsonTree';
import { formatBytes } from './shared/formatBytes';

/** A response body over this size skips the JSON tree/pretty rendering and just shows raw
 *  text — parsing and rendering a huge tree in the main thread risks freezing the tab. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

const CORS_HINT =
  "Request failed — this is almost always a CORS restriction: the server hasn't granted this site permission to read the response from your browser, even though the identical command works in curl (which has no such restriction). It can also mean a network/DNS issue or that the server is unreachable — a browser can't tell these apart.";

type SendStatus = 'idle' | 'sending' | 'done' | 'error';

interface SendResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  bodyText: string;
  bodyJson: unknown;
  durationMs: number;
  truncated: boolean;
}

type BodyView = 'tree' | 'raw';

const statusTone = (status: number): 'success' | 'warning' | 'error' =>
  status >= 200 && status < 300 ? 'success' : status >= 400 ? 'error' : 'warning';

// The GET-shaped sample matches the worked example in curl-command-builder.mdx exactly, so
// "Load example" and the content page's example.output never drift apart on a fresh page
// load (method defaults to GET). Which sample loads adapts to whatever method is currently
// selected, rather than forcing it to POST — a GET (or HEAD/OPTIONS) request conventionally
// has no body, so it gets headers and a query string instead of a JSON body to fill in.
const NO_BODY_METHODS = new Set<HttpMethod>(['GET', 'HEAD', 'OPTIONS']);

const SAMPLE_NO_BODY_URL = 'https://api.example.com/v1/users?role=engineer&active=true';
const SAMPLE_NO_BODY_HEADERS: CurlHeader[] = [
  { key: 'Accept', value: 'application/json' },
  { key: 'Authorization', value: 'Bearer TOKEN123' },
];

const SAMPLE_BODY_URL = 'https://api.example.com/v1/users';
const SAMPLE_BODY_HEADERS: CurlHeader[] = [{ key: 'Authorization', value: 'Bearer TOKEN123' }];
const SAMPLE_BODY = '{"name":"Ada Lovelace","role":"engineer"}';

interface ShareState {
  method: HttpMethod;
  url: string;
  // Headers are deliberately excluded from the shared state — they routinely carry secrets
  // like `Authorization: Bearer <token>` or an API key (same reasoning as the authUser/
  // authPass fields below), and there's no reliable way to tell a secret header value from
  // a benign one, so none of them go into a shareable URL.
  bodyType: BodyType;
  body: string;
  insecure: boolean;
  followRedirects: boolean;
  includeResponseHeaders: boolean;
  silent: boolean;
  multiline: boolean;
}

export default function CurlCommandBuilder() {
  const [method, setMethod] = useState<HttpMethod>(DEFAULT_CURL_OPTIONS.method);
  const [url, setUrl] = useState(DEFAULT_CURL_OPTIONS.url);
  const [headers, setHeaders] = useState<CurlHeader[]>(DEFAULT_CURL_OPTIONS.headers);
  const [bodyType, setBodyType] = useState<BodyType>(DEFAULT_CURL_OPTIONS.bodyType);
  const [body, setBody] = useState(DEFAULT_CURL_OPTIONS.body);
  // Basic auth credentials are deliberately excluded from the shared state below (same
  // reasoning as the HMAC key field on Hash Generator) — everything else here is a request
  // shape, not a secret, so it's still safe and useful to share.
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [insecure, setInsecure] = useState(DEFAULT_CURL_OPTIONS.insecure);
  const [followRedirects, setFollowRedirects] = useState(DEFAULT_CURL_OPTIONS.followRedirects);
  const [includeResponseHeaders, setIncludeResponseHeaders] = useState(DEFAULT_CURL_OPTIONS.includeResponseHeaders);
  const [silent, setSilent] = useState(DEFAULT_CURL_OPTIONS.silent);
  const [multiline, setMultiline] = useState(DEFAULT_CURL_OPTIONS.multiline);
  /** `null` = the "Copy as" panel is closed; a language = show that snippet. */
  const [snippetLanguage, setSnippetLanguage] = useState<SnippetLanguage | null>(null);

  const [sendStatus, setSendStatus] = useState<SendStatus>('idle');
  const [sendResponse, setSendResponse] = useState<SendResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [bodyView, setBodyView] = useState<BodyView>('tree');

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setMethod(state.method);
      setUrl(state.url);
      setBodyType(state.bodyType);
      setBody(state.body);
      setInsecure(state.insecure);
      setFollowRedirects(state.followRedirects);
      setIncludeResponseHeaders(state.includeResponseHeaders);
      setSilent(state.silent);
      setMultiline(state.multiline);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(
    () =>
      buildCurlCommand({
        method,
        url,
        headers,
        bodyType,
        body,
        authUser,
        authPass,
        insecure,
        followRedirects,
        includeResponseHeaders,
        silent,
        multiline,
      }),
    [method, url, headers, bodyType, body, authUser, authPass, insecure, followRedirects, includeResponseHeaders, silent, multiline]
  );

  const error = url.trim() !== '' && !result.ok ? result.error : null;
  const command = result.ok ? result.value : '';

  // "Copy as" reuses the same structured options as the curl command, so a snippet can
  // never describe a different request than the command shown above it.
  const snippetResult = useMemo(
    () =>
      snippetLanguage === null
        ? null
        : buildSnippet(
            {
              method,
              url,
              headers,
              bodyType,
              body,
              authUser,
              authPass,
              insecure,
              followRedirects,
              includeResponseHeaders,
              silent,
              multiline,
            },
            snippetLanguage
          ),
    [
      snippetLanguage,
      method,
      url,
      headers,
      bodyType,
      body,
      authUser,
      authPass,
      insecure,
      followRedirects,
      includeResponseHeaders,
      silent,
      multiline,
    ]
  );
  const snippet = snippetResult?.ok ? snippetResult.value : '';

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    setHeaders((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };
  const removeHeader = (index: number) => {
    setHeaders((rows) => rows.filter((_, i) => i !== index));
  };
  const addHeader = () => {
    setHeaders((rows) => [...rows, { key: '', value: '' }]);
  };

  /**
   * Actually fires the built request via `fetch()` — the one place this tool makes a
   * network call, and only when the user explicitly presses the button. Note this can't
   * replicate every curl flag: `-k` (skip TLS verification) has no browser equivalent, and
   * `-L`/redirects, `-i`, `-s` are curl CLI/output concepts that don't map onto a fetch
   * response the same way, so this always follows redirects and always shows headers.
   */
  const sendRequest = async () => {
    if (!result.ok) return;
    setSendStatus('sending');
    setSendError(null);
    setSendResponse(null);
    setBodyView('tree');

    const start = performance.now();
    try {
      const init = buildFetchInit({
        method,
        url,
        headers,
        bodyType,
        body,
        authUser,
        authPass,
        insecure,
        followRedirects,
        includeResponseHeaders,
        silent,
        multiline,
      });
      const response = await fetch(url.trim(), {
        method,
        headers: init.headers,
        body: init.body,
      });
      const durationMs = Math.round(performance.now() - start);

      const buffer = await response.arrayBuffer();
      const truncated = buffer.byteLength > MAX_PREVIEW_BYTES;
      const bodyText = new TextDecoder('utf-8', { fatal: false }).decode(
        truncated ? buffer.slice(0, MAX_PREVIEW_BYTES) : buffer
      );
      let bodyJson: unknown = null;
      if (!truncated) {
        try {
          bodyJson = JSON.parse(bodyText);
        } catch {
          bodyJson = null;
        }
      }

      setSendResponse({
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        bodyText,
        bodyJson,
        durationMs,
        truncated,
      });
      setSendStatus('done');
    } catch {
      setSendError(CORS_HINT);
      setSendStatus('error');
    }
  };

  const loadExample = () => {
    if (NO_BODY_METHODS.has(method)) {
      setUrl(SAMPLE_NO_BODY_URL);
      setHeaders(SAMPLE_NO_BODY_HEADERS);
      setBodyType('none');
      setBody('');
    } else {
      setUrl(SAMPLE_BODY_URL);
      setHeaders(SAMPLE_BODY_HEADERS);
      setBodyType('json');
      setBody(SAMPLE_BODY);
    }
    setAuthUser('');
    setAuthPass('');
    setInsecure(false);
    setFollowRedirects(false);
    setIncludeResponseHeaders(false);
    setSilent(false);
  };

  const clearAll = () => {
    setMethod(DEFAULT_CURL_OPTIONS.method);
    setUrl(DEFAULT_CURL_OPTIONS.url);
    setHeaders(DEFAULT_CURL_OPTIONS.headers);
    setBodyType(DEFAULT_CURL_OPTIONS.bodyType);
    setBody(DEFAULT_CURL_OPTIONS.body);
    setAuthUser('');
    setAuthPass('');
    setInsecure(DEFAULT_CURL_OPTIONS.insecure);
    setFollowRedirects(DEFAULT_CURL_OPTIONS.followRedirects);
    setIncludeResponseHeaders(DEFAULT_CURL_OPTIONS.includeResponseHeaders);
    setSilent(DEFAULT_CURL_OPTIONS.silent);
  };

  const isEmpty =
    url === '' &&
    headers.length === 0 &&
    body === '' &&
    authUser === '' &&
    authPass === '' &&
    !insecure &&
    !followRedirects &&
    !includeResponseHeaders &&
    !silent;

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <ShareLinkButton
          getState={(): ShareState => ({
            method,
            url,
            bodyType,
            body,
            insecure,
            followRedirects,
            includeResponseHeaders,
            silent,
            multiline,
          })}
          describe="this request"
        />
        <button
          type="button"
          class="btn"
          onClick={loadExample}
          title={
            NO_BODY_METHODS.has(method)
              ? `Fill in a sample ${method} request with headers and a query string`
              : `Fill in a sample ${method} request with a header and a JSON body`
          }
        >
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={isEmpty} title="Clear every field and start over">
          Clear
        </button>
      </div>

      <div class="curl-request-row">
        <div class="field" style="max-width:9rem">
          <label class="field__label" for="curl-method">
            <span>Method</span>
          </label>
          <select
            id="curl-method"
            class="select"
            value={method}
            onChange={(event) => setMethod((event.target as HTMLSelectElement).value as HttpMethod)}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div class="field" style="flex:1">
          <label class="field__label" for="curl-url">
            <span>URL</span>
          </label>
          <input
            id="curl-url"
            class="input"
            type="text"
            spellcheck={false}
            autocomplete="off"
            placeholder="https://api.example.com/v1/users"
            value={url}
            aria-invalid={error !== null}
            onInput={(event) => setUrl((event.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      <ErrorMessage message={error} />

      <div class="curl-section">
        <div class="curl-section__head">
          <h3 class="curl-section__title">Headers</h3>
          <button type="button" class="btn" onClick={addHeader} title="Add a request header">
            + Add header
          </button>
        </div>
        {headers.length > 0 ? (
          <div class="curl-header-rows">
            {headers.map((header, index) => (
              <div class="curl-header-row" key={index}>
                <input
                  class="input"
                  placeholder="Header-Name"
                  aria-label={`Header ${index + 1} name`}
                  value={header.key}
                  onInput={(event) => updateHeader(index, 'key', (event.target as HTMLInputElement).value)}
                />
                <input
                  class="input"
                  placeholder="value"
                  aria-label={`Header ${index + 1} value`}
                  value={header.value}
                  onInput={(event) => updateHeader(index, 'value', (event.target as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="btn"
                  onClick={() => removeHeader(index)}
                  title="Remove this header"
                  aria-label={`Remove header ${index + 1}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p class="field__hint">No headers added — add one above, e.g. Authorization or Accept.</p>
        )}
      </div>

      <div class="curl-section">
        <h3 class="curl-section__title">Body</h3>
        <div class="seg" role="group" aria-label="Body type">
          <button type="button" class="seg__btn" aria-pressed={bodyType === 'none'} onClick={() => setBodyType('none')}>
            None
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={bodyType === 'raw'}
            onClick={() => setBodyType('raw')}
            title="Sent as-is with -d, no automatic Content-Type header"
          >
            Raw
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={bodyType === 'json'}
            onClick={() => setBodyType('json')}
            title="Validated as JSON, and adds a Content-Type: application/json header automatically unless you've already set one"
          >
            JSON
          </button>
        </div>
        {bodyType !== 'none' && (
          <textarea
            class="textarea"
            spellcheck={false}
            autocomplete="off"
            placeholder={bodyType === 'json' ? '{"key":"value"}' : 'raw request body…'}
            aria-label="Request body"
            value={body}
            onInput={(event) => setBody((event.target as HTMLTextAreaElement).value)}
          />
        )}
      </div>

      <div class="curl-section">
        <h3 class="curl-section__title">Basic auth</h3>
        <div class="curl-auth-row">
          <input
            class="input"
            placeholder="Username"
            autocomplete="off"
            aria-label="Basic auth username"
            value={authUser}
            onInput={(event) => setAuthUser((event.target as HTMLInputElement).value)}
          />
          <input
            class="input"
            type="password"
            placeholder="Password"
            autocomplete="off"
            aria-label="Basic auth password"
            value={authPass}
            onInput={(event) => setAuthPass((event.target as HTMLInputElement).value)}
          />
        </div>
        <p class="field__hint">Optional — leave the username blank to skip -u entirely.</p>
      </div>

      <div class="curl-section">
        <h3 class="curl-section__title">Options</h3>
        <div class="curl-options-row">
          <label class="checkbox" title="Adds -L, so curl follows redirect responses (3xx) instead of stopping at the first one">
            <input type="checkbox" checked={followRedirects} onChange={(event) => setFollowRedirects((event.target as HTMLInputElement).checked)} />
            <span>Follow redirects (-L)</span>
          </label>
          <label class="checkbox" title="Adds -k, so curl skips TLS certificate verification — useful for a local/self-signed dev server, never for anything else">
            <input type="checkbox" checked={insecure} onChange={(event) => setInsecure((event.target as HTMLInputElement).checked)} />
            <span>Skip SSL verification (-k)</span>
          </label>
          <label class="checkbox" title="Adds -i, so the response headers are printed above the response body">
            <input
              type="checkbox"
              checked={includeResponseHeaders}
              onChange={(event) => setIncludeResponseHeaders((event.target as HTMLInputElement).checked)}
            />
            <span>Include response headers (-i)</span>
          </label>
          <label class="checkbox" title="Adds -s, so curl hides the progress meter">
            <input type="checkbox" checked={silent} onChange={(event) => setSilent((event.target as HTMLInputElement).checked)} />
            <span>Silent (-s)</span>
          </label>
        </div>
      </div>

      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Output format">
          <button type="button" class="seg__btn" aria-pressed={multiline} onClick={() => setMultiline(true)} title="One flag per line, joined with a line-continuation backslash">
            Multi-line
          </button>
          <button type="button" class="seg__btn" aria-pressed={!multiline} onClick={() => setMultiline(false)} title="Everything on a single line">
            Single line
          </button>
        </div>
        <span class="tool-bar__spacer" />
        <button
          type="button"
          class="btn btn--primary"
          onClick={() => void sendRequest()}
          disabled={!result.ok || sendStatus === 'sending'}
          title="Actually make this request from your browser and show the response — see the note below about CORS"
        >
          {sendStatus === 'sending' ? 'Sending…' : 'Send request'}
        </button>
      </div>

      <OutputPane label="curl command" value={command} placeholder="Enter a URL above to build a command." tall describe="curl command" />

      <div class="tool-bar" role="group" aria-label="Copy the same request as code">
        <span class="field__label">Copy as</span>
        {SNIPPET_LANGUAGES.map((language) => (
          <button
            key={language}
            type="button"
            class="btn"
            aria-pressed={snippetLanguage === language}
            disabled={!result.ok}
            onClick={() => setSnippetLanguage((current) => (current === language ? null : language))}
            title={`Show the same request as ${SNIPPET_LANGUAGE_LABELS[language]} code`}
          >
            {SNIPPET_LANGUAGE_LABELS[language]}
          </button>
        ))}
      </div>

      {snippetLanguage !== null && (
        <OutputPane
          label={SNIPPET_LANGUAGE_LABELS[snippetLanguage]}
          value={snippet}
          placeholder="Enter a URL above to build a snippet."
          tall
          describe={`${SNIPPET_LANGUAGE_LABELS[snippetLanguage]} snippet`}
        />
      )}

      {sendStatus !== 'idle' && (
        <div class="curl-response">
          <div class="curl-response__head">
            <h3 class="curl-section__title">Response</h3>
            {sendResponse && (
              <span class={`curl-response__status curl-response__status--${statusTone(sendResponse.status)}`}>
                {sendResponse.status} {sendResponse.statusText} · {sendResponse.durationMs}ms
              </span>
            )}
          </div>

          {sendStatus === 'sending' && (
            <p class="field__hint">
              <span class="curl-spinner" aria-hidden="true" /> Sending…
            </p>
          )}

          <ErrorMessage message={sendError} />

          {sendResponse && (
            <>
              {sendResponse.truncated && (
                <p class="msg msg--warning">
                  <span class="msg__icon" aria-hidden="true">
                    !
                  </span>
                  <span>Response body is larger than {formatBytes(MAX_PREVIEW_BYTES)} — showing the first {formatBytes(MAX_PREVIEW_BYTES)} only.</span>
                </p>
              )}

              {sendResponse.headers.length > 0 && (
                <details class="curl-response__headers">
                  <summary>Response headers ({sendResponse.headers.length})</summary>
                  <dl>
                    {sendResponse.headers.map(([key, value]) => (
                      <>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </>
                    ))}
                  </dl>
                </details>
              )}

              {sendResponse.bodyJson !== null && (
                <div class="seg" role="group" aria-label="Response body view">
                  <button type="button" class="seg__btn" aria-pressed={bodyView === 'tree'} onClick={() => setBodyView('tree')}>
                    Tree
                  </button>
                  <button type="button" class="seg__btn" aria-pressed={bodyView === 'raw'} onClick={() => setBodyView('raw')}>
                    Raw
                  </button>
                </div>
              )}

              {sendResponse.bodyJson !== null && bodyView === 'tree' ? (
                <JsonTree value={sendResponse.bodyJson} label="Response body as a collapsible tree" tall />
              ) : (
                <OutputPane
                  label="Response body"
                  value={sendResponse.bodyText}
                  placeholder="(empty body)"
                  tall
                  describe="the response body"
                />
              )}
            </>
          )}

          <p class="field__hint">
            This makes a real request from your browser. Many APIs block cross-origin requests (CORS) from pages
            other than their own, so a request that runs fine with curl can still fail here — see the FAQ below.
            <code>-k</code> (skip TLS verification) has no browser equivalent and isn't applied when sending.
          </p>
        </div>
      )}

      <style>{`
        .curl-request-row { display: flex; gap: var(--space-3); align-items: flex-end; flex-wrap: wrap; }
        .curl-section { margin-top: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
        .curl-section__head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
        .curl-section__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
        }
        .curl-header-rows { display: flex; flex-direction: column; gap: var(--space-2); }
        .curl-header-row {
          display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--space-2); align-items: center;
        }
        .curl-auth-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
        .curl-options-row { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5); }
        @media (max-width: 30rem) {
          .curl-auth-row { grid-template-columns: 1fr; }
        }

        .curl-response { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }
        .curl-response__head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
        .curl-response__status {
          font-family: var(--font-mono); font-weight: 700; font-size: var(--text-sm);
          padding: 0.15rem 0.65rem; border-radius: 999px; border: 1px solid transparent;
        }
        .curl-response__status--success { background: var(--success-subtle); color: var(--success); border-color: var(--success-border); }
        .curl-response__status--warning { background: var(--warning-subtle); color: var(--warning); border-color: var(--warning-border); }
        .curl-response__status--error { background: var(--danger-subtle); color: var(--danger); border-color: var(--danger-border); }
        .curl-response__headers { font-size: var(--text-sm); }
        .curl-response__headers summary { cursor: pointer; color: var(--text-muted); }
        .curl-response__headers dl {
          display: grid; grid-template-columns: minmax(8rem, auto) 1fr; gap: var(--space-1) var(--space-3);
          margin: var(--space-2) 0 0; font-family: var(--font-mono);
        }
        .curl-response__headers dt { color: var(--text-muted); word-break: break-all; }
        .curl-response__headers dd { margin: 0; color: var(--text); word-break: break-all; }
        .curl-spinner {
          display: inline-block; width: 0.9rem; height: 0.9rem; margin-right: var(--space-1);
          border: 2px solid var(--border-strong); border-top-color: var(--accent);
          border-radius: 50%; animation: curl-spin 0.6s linear infinite; vertical-align: -0.15em;
        }
        @media (prefers-reduced-motion: reduce) {
          .curl-spinner { animation-duration: 1.5s; }
        }
        @keyframes curl-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
