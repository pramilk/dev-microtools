import { type ToolResult, ok, err } from './result';

export interface PermissionSet {
  read: boolean;
  write: boolean;
  execute: boolean;
}

export interface ChmodState {
  owner: PermissionSet;
  group: PermissionSet;
  other: PermissionSet;
  setuid: boolean;
  setgid: boolean;
  sticky: boolean;
}

export interface ChmodPreset {
  label: string;
  octal: string;
  description: string;
}

export const CHMOD_PRESETS: ChmodPreset[] = [
  { label: '644', octal: '644', description: 'Default file — owner read/write, everyone else read-only' },
  { label: '755', octal: '755', description: 'Default directory or executable — owner full, everyone else read + execute' },
  { label: '600', octal: '600', description: 'Private file — owner read/write, no one else has access' },
  { label: '700', octal: '700', description: 'Private directory — owner full access, no one else has access' },
  { label: '664', octal: '664', description: 'Group-writable file — owner and group read/write, others read-only' },
  { label: '775', octal: '775', description: 'Group-writable directory — owner and group full, others read + execute' },
  { label: '444', octal: '444', description: 'Read-only for everyone, including the owner' },
  { label: '777', octal: '777', description: 'Full access for everyone — almost never the right choice on a real server' },
];

const permissionDigit = (p: PermissionSet): number => (p.read ? 4 : 0) + (p.write ? 2 : 0) + (p.execute ? 1 : 0);

const digitToPermissionSet = (digit: number): PermissionSet => ({
  read: (digit & 4) !== 0,
  write: (digit & 2) !== 0,
  execute: (digit & 1) !== 0,
});

/** Renders a state's numeric permissions: 3 digits normally, 4 when a special bit is set. */
export function formatOctal(state: ChmodState): string {
  const owner = permissionDigit(state.owner);
  const group = permissionDigit(state.group);
  const other = permissionDigit(state.other);
  const special = (state.setuid ? 4 : 0) + (state.setgid ? 2 : 0) + (state.sticky ? 1 : 0);
  return special === 0 ? `${owner}${group}${other}` : `${special}${owner}${group}${other}`;
}

/** Renders the 9-character `rwxr-xr-x` form, folding setuid/setgid/sticky into the execute slots. */
export function toSymbolic(state: ChmodState): string {
  const triplet = (p: PermissionSet, specialOn: boolean, onChar: string, offChar: string): string =>
    `${p.read ? 'r' : '-'}${p.write ? 'w' : '-'}${specialOn ? (p.execute ? onChar : offChar) : p.execute ? 'x' : '-'}`;

  return (
    triplet(state.owner, state.setuid, 's', 'S') +
    triplet(state.group, state.setgid, 's', 'S') +
    triplet(state.other, state.sticky, 't', 'T')
  );
}

const OCTAL_PATTERN = /^[0-7]{3,4}$/;

/** Parses a 3- or 4-digit octal permission string (e.g. "755" or "4755"). */
export function parseOctal(input: string): ToolResult<ChmodState> {
  const trimmed = input.trim();
  if (!OCTAL_PATTERN.test(trimmed)) {
    return err(`"${input}" is not a valid octal permission — expected 3 or 4 digits, each 0-7 (e.g. "755" or "4755").`);
  }

  const digits = trimmed.length === 4 ? trimmed : `0${trimmed}`;
  const special = Number(digits[0]);
  const owner = Number(digits[1]);
  const group = Number(digits[2]);
  const other = Number(digits[3]);

  return ok({
    owner: digitToPermissionSet(owner),
    group: digitToPermissionSet(group),
    other: digitToPermissionSet(other),
    setuid: (special & 4) !== 0,
    setgid: (special & 2) !== 0,
    sticky: (special & 1) !== 0,
  });
}

const SYMBOLIC_TRIPLET = /^[r-][w-][xstST-]$/;

/**
 * Parses a symbolic permission string: the 9-character `rwxr-xr-x` form, or the
 * 10-character `ls -l` form with a leading file-type character (`-`, `d`, `l`, ...),
 * which is accepted and ignored since chmod itself never sets a file's type.
 */
