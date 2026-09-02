import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  scanText,
  computeStats,
  cleanText,
  toInspectSegments,
  describeHomoglyphRisk,
  formatCodePoint,
  CATEGORY_ORDER,
  CATEGORY_INFO,
  DEFAULT_CLEAN_OPTIONS,
  type CleanOptions,
  type CharCategory,
  type InspectSegment,
} from '../lib/tools/invisibleChars';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { OutputPane } from './shared/OutputPane';
import { useTextFileDrop } from './shared/useTextFileDrop';

/** Built from code points at runtime rather than pasted as raw glyphs, so the source
 * file itself never carries a live bidi override or an unannounced homoglyph — the
 * exact category of problem this tool exists to catch. */
const cp = (codePoint: number): string => String.fromCodePoint(codePoint);

const SAMPLE =
  `Sign in at p${cp(0x0430)}ypal-support.com to verify your account.\n` +
  `The attached file is named invoice${cp(0x202e)}fdp.scr${cp(0x202c)}\n` +
  `There's a non-breaking space right${cp(0x00a0)}here, and a zero-width space${cp(0x200b)} hidden in this sentence.`;

const CLEAN_VERB: Record<CharCategory, string> = {
  bidi: 'strip',
  invisible: 'strip',
  control: 'strip',
  whitespace: 'normalize',
  homoglyph: 'replace',
};

/** Categories with no visible glyph of their own — rendered as a small text badge in
 * the preview instead of the (invisible) character itself. Whitespace and homoglyph
 * characters have real width, so the actual character is rendered and highlighted. */
const BADGE_CATEGORIES = new Set<CharCategory>(['bidi', 'invisible', 'control']);

interface ShareState {
  input: string;
  cleanOptions: CleanOptions;
}

function markTitle(segment: InspectSegment): string {
  const f = segment.found!;
  const info = CATEGORY_INFO[f.category];
  const looksLike = f.category === 'homoglyph' ? ` — looks like "${f.replacement}"` : '';
  return `${info.label}: ${f.name} (${formatCodePoint(f.codePoint)})${looksLike}`;
}

