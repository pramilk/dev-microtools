import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  convertCase,
  toHighlightSegments,
  CASE_TYPES,
  CASE_LABELS,
  type CaseType,
} from '../lib/tools/wordCounter';
import { applySentenceCase, toggleGuessedCase, type LowConfidenceRange } from '../lib/tools/sentenceCase';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { CopyButton } from './shared/CopyButton';
import { useTextFileDrop } from './shared/useTextFileDrop';
import { ErrorMessage } from './shared/ErrorMessage';

const SAMPLE = 'elon musk announced that SpaceX will launch a new ROCKET to Mars next year.';

interface ShareState {
  input: string;
}

function lowConfidenceReasonText(word: string, reason: LowConfidenceRange['reason']): string {
  if (reason === 'contextual') {
    return `Guessed as a name because of nearby wording like "named" or "name is", not because "${word}" is a recognized name — could be wrong.`;
  }
  if (reason === 'commonWord') {
    return `"${word.toLowerCase()}" is also an ordinary English word, so it's shown lowercase by default even though it was capitalized in your original text — it might actually be a name.`;
  }
  return `Capitalized in your text, but not recognized as a known name, place, or organization, and not a common English word either — could be a real proper noun the tool just doesn't know.`;
}

/**
 * Case conversion logic (convertCase/CASE_TYPES) and Sentence case (applySentenceCase) are
 * shared with Word Counter's own case buttons — see wordCounter.ts and sentenceCase.ts. Split
 * out as its own page per .assets/GAP-ANALYSIS.md §3: "case converter" is a large standalone
 * search term invisible inside a page called Word Counter. The controls stay in Word Counter
 * too, so this is a UI split, not a logic move.
 */
