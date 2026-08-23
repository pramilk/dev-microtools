import { describe, it, expect } from 'vitest';
import { parseCsv, convertDataFormat, detectFormat, MAX_INPUT_LENGTH } from './dataFormat';

describe('parseCsv', () => {
  it('parses a simple comma-separated grid', () => {
    const result = parseCsv('a,b,c\n1,2,3');
    expect(result).toEqual({ ok: true, value: [['a', 'b', 'c'], ['1', '2', '3']] });
  });

  it('handles quoted fields containing the delimiter', () => {
    const result = parseCsv('name,note\n"Doe, Jane","hello ""world"""');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[1]).toEqual(['Doe, Jane', 'hello "world"']);
  });

  it('handles a quoted field containing a newline', () => {
    const result = parseCsv('a,b\n"line1\nline2",x');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[1]).toEqual(['line1\nline2', 'x']);
  });

  it('handles CRLF line endings', () => {
    const result = parseCsv('a,b\r\n1,2\r\n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('respects a custom delimiter', () => {
    const result = parseCsv('a;b\n1;2', ';');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('rejects an unterminated quoted field', () => {
    const result = parseCsv('a,b\n"unterminated,2');
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/unterminated/i) });
  });

  it('rejects a stray quote in the middle of an unquoted field', () => {
    const result = parseCsv('a,b\nab"cd,2');
    expect(result.ok).toBe(false);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual({ ok: true, value: [] });
  });
});

describe('detectFormat', () => {
  it('detects a JSON object', () => {
    expect(detectFormat('{"a": 1}')).toBe('json');
  });

  it('detects a JSON array', () => {
    expect(detectFormat('[1, 2, 3]')).toBe('json');
  });

  it('detects a YAML mapping', () => {
    expect(detectFormat('name: Ada\nrole: Engineer\n')).toBe('yaml');
  });

  it('detects a YAML list', () => {
    expect(detectFormat('- Ada\n- Grace\n')).toBe('yaml');
  });

  it('detects a YAML document marker', () => {
    expect(detectFormat('---\nname: Ada\n')).toBe('yaml');
  });

  it('detects a CSV table by its delimited header row', () => {
    expect(detectFormat('name,role\nAda,Engineer\n')).toBe('csv');
  });

  it('detects a semicolon-delimited CSV table', () => {
    expect(detectFormat('name;role\nAda;Engineer\n')).toBe('csv');
  });

  it('returns null for a single line with no structural markers', () => {
    expect(detectFormat('just some text')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(detectFormat('   ')).toBeNull();
  });

  it('falls through to YAML for JSON-ish text that fails to parse', () => {
    // Not valid JSON (trailing comma), but reads as a YAML flow-style mapping key.
    expect(detectFormat('key: not json {a: 1,}')).toBe('yaml');
  });
});

describe('convertDataFormat', () => {
  it('converts JSON to YAML', async () => {
    const result = await convertDataFormat('{"name":"Ada","active":true}', 'json', 'yaml');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('name: Ada');
      expect(result.value).toContain('active: true');
    }
  });

  it('converts YAML to JSON', async () => {
    const result = await convertDataFormat('name: Ada\nactive: true\n', 'yaml', 'json');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.value)).toEqual({ name: 'Ada', active: true });
  });

  it('converts a CSV table (with header) to a JSON array of objects', async () => {
    const result = await convertDataFormat('name,age\nAda,36\nGrace,85', 'csv', 'json');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.value)).toEqual([
        { name: 'Ada', age: '36' },
        { name: 'Grace', age: '85' },
      ]);
    }
  });

  it('keeps CSV cell values as strings, never guessing at numbers or booleans', async () => {
    const result = await convertDataFormat('zip,version\n00501,1.0', 'csv', 'json');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.value)).toEqual([{ zip: '00501', version: '1.0' }]);
  });

  it('converts a JSON array of flat objects to CSV', async () => {
    const result = await convertDataFormat('[{"name":"Ada","age":36},{"name":"Grace","age":85}]', 'json', 'csv');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('name,age\r\nAda,36\r\nGrace,85');
  });

  it('parses CSV without a header as an array of raw rows', async () => {
    const result = await convertDataFormat('Ada,36\nGrace,85', 'csv', 'json', { delimiter: ',', hasHeader: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.value)).toEqual([['Ada', '36'], ['Grace', '85']]);
  });

  it('round-trips an array of arrays through CSV without synthesising a header', async () => {
    const result = await convertDataFormat('[["Ada","36"],["Grace","85"]]', 'json', 'csv');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Ada,36\r\nGrace,85');
  });

  it('respects a custom delimiter on both ends', async () => {
    const result = await convertDataFormat('[{"a":"1","b":"2"}]', 'json', 'csv', { delimiter: ';', hasHeader: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('a;b\r\n1;2');
  });

  it('embeds a nested value as JSON text in a CSV cell rather than dropping it', async () => {
    const result = await convertDataFormat('[{"id":1,"tags":["a","b"]}]', 'json', 'csv');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('"[""a"",""b""]"');
  });

  it('preserves Unicode content across a round trip', async () => {
    const result = await convertDataFormat('name,note\n日本語,"café — 😀"', 'csv', 'json');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.value)).toEqual([{ name: '日本語', note: 'café — 😀' }]);
    }
  });

  it('converts a large CSV table without truncating rows', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `row${i},${i}`);
    const csv = `id,value\n${rows.join('\n')}`;
    const result = await convertDataFormat(csv, 'csv', 'json');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.value)).toHaveLength(5000);
  });

  it('rejects malformed JSON with a clear message', async () => {
    const result = await convertDataFormat('{not valid json', 'json', 'yaml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid json/i);
  });

  it('rejects malformed YAML with a clear message', async () => {
    const result = await convertDataFormat('key: [unclosed', 'yaml', 'json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid yaml/i);
  });

  it('rejects converting a non-array JSON value to CSV', async () => {
    const result = await convertDataFormat('{"a":1}', 'json', 'csv');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/array/i);
  });

  it('rejects converting a mixed-content array to CSV', async () => {
    const result = await convertDataFormat('[{"a":1}, [1,2], "text"]', 'json', 'csv');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty YAML document (comment-only input)', async () => {
    const result = await convertDataFormat('# just a comment', 'yaml', 'json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty/i);
  });

  it('rejects empty input', async () => {
    const result = await convertDataFormat('   ', 'json', 'yaml');
    expect(result.ok).toBe(false);
  });

  it('rejects input larger than the size limit', async () => {
    const huge = '['.padEnd(MAX_INPUT_LENGTH + 2, '1') + ']';
    const result = await convertDataFormat(huge, 'json', 'yaml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });
});
