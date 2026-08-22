import { useMemo, useState } from 'preact/hooks';
import { runRegex, toSegments, applyReplace, REGEX_FLAGS } from '../lib/tools/regex';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';

const SAMPLE_PATTERN = '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+\\.[\\w.]+)';
const SAMPLE_TEXT = `Contact ada@example.com or grace.hopper@navy.mil.
Invalid: not-an-email@, @nope.com`;

export default function RegexTester() {
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('g');
  const [subject, setSubject] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);

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
        <button
          type="button"
          class="btn"
          onClick={() => {
            setPattern(SAMPLE_PATTERN);
            setSubject(SAMPLE_TEXT);
            setFlags('g');
          }}
        >
          Load sample
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
          class="textarea"
          spellcheck={false}
          autocomplete="off"
          placeholder="Paste the text you want to test against…"
          value={subject}
          onInput={(event) => setSubject((event.target as HTMLTextAreaElement).value)}
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
                      <span key={groupIndex} class="match__group">
                        <span class="match__group-name">${groupIndex + 1}</span>
                        <code>{group ?? '(undefined)'}</code>
                      </span>
                    ))}
                    {Object.entries(match.named).map(([name, group]) => (
                      <span key={name} class="match__group">
                        <span class="match__group-name">{name}</span>
                        <code>{group ?? '(undefined)'}</code>
                      </span>
                    ))}
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

      <label class="checkbox">
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
      `}</style>
    </div>
  );
}
