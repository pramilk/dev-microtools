import { describe, it, expect } from 'vitest';
import { snapshotKeyEvent, formatKeyEventText, SUPPRESSED_DEFAULT_KEYS, type KeyEventInput } from './keyEvent';

const baseInput: KeyEventInput = {
  key: 'a',
  code: 'KeyA',
  keyCode: 65,
  which: 65,
  location: 0,
  repeat: false,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
};

describe('snapshotKeyEvent', () => {
  it('reports no modifiers when none are held', () => {
    const snapshot = snapshotKeyEvent(baseInput);
    expect(snapshot.modifiers).toEqual([]);
    expect(snapshot.modifierText).toBe('none');
  });

  it('lists held modifiers in a fixed order regardless of input order', () => {
    const snapshot = snapshotKeyEvent({ ...baseInput, metaKey: true, shiftKey: true, ctrlKey: true });
    expect(snapshot.modifiers).toEqual(['Ctrl', 'Shift', 'Meta']);
    expect(snapshot.modifierText).toBe('Ctrl + Shift + Meta');
  });

  it('labels each known location code', () => {
    expect(snapshotKeyEvent({ ...baseInput, location: 0 }).locationLabel).toBe('Standard');
    expect(snapshotKeyEvent({ ...baseInput, location: 1 }).locationLabel).toBe('Left');
    expect(snapshotKeyEvent({ ...baseInput, location: 2 }).locationLabel).toBe('Right');
    expect(snapshotKeyEvent({ ...baseInput, location: 3 }).locationLabel).toBe('Numpad');
  });

  it('falls back to "Unknown" for an undocumented location code', () => {
    expect(snapshotKeyEvent({ ...baseInput, location: 9 }).locationLabel).toBe('Unknown');
  });

  it('passes through the raw event fields unchanged', () => {
    const snapshot = snapshotKeyEvent({ ...baseInput, key: 'Enter', code: 'Enter', keyCode: 13, which: 13, repeat: true });
    expect(snapshot).toMatchObject({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13, repeat: true });
  });
});

describe('formatKeyEventText', () => {
  it('formats a snapshot as a readable, copy-friendly block', () => {
    const snapshot = snapshotKeyEvent({ ...baseInput, ctrlKey: true });
    const text = formatKeyEventText(snapshot);
    expect(text).toBe(
      ['key: "a"', 'code: KeyA', 'keyCode: 65', 'which: 65', 'location: 0 (Standard)', 'modifiers: Ctrl', 'repeat: false'].join('\n')
    );
  });

  it('quotes the key field so a space or empty key is visible rather than invisible', () => {
    const snapshot = snapshotKeyEvent({ ...baseInput, key: ' ', code: 'Space' });
    expect(formatKeyEventText(snapshot)).toContain('key: " "');
  });
});

describe('SUPPRESSED_DEFAULT_KEYS', () => {
  it('includes the keys whose default browser behaviour would disrupt the capture box', () => {
    for (const key of ['Tab', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace']) {
      expect(SUPPRESSED_DEFAULT_KEYS.has(key)).toBe(true);
    }
  });

  it('does not suppress ordinary printable keys', () => {
    expect(SUPPRESSED_DEFAULT_KEYS.has('a')).toBe(false);
    expect(SUPPRESSED_DEFAULT_KEYS.has('Enter')).toBe(false);
  });
});
