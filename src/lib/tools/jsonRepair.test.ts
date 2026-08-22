import { describe, it, expect } from 'vitest';
import { repairJson, isStrictJson, type RepairKind } from './jsonRepair';

/** Repairs and returns the parsed value, failing the test if repair did not succeed. */
const fixed = (input: string): unknown => {
  const result = repairJson(input);
  if (!result.ok) throw new Error(`expected repair to succeed, got: ${result.error}`);
  expect(isStrictJson(result.value.json)).toBe(true);
  return JSON.parse(result.value.json);
};

const kinds = (input: string): RepairKind[] => {
  const result = repairJson(input);
  if (!result.ok) throw new Error(result.error);
  return result.value.notes.map((note) => note.kind);
};

describe('repairJson — leaves valid JSON alone', () => {
  it.each([
    '{"a":1}',
    '[1,2,3]',
    '{"nested":{"deep":[true,false,null]}}',
    '"just a string"',
    '42',
    'null',
  ])('reports no repairs for already-valid %s', (input) => {
    const result = repairJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notes).toEqual([]);
      expect(JSON.parse(result.value.json)).toEqual(JSON.parse(input));
    }
  });

  it('preserves exact numeric formatting that is already valid', () => {
    const result = repairJson('{"a":1.50,"b":1e5}');
    expect(result.ok).toBe(true);
    // 1.50 is not strict JSON canonical form but IS valid JSON, so it must survive.
    if (result.ok) expect(result.value.json).toContain('1.50');
  });
});

describe('repairJson — trailing commas', () => {
  it('removes a trailing comma in an object', () => {
    expect(fixed('{"a":1,}')).toEqual({ a: 1 });
    expect(kinds('{"a":1,}')).toContain('trailing-comma');
  });

  it('removes a trailing comma in an array', () => {
    expect(fixed('[1,2,]')).toEqual([1, 2]);
  });

  it('removes doubled commas', () => {
    expect(fixed('[1,,2]')).toEqual([1, 2]);
  });
});

describe('repairJson — quoting', () => {
  it('converts single-quoted strings', () => {
    expect(fixed("{'a':'b'}")).toEqual({ a: 'b' });
    expect(kinds("{'a':'b'}")).toContain('single-quotes');
  });

  it('quotes bare object keys', () => {
    expect(fixed('{name:"ada",age:36}')).toEqual({ name: 'ada', age: 36 });
    expect(kinds('{name:1}')).toContain('unquoted-key');
  });

  it('handles curly smart quotes pasted from a word processor', () => {
    expect(fixed('{\u201Ca\u201D:\u201Cb\u201D}')).toEqual({ a: 'b' });
    expect(kinds('{\u201Ca\u201D:1}')).toContain('smart-quotes');
  });

  it('treats a bare word value as a string', () => {
    expect(fixed('{"status":ok}')).toEqual({ status: 'ok' });
  });
});

describe('repairJson — comments', () => {
  it('strips line comments', () => {
    expect(fixed('{\n// the id\n"a":1\n}')).toEqual({ a: 1 });
    expect(kinds('{//x\n"a":1}')).toContain('comments');
  });

  it('strips block comments', () => {
    expect(fixed('{/* note */"a":1}')).toEqual({ a: 1 });
  });

  it('strips hash comments', () => {
    expect(fixed('{\n# note\n"a":1\n}')).toEqual({ a: 1 });
  });
});

describe('repairJson — literals and numbers', () => {
  it('converts Python literals', () => {
    expect(fixed('{"a":True,"b":False,"c":None}')).toEqual({ a: true, b: false, c: null });
    expect(kinds('{"a":True}')).toContain('python-literal');
  });

  it('replaces values JSON cannot represent with null', () => {
    expect(fixed('{"a":NaN,"b":Infinity,"c":undefined}')).toEqual({
      a: null,
      b: null,
      c: null,
    });
    expect(kinds('{"a":NaN}')).toContain('special-number');
  });

  it('normalises hexadecimal numbers', () => {
    expect(fixed('{"a":0xff}')).toEqual({ a: 255 });
  });

  it('normalises a leading plus and bare decimal points', () => {
    expect(fixed('{"a":+5,"b":.5,"c":5.}')).toEqual({ a: 5, b: 0.5, c: 5 });
  });
});

describe('repairJson — structure', () => {
  it('closes an unclosed object', () => {
    expect(fixed('{"a":1')).toEqual({ a: 1 });
    expect(kinds('{"a":1')).toContain('unclosed-bracket');
  });

  it('closes deeply nested unclosed brackets', () => {
    expect(fixed('{"a":{"b":[1,2')).toEqual({ a: { b: [1, 2] } });
  });

  it('closes an unterminated string', () => {
    expect(fixed('{"a":"unfinished')).toEqual({ a: 'unfinished' });
    expect(kinds('{"a":"unfinished')).toContain('unterminated-string');
  });

  it('inserts a missing comma between object entries', () => {
    expect(fixed('{"a":1 "b":2}')).toEqual({ a: 1, b: 2 });
    expect(kinds('{"a":1 "b":2}')).toContain('missing-comma');
  });

  it('inserts a missing comma between array items', () => {
    expect(fixed('[1 2 3]')).toEqual([1, 2, 3]);
  });

  it('inserts a missing colon', () => {
    expect(fixed('{"a" 1}')).toEqual({ a: 1 });
    expect(kinds('{"a" 1}')).toContain('missing-colon');
  });

  it('keeps the last value for a duplicate key, as a parser would', () => {
    expect(fixed('{"a":1,"a":2}')).toEqual({ a: 2 });
    expect(kinds('{"a":1,"a":2}')).toContain('duplicate-key');
  });

  it('escapes a literal newline inside a string', () => {
    expect(fixed('{"a":"line1\nline2"}')).toEqual({ a: 'line1\nline2' });
    expect(kinds('{"a":"x\ny"}')).toContain('newline-in-string');
  });
});

