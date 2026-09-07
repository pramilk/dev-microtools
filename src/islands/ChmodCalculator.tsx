import { Fragment } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  parseChmodString,
  formatOctal,
  toSymbolic,
  describeChmod,
  numericChmodCommand,
  symbolicChmodCommand,
  CHMOD_PRESETS,
  type ChmodState,
  type PermissionSet,
} from '../lib/tools/chmod';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { ShareLinkButton } from './shared/ShareLinkButton';

interface ShareState {
  input: string;
  filename: string;
}

type Role = 'owner' | 'group' | 'other';
type Perm = keyof PermissionSet;

const ROLES: { key: Role; label: string }[] = [
  { key: 'owner', label: 'Owner' },
  { key: 'group', label: 'Group' },
  { key: 'other', label: 'Others' },
];
const PERMS: { key: Perm; label: string }[] = [
  { key: 'read', label: 'Read' },
  { key: 'write', label: 'Write' },
  { key: 'execute', label: 'Execute' },
];

export default function ChmodCalculator() {
  const [input, setInput] = useState('755');
  const [filename, setFilename] = useState('file');

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setFilename(restored.value.filename || 'file');
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => (input.trim() === '' ? null : parseChmodString(input)), [input]);
  const state = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;

  const toggle = (role: Role, perm: Perm) => {
    if (!state) return;
    const next: ChmodState = { ...state, [role]: { ...state[role], [perm]: !state[role][perm] } };
    setInput(formatOctal(next));
  };

  const toggleSpecial = (bit: 'setuid' | 'setgid' | 'sticky') => {
    if (!state) return;
    setInput(formatOctal({ ...state, [bit]: !state[bit] }));
  };

  const name = filename.trim() === '' ? 'file' : filename.trim();

  return (
    <div class="tool">
      <div class="presets" role="group" aria-label="Common permissions">
        {CHMOD_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            class="preset-chip"
            onClick={() => setInput(preset.octal)}
            title={preset.description}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div class="field">
        <label class="field__label" for="chmod-input">
          <span>Permission</span>
          <span class="field__hint">Octal (e.g. 755) or symbolic (e.g. rwxr-xr-x)</span>
        </label>
        <input
          id="chmod-input"
          class="input"
          spellcheck={false}
          autocomplete="off"
          placeholder="755"
          value={input}
          aria-invalid={error !== null}
          onInput={(event) => setInput((event.target as HTMLInputElement).value)}
        />
      </div>

      <div class="tool-bar">
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={(): ShareState => ({ input, filename })} describe="this permission" />
      </div>

      <ErrorMessage message={error} />

      {state && (
        <>
          <div class="field">
            <span class="field__label">Permissions</span>
            <div class="chmod-grid" role="group" aria-label="Read, write and execute permissions">
              <span />
              {PERMS.map((perm) => (
                <span key={perm.key} class="chmod-grid__col">
                  {perm.label}
                </span>
              ))}
              {ROLES.map((role) => (
                <Fragment key={role.key}>
                  <span class="chmod-grid__row">{role.label}</span>
                  {PERMS.map((perm) => (
                    <label class="checkbox" key={`${role.key}-${perm.key}`}>
                      <input
                        type="checkbox"
                        checked={state[role.key][perm.key]}
                        onChange={() => toggle(role.key, perm.key)}
                        aria-label={`${role.label} ${perm.label.toLowerCase()}`}
                      />
                    </label>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>

          <div class="field">
            <span class="field__label">Special permissions</span>
            <div class="special-row">
              <label class="checkbox" title="Runs an executable with the file owner's privileges instead of the running user's">
                <input type="checkbox" checked={state.setuid} onChange={() => toggleSpecial('setuid')} />
                <span>Setuid</span>
              </label>
              <label
                class="checkbox"
                title="Runs an executable with the file's group privileges, or makes new files in a directory inherit its group"
              >
                <input type="checkbox" checked={state.setgid} onChange={() => toggleSpecial('setgid')} />
                <span>Setgid</span>
              </label>
              <label
                class="checkbox"
                title="In a shared, world-writable directory, only a file's owner or root can delete or rename it"
              >
                <input type="checkbox" checked={state.sticky} onChange={() => toggleSpecial('sticky')} />
                <span>Sticky bit</span>
              </label>
            </div>
          </div>

          <div class="field">
            <label class="field__label" for="chmod-filename">
              <span>File name</span>
              <span class="field__hint">Used only in the command examples below</span>
            </label>
            <input
              id="chmod-filename"
              class="input"
              spellcheck={false}
              autocomplete="off"
              placeholder="file"
              value={filename}
              onInput={(event) => setFilename((event.target as HTMLInputElement).value)}
            />
          </div>

          <div class="output-grid">
            <OutputPane label="Octal" value={formatOctal(state)} placeholder="" describe="the octal permission" />
            <OutputPane label="Symbolic" value={toSymbolic(state)} placeholder="" describe="the symbolic permission" />
          </div>

          <OutputPane
            label="Numeric chmod command"
            value={numericChmodCommand(state, name)}
            placeholder=""
            describe="the chmod command"
          />
          <OutputPane
            label="Symbolic chmod command"
            value={symbolicChmodCommand(state, name)}
            placeholder=""
            describe="the symbolic chmod command"
          />

          <div class="field">
            <div class="field__label">
              <span>What this means</span>
            </div>
            <p class="description">{describeChmod(state)}</p>
          </div>
        </>
      )}

      <style>{`
        .presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .preset-chip {
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); padding: 0.35rem 0.75rem;
          font: inherit; font-size: var(--text-sm); font-weight: 550; color: var(--text);
          cursor: pointer;
        }
        .preset-chip:hover { background: var(--surface-2); border-color: var(--text-subtle); }
        .chmod-grid {
          display: grid; grid-template-columns: minmax(5rem, auto) repeat(3, 1fr);
          gap: var(--space-2) var(--space-4); align-items: center;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-3) var(--space-4);
        }
        .chmod-grid__col {
          font-size: var(--text-xs); color: var(--text-subtle);
          text-transform: uppercase; letter-spacing: .06em; justify-self: center;
        }
        .chmod-grid__row { font-size: var(--text-sm); font-weight: 600; color: var(--text); }
        .chmod-grid .checkbox { justify-self: center; }
        .special-row { display: flex; flex-wrap: wrap; gap: var(--space-4); }
        .output-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); }
        .description {
          margin: 0; padding: var(--space-3) var(--space-4);
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); font-size: var(--text-base); line-height: 1.6;
        }
      `}</style>
    </div>
  );
}
