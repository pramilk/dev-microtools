import { describe, it, expect } from 'vitest';
import { compileRegex, runRegex, toSegments, applyReplace, testLines, explainRegex } from './regex';

describe('compileRegex', () => {
  it('compiles a valid pattern', () => {
    expect(compileRegex('\\d+', 'g').ok).toBe(true);
  });

  it('reports a syntax error instead of throwing', () => {
    const result = compileRegex('[unclosed', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it('rejects an empty pattern', () => {
    expect(compileRegex('', 'g').ok).toBe(false);
  });
});

describe('runRegex', () => {
  it('finds all matches with the global flag', () => {
    const result = runRegex('\\d+', 'g', 'a1 b22 c333');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.matches.map((m) => m.text)).toEqual(['1', '22', '333']);
  });

  it('finds only the first match without the global flag', () => {
    const result = runRegex('\\d+', '', 'a1 b22');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.matches).toHaveLength(1);
  });

  it('records match positions', () => {
    const result = runRegex('b', 'g', 'abc');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.matches[0]).toMatchObject({ index: 1, length: 1 });
  });

  it('captures numbered groups', () => {
    const result = runRegex('(\\w)(\\d)', 'g', 'a1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.matches[0]!.groups).toEqual(['a', '1']);
  });

  it('captures named groups', () => {
    const result = runRegex('(?<letter>\\w)(?<digit>\\d)', 'g', 'a1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.matches[0]!.named).toEqual({ letter: 'a', digit: '1' });
  });

  it('terminates on a zero-length global match instead of looping forever', () => {
    const result = runRegex('a*', 'g', 'bbb');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.hasEmptyMatch).toBe(true);
  });

  it('honours the case-insensitive flag', () => {
    const result = runRegex('abc', 'gi', 'ABC abc');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.matches).toHaveLength(2);
  });

  it('returns no matches for a pattern that does not match', () => {
    const result = runRegex('zzz', 'g', 'abc');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.matches).toEqual([]);
  });

  it('propagates an invalid pattern as an error', () => {
    expect(runRegex('(', 'g', 'abc').ok).toBe(false);
  });
});

describe('toSegments', () => {
  it('splits text into matched and unmatched runs', () => {
    const run = runRegex('b', 'g', 'abc');
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    expect(toSegments('abc', run.value.matches)).toEqual([
      { text: 'a', isMatch: false },
      { text: 'b', isMatch: true, matchNumber: 1 },
      { text: 'c', isMatch: false },
    ]);
  });

  it('returns the whole subject as one unmatched run when nothing matches', () => {
    expect(toSegments('abc', [])).toEqual([{ text: 'abc', isMatch: false }]);
  });

  it('returns nothing for empty input', () => {
    expect(toSegments('', [])).toEqual([]);
  });

  it('reassembles to exactly the original text', () => {
    const subject = 'the quick brown fox';
    const run = runRegex('\\w+', 'g', subject);
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const rebuilt = toSegments(subject, run.value.matches)
      .map((s) => s.text)
      .join('');
    expect(rebuilt).toBe(subject);
  });

  it('handles a match at the very start and end', () => {
    const run = runRegex('a', 'g', 'aba');
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const segments = toSegments('aba', run.value.matches);
    expect(segments[0]).toMatchObject({ isMatch: true });
    expect(segments[segments.length - 1]).toMatchObject({ isMatch: true });
  });
});

describe('applyReplace', () => {
  it('replaces using numbered back-references', () => {
    expect(applyReplace('(\\w+)@(\\w+)', 'g', 'user@host', '$2:$1')).toEqual({
      ok: true,
      value: 'host:user',
    });
  });

  it('replaces using named back-references', () => {
    expect(applyReplace('(?<y>\\d{4})-(?<m>\\d{2})', 'g', '2026-08', '$<m>/$<y>')).toEqual({
      ok: true,
      value: '08/2026',
    });
  });

  it('propagates an invalid pattern', () => {
    expect(applyReplace('(', 'g', 'x', 'y').ok).toBe(false);
  });
});

describe('testLines', () => {
  it('reports pass/fail per line', () => {
    const result = testLines('^\\d+$', '', '123\nabc\n456');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((r) => r.matched)).toEqual([true, false, true]);
    }
  });

  it('counts matches per line', () => {
    const result = testLines('\\d+', '', 'a1 b2 c3\nno digits here');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]).toMatchObject({ matched: true, matchCount: 3 });
      expect(result.value[1]).toMatchObject({ matched: false, matchCount: 0 });
    }
  });

  it('works whether or not the caller already passed the global flag', () => {
    const withoutG = testLines('a', '', 'aaa');
    const withG = testLines('a', 'g', 'aaa');
    expect(withoutG.ok && withG.ok).toBe(true);
    if (withoutG.ok && withG.ok) {
      expect(withoutG.value[0]!.matchCount).toBe(3);
      expect(withG.value[0]!.matchCount).toBe(3);
    }
  });

  it('rejects empty input', () => {
    expect(testLines('a', '', '').ok).toBe(false);
  });

  it('propagates an invalid pattern', () => {
    expect(testLines('(', '', 'x').ok).toBe(false);
  });
});

describe('explainRegex', () => {
  it('describes a literal run and a digit class as separate bullets', () => {
    const result = explainRegex('cat\\d', '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const joined = result.value.join(' ');
      expect(joined).toMatch(/"cat"/);
      expect(joined).toMatch(/digit/);
    }
  });

  it('describes a quantifier', () => {
    const result = explainRegex('a+', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]).toMatch(/one or more times/);
  });

  it('describes a lazy quantifier', () => {
    const result = explainRegex('a+?', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]).toMatch(/as few as possible/);
  });

  it('describes a bounded quantifier', () => {
    const result = explainRegex('a{2,4}', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]).toMatch(/between 2 and 4 times/);
  });

  it('describes anchors', () => {
    const result = explainRegex('^abc$', '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.join(' ')).toMatch(/start of the string/);
      expect(result.value.join(' ')).toMatch(/end of the string/);
    }
  });

  it('describes a custom character class with a range', () => {
    const result = explainRegex('[a-z0-9]', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]).toMatch(/"a" to "z"/);
  });

  it('describes a negated character class', () => {
    const result = explainRegex('[^abc]', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]).toMatch(/except/);
  });

  it('describes a named capturing group', () => {
    const result = explainRegex('(?<year>\\d{4})', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]).toMatch(/named "year"/);
  });

  it('describes a non-capturing group', () => {
    const result = explainRegex('(?:abc)+', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]).toMatch(/not captured/);
  });

  it('describes alternation', () => {
    const result = explainRegex('cat|dog', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]).toMatch(/"cat".*or.*"dog"/);
  });

  it('describes a positive lookahead', () => {
    const result = explainRegex('foo(?=bar)', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.join(' ')).toMatch(/followed by/i);
  });

  it('describes a negative lookbehind', () => {
    const result = explainRegex('(?<!foo)bar', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.join(' ')).toMatch(/not preceded by/i);
  });

  it('mentions active flags', () => {
    const result = explainRegex('abc', 'gi');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const joined = result.value.join(' ');
      expect(joined).toMatch(/ignores upper\/lower case/);
      expect(joined).toMatch(/every match/);
    }
  });

  it('propagates an invalid pattern', () => {
    expect(explainRegex('(', '').ok).toBe(false);
  });

  it('rejects an empty pattern', () => {
    expect(explainRegex('', '').ok).toBe(false);
  });
});