export default function InvisibleCharInspector() {
  const [input, setInput] = useState('');
  const [cleanOptions, setCleanOptions] = useState<CleanOptions>(DEFAULT_CLEAN_OPTIONS);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setCleanOptions(restored.value.cleanOptions);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const { isDragActive, dropHandlers } = useTextFileDrop(setInput);

  const found = useMemo(() => scanText(input), [input]);
  const stats = useMemo(() => computeStats(input, found), [input, found]);
  const segments = useMemo(() => toInspectSegments(input, found), [input, found]);
  const cleaned = useMemo(() => cleanText(input, found, cleanOptions), [input, found, cleanOptions]);
  const homoglyphRisk = useMemo(() => describeHomoglyphRisk(input, found), [input, found]);

  const toggleOption = (category: CharCategory) => {
    setCleanOptions((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Actions">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input, cleanOptions })} describe="this text and your clean-up settings" />
        <button type="button" class="btn" onClick={() => setInput(SAMPLE)} title="Load example text">
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="field">
        <label class="field__label" for="ic-input">
          <span>Text to inspect</span>
          <span class="field__hint">
            {stats.totalCodePoints.toLocaleString()} character{stats.totalCodePoints === 1 ? '' : 's'}
          </span>
        </label>
        <textarea
          id="ic-input"
          class={`textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
          spellcheck={false}
          placeholder="Paste or type text here, or drop a .txt file…"
          value={input}
          onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          {...dropHandlers}
        />
      </div>

      <div class="field">
        <span class="field__label">
          <span>Findings</span>
        </span>

        {input === '' && <p class="field__hint">Findings appear here once you paste or type something above.</p>}

        {input !== '' && found.length === 0 && (
          <p class="msg msg--success">
            <span class="msg__icon" aria-hidden="true">
              ✓
            </span>
            <span>No invisible characters, bidi overrides, odd whitespace, control characters, or Latin look-alike letters found.</span>
          </p>
        )}

        {found.length > 0 && (
          <>
            <div class="stats" data-testid="ic-stats">
              <span class="stats__item">
                <strong>{stats.total.toLocaleString()}</strong> flagged character{stats.total === 1 ? '' : 's'}
              </span>
              <span class="stats__item">
                <strong>{stats.totalCodePoints.toLocaleString()}</strong> total characters
              </span>
              <span class="stats__item">
                <strong>{stats.totalBytes.toLocaleString()}</strong> UTF-8 bytes
              </span>
            </div>

            <div class="ic-badges" role="list" aria-label="Findings by category">
              {CATEGORY_ORDER.filter((category) => stats.byCategory[category] > 0).map((category) => (
                <span
                  key={category}
                  role="listitem"
                  class={`ic-badge ic-badge--${CATEGORY_INFO[category].severity}`}
                  title={CATEGORY_INFO[category].description}
                >
                  {CATEGORY_INFO[category].label} <strong>{stats.byCategory[category]}</strong>
                </span>
              ))}
            </div>

            {homoglyphRisk && (
              <p class={`msg msg--${homoglyphRisk.level}`}>
                <span class="msg__icon" aria-hidden="true">
                  {homoglyphRisk.level === 'warning' ? '!' : 'i'}
                </span>
                <span>{homoglyphRisk.message}</span>
              </p>
            )}
          </>
        )}
      </div>

      {found.length > 0 && (
        <div class="field">
          <div class="field__label">
            <span>Annotated preview</span>
            <span class="field__hint">Hover a highlighted character for details</span>
          </div>
          {/* Individual marks are deliberately not keyboard-focusable: a watermarking
              attack can hide hundreds of invisible characters in one paste, and a tab
              stop per character would trap keyboard users. The category badges above
              are the accessible summary; this preview is a visual aid on top of them,
              with the container itself (not each mark) as the one tab stop. */}
          <div class="output ic-preview" tabIndex={0} aria-label={`Text with ${found.length} flagged character${found.length === 1 ? '' : 's'} highlighted`}>
            {segments.map((segment, index) =>
              segment.found ? (
                <mark
                  key={index}
                  class={`ic-mark ic-mark--${CATEGORY_INFO[segment.found.category].severity}`}
                  title={markTitle(segment)}
                >
                  {BADGE_CATEGORIES.has(segment.found.category) ? (
                    <span class="ic-mark__badge">{segment.found.abbr}</span>
                  ) : (
                    segment.text
                  )}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
          </div>
        </div>
      )}

      <div class="field">
        <span class="field__label">
          <span>Clean-up options</span>
        </span>
        <div class="tool-bar">
          {CATEGORY_ORDER.map((category) => (
            <label
              key={category}
              class="checkbox"
              title={`${CATEGORY_INFO[category].description} ${
                stats.byCategory[category] === 0 ? '(none found in the current text)' : ''
              }`.trim()}
            >
              <input
                type="checkbox"
                checked={cleanOptions[category]}
                disabled={stats.byCategory[category] === 0}
                onChange={() => toggleOption(category)}
              />
              <span>
                {CATEGORY_INFO[category].label} ({CLEAN_VERB[category]})
              </span>
            </label>
          ))}
        </div>
      </div>

      <OutputPane
        label="Cleaned text"
        value={cleaned}
        placeholder={
          input === ''
            ? 'Paste or type text above to see a cleaned version here.'
            : 'Nothing to clean — no flagged characters match the categories selected above.'
        }
        tall
        describe="the cleaned text"
      />

      <style>{`
        .ic-badges {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }
        .ic-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.3em;
          padding: 0.2rem 0.6rem;
          border-radius: 999px;
          border: 1px solid;
          font-size: var(--text-xs);
          font-weight: 550;
          cursor: help;
        }
        .ic-badge--danger {
          background: var(--danger-subtle);
          border-color: var(--danger-border);
          color: var(--danger);
        }
        .ic-badge--warning {
          background: var(--warning-subtle);
          border-color: var(--warning-border);
          color: var(--warning);
        }
        .ic-badge strong {
          font-variant-numeric: tabular-nums;
        }

        .ic-preview {
          cursor: text;
        }
        /* See the box-decoration-break note in DuplicateLineRemover.tsx — a <mark> that
           wraps across lines needs this so its background/border don't run past the
           actual highlighted text on every line but the last. */
        .ic-mark {
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
          border-radius: 2px;
          cursor: help;
        }
        .ic-mark--danger {
          background: var(--danger-subtle);
          border-bottom: 2px solid var(--danger);
        }
        .ic-mark--warning {
          background: var(--warning-subtle);
          border-bottom: 2px dotted var(--warning);
        }
        .ic-mark__badge {
          display: inline-block;
          padding: 0 0.3em;
          border-radius: 3px;
          background: var(--surface-3);
          color: var(--text);
          font-size: 0.7em;
          font-weight: 650;
          line-height: 1.5;
          vertical-align: 0.05em;
        }
      `}</style>
    </div>
  );
}
