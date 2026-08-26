import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  findDuplicates,
  computeStats,
  removeItems,
  indicesForBulkRemoval,
  toDuplicateHighlightSegments,
  toOriginalHighlightSegments,
  toDuplicateHintSegments,
  describeDuplicateOccurrence,
  splitItems,
  itemIndexAtOffset,
  type Granularity,
  type DuplicateOptions,
} from '../lib/tools/duplicateFinder';
import { toHighlightSegments, type TextMatch } from '../lib/tools/wordCounter';
import { readShareStateFromLocation, buildShareUrl } from '../lib/shareLink';
import { writeHandoff } from '../lib/crossToolHandoff';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { CopyButton } from './shared/CopyButton';
import { ErrorMessage } from './shared/ErrorMessage';
import { useTextFileDrop } from './shared/useTextFileDrop';
import { useSyncedBackdropHeight } from './shared/useSyncedBackdropHeight';

/** Diff Checker's own share-state shape (src/islands/DiffChecker.tsx) — duplicated here
 * rather than imported, since importing a *component* file's internal type would pull in
 * that whole island's code. Only the fields Diff Checker's schema requires are set. */
interface DiffCheckerShareState {
  left: string;
  right: string;
  kind: 'text' | 'json';
  mode: 'line' | 'word' | 'char';
  view: 'inline' | 'side-by-side';
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
}

const SAMPLES: Record<Granularity, string> = {
  line: `alice@example.com
bob@example.com
carol@example.com
alice@example.com
dave@example.com
bob@example.com`,
  sentence:
    'Please review the attached invoice before Friday. Let me know if anything looks wrong. ' +
    'Please review the attached invoice before Friday. Thanks for your help this week.',
  paragraph: `Our return policy allows items to be returned within 30 days of purchase for a full refund. Items must be unused and in their original packaging.

Shipping times vary by location, typically arriving within 5 to 7 business days.

Our return policy allows items to be returned within 30 days of purchase for a full refund. Items must be unused and in their original packaging.`,
};

const GRANULARITIES: readonly Granularity[] = ['line', 'sentence', 'paragraph'];

const GRANULARITY_LABELS: Record<Granularity, string> = {
  line: 'Lines',
  sentence: 'Sentences',
  paragraph: 'Paragraphs',
};

const UNIT_LABELS: Record<Granularity, string> = {
  line: 'line',
  sentence: 'sentence',
  paragraph: 'paragraph',
};

const CHIP_TEXT_LIMIT = 60;

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > CHIP_TEXT_LIMIT ? `${trimmed.slice(0, CHIP_TEXT_LIMIT - 1)}…` : trimmed;
}

interface ShareState {
  input: string;
  granularity: Granularity;
  caseSensitive: boolean;
  trimWhitespace: boolean;
  ignoreEmptyLines: boolean;
}

