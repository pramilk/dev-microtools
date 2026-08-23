import { useEffect, useMemo, useState } from 'preact/hooks';
import { parseCidr, CIDR_PRESETS, type AddressType } from '../lib/tools/cidr';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

interface ShareState {
  input: string;
}

const TYPE_TONE: Record<AddressType, 'success' | 'warning'> = {
  Public: 'success',
  Private: 'warning',
  Loopback: 'warning',
  'Link-local': 'warning',
  Multicast: 'warning',
  'This network': 'warning',
  Reserved: 'warning',
};

/** Splits a dotted-binary string ("11000000.10101000...") at the network/host boundary, for highlighting. */
function splitBinaryAtPrefix(binaryDotted: string, prefixLength: number): { network: string; host: string } {
  if (prefixLength === 0) return { network: '', host: binaryDotted };

  let bitsSeen = 0;
  let splitIndex = binaryDotted.length;
  for (let i = 0; i < binaryDotted.length; i += 1) {
    if (binaryDotted[i] !== '.') {
      bitsSeen += 1;
      if (bitsSeen === prefixLength) {
        splitIndex = i + 1;
        break;
      }
    }
  }
  return { network: binaryDotted.slice(0, splitIndex), host: binaryDotted.slice(splitIndex) };
}

export default function CidrCalculator() {
  const [input, setInput] = useState('192.168.1.0/24');

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => (input.trim() === '' ? null : parseCidr(input)), [input]);
  const value = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;

  const binaryIp = useMemo(() => (value ? splitBinaryAtPrefix(value.binaryIp, value.prefixLength) : null), [value]);

  return (
    <div class="tool">
      <div class="presets" role="group" aria-label="Common ranges">
        {CIDR_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            class="preset-chip"
            onClick={() => setInput(preset.expression)}
            title={`Use "${preset.expression}"`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div class="field">
        <label class="field__label" for="cidr-input">
          <span>Address</span>
          <span class="field__hint">CIDR notation, or an address and a dotted subnet mask</span>
        </label>
        <input
          id="cidr-input"
          class="input"
          spellcheck={false}
          autocomplete="off"
          placeholder="192.168.1.0/24"
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
        <ShareLinkButton getState={() => ({ input })} describe="this address" />
      </div>

      <ErrorMessage message={error} />

      {value && (
        <>
          <dl class="cidr-grid">
            <dt>Network address</dt>
            <dd>
              <code>
                {value.networkAddress}/{value.prefixLength}
              </code>
            </dd>

            <dt>Broadcast address</dt>
            <dd>
              <code>{value.broadcastAddress}</code>
            </dd>

            <dt>Usable host range</dt>
            <dd>
              <code>
                {value.firstUsableHost} – {value.lastUsableHost}
              </code>
            </dd>

            <dt>Netmask</dt>
            <dd>
              <code>{value.netmask}</code>
            </dd>

            <dt>Wildcard mask</dt>
            <dd>
              <code>{value.wildcardMask}</code>
            </dd>

            <dt>Total addresses</dt>
            <dd class="tnum">{value.totalAddresses.toLocaleString()}</dd>

            <dt>Usable hosts</dt>
            <dd class="tnum">{value.usableHosts.toLocaleString()}</dd>

            <dt>IP class</dt>
            <dd>{value.ipClass}</dd>

            <dt>Address type</dt>
            <dd>
              <span class={`badge badge--${TYPE_TONE[value.addressType]}`}>{value.addressType}</span>
            </dd>
          </dl>

          <div class="field">
            <div class="field__label">
              <span>Binary breakdown</span>
              <CopyButton value={`${value.binaryIp} / ${value.binaryNetmask}`} describe="the binary breakdown" />
            </div>
            <div class="binary">
              {binaryIp && (
                <p class="binary__row">
                  <span class="binary__label">Address</span>
                  <code>
                    <span class="binary__network">{binaryIp.network}</span>
                    <span class="binary__host">{binaryIp.host}</span>
                  </code>
                </p>
              )}
              <p class="binary__row">
                <span class="binary__label">Netmask</span>
                <code>{value.binaryNetmask}</code>
              </p>
            </div>
            <p class="field__hint">
              <span class="binary__legend binary__legend--network" aria-hidden="true" /> network bits{' '}
              <span class="binary__legend binary__legend--host" aria-hidden="true" /> host bits
            </p>
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
        .cidr-grid {
          display: grid; grid-template-columns: minmax(10rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4); font-size: var(--text-sm);
        }
        .cidr-grid dt {
          font-family: var(--font-mono); color: var(--text-muted);
          font-size: var(--text-xs); letter-spacing: .06em; align-self: center;
        }
        .cidr-grid dd { margin: 0; align-self: center; }
        .badge {
          font-size: var(--text-xs); font-weight: 600; padding: .1em .6em;
          border-radius: 99px; border: 1px solid;
        }
        .badge--success { color: var(--success); background: var(--success-subtle); border-color: var(--success-border); }
        .badge--warning { color: var(--warning); background: var(--warning-subtle); border-color: var(--warning-border); }
        .binary {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-3) var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-2);
        }
        .binary__row { margin: 0; display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
        .binary__row code { font-size: var(--text-sm); word-break: break-all; }
        .binary__label {
          font-size: var(--text-xs); color: var(--text-subtle); min-width: 4.5rem;
          text-transform: uppercase; letter-spacing: .06em;
        }
        .binary__network { color: var(--accent); font-weight: 600; }
        .binary__host { color: var(--text-muted); }
        .binary__legend {
          display: inline-block; width: 0.7em; height: 0.7em; border-radius: 2px;
          vertical-align: -0.05em; margin-right: 0.2em;
        }
        .binary__legend--network { background: var(--accent); }
        .binary__legend--host { background: var(--text-subtle); }
      `}</style>
    </div>
  );
}
