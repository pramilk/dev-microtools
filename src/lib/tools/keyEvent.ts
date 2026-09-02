/** The subset of a DOM `KeyboardEvent` this tool reads. Kept as a plain object, not the
 *  real event type, so the snapshot logic is testable without constructing a DOM event. */
export interface KeyEventInput {
  key: string;
  code: string;
  keyCode: number;
  which: number;
  location: number;
  repeat: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface KeyEventSnapshot extends KeyEventInput {
  locationLabel: string;
  modifiers: string[];
  modifierText: string;
}

const LOCATION_LABELS: Readonly<Record<number, string>> = {
  0: 'Standard',
  1: 'Left',
  2: 'Right',
  3: 'Numpad',
};

/** Normalizes a raw key event into a display-ready snapshot: modifier list, location label. */
export function snapshotKeyEvent(input: KeyEventInput): KeyEventSnapshot {
  const modifiers: string[] = [];
  if (input.ctrlKey) modifiers.push('Ctrl');
  if (input.altKey) modifiers.push('Alt');
  if (input.shiftKey) modifiers.push('Shift');
  if (input.metaKey) modifiers.push('Meta');

  return {
    ...input,
    locationLabel: LOCATION_LABELS[input.location] ?? 'Unknown',
    modifiers,
    modifierText: modifiers.length > 0 ? modifiers.join(' + ') : 'none',
  };
}

/** A compact, copy-friendly text block for the current snapshot. */
export function formatKeyEventText(snapshot: KeyEventSnapshot): string {
  return [
    `key: ${JSON.stringify(snapshot.key)}`,
    `code: ${snapshot.code}`,
    `keyCode: ${snapshot.keyCode}`,
    `which: ${snapshot.which}`,
    `location: ${snapshot.location} (${snapshot.locationLabel})`,
    `modifiers: ${snapshot.modifierText}`,
    `repeat: ${snapshot.repeat}`,
  ].join('\n');
}

/** Keys whose default browser behaviour (scrolling, leaving the capture area) would get
 *  in the way of testing them, and can safely be suppressed inside a non-editable box. */
export const SUPPRESSED_DEFAULT_KEYS: ReadonlySet<string> = new Set([
  'Tab',
  ' ',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Backspace',
]);