export function parseSymbolic(input: string): ToolResult<ChmodState> {
  const trimmed = input.trim();
  const body = trimmed.length === 10 ? trimmed.slice(1) : trimmed;

  if (body.length !== 9) {
    return err(
      `"${input}" isn't a 9-character symbolic permission string (e.g. "rwxr-xr-x") — got ${body.length} characters after any leading file-type character.`
    );
  }

  const ownerStr = body.slice(0, 3);
  const groupStr = body.slice(3, 6);
  const otherStr = body.slice(6, 9);

  if (!SYMBOLIC_TRIPLET.test(ownerStr) || !SYMBOLIC_TRIPLET.test(groupStr) || !SYMBOLIC_TRIPLET.test(otherStr)) {
    return err(`"${input}" isn't a valid symbolic permission string — expected a pattern like "rwxr-xr-x".`);
  }
  // The "execute" slot in the group triplet may only carry g/G-style letters, and the
  // owner/other triplets never carry the other role's special letter — reject a value
  // like "rwtr-xr-x" that is syntactically a valid triplet shape but uses the wrong
  // special letter for that position, which would otherwise silently parse as if the
  // sticky/setuid bit were on the wrong role.
  if (/[tT]/.test(ownerStr) || /[tT]/.test(groupStr) || /[sS]/.test(otherStr)) {
    return err(`"${input}" uses "s"/"S" (setuid/setgid) or "t"/"T" (sticky) in the wrong position.`);
  }

  const ownerExec = ownerStr[2]!;
  const groupExec = groupStr[2]!;
  const otherExec = otherStr[2]!;

  return ok({
    owner: { read: ownerStr[0] === 'r', write: ownerStr[1] === 'w', execute: ownerExec === 'x' || ownerExec === 's' },
    group: { read: groupStr[0] === 'r', write: groupStr[1] === 'w', execute: groupExec === 'x' || groupExec === 's' },
    other: { read: otherStr[0] === 'r', write: otherStr[1] === 'w', execute: otherExec === 'x' || otherExec === 't' },
    setuid: ownerExec === 's' || ownerExec === 'S',
    setgid: groupExec === 's' || groupExec === 'S',
    sticky: otherExec === 't' || otherExec === 'T',
  });
}

/** Accepts either an octal string ("755") or a symbolic string ("rwxr-xr-x"), auto-detected. */
export function parseChmodString(input: string): ToolResult<ChmodState> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter a permission — octal (e.g. 755) or symbolic (e.g. rwxr-xr-x).');
  if (OCTAL_PATTERN.test(trimmed)) return parseOctal(trimmed);
  if (trimmed.length === 9 || trimmed.length === 10) return parseSymbolic(trimmed);
  return err(
    `Could not read "${input}" as a permission. Try an octal value like "755" or "4755", or a symbolic value like "rwxr-xr-x".`
  );
}

const joinWithAnd = (items: string[]): string => {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

const describeRole = (label: string, p: PermissionSet): string => {
  const abilities = [p.read && 'read', p.write && 'write', p.execute && 'execute'].filter(Boolean) as string[];
  return abilities.length > 0 ? `${label} can ${joinWithAnd(abilities)}` : `${label} has no permissions`;
};

/** Plain-English explanation of what a permission state actually grants. */
export function describeChmod(state: ChmodState): string {
  const clauses = [
    describeRole('the owner', state.owner),
    describeRole('the group', state.group),
    describeRole('everyone else', state.other),
  ];

  const notes: string[] = [];
  if (state.setuid) {
    notes.push(
      'The setuid bit is set — an executable runs with the file owner\'s privileges rather than the privileges of whoever runs it.'
    );
  }
  if (state.setgid) {
    notes.push(
      'The setgid bit is set — an executable runs with the file\'s group privileges, and a directory makes new files created inside inherit its group.'
    );
  }
  if (state.sticky) {
    notes.push(
      "The sticky bit is set — inside a shared, world-writable directory (e.g. /tmp), only a file's owner or root can delete or rename it."
    );
  }

  return [`${clauses.join('; ')}.`, ...notes].join(' ');
}

const roleLetters = (p: PermissionSet): string => `${p.read ? 'r' : ''}${p.write ? 'w' : ''}${p.execute ? 'x' : ''}`;

/** The `chmod <octal> <name>` command a visitor can paste straight into a shell. */
export function numericChmodCommand(state: ChmodState, name: string): string {
  return `chmod ${formatOctal(state)} ${name}`;
}

/** The equivalent `chmod u=...,g=...,o=...` symbolic command, including special bits. */
export function symbolicChmodCommand(state: ChmodState, name: string): string {
  const parts = [`u=${roleLetters(state.owner)}`, `g=${roleLetters(state.group)}`, `o=${roleLetters(state.other)}`];
  if (state.setuid) parts.push('u+s');
  if (state.setgid) parts.push('g+s');
  if (state.sticky) parts.push('+t');
  return `chmod ${parts.join(',')} ${name}`;
}