describe('repairJson — surrounding noise', () => {
  it('extracts JSON from a log line prefix', () => {
    expect(fixed('2026-08-22 INFO response={"a":1}')).toEqual({ a: 1 });
    expect(kinds('INFO {"a":1}')).toContain('surrounding-text');
  });

  it('wraps newline-delimited JSON documents in an array', () => {
    expect(fixed('{"a":1}\n{"a":2}')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(kinds('{"a":1}\n{"a":2}')).toContain('multiple-documents');
  });

  it('fails cleanly when there is no JSON at all', () => {
    const result = repairJson('this is just prose with no data');
    expect(result.ok).toBe(false);
  });

  it('rejects empty input', () => {
    expect(repairJson('   ').ok).toBe(false);
  });
});

/**
 * The cases that separate a real parser from regex find-and-replace. Every one of these
 * would be corrupted by naive pattern matching, so they are the most important tests here.
 */
describe('repairJson — must not corrupt string contents', () => {
  it('does not treat // inside a string as a comment', () => {
    expect(fixed('{"url":"https://example.com/path"}')).toEqual({
      url: 'https://example.com/path',
    });
  });

  it('does not treat /* inside a string as a comment', () => {
    expect(fixed('{"glob":"/*.ts"}')).toEqual({ glob: '/*.ts' });
  });

  it('does not treat a hash inside a string as a comment', () => {
    expect(fixed('{"colour":"#ff0000"}')).toEqual({ colour: '#ff0000' });
  });

  it('leaves braces and brackets inside strings alone', () => {
    expect(fixed('{"tpl":"{{name}}","arr":"[1,2]"}')).toEqual({
      tpl: '{{name}}',
      arr: '[1,2]',
    });
  });

  it('leaves commas inside strings alone', () => {
    expect(fixed('{"csv":"a,b,c,"}')).toEqual({ csv: 'a,b,c,' });
  });

  it('leaves an apostrophe inside a double-quoted string alone', () => {
    expect(fixed(`{"note":"it's fine"}`)).toEqual({ note: "it's fine" });
  });

  it('leaves the words true and null inside strings alone', () => {
    expect(fixed('{"a":"True","b":"null"}')).toEqual({ a: 'True', b: 'null' });
  });

  it('preserves an escaped quote', () => {
    expect(fixed('{"a":"say \\"hi\\""}')).toEqual({ a: 'say "hi"' });
  });

  it('preserves unicode escapes', () => {
    expect(fixed('{"a":"\\u00e9"}')).toEqual({ a: 'é' });
  });

  it('preserves emoji and CJK text', () => {
    expect(fixed('{"a":"🎉 日本語"}')).toEqual({ a: '🎉 日本語' });
  });

  it('converts a single-quoted string containing a double quote', () => {
    expect(fixed(`{'a':'say "hi"'}`)).toEqual({ a: 'say "hi"' });
  });

  it('handles a colon inside a string value', () => {
    expect(fixed('{"time":"12:30:00"}')).toEqual({ time: '12:30:00' });
  });
});

describe('repairJson — realistic combined cases', () => {
  it('repairs a hand-written config with several problems at once', () => {
    const input = `{
      // service configuration
      name: 'api-server',
      port: 8080,
      debug: True,
      timeout: .5,
      hosts: ['a.dev', 'b.dev',],
    }`;

    expect(fixed(input)).toEqual({
      name: 'api-server',
      port: 8080,
      debug: true,
      timeout: 0.5,
      hosts: ['a.dev', 'b.dev'],
    });
  });

  it('repairs a JavaScript object literal pasted from source', () => {
    expect(fixed(`{ id: 1, tags: ['a', 'b'], meta: { active: true, } }`)).toEqual({
      id: 1,
      tags: ['a', 'b'],
      meta: { active: true },
    });
  });

  it('repairs a truncated API response', () => {
    expect(fixed('{"items":[{"id":1},{"id":2}')).toEqual({ items: [{ id: 1 }, { id: 2 }] });
  });

  it('reports a count when the same problem occurs repeatedly', () => {
    const result = repairJson("{'a':'x','b':'y','c':'z'}");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const note = result.value.notes.find((n) => n.kind === 'single-quotes');
      expect(note?.count).toBe(6); // three keys plus three values
    }
  });

  it('always produces output that JSON.parse accepts', () => {
    const nasty = [
      '{',
      '[',
      '{"a"',
      '{"a":',
      '{,}',
      '[,]',
      '{"a":1,,}',
      "{'''}",
      '{"a":"\\',
      '[[[[',
      '{"a":{"b":{"c":',
    ];

    for (const input of nasty) {
      const result = repairJson(input);
      if (result.ok) {
        expect(() => JSON.parse(result.value.json)).not.toThrow();
      }
    }
  });
});
