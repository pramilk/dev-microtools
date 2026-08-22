import { describe, it, expect } from 'vitest';
import { uuidV4, uuidV7, generateUuids, inspectUuid } from './uuid';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuidV4', () => {
  it('produces a correctly shaped UUID', () => {
    expect(uuidV4()).toMatch(UUID_SHAPE);
  });

  it('sets the version nibble to 4 and an RFC 4122 variant', () => {
    const uuid = uuidV4();
    expect(uuid[14]).toBe('4');
    expect(['8', '9', 'a', 'b']).toContain(uuid[19]);
  });

  it('does not repeat across many draws', () => {
    const seen = new Set(Array.from({ length: 500 }, uuidV4));
    expect(seen.size).toBe(500);
  });
});

describe('uuidV7', () => {
  it('produces a correctly shaped UUID with version 7', () => {
    const uuid = uuidV7();
    expect(uuid).toMatch(UUID_SHAPE);
    expect(uuid[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(uuid[19]);
  });

  it('embeds the supplied timestamp in the leading 48 bits', () => {
    const when = Date.UTC(2026, 2, 14, 9, 26, 53);
    const uuid = uuidV7(when);
    const encoded = Number.parseInt(uuid.replace(/-/g, '').slice(0, 12), 16);
    expect(encoded).toBe(when);
  });

  it('sorts chronologically, which is the whole point of v7', () => {
    const early = uuidV7(1_700_000_000_000);
    const late = uuidV7(1_800_000_000_000);
    expect(early < late).toBe(true);
  });
});

describe('generateUuids', () => {
  it('generates the requested count', () => {
    const result = generateUuids(5, 'v4');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(5);
  });

  it('rejects zero, negatives and fractions', () => {
    expect(generateUuids(0, 'v4').ok).toBe(false);
    expect(generateUuids(-3, 'v4').ok).toBe(false);
    expect(generateUuids(2.5, 'v4').ok).toBe(false);
  });

  it('caps the batch size rather than hanging the tab', () => {
    const result = generateUuids(5000, 'v4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/1000/);
  });

  it('generates v7 when asked', () => {
    const result = generateUuids(3, 'v7');
    expect(result.ok).toBe(true);
    if (result.ok) for (const uuid of result.value) expect(uuid[14]).toBe('7');
  });
});

describe('inspectUuid', () => {
  it('reports the version of a v4 UUID', () => {
    const result = inspectUuid(uuidV4());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.version).toBe(4);
  });

  it('recovers the creation time from a v7 UUID', () => {
    const when = Date.UTC(2026, 5, 1, 12, 0, 0);
    const result = inspectUuid(uuidV7(when));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.timestamp?.getTime()).toBe(when);
  });

  it('accepts uppercase input', () => {
    expect(inspectUuid(uuidV4().toUpperCase()).ok).toBe(true);
  });

  it('rejects malformed input with a helpful message', () => {
    const result = inspectUuid('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/8-4-4-4-12/);
  });

  it('rejects empty input', () => {
    expect(inspectUuid('  ').ok).toBe(false);
  });

  it('rejects a UUID with an invalid variant nibble', () => {
    expect(inspectUuid('00000000-0000-4000-0000-000000000000').ok).toBe(false);
  });
});
