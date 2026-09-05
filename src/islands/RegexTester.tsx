import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  toSegments,
  explainRegex,
  REGEX_FLAGS,
  REGEX_FLAVORS,
  COMMON_PATTERNS,
  buildPatternTree,
  flattenPatternGroups,
  detectFlavorHints,
  resolveFlavorPattern,
  GROUP_TINT_COUNT,
  type PatternSegmentNode,
  type RegexRun,
  type LineTestResult,
  type RegexFlavor,
} from '../lib/tools/regex';
import { ok, err, type ToolResult } from '../lib/tools/result';
import { readShareStateFromLocation } from '../lib/shareLink';
import { CopyButton } from './shared/CopyButton';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';
import { useWorkerTask, WorkerTimeoutError } from './shared/useWorkerTask';
import RegexWorker from '../workers/regex.worker?worker';
import type { RegexWorkerRequest, RegexWorkerResult } from '../workers/regex.worker';

/**
 * Debounce before a keystroke actually triggers a worker round-trip — cheap insurance
 * against posting a message per keystroke on a fast typist, matching the same reasoning
 * as the Image Compressor's quality-slider debounce.
 */
const REGEX_DEBOUNCE_MS = 150;

/**
 * How long a single run/replace/line-test call gets before `useWorkerTask` terminates and
 * replaces the worker. `regex.ts`'s own static guard (`hasCatastrophicBacktrackingRisk`)
 * already refuses the textbook catastrophic-backtracking shape once text is long enough to
 * matter, and rejects fast — well under this — for anything it flags. This timeout exists
 * for what that guard deliberately doesn't catch (its own doc names ambiguous alternation
 * like `(a|a)*` as a known miss): the actual, final backstop PLAN.md's 12.1 note deferred
 * to this Web Worker migration, since only a worker can be killed mid-execution.
 */
const REGEX_TIMEOUT_MS = 2000;

const TIMEOUT_MESSAGE =
  'This pattern took too long to run and was stopped — it likely has catastrophic backtracking on this text (a shape like "(a|a)*" that the quick check above does not catch). Simplify the pattern or shorten the text.';

const SAMPLE = COMMON_PATTERNS[0]!;

/** The flag set a fresh page starts with, so Clear can restore it rather than guessing. */
const DEFAULT_FLAGS = 'g';

const tintClass = (index: number): string => `group-tint-${(index - 1) % GROUP_TINT_COUNT}`;

/** Renders a pattern's parsed tree, tinting each capturing group so it can be visually paired with its match. */
function renderPatternTree(nodes: PatternSegmentNode[]): ComponentChildren {
  return nodes.map((node, i) => {
    if (node.type === 'text') return <span key={i}>{node.text}</span>;
    return (
      <mark
        key={i}
        class={`pattern-group ${tintClass(node.index)}`}
        title={node.name ? `Group "${node.name}"` : `Group ${node.index}`}
      >
        <sup class="pattern-group__badge">{node.name ?? node.index}</sup>
        {renderPatternTree(node.children)}
      </mark>
    );
  });
}

interface ShareState {
  pattern: string;
  flags: string;
  subject: string;
  replacement: string;
  flavor?: RegexFlavor;
}

/** The flavour a fresh page starts with — the engine this tool actually runs, no translation. */
const DEFAULT_FLAVOR: RegexFlavor = 'javascript';

