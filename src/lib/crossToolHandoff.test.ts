import { describe, expect, it, beforeEach } from 'vitest';
import { writeHandoff, consumeHandoff } from './crossToolHandoff';

beforeEach(() => {
  sessionStorage.clear();
});

describe('writeHandoff / consumeHandoff', () => {
  it('round-trips a payload through sessionStorage', () => {
    expect(writeHandoff('diff-checker', { left: 'a', right: 'b' })).toBe(true);
    expect(consumeHandoff('diff-checker')).toEqual({ left: 'a', right: 'b' });
  });

  it('clears the payload once consumed, so a second read returns null', () => {
    writeHandoff('diff-checker', { left: 'a', right: 'b' });
    consumeHandoff('diff-checker');
    expect(consumeHandoff('diff-checker')).toBeNull();
  });

  it('returns null when nothing was ever written for that slug', () => {
    expect(consumeHandoff('diff-checker')).toBeNull();
  });

  it('keeps payloads for different tool slugs independent', () => {
    writeHandoff('diff-checker', { text: 'for diff checker' });
    writeHandoff('word-counter', { text: 'for word counter' });

    expect(consumeHandoff('word-counter')).toEqual({ text: 'for word counter' });
    // diff-checker's payload is untouched by consuming word-counter's.
    expect(consumeHandoff('diff-checker')).toEqual({ text: 'for diff checker' });
  });

  it('returns null instead of throwing on a corrupted stored value', () => {
    sessionStorage.setItem('dmt:handoff:diff-checker', 'not valid json{');
    expect(consumeHandoff('diff-checker')).toBeNull();
  });
});
