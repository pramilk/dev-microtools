import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  CSP_DIRECTIVES,
  CSP_SOURCE_KEYWORDS,
  EMPTY_CSP_CONFIG,
  buildCspHeaderValue,
  formatCspHeaderLine,
  parseCspHeader,
  analyzeCsp,
  buildCspReportingHeaders,
  isCspConfigEmpty,
  type CspConfig,
  type CspFetchDirective,
} from '../lib/tools/csp';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

/** Matches `example.input` in csp-header-builder.mdx — keep the two in step. */
const EXAMPLE: CspConfig = {
  ...EMPTY_CSP_CONFIG,
  directives: {
    'default-src': ["'self'"],
    'script-src': ["'self'", 'https://cdn.example.com'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
  },
  upgradeInsecureRequests: true,
  reportUri: 'https://example.com/csp-reports',
  reportTo: 'csp-endpoint',
};

type Mode = 'build' | 'analyze';
type ShareState = CspConfig;

export default function CspBuilder() {
  const [mode, setMode] = useState<Mode>('build');
  const [config, setConfig] = useState<CspConfig>(EMPTY_CSP_CONFIG);
  const [pasted, setPasted] = useState('');

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setConfig({ ...EMPTY_CSP_CONFIG, ...restored.value });
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const patchDirective = (directive: CspFetchDirective, raw: string) => {
    const sources = raw.split(/\s+/).filter(Boolean);
    setConfig((current) => ({
      ...current,
      directives: { ...current.directives, [directive]: sources },
    }));
  };

  const patch = (partial: Partial<CspConfig>) => setConfig((current) => ({ ...current, ...partial }));

  const headerValueResult = useMemo(() => buildCspHeaderValue(config), [config]);
  const headerValue = headerValueResult.ok ? headerValueResult.value : '';
  const headerLine = headerValue !== '' ? formatCspHeaderLine(config, headerValue) : '';
  const buildError = !isCspConfigEmpty(config) && !headerValueResult.ok ? headerValueResult.error : null;

  const buildAnalysis = useMemo(() => analyzeCsp(config), [config]);

  const reportingResult = useMemo(
    () => (config.reportUri.trim() !== '' ? buildCspReportingHeaders(config.reportUri, config.reportTo) : null),
    [config.reportUri, config.reportTo]
  );

  const parsed = useMemo(() => (pasted.trim() !== '' ? parseCspHeader(pasted) : null), [pasted]);
  const parseError = parsed && !parsed.ok ? parsed.error : null;
  const analyzedConfig = parsed?.ok ? parsed.value.config : null;
  const analysis = useMemo(
    () => (analyzedConfig ? analyzeCsp(analyzedConfig, parsed?.ok ? parsed.value.duplicateDirectives : []) : null),
    [analyzedConfig, parsed]
  );
  const normalizedResult = useMemo(() => (analyzedConfig ? buildCspHeaderValue(analyzedConfig) : null), [analyzedConfig]);
  const normalizedHeaderLine =
    analyzedConfig && normalizedResult?.ok ? formatCspHeaderLine(analyzedConfig, normalizedResult.value) : '';

  const analyzeSummary = useMemo(() => {
    if (!analyzedConfig || !analysis) return null;
    const directiveEntries = Object.values(analyzedConfig.directives).filter((sources) => sources && sources.length > 0);
    const directiveCount = directiveEntries.length + analyzedConfig.otherDirectives.length;
    const sourceCount = directiveEntries.reduce((sum, sources) => sum + (sources?.length ?? 0), 0);
    return {
      directiveCount,
      sourceCount,
      warningCount: analysis.warnings.length,
      noteCount: analysis.notes.length,
    };
  }, [analyzedConfig, analysis]);

  const loadExample = () => {
    setMode('build');
    setConfig(EXAMPLE);
  };
  const clearAll = () => setConfig(EMPTY_CSP_CONFIG);
  const isEmpty = isCspConfigEmpty(config);

  const editInBuilder = () => {
    if (!analyzedConfig) return;
    setConfig(analyzedConfig);
    setPasted('');
    setMode('build');
  };

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Mode">
          <button type="button" class="seg__btn" aria-pressed={mode === 'build'} onClick={() => setMode('build')}>
            Build
          </button>
          <button type="button" class="seg__btn" aria-pressed={mode === 'analyze'} onClick={() => setMode('analyze')}>
            Analyze
          </button>
        </div>
        <span class="tool-bar__spacer" />
        {mode === 'build' && <ShareLinkButton getState={(): ShareState => config} describe="this policy" />}
        <button type="button" class="btn" onClick={loadExample} title="Fill in a worked hardened-policy example">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={mode === 'build' && isEmpty} title="Reset every field">
          Clear
        </button>
      </div>

      {mode === 'build' ? (
        <>
          <datalist id="csp-keywords">
            {CSP_SOURCE_KEYWORDS.map((keyword) => (
              <option value={keyword} key={keyword} />
            ))}
          </datalist>

          <div class="csp-grid">
            {CSP_DIRECTIVES.map((directive) => (
              <div class="field" key={directive.value}>
                <label class="field__label" for={`csp-${directive.value}`} title={directive.hint}>
                  <span>{directive.label}</span>
                </label>
                <input
                  id={`csp-${directive.value}`}
                  type="text"
                  class="input"
                  list="csp-keywords"
                  placeholder="'self'"
                  value={(config.directives[directive.value] ?? []).join(' ')}
                  onInput={(event) => patchDirective(directive.value, (event.target as HTMLInputElement).value)}
                />
                <span class="field__hint">{directive.hint}</span>
              </div>
            ))}
          </div>

          <div class="csp-grid csp-grid--three">
            <div class="field">
              <span class="field__label">
                <span>Header mode</span>
              </span>
              <div class="seg" role="group" aria-label="Enforce or report-only">
                <button
                  type="button"
                  class="seg__btn"
                  aria-pressed={!config.reportOnly}
                  title="Blocks violating content"
                  onClick={() => patch({ reportOnly: false })}
                >
                  Enforce
                </button>
                <button
                  type="button"
                  class="seg__btn"
                  aria-pressed={config.reportOnly}
                  title="Logs violations without blocking anything — safe to test a policy in production"
                  onClick={() => patch({ reportOnly: true })}
                >
                  Report-only
                </button>
              </div>
              <span class="field__hint">Report-only logs violations without blocking anything — use it to test a policy before enforcing it.</span>
            </div>

            <label class="field checkbox-field" title="Forces every http:// sub-resource this page loads to be requested over https:// instead">
              <input
                type="checkbox"
                checked={config.upgradeInsecureRequests}
                onChange={(event) => patch({ upgradeInsecureRequests: (event.target as HTMLInputElement).checked })}
              />
              <span>upgrade-insecure-requests</span>
            </label>
          </div>

          <fieldset class="csp-fieldset">
            <legend>Violation reporting</legend>
            <div class="csp-grid csp-grid--three">
              <div class="field">
                <label class="field__label" for="csp-report-uri">
                  <span>Report collector URL</span>
                </label>
                <input
                  id="csp-report-uri"
                  type="url"
                  class="input"
                  placeholder="https://example.com/csp-reports"
                  value={config.reportUri}
                  onInput={(event) => patch({ reportUri: (event.target as HTMLInputElement).value })}
                />
                <span class="field__hint">Drives report-uri (legacy, universally supported) and — with a group name — report-to.</span>
              </div>
              <div class="field">
                <label class="field__label" for="csp-report-to">
                  <span>Reporting group name</span>
                </label>
                <input
                  id="csp-report-to"
                  type="text"
                  class="input"
                  placeholder="csp-endpoint"
                  value={config.reportTo}
                  onInput={(event) => patch({ reportTo: (event.target as HTMLInputElement).value })}
                />
                <span class="field__hint">Referenced by the report-to directive; the group's URL is declared by the header below.</span>
              </div>
            </div>
          </fieldset>

          <OutputPane
            label="Content-Security-Policy header"
            value={headerLine}
            placeholder="Fill in at least one directive above to build a policy."
            tall
            describe="this CSP header"
            actions={<DownloadButton value={headerLine} filename="csp-header.txt" describe="this CSP header" />}
          />
          <ErrorMessage message={buildError} />

          <CspFindings warnings={buildAnalysis.warnings} notes={buildAnalysis.notes} />

          {reportingResult?.ok && (
            <div class="csp-grid">
              <OutputPane
                label="Reporting-Endpoints header"
                value={`Reporting-Endpoints: ${reportingResult.value.reportingEndpoints}`}
                placeholder=""
                describe="the Reporting-Endpoints header"
              />
              <OutputPane
                label="Report-To header (legacy, optional)"
                value={`Report-To: ${reportingResult.value.reportTo}`}
                placeholder=""
                describe="the legacy Report-To header"
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div class="field">
            <label class="field__label" for="csp-paste">
              <span>Paste a Content-Security-Policy header</span>
            </label>
            <textarea
              id="csp-paste"
              class="textarea textarea--tall"
              placeholder="Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; object-src *"
              value={pasted}
              onInput={(event) => setPasted((event.target as HTMLTextAreaElement).value)}
            />
            <span class="field__hint">
              Paste just the header value, a single header line, or the whole response from curl -I — this finds the
              Content-Security-Policy line on its own either way.
            </span>
          </div>

          <ErrorMessage message={parseError} />

          {analyzedConfig && (
            <>
              {analyzeSummary && (
                <p class="msg msg--info" role="status">
                  <span class="msg__icon" aria-hidden="true">i</span>
                  <span>
                    Found {analyzeSummary.directiveCount} directive{analyzeSummary.directiveCount === 1 ? '' : 's'} ({analyzeSummary.sourceCount} source
                    {analyzeSummary.sourceCount === 1 ? '' : 's'} total) — {analyzeSummary.warningCount} warning
                    {analyzeSummary.warningCount === 1 ? '' : 's'}, {analyzeSummary.noteCount} note{analyzeSummary.noteCount === 1 ? '' : 's'}.
                  </span>
                </p>
              )}

              {normalizedResult?.ok ? (
                <OutputPane label="Normalized policy" value={normalizedHeaderLine} placeholder="" tall describe="the normalized policy" />
              ) : (
                <ErrorMessage message={normalizedResult ? normalizedResult.error : null} />
              )}

              {analyzedConfig.otherDirectives.length > 0 && (
                <p class="field__hint">
                  Directives this tool doesn't have a dedicated field for, kept as-is: <code>{analyzedConfig.otherDirectives.join('; ')}</code>
                </p>
              )}

              {analysis && <CspFindings warnings={analysis.warnings} notes={analysis.notes} />}

              <div class="tool-bar">
                <span class="tool-bar__spacer" />
                <button type="button" class="btn" onClick={editInBuilder}>
                  Edit in builder
                </button>
              </div>
            </>
          )}
        </>
      )}

      <style>{`
        .csp-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
        .csp-grid--three { grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); }
        .csp-fieldset { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4); margin: 0; display: flex; flex-direction: column; gap: var(--space-3); }
        .csp-fieldset legend { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; padding: 0 var(--space-2); }
        .checkbox-field { flex-direction: row; align-items: center; gap: var(--space-2); justify-content: flex-start; }
        .checkbox-field input { width: 1.1rem; height: 1.1rem; }
        .csp-findings { margin: 0; padding-left: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
      `}</style>
    </div>
  );
}

function CspFindings({ warnings, notes }: { warnings: string[]; notes: string[] }) {
  if (warnings.length === 0 && notes.length === 0) {
    return (
      <p class="msg msg--success" role="status">
        <span class="msg__icon" aria-hidden="true">✓</span>
        <span>No issues found by this checklist.</span>
      </p>
    );
  }

  return (
    <>
      {warnings.length > 0 && (
        <div class="msg msg--warning">
          <span class="msg__icon" aria-hidden="true">!</span>
          <ul class="csp-findings">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {notes.length > 0 && (
        <div class="msg msg--info">
          <span class="msg__icon" aria-hidden="true">i</span>
          <ul class="csp-findings">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
