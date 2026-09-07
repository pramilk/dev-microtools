import { describe, it, expect } from 'vitest';
import {
  parseOctal,
  parseSymbolic,
  parseChmodString,
  formatOctal,
  toSymbolic,
  describeChmod,
  numericChmodCommand,
  symbolicChmodCommand,
  CHMOD_PRESETS,
  type ChmodState,
} from './chmod';

const FULL: ChmodState = {
  owner: { read: true, write: true, execute: true },
  group: { read: true, write: false, execute: true },
  other: { read: true, write: false, execute: true },
  setuid: false,
  setgid: false,
  sticky: false,
};

describe('parseOctal', () => {
  it('parses a typical 3-digit value', () => {
    const result = parseOctal('755');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(FULL);
  });

  it('parses a 4-digit value with special bits', () => {
    const result = parseOctal('4755');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.setuid).toBe(true);
    expect(result.value.setgid).toBe(false);
    expect(result.value.sticky).toBe(false);
  });

  it('parses every special-bit combination via the leading digit', () => {
    const result = parseOctal('7777');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.setuid).toBe(true);
    expect(result.value.setgid).toBe(true);
    expect(result.value.sticky).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(parseOctal('').ok).toBe(false);
  });

  it('rejects a digit out of the 0-7 octal range', () => {
    expect(parseOctal('789').ok).toBe(false);
  });

  it('rejects the wrong number of digits', () => {
    expect(parseOctal('75').ok).toBe(false);
    expect(parseOctal('75555').ok).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(parseOctal('rwx').ok).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(parseOctal('  755  ').ok).toBe(true);
  });
});

describe('parseSymbolic', () => {
  it('parses a 9-character string', () => {
    const result = parseSymbolic('rwxr-xr-x');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(FULL);
  });

  it('parses a 10-character ls -l string, ignoring the leading file-type character', () => {
    expect(parseSymbolic('-rwxr-xr-x')).toEqual(parseSymbolic('rwxr-xr-x'));
    expect(parseSymbolic('drwxr-xr-x').ok).toBe(true);
  });

  it('decodes setuid ("s" and "S")', () => {
    const withExec = parseSymbolic('rwsr--r--');
    expect(withExec.ok).toBe(true);
    if (withExec.ok) {
      expect(withExec.value.setuid).toBe(true);
      expect(withExec.value.owner.execute).toBe(true);
    }

    const withoutExec = parseSymbolic('rwSr--r--');
    expect(withoutExec.ok).toBe(true);
    if (withoutExec.ok) {
      expect(withoutExec.value.setuid).toBe(true);
      expect(withoutExec.value.owner.execute).toBe(false);
    }
  });

  it('decodes setgid ("s" and "S") in the group slot', () => {
    const result = parseSymbolic('rwxr-Sr--');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.setgid).toBe(true);
    expect(result.value.group.execute).toBe(false);
  });

  it('decodes sticky ("t" and "T") in the other slot', () => {
    const sticky = parseSymbolic('rwxrwxrwt');
    expect(sticky.ok).toBe(true);
    if (sticky.ok) {
      expect(sticky.value.sticky).toBe(true);
      expect(sticky.value.other.execute).toBe(true);
    }

    const stickyNoExec = parseSymbolic('rwxrwxrwT');
    expect(stickyNoExec.ok).toBe(true);
    if (stickyNoExec.ok) {
      expect(stickyNoExec.value.sticky).toBe(true);
      expect(stickyNoExec.value.other.execute).toBe(false);
    }
  });

  it('rejects the wrong length', () => {
    expect(parseSymbolic('rwxr-x').ok).toBe(false);
    expect(parseSymbolic('rwxrwxrwxrwx').ok).toBe(false);
  });

  it('rejects invalid characters', () => {
    expect(parseSymbolic('rwzr-xr-x').ok).toBe(false);
  });

  it('rejects a special letter used in the wrong slot', () => {
    expect(parseSymbolic('rwtr-xr-x').ok).toBe(false);
    expect(parseSymbolic('rwxr-xr-s').ok).toBe(false);
  });
});

describe('parseChmodString', () => {
  it('auto-detects octal input', () => {
    const result = parseChmodString('644');
    expect(result.ok).toBe(true);
  });

  it('auto-detects symbolic input', () => {
    const result = parseChmodString('rw-r--r--');
    expect(result.ok).toBe(true);
  });

  it('reports an empty input as an error, not a default value', () => {
    const result = parseChmodString('');
    expect(result.ok).toBe(false);
  });

  it('reports unrecognisable input as an error rather than guessing', () => {
    const result = parseChmodString('not a permission');
    expect(result.ok).toBe(false);
  });

  it('rejects non-ASCII input instead of crashing', () => {
    const result = parseChmodString('日本語のパーミッション');
    expect(result.ok).toBe(false);
  });
});

describe('formatOctal / toSymbolic round trip', () => {
  it('round-trips a plain permission set', () => {
    expect(formatOctal(FULL)).toBe('755');
    expect(toSymbolic(FULL)).toBe('rwxr-xr-x');
  });

  it('round-trips every special bit at once', () => {
    const state: ChmodState = { ...FULL, setuid: true, setgid: true, sticky: true };
    const octal = formatOctal(state);
    expect(octal).toBe('7755');
    const reparsed = parseOctal(octal);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.value).toEqual(state);
  });

  it('omits the special digit entirely when no special bit is set', () => {
    expect(formatOctal(FULL)).toHaveLength(3);
  });

  it('every preset parses back to a state that re-formats to the same octal', () => {
    for (const preset of CHMOD_PRESETS) {
      const parsed = parseOctal(preset.octal);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatOctal(parsed.value)).toBe(preset.octal);
    }
  });
});

describe('describeChmod', () => {
  it('describes a common file permission in plain English', () => {
    const description = describeChmod(FULL);
    expect(description).toContain('the owner can read, write and execute');
    expect(description).toContain('everyone else can read');
  });

  it('describes a permission with no access for a role', () => {
    const state: ChmodState = {
      owner: { read: true, write: true, execute: false },
      group: { read: false, write: false, execute: false },
      other: { read: false, write: false, execute: false },
      setuid: false,
      setgid: false,
      sticky: false,
    };
    const description = describeChmod(state);
    expect(description).toContain('the group has no permissions');
    expect(description).toContain('everyone else has no permissions');
  });

  it('calls out setuid, setgid, and sticky when set', () => {
    const state: ChmodState = { ...FULL, setuid: true, setgid: true, sticky: true };
    const description = describeChmod(state);
    expect(description).toMatch(/setuid/i);
    expect(description).toMatch(/setgid/i);
    expect(description).toMatch(/sticky/i);
  });
});

describe('command builders', () => {
  it('builds the numeric chmod command', () => {
    expect(numericChmodCommand(FULL, 'script.sh')).toBe('chmod 755 script.sh');
  });

  it('builds the symbolic chmod command, including special bits', () => {
    const state: ChmodState = { ...FULL, setuid: true, sticky: true };
    expect(symbolicChmodCommand(state, 'script.sh')).toBe('chmod u=rwx,g=rx,o=rx,u+s,+t script.sh');
  });

  it('produces a valid empty-permission assignment rather than omitting the role', () => {
    const state: ChmodState = {
      owner: { read: false, write: false, execute: false },
      group: { read: false, write: false, execute: false },
      other: { read: false, write: false, execute: false },
      setuid: false,
      setgid: false,
      sticky: false,
    };
    expect(symbolicChmodCommand(state, 'file')).toBe('chmod u=,g=,o= file');
  });
});