export default function DuplicateLineRemover() {
  const [input, setInput] = useState('');
  // The text as it stood before the most recent removal(s) — typing, loading a sample,
  // dropping a file, or clearing all reset this to match `input` again (a fresh baseline),
  // while every removal action (chip, bulk, "current line") only ever moves `input`,
  // leaving this in place — so "View diff" always compares against the last point the
  // user was freely authoring/loading text, not the very first thing ever typed.
  const [originalText, setOriginalText] = useState('');
  const [granularity, setGranularityState] = useState<Granularity>('line');
  const [caseSensitive, setCaseSensitiveState] = useState(false);
  const [trimWhitespace, setTrimWhitespaceState] = useState(true);
  const [ignoreEmptyLines, setIgnoreEmptyLinesState] = useState(true);
  const [cursorPos, setCursorPos] = useState(0);
  const [diffLinkBusy, setDiffLinkBusy] = useState(false);
  const [diffLinkError, setDiffLinkError] = useState<string | null>(null);
  // A custom-styled tooltip for the in-editor hint marks, positioned in JS (not a native
  // `title`) so it can be styled to match the site — position: fixed, computed from the
  // hovered mark's own bounding box, so it escapes the backdrop layer's `overflow: auto`
  // instead of being clipped by it the way a CSS ::after tooltip anchored to the mark
  // itself would be, and never reflows the surrounding text since it's out of flow.
  const [hoverTooltip, setHoverTooltip] = useState<{ text: string; left: number; top: number; below: boolean } | null>(
    null
  );
  // Item indices marked for removal by clicking a chip. Indices are only meaningful for
  // the text/granularity they were computed against, so every setter that could change
  // what those indices point at also clears this set.
  const [markedForRemoval, setMarkedForRemoval] = useState<Set<number>>(new Set());
  // Hovering/focusing a chip previews that specific occurrence; while nothing is hovered
  // this falls back to wherever the cursor currently is (see effectiveSpotlightIndex),
  // so there's always a visible answer to "what would Remove current line act on".
  const [hoveredChipIndex, setHoveredChipIndex] = useState<number | null>(null);
  // Multi-level undo/redo: a native browser undo can't reliably reverse a programmatic
  // textarea value change (which is how every removal action here works), so this tracks
  // its own history instead. Typed input coalesces into one step per "typing session"
  // (see handleTyping/endTypingSession) rather than one step per keystroke; every removal
  // action, and every discrete load (sample/file/clear), is always its own single step.
  const [pastStates, setPastStates] = useState<string[]>([]);
  const [futureStates, setFutureStates] = useState<string[]>([]);
  const typingSessionActive = useRef(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const originalBackdropRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const spotlightBackdropRef = useRef<HTMLDivElement>(null);
  const markedBackdropRef = useRef<HTMLDivElement>(null);
  const hintsRef = useRef<HTMLDivElement>(null);
  const allBackdropRefs = [originalBackdropRef, backdropRef, spotlightBackdropRef, markedBackdropRef, hintsRef];

  useSyncedBackdropHeight(textareaRef, allBackdropRefs);

  const pushHistoryCheckpoint = () => {
    setPastStates([...pastStates, input]);
    setFutureStates([]);
  };

  const setText = (value: string) => {
    // Discrete, single-shot changes (Load example, Clear, file drop) — always their own step.
    pushHistoryCheckpoint();
    setInput(value);
    setOriginalText(value);
    setMarkedForRemoval(new Set());
    typingSessionActive.current = false;
  };
  /** Removal-only actions: move `input` forward without disturbing `originalText`. */
  const applyRemoval = (value: string) => {
    pushHistoryCheckpoint();
    setInput(value);
    setMarkedForRemoval(new Set());
    typingSessionActive.current = false;
  };
  const handleTyping = (value: string) => {
    if (!typingSessionActive.current) {
      pushHistoryCheckpoint();
      typingSessionActive.current = true;
    }
    setInput(value);
    setOriginalText(value);
    setMarkedForRemoval(new Set());
  };
  const endTypingSession = () => {
    typingSessionActive.current = false;
  };
  const undo = () => {
    if (pastStates.length === 0) return;
    const previous = pastStates[pastStates.length - 1]!;
    setPastStates(pastStates.slice(0, -1));
    setFutureStates([...futureStates, input]);
    setInput(previous);
    setMarkedForRemoval(new Set());
    typingSessionActive.current = false;
  };
  const redo = () => {
    if (futureStates.length === 0) return;
    const next = futureStates[futureStates.length - 1]!;
    setFutureStates(futureStates.slice(0, -1));
    setPastStates([...pastStates, input]);
    setInput(next);
    setMarkedForRemoval(new Set());
    typingSessionActive.current = false;
  };
  const setGranularity = (value: Granularity) => {
    setGranularityState(value);
    setMarkedForRemoval(new Set());
  };
  const setCaseSensitive = (value: boolean) => {
    setCaseSensitiveState(value);
    setMarkedForRemoval(new Set());
  };
  const setTrimWhitespace = (value: boolean) => {
    setTrimWhitespaceState(value);
    setMarkedForRemoval(new Set());
  };
  const setIgnoreEmptyLines = (value: boolean) => {
    setIgnoreEmptyLinesState(value);
    setMarkedForRemoval(new Set());
  };

  const { isDragActive, dropHandlers } = useTextFileDrop(setText);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setOriginalText(restored.value.input);
      setGranularityState(restored.value.granularity);
      setCaseSensitiveState(restored.value.caseSensitive);
      setTrimWhitespaceState(restored.value.trimWhitespace);
      setIgnoreEmptyLinesState(restored.value.ignoreEmptyLines);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  // Global, not scoped to the textarea's own onKeyDown: after clicking a removal button
  // (the most common way undo actually gets triggered), focus sits on that button, not the
  // textarea, so a handler tied only to the textarea would miss Ctrl+Z in exactly the case
  // it's needed for. Skips handling when some *other* text-editing element has focus (e.g.
  // the sidebar's tool search), so this never steals undo from an unrelated field.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      const active = document.activeElement;
      const isForeignInput =
        active instanceof HTMLElement &&
        active !== textareaRef.current &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (isForeignInput) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  const options: DuplicateOptions = useMemo(
    () => ({ granularity, caseSensitive, trimWhitespace, ignoreEmptyLines }),
    [granularity, caseSensitive, trimWhitespace, ignoreEmptyLines]
  );

  const occurrences = useMemo(() => findDuplicates(input, options), [input, options]);
  const stats = useMemo(() => computeStats(occurrences), [occurrences]);
  // Every occurrence involved in a duplicate group — the original included, not just the
  // later repeats — so any one of them can be marked and removed individually.
  const groupedOccurrences = useMemo(() => occurrences.filter((o) => o.hasDuplicates), [occurrences]);

  // Always computed, not just when duplicates exist, so each backdrop's height always
  // mirrors the real textarea — see the identical comment in WordCounter.tsx.
  const originalSegments = useMemo(() => toOriginalHighlightSegments(input, occurrences), [input, occurrences]);
  const duplicateSegments = useMemo(() => toDuplicateHighlightSegments(input, occurrences), [input, occurrences]);
  const hintSegments = useMemo(() => toDuplicateHintSegments(input, occurrences), [input, occurrences]);

  const markedSegments = useMemo(() => {
    const marked = occurrences.filter((o) => markedForRemoval.has(o.itemIndex));
    return toDuplicateHighlightSegments(
      input,
      marked.map((o) => ({ ...o, isDuplicate: true }))
    );
  }, [input, occurrences, markedForRemoval]);

  // The item (of any kind, duplicate or not) the text cursor currently sits inside —
  // recomputed for whichever granularity is active, so switching granularity re-locates
  // the cursor's item under the new split rather than pointing at something stale.
  const allItems = useMemo(() => splitItems(input, granularity), [input, granularity]);
  const currentItemIndex = useMemo(() => itemIndexAtOffset(allItems, cursorPos), [allItems, cursorPos]);
  const unitLabel = UNIT_LABELS[granularity];

  // What "Remove current line" would act on right now, made visible in the editor rather
  // than relying on an often-invisible text caret: hovering/focusing a chip previews that
  // specific occurrence; otherwise it falls back to wherever the cursor actually is.
  const spotlightIndex = hoveredChipIndex ?? (currentItemIndex !== -1 ? currentItemIndex : null);
  const spotlightMatches = useMemo<TextMatch[]>(() => {
    const item = spotlightIndex !== null ? allItems[spotlightIndex] : undefined;
    return item ? [{ start: item.start, end: item.end }] : [];
  }, [allItems, spotlightIndex]);
  const spotlightSegments = useMemo(() => toHighlightSegments(input, spotlightMatches), [input, spotlightMatches]);

  const toggleMark = (itemIndex: number) => {
    setMarkedForRemoval((prev) => {
      const next = new Set(prev);
      if (next.has(itemIndex)) next.delete(itemIndex);
      else next.add(itemIndex);
      return next;
    });
  };

  const removeMarked = () => {
    applyRemoval(removeItems(input, [...markedForRemoval], granularity));
  };
  const removeAllDuplicates = () => {
    applyRemoval(removeItems(input, indicesForBulkRemoval(occurrences, 'removeAllDuplicates'), granularity));
  };
  const keepFirstOccurrenceOnly = () => {
    applyRemoval(removeItems(input, indicesForBulkRemoval(occurrences, 'keepFirstOccurrence'), granularity));
  };
  const removeCurrentItem = () => {
    if (currentItemIndex === -1) return;
    applyRemoval(removeItems(input, [currentItemIndex], granularity));
  };

  const clearAll = () => setText('');

  const trackCursor = (event: { target: EventTarget | null }) => {
    const el = event.target as HTMLTextAreaElement;
    setCursorPos(el.selectionStart);
  };

  const TOOLTIP_MAX_WIDTH = 380;
  const showHint = (event: { currentTarget: EventTarget | null }, text: string) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Flips below when there's not enough room above, and keeps the left edge on-screen —
    // a lightweight clamp, not full viewport-edge detection on every side.
    const below = rect.top < 80;
    setHoverTooltip({
      text,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - TOOLTIP_MAX_WIDTH - 8)),
      top: below ? rect.bottom + 8 : rect.top - 8,
      below,
    });
  };
  const hideHint = () => setHoverTooltip(null);

  const hasEdits = originalText !== '' && input !== originalText;

  const viewDiff = async () => {
    const state: DiffCheckerShareState = {
      left: originalText,
      right: input,
      kind: 'text',
      mode: 'line',
      // Side-by-side rather than inline: removing duplicates is always a pure subtraction
      // (never adds lines), so side-by-side keeps the original fully intact on the left
      // while lining up a blank cell on the right against exactly each removed line —
      // clearer here than inline's interleaved +/- list. Diff Checker's side-by-side is
      // built from the actual diff, aligning by edit rather than raw line position, so it
      // stays correct even though removal shifts every later line's position.
      view: 'side-by-side',
      ignoreCase: false,
      ignoreWhitespace: false,
    };

    // Primary path: hand the text off via sessionStorage, which Diff Checker's own page
    // reads on load — no URL-length cap, since nothing is encoded into the URL at all.
    // Deliberately no 'noopener' here: sessionStorage written just before a same-origin
    // window.open() is only copied into the new tab if the browsing-context-group
    // relationship survives, which 'noopener' would sever. Safe to omit — the destination
    // is always our own /diff-checker/ page, not a third party 'noopener' would guard
    // against.
    if (writeHandoff('diff-checker', state)) {
      window.open('/diff-checker/', '_blank');
      return;
    }

    // Fallback: sessionStorage unavailable (disabled by browser privacy settings, full,
    // etc.) — a share-link URL still works, just with that feature's usual size cap.
    setDiffLinkBusy(true);
    setDiffLinkError(null);
    const result = await buildShareUrl(`${window.location.origin}/diff-checker/`, state);
    setDiffLinkBusy(false);
    if (!result.ok) {
      setDiffLinkError(result.error);
      return;
    }
    window.open(result.value, '_blank', 'noopener');
  };

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Actions">
        <span class="tool-bar__spacer" />
        <ShareLinkButton
          getState={() => ({ input, granularity, caseSensitive, trimWhitespace, ignoreEmptyLines })}
          describe="this text and its options"
        />
        <button type="button" class="btn" onClick={() => setText(SAMPLES[granularity])} title="Load example text">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="tool-bar" role="group" aria-label="Duplicate detection settings">
        <div class="seg" role="group" aria-label="Granularity">
          {GRANULARITIES.map((value) => (
            <button
              key={value}
              type="button"
              class="seg__btn"
              aria-pressed={granularity === value}
              onClick={() => setGranularity(value)}
              title={
                value === 'line'
                  ? 'Treat each line as one unit — best for lists, CSV rows, and log lines'
                  : value === 'sentence'
                    ? 'Treat each sentence as one unit — best for prose'
                    : 'Treat each paragraph as one unit — best for long-form text'
              }
            >
              {GRANULARITY_LABELS[value]}
            </button>
          ))}
        </div>
        <label class="checkbox" title="Compare items exactly, including uppercase/lowercase differences">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive((event.target as HTMLInputElement).checked)}
          />
          Case-sensitive
        </label>
        <label class="checkbox" title="Ignore leading and trailing whitespace when comparing items">
          <input
            type="checkbox"
            checked={trimWhitespace}
            onChange={(event) => setTrimWhitespace((event.target as HTMLInputElement).checked)}
          />
          Trim whitespace
        </label>
        <label class="checkbox" title="Skip blank lines so they're never flagged as duplicates of each other (line mode only)">
          <input
            type="checkbox"
            checked={ignoreEmptyLines}
            onChange={(event) => setIgnoreEmptyLines((event.target as HTMLInputElement).checked)}
          />
          Ignore blank lines
        </label>
      </div>

      <div class="field">
        <div class="field__label">
          <span class="tool-bar__group">
            {/* The <label> wraps only "Text" — nesting the button inside it too would make
                it implicitly associated with the label as well (any focusable descendant
                of a <label> is), so both it and the textarea would answer to the same
                accessible name. Keeping the button as a sibling avoids that ambiguity. */}
            <label for="dup-input">Text</label>
            <button
              type="button"
              class="btn"
              onClick={removeCurrentItem}
              disabled={currentItemIndex === -1}
              title={`Remove the ${unitLabel} your cursor is currently on, whether or not it's a duplicate`}
            >
              Remove current {unitLabel}
            </button>
            <button
              type="button"
              class="btn"
              onClick={undo}
              disabled={pastStates.length === 0}
              title="Undo the last change (Ctrl+Z)"
            >
              <span aria-hidden="true">↶</span> Undo
            </button>
            <button
              type="button"
              class="btn"
              onClick={redo}
              disabled={futureStates.length === 0}
              title="Redo the last undone change (Ctrl+Y)"
            >
              <span aria-hidden="true">↷</span> Redo
            </button>
          </span>
          <span class="field__hint">
            {stats.total.toLocaleString()} {unitLabel}
            {stats.total === 1 ? '' : 's'}
          </span>
        </div>
        {/* Duplicate occurrences are highlighted live directly in the box the user is
            editing, using the same transparent-backdrop-behind-a-transparent-textarea
            technique as WordCounter's find/replace highlight. Three backdrops stack
            behind the real textarea: the "original" occurrence of a duplicated item
            (dashed accent underline), every later duplicate (solid accent underline),
            and — in front of both — anything the user has clicked a chip to mark for
            removal (solid danger underline). A fourth, topmost layer sits *above* the
            textarea and re-enables pointer-events only on its own marks, each carrying
            a `title` with the item's line number and where else it repeats — hover
            info only, so the box stays uncluttered until the user actually asks. */}
        <div class="dup-editor">
          <div class="dup-editor__backdrop textarea textarea--tall" aria-hidden="true" ref={originalBackdropRef}>
            {originalSegments.map((segment, index) =>
              segment.isMatch ? (
                <mark key={index} class="dup-highlight__original">
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
          </div>
          <div class="dup-editor__backdrop textarea textarea--tall" aria-hidden="true" ref={backdropRef}>
            {duplicateSegments.map((segment, index) =>
              segment.isMatch ? (
                <mark key={index} class="highlight__match">
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
          </div>
          {spotlightIndex !== null && (
            <div class="dup-editor__backdrop textarea textarea--tall" aria-hidden="true" ref={spotlightBackdropRef}>
              {spotlightSegments.map((segment, index) =>
                segment.isMatch ? (
                  <mark key={index} class="dup-highlight__spotlight">
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                )
              )}
            </div>
          )}
          {markedForRemoval.size > 0 && (
            <div class="dup-editor__backdrop textarea textarea--tall" aria-hidden="true" ref={markedBackdropRef}>
              {markedSegments.map((segment, index) =>
                segment.isMatch ? (
                  <mark key={index} class="dup-highlight__marked">
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                )
              )}
            </div>
          )}
          <textarea
            id="dup-input"
            ref={textareaRef}
            class={`dup-editor__textarea textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            placeholder="Paste or type text here, or drop a .txt file…"
            value={input}
            onInput={(event) => {
              handleTyping((event.target as HTMLTextAreaElement).value);
              trackCursor(event);
            }}
            onSelect={trackCursor}
            onClick={trackCursor}
            onKeyUp={trackCursor}
            onBlur={endTypingSession}
            onScroll={(event) => {
              const el = event.target as HTMLTextAreaElement;
              for (const ref of allBackdropRefs) {
                if (ref.current) {
                  ref.current.scrollTop = el.scrollTop;
                  ref.current.scrollLeft = el.scrollLeft;
                }
              }
              // The floating tooltip's position is a snapshot from when the hover started;
              // scrolling the box would leave it pointing at stale coordinates, so just
              // dismiss it rather than let it drift out of sync with the text underneath.
              hideHint();
            }}
            {...dropHandlers}
          />
          <div class="dup-editor__backdrop dup-editor__hints" aria-hidden="true" ref={hintsRef}>
            {hintSegments.map((segment, index) =>
              segment.hint ? (
                <mark
                  key={index}
                  class="dup-hint"
                  tabIndex={0}
                  onMouseEnter={(event) => showHint(event, segment.hint!)}
                  onMouseLeave={hideHint}
                  onFocus={(event) => showHint(event, segment.hint!)}
                  onBlur={hideHint}
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
          </div>
        </div>
      </div>

      {hoverTooltip && (
        <div
          class={`dup-tooltip${hoverTooltip.below ? '' : ' dup-tooltip--above'}`}
          style={{ left: `${hoverTooltip.left}px`, top: `${hoverTooltip.top}px` }}
          role="tooltip"
        >
          {hoverTooltip.text}
        </div>
      )}

      <div class="field">
        <span class="field__label">
          <span>Results</span>
          <span class="tool-bar__group">
            <CopyButton value={input} label="Copy text" describe="the text" />
            <button
              type="button"
              class="btn"
              onClick={() => void viewDiff()}
              disabled={!hasEdits || diffLinkBusy}
              title="Open the original text and your current, edited text side-by-side in Diff Checker (opens in a new tab)"
            >
              {diffLinkBusy ? (
                'Preparing…'
              ) : (
                <>
                  View diff <span aria-hidden="true">↗</span>
                </>
              )}
            </button>
          </span>
        </span>
        <ErrorMessage message={diffLinkError} />
        <div class="stats" data-testid="dup-stats">
          <span class="stats__item">
            <strong>{stats.total.toLocaleString()}</strong> total
          </span>
          <span class="stats__item">
            <strong>{stats.unique.toLocaleString()}</strong> unique
          </span>
          <span class="stats__item">
            <strong>{stats.duplicateOccurrences.toLocaleString()}</strong> duplicate
            {stats.duplicateOccurrences === 1 ? '' : 's'}
          </span>
        </div>

        {input !== '' && stats.duplicateOccurrences === 0 && (
          <p class="field__hint dup-no-duplicates">No duplicate {unitLabel}s found — every {unitLabel} is unique.</p>
        )}

        {groupedOccurrences.length > 0 && (
          <>
            <p class="field__hint">Hover an item for its line number and where else it repeats.</p>
            <div class="dup-chips" role="group" aria-label="Occurrences with duplicates">
              {groupedOccurrences.map((o) => {
                const marked = markedForRemoval.has(o.itemIndex);
                return (
                  <button
                    key={o.itemIndex}
                    type="button"
                    class={`dup-chip${marked ? ' dup-chip--marked' : ''}${o.occurrenceNumber === 1 ? ' dup-chip--original' : ''}`}
                    onClick={() => toggleMark(o.itemIndex)}
                    onMouseEnter={() => setHoveredChipIndex(o.itemIndex)}
                    onMouseLeave={() => setHoveredChipIndex(null)}
                    onFocus={() => setHoveredChipIndex(o.itemIndex)}
                    onBlur={() => setHoveredChipIndex(null)}
                    title={`${describeDuplicateOccurrence(o)} — click to ${marked ? 'unmark' : 'mark for removal'}`}
                  >
                    <code class="dup-chip__text">{truncate(o.text)}</code>
                  </button>
                );
              })}
            </div>

            <div class="tool-bar" role="group" aria-label="Bulk removal actions">
              <button
                type="button"
                class="btn"
                onClick={keepFirstOccurrenceOnly}
                title="Remove every repeat, keeping just the first occurrence of each — the standard dedupe"
              >
                Keep first occurrence only
              </button>
              <button
                type="button"
                class="btn"
                onClick={removeAllDuplicates}
                title="Remove every item that has any duplicate, including the first occurrence — leaves only items that were already unique"
              >
                Remove all duplicates
              </button>
              <button
                type="button"
                class="btn btn--primary"
                onClick={removeMarked}
                disabled={markedForRemoval.size === 0}
                title="Remove just the marked occurrences above"
              >
                Remove marked ({markedForRemoval.size})
              </button>
            </div>
          </>
        )}
      </div>

      <style>{`
        .dup-editor {
          display: grid;
          background: var(--surface);
          border-radius: var(--radius);
        }
        .dup-editor > * {
          grid-area: 1 / 1 / 2 / 2;
          background: transparent;
        }
        .dup-editor__backdrop {
          margin: 0;
          color: transparent;
          overflow: auto;
          pointer-events: none;
          white-space: pre-wrap;
          word-break: break-word;
          resize: none;
        }
        .dup-editor__textarea {
          position: relative;
        }
        .dup-editor__textarea.textarea--drag-active {
          background: var(--accent-subtle);
        }
        /* A <mark> spanning a whole sentence/paragraph routinely wraps across several
           visual lines. By default (box-decoration-break: slice), a browser treats a
           wrapped inline box as one continuous box sliced by the wrap, so every
           fragment except the last renders its border at the *full available line
           width* rather than clipped to the actual text — visible as the underline
           running on well past where the highlighted text ends. box-decoration-break:
           clone makes each wrapped fragment size and border itself independently,
           matching only its own text. Applies to every bordered mark below. */
        .highlight__match,
        .dup-highlight__original,
        .dup-highlight__marked {
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .highlight__match {
          background: var(--accent-subtle); color: transparent;
          border-bottom: 2px solid var(--accent); border-radius: 2px;
        }
        /* The source of a duplicate group: an outline rather than a solid fill, so it
           reads as "this is where the copies came from" rather than "this is a copy". */
        .dup-highlight__original {
          background: transparent; color: transparent;
          border-bottom: 2px dashed var(--accent); border-radius: 2px;
        }
        .dup-highlight__marked {
          background: var(--danger-subtle); color: transparent;
          border-bottom: 2px solid var(--danger); border-radius: 2px;
        }
        /* No border, unlike the three states above — reads as "this row" rather than
           another kind of match. Shows what "Remove current line" would act on (the
           cursor's item) by default, or whichever chip is being hovered/focused instead. */
        .dup-highlight__spotlight {
          background: var(--warning-subtle); color: transparent;
        }
        .dup-no-duplicates {
          color: var(--success);
        }
        /* The topmost, hover-only layer: invisible and pointer-events: none by default so
           clicking/typing falls through to the real textarea underneath, matching
           WordCounter's .wc-editor__hints technique. Only .dup-hint marks re-enable
           pointer events, turning just the exact span covering a duplicate item into a
           real hover/focus target for the custom tooltip below — line number and
           cross-references are deliberately hover-only rather than shown by default, to
           keep the box readable. */
        .dup-editor__hints {
          position: relative;
          pointer-events: none;
        }
        .dup-hint {
          background: transparent;
          color: transparent;
          pointer-events: auto;
          cursor: help;
        }
        .dup-hint:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        /* Positioned in JS from the hovered mark's own bounding box (see showHint) —
           position: fixed escapes the backdrop's overflow: auto instead of being clipped
           by it, and never disturbs the surrounding text's layout since it's out of flow
           entirely. .dup-tooltip--above anchors its bottom edge above the mark; the
           default (no modifier) grows down from below it. */
        .dup-tooltip {
          position: fixed;
          z-index: 1000;
          max-width: 380px;
          background: var(--surface-2);
          color: var(--text);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius);
          padding: var(--space-2) var(--space-3);
          font-size: var(--text-xs);
          line-height: 1.4;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
          pointer-events: none;
        }
        .dup-tooltip--above {
          transform: translateY(-100%);
        }
        .dup-chips {
          display: flex; flex-wrap: wrap; gap: var(--space-2);
          margin-top: var(--space-2);
          max-height: 16rem; overflow-y: auto;
        }
        /* Colored to match each item's own highlight in the editor above, so the chip
           and the highlighted text it corresponds to read as the same state: solid
           accent = duplicate, dashed accent = the original it was copied from, solid
           danger = marked for removal (overriding whichever of the first two applied). */
        .dup-chip {
          border: 1px solid var(--accent); border-radius: var(--radius);
          background: var(--accent-subtle); padding: .3rem .6rem;
          font-size: var(--text-sm); cursor: pointer; text-align: left;
        }
        .dup-chip:hover {
          border-color: var(--accent);
          filter: brightness(1.05);
        }
        .dup-chip--original {
          border-style: dashed;
          background: transparent;
        }
        .dup-chip--marked {
          border-color: var(--danger-border); border-style: solid; background: var(--danger-subtle);
        }
        .dup-chip__text {
          color: var(--text); word-break: break-all;
        }
      `}</style>
    </div>
  );
}