export default function RegexTester() {
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState(DEFAULT_FLAGS);
  const [flavor, setFlavor] = useState<RegexFlavor>(DEFAULT_FLAVOR);
  const [subject, setSubject] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [showExplain, setShowExplain] = useState(false);
  const [showLineTest, setShowLineTest] = useState(false);
  const [testList, setTestList] = useState('');
  const subjectDrop = useTextFileDrop(setSubject);

  // Restore state from a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setPattern(restored.value.pattern);
      setFlags(restored.value.flags);
      // Fall back for links made before flavour was shared, rather than restoring `undefined`.
      setFlavor(restored.value.flavor ?? DEFAULT_FLAVOR);
      setSubject(restored.value.subject);
      if (restored.value.replacement !== '') {
        setReplacement(restored.value.replacement);
        setShowReplace(true);
      }
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  // The pattern/flags actually compiled and run: identical to what was typed in JavaScript
  // mode, or translated from the selected flavour's syntax otherwise (see resolveFlavorPattern's
  // doc comment on why this is a syntax bridge rather than a real second engine).
  const resolved = useMemo(() => resolveFlavorPattern(pattern, flags, flavor), [pattern, flags, flavor]);
  const flavorError = resolved.ok ? null : resolved.error;
  const effectivePattern = resolved.ok ? resolved.value.pattern : '';
  const effectiveFlags = resolved.ok ? resolved.value.flags : flags;
  const flavorNotes = resolved.ok ? resolved.value.notes : [];

  const regexWorkerTask = useWorkerTask<RegexWorkerRequest, RegexWorkerResult>(() => new RegexWorker());

  const timeoutMessage = (thrown: unknown, fallback: string): string =>
    thrown instanceof WorkerTimeoutError ? TIMEOUT_MESSAGE : thrown instanceof Error ? thrown.message : fallback;

  const [run, setRun] = useState<ToolResult<RegexRun> | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const runRequestId = useRef(0);

  // Matching runs in a worker (see regex.worker.ts) so a pattern the static ReDoS guard
  // misses hangs that worker instead of the tab — recoverable via the timeout above.
  // Debounced so a fast typist doesn't post a worker message per keystroke.
  useEffect(() => {
    if (pattern === '' || subject === '') {
      setRun(null);
      setRunBusy(false);
      return;
    }
    if (flavorError) {
      setRun(err(flavorError));
      setRunBusy(false);
      return;
    }
    const id = (runRequestId.current += 1);
    const timer = window.setTimeout(() => {
      setRunBusy(true);
      regexWorkerTask
        .run({ kind: 'run', pattern: effectivePattern, flags: effectiveFlags, subject }, { timeoutMs: REGEX_TIMEOUT_MS })
        .then(
          (result) => {
            if (id !== runRequestId.current || result.kind !== 'run') return;
            setRunBusy(false);
            setRun(ok(result.value));
          },
          (thrown: unknown) => {
            if (id !== runRequestId.current) return;
            setRunBusy(false);
            setRun(err(timeoutMessage(thrown, 'Something went wrong running that pattern.')));
          }
        );
    }, REGEX_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, effectivePattern, effectiveFlags, flavorError, subject]);

  const matches = run?.ok ? run.value.matches : [];
  const error = run && !run.ok ? run.error : null;

  const segments = useMemo(
    () => (run?.ok ? toSegments(subject, matches) : []),
    [run, subject, matches]
  );

  const [replaced, setReplaced] = useState<ToolResult<string> | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const replaceRequestId = useRef(0);

  useEffect(() => {
    if (!showReplace || pattern === '' || subject === '') {
      setReplaced(null);
      setReplaceBusy(false);
      return;
    }
    if (flavorError) {
      setReplaced(err(flavorError));
      setReplaceBusy(false);
      return;
    }
    const id = (replaceRequestId.current += 1);
    const timer = window.setTimeout(() => {
      setReplaceBusy(true);
      regexWorkerTask
        .run(
          { kind: 'replace', pattern: effectivePattern, flags: effectiveFlags, subject, replacement },
          { timeoutMs: REGEX_TIMEOUT_MS }
        )
        .then(
          (result) => {
            if (id !== replaceRequestId.current || result.kind !== 'replace') return;
            setReplaceBusy(false);
            setReplaced(ok(result.value));
          },
          (thrown: unknown) => {
            if (id !== replaceRequestId.current) return;
            setReplaceBusy(false);
            setReplaced(err(timeoutMessage(thrown, 'Could not apply that replacement.')));
          }
        );
    }, REGEX_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReplace, pattern, effectivePattern, effectiveFlags, flavorError, subject, replacement]);

  const explanation = useMemo(() => {
    if (!showExplain || pattern === '') return null;
    if (flavorError) return err(flavorError);
    return explainRegex(effectivePattern, effectiveFlags);
  }, [showExplain, pattern, effectivePattern, effectiveFlags, flavorError]);

  const [lineResults, setLineResults] = useState<ToolResult<LineTestResult[]> | null>(null);
  const [lineTestBusy, setLineTestBusy] = useState(false);
  const lineTestRequestId = useRef(0);

  useEffect(() => {
    if (!showLineTest || pattern === '' || testList === '') {
      setLineResults(null);
      setLineTestBusy(false);
      return;
    }
    if (flavorError) {
      setLineResults(err(flavorError));
      setLineTestBusy(false);
      return;
    }
    const id = (lineTestRequestId.current += 1);
    const timer = window.setTimeout(() => {
      setLineTestBusy(true);
      regexWorkerTask
        .run({ kind: 'testLines', pattern: effectivePattern, flags: effectiveFlags, subject: testList }, { timeoutMs: REGEX_TIMEOUT_MS })
        .then(
          (result) => {
            if (id !== lineTestRequestId.current || result.kind !== 'testLines') return;
            setLineTestBusy(false);
            setLineResults(ok(result.value));
          },
          (thrown: unknown) => {
            if (id !== lineTestRequestId.current) return;
            setLineTestBusy(false);
            setLineResults(err(timeoutMessage(thrown, 'Something went wrong testing those lines.')));
          }
        );
    }, REGEX_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLineTest, pattern, effectivePattern, effectiveFlags, flavorError, testList]);

  const patternTree = useMemo(() => (pattern !== '' ? buildPatternTree(pattern) : []), [pattern]);
  const groupList = useMemo(() => flattenPatternGroups(patternTree), [patternTree]);
  const nameToIndex = useMemo(
    () => new Map(groupList.filter((g) => g.name !== undefined).map((g) => [g.name!, g.index])),
    [groupList]
  );
  // Only nudges toward the flavour selector while still in JavaScript mode — once a
  // flavour is picked, that same syntax is deliberately translated instead of flagged.
  const flavorHints = useMemo(
    () => (flavor === 'javascript' && pattern !== '' ? detectFlavorHints(pattern) : []),
    [flavor, pattern]
  );

  const toggleFlag = (flag: string) => {
    setFlags((current) =>
      current.includes(flag) ? current.replace(flag, '') : current + flag
    );
  };

  /**
   * The matched text, one match per line — the extraction people actually want off this
   * tool ("give me every email in that log"), rather than a transcript of the detail
   * cards. Deliberately covers *every* match, including any beyond the 100 the list
   * renders, since the cap is a display concern and a truncated copy would be a trap.
   */
  const matchListText = matches.map((match) => match.text).join('\n');

  // Nothing typed and no flag touched: Clear would be a no-op, so it stays disabled.
  const isEmpty =
    pattern === '' &&
    subject === '' &&
    replacement === '' &&
    testList === '' &&
    flags === DEFAULT_FLAGS &&
    flavor === DEFAULT_FLAVOR;

  const clearAll = () => {
    setPattern('');
    setFlags(DEFAULT_FLAGS);
    setFlavor(DEFAULT_FLAVOR);
    setSubject('');
    setReplacement('');
    setTestList('');
    // The three panel toggles are left as they are on purpose. They are a choice about
    // which parts of the tool are on screen, not content — collapsing a panel the user
    // opened, while they are clearing input to try something else in it, is a surprise.
  };

  return (
    <div class="tool">
      <div class="field">
        <div class="field__label">
          <label for="rx-pattern">Regular expression</label>
          <select
            id="rx-flavor"
            class="select rx-flavor-select"
            aria-label="Regex flavour"
            title="Which engine's syntax to read the pattern as. This tool only runs JavaScript's engine — the other flavours translate their syntax to JavaScript's first and note any approximation made."
            value={flavor}
            onChange={(event) => setFlavor((event.target as HTMLSelectElement).value as RegexFlavor)}
          >
            {REGEX_FLAVORS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div class="rx-input">
          <span class="rx-input__delim" aria-hidden="true">
            /
          </span>
          <input
            id="rx-pattern"
            class="input rx-input__field"
            spellcheck={false}
            autocomplete="off"
            placeholder="\\d{3}-\\d{4}"
            value={pattern}
            aria-invalid={error !== null}
            onInput={(event) => setPattern((event.target as HTMLInputElement).value)}
          />
          <span class="rx-input__delim" aria-hidden="true">
            /{flags}
          </span>
        </div>
        <p class="field__hint rx-flavor-status">
          {(() => {
            if (flavor === 'javascript') {
              return 'Running as JavaScript — the engine this tool actually executes, no translation.';
            }
            const label = REGEX_FLAVORS.find((f) => f.id === flavor)?.label;
            if (flavorError) return `Read as ${label} syntax — this pattern can't be translated to JavaScript, see below.`;
            if (flavorNotes.length === 0) {
              return `Read as ${label} syntax — identical to JavaScript here, so nothing needed translating.`;
            }
            return `Read as ${label} syntax — translated before running, see the notes below.`;
          })()}
        </p>
      </div>

      {flavorHints.length > 0 && (
        <div class="msg-list">
          {flavorHints.map((hint, index) => (
            <p key={index} class="msg msg--warning">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>{hint}</span>
            </p>
          ))}
        </div>
      )}

      {flavorNotes.length > 0 && (
        <div class="msg-list">
          {flavorNotes.map((note, index) => (
            <p key={index} class="msg msg--info">
              <span class="msg__icon" aria-hidden="true">
                ⓘ
              </span>
              <span>{note}</span>
            </p>
          ))}
        </div>
      )}

      {groupList.length > 0 && (
        <div class="field">
          <span class="field__label">
            <span>Pattern groups</span>
            <span class="field__hint">Each capturing group is tinted, and matches the same tint below</span>
          </span>
          <div class="pattern-breakdown" aria-hidden="true">
            {renderPatternTree(patternTree)}
          </div>
        </div>
      )}

      <label class="checkbox" title="Break the pattern down into a plain-English, step-by-step description">
        <input
          type="checkbox"
          checked={showExplain}
          onChange={(event) => setShowExplain((event.target as HTMLInputElement).checked)}
        />
        Explain this pattern
      </label>

      {showExplain && explanation && (
        <div class="field">
          {explanation.ok ? (
            <ul class="explain-list">
              {explanation.value.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : (
            <ErrorMessage message={explanation.error} />
          )}
        </div>
      )}

      <div class="tool-bar" role="group" aria-label="Flags">
        {REGEX_FLAGS.map(({ flag, label, hint }) => (
          <button
            key={flag}
            type="button"
            class="flag"
            aria-pressed={flags.includes(flag)}
            title={hint}
            onClick={() => toggleFlag(flag)}
          >
            <code>{flag}</code> {label}
          </button>
        ))}

        {/* Its own auto-margin, not the usual bare .tool-bar__spacer, so this whole
            cluster stays right-aligned even when it wraps to its own line below the
            flags — a bare spacer only pushes whatever shares its own flex line. */}
        <div class="tool-bar__group rx-actions">
          <ShareLinkButton
            getState={() => ({ pattern, flags, flavor, subject, replacement: showReplace ? replacement : '' })}
            describe="this pattern"
          />
          <select
            class="input rx-preset-select"
            aria-label="Load a common pattern"
            title="Start from a ready-made pattern for a common case"
            value=""
            onChange={(event) => {
              const select = event.target as HTMLSelectElement;
              const preset = COMMON_PATTERNS.find((p) => p.id === select.value);
              if (preset) {
                setPattern(preset.pattern);
                setFlags(preset.flags);
                setSubject(preset.sample);
              }
              select.value = '';
            }}
          >
            <option value="" disabled>
              Common patterns…
            </option>
            {COMMON_PATTERNS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            class="btn"
            onClick={() => {
              setPattern(SAMPLE.pattern);
              setSubject(SAMPLE.sample);
              setFlags(SAMPLE.flags);
            }}
            title="Load an example pattern and text to try the tool"
          >
            Load example
          </button>
          <button
            type="button"
            class="btn"
            onClick={clearAll}
            disabled={isEmpty}
            title="Clear the pattern, flags and text, and start over"
          >
            Clear
          </button>
        </div>
      </div>

      <ErrorMessage message={error} />

      {runBusy && (
        <p class="field__hint">
          <span class="job__spinner" aria-hidden="true" /> Testing pattern…
        </p>
      )}

      <div class="field">
        <label class="field__label" for="rx-subject">
          <span>Test string</span>
          <span class="field__hint">
            {run?.ok
              ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`
              : `${subject.length.toLocaleString()} characters`}
          </span>
        </label>
        <textarea
          id="rx-subject"
          class={`textarea${subjectDrop.isDragActive ? ' textarea--drag-active' : ''}`}
          spellcheck={false}
          autocomplete="off"
          placeholder="Paste the text you want to test against, or drop a file here…"
          value={subject}
          onInput={(event) => setSubject((event.target as HTMLTextAreaElement).value)}
          {...subjectDrop.dropHandlers}
        />
      </div>

      {run?.ok && run.value.hasEmptyMatch && (
        <p class="msg msg--warning">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <span>
            This pattern can match an empty string, which usually means a quantifier such as
            <code> * </code> should be <code>+</code>.
          </span>
        </p>
      )}

      {segments.length > 0 && (
        <div class="field">
          <span class="field__label">Highlighted matches</span>
          <div class="highlight" aria-label="Test string with matches highlighted">
            {segments.map((segment, index) =>
              segment.isMatch ? (
                <mark key={index} class="highlight__match">
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
          </div>
        </div>
      )}

      {matches.length > 0 && (
        <div class="field">
          <div class="field__label">
            <span>Match details</span>
            <span class="tool-bar__group">
              <span class="field__hint">Position and captured groups</span>
              <CopyButton value={matchListText} label="Copy matches" describe="the match list" />
            </span>
          </div>
          <div class="match-list">
            {matches.slice(0, 100).map((match, index) => (
              <div key={index} class="match">
                <div class="match__head">
                  <span class="match__num">#{index + 1}</span>
                  <code class="match__text">{match.text === '' ? '(empty)' : match.text}</code>
                  <span class="match__pos tnum">at {match.index}</span>
                </div>
                {match.groups.length > 0 && (
                  <div class="match__groups">
                    {match.groups.map((group, groupIndex) => (
                      <span key={groupIndex} class={`match__group ${tintClass(groupIndex + 1)}`}>
                        <span class="match__group-name">${groupIndex + 1}</span>
                        <code>{group ?? '(undefined)'}</code>
                      </span>
                    ))}
                    {Object.entries(match.named).map(([name, group]) => {
                      const groupIndex = nameToIndex.get(name);
                      return (
                        <span
                          key={name}
                          class={`match__group${groupIndex !== undefined ? ` ${tintClass(groupIndex)}` : ''}`}
                        >
                          <span class="match__group-name">{name}</span>
                          <code>{group ?? '(undefined)'}</code>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {matches.length > 100 && (
              <p class="field__hint">
                Showing the first 100 of {matches.length.toLocaleString()} matches.
              </p>
            )}
          </div>
        </div>
      )}

      <label class="checkbox" title="Test each line of a list independently — useful for validating a batch of values">
        <input
          type="checkbox"
          checked={showLineTest}
          onChange={(event) => setShowLineTest((event.target as HTMLInputElement).checked)}
        />
        Test a list of lines
      </label>

      {showLineTest && (
        <>
          <div class="field">
            <label class="field__label" for="rx-line-test">
              <span>One item per line</span>
              <span class="field__hint">Each line is tested against the pattern on its own</span>
            </label>
            <textarea
              id="rx-line-test"
              class="textarea"
              spellcheck={false}
              autocomplete="off"
              placeholder={'ada@example.com\nnot-an-email\ngrace.hopper@navy.mil'}
              value={testList}
              onInput={(event) => setTestList((event.target as HTMLTextAreaElement).value)}
            />
          </div>

          {lineTestBusy && (
            <p class="field__hint">
              <span class="job__spinner" aria-hidden="true" /> Testing lines…
            </p>
          )}

          {lineResults && !lineResults.ok && <ErrorMessage message={lineResults.error} />}

          {lineResults?.ok && (
            <div class="field">
              <span class="field__label">
                <span>Results</span>
                <span class="field__hint">
                  {lineResults.value.filter((r) => r.matched).length} of {lineResults.value.length} match
                </span>
              </span>
              <div class="line-results">
                {lineResults.value.map((row, index) => (
                  <div key={index} class={`line-row${row.matched ? ' line-row--pass' : ' line-row--fail'}`}>
                    <span class="line-row__icon" aria-hidden="true">
                      {row.matched ? '✓' : '✗'}
                    </span>
                    <code class="line-row__text">{row.line === '' ? '(empty line)' : row.line}</code>
                    {row.matched && row.matchCount > 1 && (
                      <span class="line-row__count">×{row.matchCount}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <label class="checkbox" title="Preview a find-and-replace using this pattern, without changing anything">
        <input
          type="checkbox"
          checked={showReplace}
          onChange={(event) => setShowReplace((event.target as HTMLInputElement).checked)}
        />
        Show replace
      </label>

      {showReplace && (
        <>
          <div class="field">
            <label class="field__label" for="rx-replacement">
              <span>Replacement</span>
              <span class="field__hint">
                Use <code>$1</code> or <code>$&lt;name&gt;</code> for captured groups
              </span>
            </label>
            <input
              id="rx-replacement"
              class="input"
              spellcheck={false}
              autocomplete="off"
              placeholder="$<user> at $<domain>"
              value={replacement}
              onInput={(event) => setReplacement((event.target as HTMLInputElement).value)}
            />
          </div>

          {replaceBusy && (
            <p class="field__hint">
              <span class="job__spinner" aria-hidden="true" /> Replacing…
            </p>
          )}

          {replaced && !replaced.ok && <ErrorMessage message={replaced.error} />}

          <OutputPane
            label="Result after replace"
            value={replaced?.ok ? replaced.value : ''}
            placeholder="Replacement output appears here."
            describe="replaced text"
          />
        </>
      )}

      <style>{`
        .rx-input { display: flex; align-items: stretch; gap: var(--space-2); }
        .rx-input__delim {
          display: flex; align-items: center; font-family: var(--font-mono);
          color: var(--text-subtle); font-size: var(--text-sm);
        }
        .rx-input__field { flex: 1; }
        .rx-flavor-status { margin: var(--space-2) 0 0; }
        .rx-actions { margin-left: auto; }
        .rx-preset-select { width: auto; max-width: 12rem; font-size: var(--text-sm); }
        .rx-flavor-select { width: auto; max-width: 11rem; font-size: var(--text-xs); padding: 0.25rem 0.5rem; }
        .msg-list { display: flex; flex-direction: column; gap: var(--space-2); }
        .pattern-breakdown {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface-2); padding: var(--space-3);
          font-family: var(--font-mono); font-size: var(--text-sm);
          white-space: pre-wrap; word-break: break-word; line-height: 1.9;
        }
        .pattern-group {
          border-radius: 3px; padding: 0 2px; position: relative;
        }
        .pattern-group__badge {
          font-family: var(--font-sans); font-size: 0.6em; font-weight: 700;
          color: var(--text-muted); margin-right: 1px;
        }
        .flag {
          display: inline-flex; align-items: center; gap: .4em;
          padding: .25rem .6rem; border: 1px solid var(--border-strong);
          border-radius: var(--radius); background: var(--surface);
          color: var(--text-muted); font: inherit; font-size: var(--text-xs);
          cursor: pointer;
        }
        .flag:hover { background: var(--surface-2); color: var(--text); }
        .flag[aria-pressed="true"] {
          background: var(--accent); color: var(--accent-contrast); border-color: var(--accent);
        }
        .flag code { font-weight: 700; }
        .highlight {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface-2); padding: var(--space-3);
          font-family: var(--font-mono); font-size: var(--text-sm);
          white-space: pre-wrap; word-break: break-word; line-height: 1.6;
          max-height: 18rem; overflow-y: auto;
        }
        .highlight__match {
          background: var(--accent-subtle); color: var(--text);
          border-bottom: 2px solid var(--accent); border-radius: 2px; padding: 0 1px;
        }
        .match-list {
          display: flex; flex-direction: column; gap: var(--space-2);
          max-height: 22rem; overflow-y: auto;
        }
        .match {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-2) var(--space-3);
          display: flex; flex-direction: column; gap: var(--space-2);
        }
        .match__head { display: flex; align-items: center; gap: var(--space-3); }
        .match__num {
          font-family: var(--font-mono); font-size: var(--text-xs);
          color: var(--text-subtle); font-weight: 600;
        }
        .match__text { flex: 1; word-break: break-all; font-size: var(--text-sm); }
        .match__pos { font-size: var(--text-xs); color: var(--text-subtle); }
        .match__groups { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .match__group {
          display: inline-flex; align-items: center; gap: .4em;
          background: var(--surface-2); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: .1em .5em; font-size: var(--text-xs);
        }
        .match__group-name {
          font-family: var(--font-mono); color: var(--accent); font-weight: 600;
        }
        .explain-list {
          margin: 0; padding-left: var(--space-5);
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
          display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--text-sm);
        }
        .line-results {
          display: flex; flex-direction: column; gap: var(--space-1);
          max-height: 18rem; overflow-y: auto;
        }
        .line-row {
          display: flex; align-items: center; gap: var(--space-2);
          border: 1px solid var(--border); border-radius: var(--radius);
          padding: .25rem .6rem; font-size: var(--text-sm);
        }
        .line-row--pass { border-color: var(--success-border); background: var(--success-subtle); }
        .line-row--fail { border-color: var(--danger-border); background: var(--danger-subtle); }
        .line-row--pass .line-row__icon { color: var(--success); }
        .line-row--fail .line-row__icon { color: var(--danger); }
        .line-row__text { flex: 1; word-break: break-all; }
        .line-row__count { font-size: var(--text-xs); color: var(--text-muted); }

        /* Group tints: shades of the single accent colour, cycled by group index, so a
           group's colour in the pattern breakdown matches its colour in match details. */
        .group-tint-0 { background: color-mix(in srgb, var(--accent) 16%, transparent); }
        .group-tint-1 { background: color-mix(in srgb, var(--accent) 30%, transparent); }
        .group-tint-2 { background: color-mix(in srgb, var(--accent) 44%, transparent); }
        .group-tint-3 { background: color-mix(in srgb, var(--accent) 58%, transparent); }
        .group-tint-4 { background: color-mix(in srgb, var(--accent) 24%, transparent); outline: 1px dashed var(--accent-border); }
      `}</style>
    </div>
  );
}
