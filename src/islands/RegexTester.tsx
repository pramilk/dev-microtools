import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  runRegex,
  toSegments,
  applyReplace,
  explainRegex,
  testLines,
  REGEX_FLAGS,
  COMMON_PATTERNS,
  buildPatternTree,
  flattenPatternGroups,
  detectFlavorHints,
  GROUP_TINT_COUNT,
  type PatternSegmentNode,
} from '../lib/tools/regex';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

const SAMPLE = COMMON_PATTERNS[0]!;

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
}

export default function RegexTester() {
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('g');
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
      setSubject(restored.value.subject);
      if (restored.value.replacement !== '') {
        setReplacement(restored.value.replacement);
        setShowReplace(true);
      }
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const run = useMemo(() => {
    if (pattern === '' || subject === '') return null;
    return runRegex(pattern, flags, subject);
  }, [pattern, flags, subject]);

  const matches = run?.ok ? run.value.matches : [];
  const error = run && !run.ok ? run.error : null;

  const segments = useMemo(
    () => (run?.ok ? toSegments(subject, matches) : []),
    [run, subject, matches]
  );

  const replaced = useMemo(() => {
    if (!showReplace || pattern === '' || subject === '') return null;
    return applyReplace(pattern, flags, subject, replacement);
  }, [showReplace, pattern, flags, subject, replacement]);

  const explanation = useMemo(() => {
    if (!showExplain || pattern === '') return null;
    return explainRegex(pattern, flags);
  }, [showExplain, pattern, flags]);

  const lineResults = useMemo(() => {
    if (!showLineTest || pattern === '' || testList === '') return null;
    return testLines(pattern, flags, testList);
  }, [showLineTest, pattern, flags, testList]);

  const patternTree = useMemo(() => (pattern !== '' ? buildPatternTree(pattern) : []), [pattern]);
  const groupList = useMemo(() => flattenPatternGroups(patternTree), [patternTree]);
  const nameToIndex = useMemo(
    () => new Map(groupList.filter((g) => g.name !== undefined).map((g) => [g.name!, g.index])),
    [groupList]
  );
  const flavorHints = useMemo(() => (pattern !== '' ? detectFlavorHints(pattern) : []), [pattern]);

  const toggleFlag = (flag: string) => {
    setFlags((current) =>
      current.includes(flag) ? current.replace(flag, '') : current + flag
    );
  };

  return (
    <div class="tool">
      <div class="field">
        <label class="field__label" for="rx-pattern">
          <span>Regular expression</span>
          <span class="field__hint">JavaScript flavour</span>
        </label>
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

        <span class="tool-bar__spacer" />
        <ShareLinkButton
          getState={() => ({ pattern, flags, subject, replacement: showReplace ? replacement : '' })}
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
      </div>

      <ErrorMessage message={error} />

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
          <span class="field__label">
            <span>Match details</span>
            <span class="field__hint">Position and captured groups</span>
          </span>
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
        .rx-preset-select { width: auto; max-width: 12rem; font-size: var(--text-sm); }
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
