import { describe, it, expect } from 'vitest';
import { generateLoremIpsum, DEFAULT_LOREM_OPTIONS } from './loremIpsum';

describe('generateLoremIpsum', () => {
  it('generates the requested number of paragraphs, separated by a blank line', () => {
    const result = generateLoremIpsum({ ...DEFAULT_LOREM_OPTIONS, unit: 'paragraphs', count: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.split('\n\n')).toHaveLength(5);
  });

  it('starts with the classic opening when startWithLorem is on', () => {
    const result = generateLoremIpsum({ ...DEFAULT_LOREM_OPTIONS, startWithLorem: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.startsWith('Lorem ipsum dolor sit amet')).toBe(true);
  });

  it('does not start with the classic opening when startWithLorem is off', () => {
    const result = generateLoremIpsum({ ...DEFAULT_LOREM_OPTIONS, startWithLorem: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.startsWith('Lorem ipsum dolor sit amet')).toBe(false);
  });

  it('generates exactly the requested number of words', () => {
    const result = generateLoremIpsum({ unit: 'words', count: 25, startWithLorem: true, asHtml: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.split(' ')).toHaveLength(25);
  });

  it('generates exactly the requested number of sentences', () => {
    const result = generateLoremIpsum({ unit: 'sentences', count: 7, startWithLorem: true, asHtml: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sentenceCount = (result.value.match(/\./g) ?? []).length;
    expect(sentenceCount).toBe(7);
  });

  it('produces the same output for the same settings (deterministic, not random)', () => {
    const a = generateLoremIpsum({ ...DEFAULT_LOREM_OPTIONS, count: 3 });
    const b = generateLoremIpsum({ ...DEFAULT_LOREM_OPTIONS, count: 3 });
    expect(a).toEqual(b);
  });

  it('wraps each paragraph in <p> tags when asHtml is on', () => {
    const result = generateLoremIpsum({ ...DEFAULT_LOREM_OPTIONS, unit: 'paragraphs', count: 3, asHtml: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paragraphs = result.value.split('\n\n');
    expect(paragraphs).toHaveLength(3);
    for (const p of paragraphs) {
      expect(p.startsWith('<p>')).toBe(true);
      expect(p.endsWith('</p>')).toBe(true);
    }
  });

  it('wraps sentences-mode output in a single <p> tag when asHtml is on', () => {
    const result = generateLoremIpsum({ unit: 'sentences', count: 4, startWithLorem: true, asHtml: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.startsWith('<p>')).toBe(true);
    expect(result.value.endsWith('</p>')).toBe(true);
    expect(result.value.match(/<p>/g)).toHaveLength(1);
  });

  it('cycles back through the passage when the word count exceeds the word bank', () => {
    const result = generateLoremIpsum({ unit: 'words', count: 2500, startWithLorem: true, asHtml: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.split(' ')).toHaveLength(2500);
  });

  it('rejects a count of zero', () => {
    const result = generateLoremIpsum({ ...DEFAULT_LOREM_OPTIONS, count: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects a negative count', () => {
    const result = generateLoremIpsum({ ...DEFAULT_LOREM_OPTIONS, count: -3 });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-integer count', () => {
    const result = generateLoremIpsum({ ...DEFAULT_LOREM_OPTIONS, count: 2.5 });
    expect(result.ok).toBe(false);
  });

  it('rejects a count above the per-unit maximum', () => {
    const result = generateLoremIpsum({ ...DEFAULT_LOREM_OPTIONS, unit: 'paragraphs', count: 51 });
    expect(result.ok).toBe(false);
  });
});
