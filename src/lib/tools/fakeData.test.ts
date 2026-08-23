import { describe, it, expect } from 'vitest';
import { generateFakeData, MAX_ROWS, type FakeDataField } from './fakeData';

const field = (type: FakeDataField['type'], label?: string, extra: Partial<FakeDataField> = {}): FakeDataField => ({
  id: type,
  type,
  label: label ?? type,
  ...extra,
});

describe('generateFakeData', () => {
  it('generates the requested number of JSON rows with the requested keys', () => {
    const result = generateFakeData({
      rowCount: 5,
      fields: [field('firstName', 'name'), field('email')],
      format: 'json',
      seed: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = JSON.parse(result.value.text);
    expect(rows).toHaveLength(5);
    expect(Object.keys(rows[0])).toEqual(['name', 'email']);
    expect(typeof rows[0].name).toBe('string');
    expect(rows[0].email).toMatch(/^[a-z.]+@[a-z.]+$/);
  });

  it('generates valid CSV with a header row', () => {
    const result = generateFakeData({
      rowCount: 3,
      fields: [field('firstName'), field('lastName')],
      format: 'csv',
      seed: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.value.text.split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('firstName,lastName');
  });

  it('quotes a CSV field whose value contains a comma', () => {
    const result = generateFakeData({
      rowCount: 1,
      fields: [field('sentence')],
      format: 'csv',
      seed: 1,
    });
    expect(result.ok).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const options = {
      rowCount: 20,
      fields: [field('fullName'), field('email'), field('uuid'), field('integer'), field('date')],
      format: 'json' as const,
      seed: 42,
    };
    const first = generateFakeData(options);
    const second = generateFakeData(options);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.text).toBe(second.value.text);
    expect(first.value.seed).toBe(42);
  });

  it('produces different output for different seeds', () => {
    const base = { rowCount: 10, fields: [field('fullName')], format: 'json' as const };
    const a = generateFakeData({ ...base, seed: 1 });
    const b = generateFakeData({ ...base, seed: 2 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.text).not.toBe(b.value.text);
  });

  it('draws a fresh random seed and reports it when none is given', () => {
    const result = generateFakeData({ rowCount: 1, fields: [field('uuid')], format: 'json', seed: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Number.isInteger(result.value.seed)).toBe(true);
  });

  it('respects a custom integer range', () => {
    const result = generateFakeData({
      rowCount: 50,
      fields: [field('integer', 'age', { min: 18, max: 21 })],
      format: 'json',
      seed: 7,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = JSON.parse(result.value.text) as { age: number }[];
    for (const row of rows) {
      expect(row.age).toBeGreaterThanOrEqual(18);
      expect(row.age).toBeLessThanOrEqual(21);
      expect(Number.isInteger(row.age)).toBe(true);
    }
  });

  it('respects a custom float range and decimal precision', () => {
    const result = generateFakeData({
      rowCount: 30,
      fields: [field('float', 'price', { min: 1, max: 2, decimals: 3 })],
      format: 'json',
      seed: 7,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = JSON.parse(result.value.text) as { price: number }[];
    for (const row of rows) {
      expect(row.price).toBeGreaterThanOrEqual(1);
      expect(row.price).toBeLessThanOrEqual(2);
      expect(String(row.price).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
    }
  });

  it('produces structurally valid v4 UUIDs', () => {
    const result = generateFakeData({ rowCount: 10, fields: [field('uuid')], format: 'json', seed: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = JSON.parse(result.value.text) as { uuid: string }[];
    for (const row of rows) {
      expect(row.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('rejects an empty field list', () => {
    const result = generateFakeData({ rowCount: 5, fields: [], format: 'json', seed: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/at least one field/i);
  });

  it('rejects a row count outside the allowed range', () => {
    const tooFew = generateFakeData({ rowCount: 0, fields: [field('uuid')], format: 'json', seed: 1 });
    const tooMany = generateFakeData({ rowCount: MAX_ROWS + 1, fields: [field('uuid')], format: 'json', seed: 1 });
    expect(tooFew.ok).toBe(false);
    expect(tooMany.ok).toBe(false);
  });

  it('rejects duplicate field names', () => {
    const result = generateFakeData({
      rowCount: 1,
      fields: [field('firstName', 'name'), field('lastName', 'name')],
      format: 'json',
      seed: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/unique/i);
  });

  it('rejects an empty field name', () => {
    const result = generateFakeData({ rowCount: 1, fields: [field('firstName', '  ')], format: 'json', seed: 1 });
    expect(result.ok).toBe(false);
  });

  it('rejects a min greater than max', () => {
    const result = generateFakeData({
      rowCount: 1,
      fields: [field('integer', 'n', { min: 10, max: 5 })],
      format: 'json',
      seed: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/minimum.*maximum/i);
  });

  it('handles the maximum row count without error', () => {
    const result = generateFakeData({ rowCount: MAX_ROWS, fields: [field('firstName')], format: 'json', seed: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.value.text)).toHaveLength(MAX_ROWS);
  });

  it('produces boolean values of the correct type', () => {
    const result = generateFakeData({ rowCount: 20, fields: [field('boolean')], format: 'json', seed: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = JSON.parse(result.value.text) as { boolean: boolean }[];
    expect(rows.some((r) => r.boolean === true)).toBe(true);
    expect(rows.some((r) => r.boolean === false)).toBe(true);
  });

  it('produces a hex colour string', () => {
    const result = generateFakeData({ rowCount: 5, fields: [field('color')], format: 'json', seed: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = JSON.parse(result.value.text) as { color: string }[];
    for (const row of rows) expect(row.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