export default function CaseConverter() {
  const [input, setInput] = useState('');
  // The last text the user actually typed, pasted, dropped, or shared in — as opposed to
  // `input`, which is what's currently displayed. Case buttons always convert from this, not
  // from `input`, so switching from PascalCase to Title Case (say) performs Title Case on the
  // original text rather than re-casing an already-cased result. A direct edit to the textarea
  // re-syncs the two, so typing after a case conversion "adopts" it as the new base rather
  // than being silently discarded on the next case click.
  const [baseText, setBaseText] = useState('');
  const [sentenceCaseLoading, setSentenceCaseLoading] = useState(false);
  const [sentenceCaseError, setSentenceCaseError] = useState<string | null>(null);
  // Words the Sentence case button wasn't confident were proper nouns — cleared on any real
  // edit (setText) so a stale highlight never survives past the text it was computed for.
  const [lowConfidenceRanges, setLowConfidenceRanges] = useState<LowConfidenceRange[]>([]);

  const setText = (value: string) => {
    setInput(value);
    setBaseText(value);
    setLowConfidenceRanges([]);
  };

  const { isDragActive, dropHandlers } = useTextFileDrop(setText);
  const backdropRef = useRef<HTMLDivElement>(null);
  const hintsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setText(restored.value.input);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const lowConfidenceSegments = useMemo(
    () => toHighlightSegments(input, lowConfidenceRanges),
    [input, lowConfidenceRanges]
  );

  // A per-word hover target directly on the text, rather than a list below the box — see
  // WordCounter's identical technique for the full rationale on the layered overlay, and for
  // why toggling is a same-length in-place substring swap that never invalidates other ranges.
  const lowConfidenceHints = useMemo(() => {
    let rangeIndex = 0;
    return lowConfidenceSegments.map((segment) => {
      if (!segment.isMatch) return null;
      const index = rangeIndex;
      rangeIndex += 1;
      const reason = lowConfidenceRanges[index]?.reason ?? 'unrecognized';
      return { rangeIndex: index, title: `${lowConfidenceReasonText(segment.text, reason)} Click to toggle capitalization.` };
    });
  }, [lowConfidenceSegments, lowConfidenceRanges]);

  // Flips one flagged word between this tool's capitalized guess and plain lowercase — a
  // one-click fix for an uncertain guess instead of retyping it. Updates `input` directly
  // (not `setText`) so the low-confidence ranges and `baseText` survive.
  const toggleLowConfidenceWord = (rangeIndex: number) => {
    const range = lowConfidenceRanges[rangeIndex];
    if (!range) return;
    const current = input.slice(range.start, range.end);
    const next = toggleGuessedCase(current, range.original);
    setInput(input.slice(0, range.start) + next + input.slice(range.end));
  };

  const applyCase = (type: CaseType) => {
    setInput(convertCase(baseText, type));
    setLowConfidenceRanges([]);
  };

  const runSentenceCase = async () => {
    setSentenceCaseLoading(true);
    setSentenceCaseError(null);
    try {
      const result = await applySentenceCase(baseText);
      setInput(result.text);
      setLowConfidenceRanges(result.lowConfidenceRanges);
    } catch {
      setSentenceCaseError('Sentence case failed to load. Check your connection and try again.');
    } finally {
      setSentenceCaseLoading(false);
    }
  };

  const clearAll = () => setText('');

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Actions">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input })} describe="this text" />
        <button type="button" class="btn" onClick={() => setText(SAMPLE)} title="Load example text">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="field">
        <label class="field__label" for="cc-input">
          <span>Text</span>
          <span class="field__hint">{input.length.toLocaleString()} characters</span>
        </label>
        {/* Same layered-overlay technique as Word Counter's Sentence case highlight: a
            transparent backdrop <div> (identical font/padding/border via the shared
            .textarea class) sits behind the real textarea to draw the low-confidence
            underline, and a second transparent layer on top turns just the flagged words
            into real hover targets carrying a `title`. See WordCounter.tsx for the full
            rationale — this is a trimmed copy with no find/replace layer, since this page
            has no find/replace feature. */}
        <div class="cc-editor">
          {lowConfidenceRanges.length > 0 && (
            <div class="cc-editor__backdrop textarea textarea--tall" aria-hidden="true" ref={backdropRef}>
              {lowConfidenceSegments.map((segment, index) =>
                segment.isMatch ? (
                  <mark key={index} class="highlight__lowconf">
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                )
              )}
            </div>
          )}
          <textarea
            id="cc-input"
            class={`cc-editor__textarea textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            placeholder="Paste or type text here, or drop a .txt file…"
            value={input}
            onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
            onScroll={(event) => {
              const el = event.target as HTMLTextAreaElement;
              if (backdropRef.current) {
                backdropRef.current.scrollTop = el.scrollTop;
                backdropRef.current.scrollLeft = el.scrollLeft;
              }
              if (hintsRef.current) {
                hintsRef.current.scrollTop = el.scrollTop;
                hintsRef.current.scrollLeft = el.scrollLeft;
              }
            }}
            {...dropHandlers}
          />
          {lowConfidenceRanges.length > 0 && (
            <div class="cc-editor__backdrop cc-editor__hints textarea textarea--tall" aria-hidden="true" ref={hintsRef}>
              {lowConfidenceSegments.map((segment, index) => {
                const hint = lowConfidenceHints[index];
                return segment.isMatch && hint ? (
                  <mark
                    key={index}
                    class="cc-lowconf-hint"
                    tabIndex={0}
                    role="button"
                    title={hint.title}
                    onClick={() => toggleLowConfidenceWord(hint.rangeIndex)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      toggleLowConfidenceWord(hint.rangeIndex);
                    }}
                  >
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                );
              })}
            </div>
          )}
        </div>
        {lowConfidenceRanges.length > 0 && (
          <p class="field__hint cc-sentence-case-warning">
            {lowConfidenceRanges.length} word{lowConfidenceRanges.length === 1 ? '' : 's'} above{' '}
            {lowConfidenceRanges.length === 1 ? 'is' : 'are'} underlined because Sentence case
            wasn't confident {lowConfidenceRanges.length === 1 ? "it's a proper noun" : "they're proper nouns"}{' '}
            — hover a word above for why, or click it to toggle its capitalization.
          </p>
        )}
      </div>

      <div class="field">
        <span class="field__label">
          <span>Change case</span>
          <span class="field__hint">Transforms the text above in place</span>
        </span>
        <div class="tool-bar" role="group" aria-label="Case conversion">
          {CASE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              class="btn"
              onClick={() => applyCase(type)}
              disabled={baseText === ''}
              title={`Convert the text above to ${CASE_LABELS[type]}`}
            >
              {CASE_LABELS[type]}
            </button>
          ))}
          <button
            type="button"
            class="btn"
            onClick={() => void runSentenceCase()}
            disabled={baseText === '' || sentenceCaseLoading}
            title="Best-effort: capitalizes sentence starts and guesses proper nouns using NLP. May be wrong — review highlighted words."
          >
            {sentenceCaseLoading ? 'Sentence case…' : 'Sentence case (beta)'}
          </button>
        </div>
        <p class="field__hint">
          Sentence case (beta) guesses proper nouns automatically using NLP and can be wrong —
          especially for uncommon names, brands, or acronyms. Any word it wasn't confident about
          gets underlined in the text box above for you to review.
        </p>
        <ErrorMessage message={sentenceCaseError} />
      </div>

      <div class="field">
        <span class="field__label">
          <span>Result</span>
          <span class="tool-bar__group">
            <CopyButton value={input} label="Copy text" describe="the converted text" />
          </span>
        </span>
      </div>

      <style>{`
        /* Identical technique to Word Counter's .wc-editor — see that component for the full
           rationale on why every layer shares one grid cell and why only .cc-editor itself
           paints the visible surface color. */
        .cc-editor {
          display: grid;
          background: var(--surface);
          border-radius: var(--radius);
        }
        .cc-editor > * {
          grid-area: 1 / 1 / 2 / 2;
          background: transparent;
        }
        .cc-editor__backdrop {
          margin: 0;
          color: transparent;
          overflow: auto;
          pointer-events: none;
          white-space: pre-wrap;
          word-break: break-word;
          resize: none;
        }
        .cc-editor__textarea {
          position: relative;
        }
        .cc-editor__textarea.textarea--drag-active {
          background: var(--accent-subtle);
        }
        .highlight__lowconf {
          background: var(--warning-subtle); color: transparent;
          border-bottom: 2px dotted var(--warning); border-radius: 2px;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .cc-editor__hints {
          position: relative;
          pointer-events: none;
        }
        .cc-lowconf-hint {
          background: transparent;
          color: transparent;
          pointer-events: auto;
          cursor: pointer;
        }
        .cc-sentence-case-warning {
          color: var(--warning);
        }
      `}</style>
    </div>
  );
}
