import { describe, it, expect } from 'vitest';
import {
  compileRegex,
  runRegex,
  toSegments,
  applyReplace,
  testLines,
  explainRegex,
  buildPatternTree,
  flattenPatternGroups,
  detectFlavorHints,
  hasCatastrophicBacktrackingRisk,
  COMMON_PATTERNS,
  REDOS_LENGTH_GUARD,
} from './regex';

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

  it('lets a catastrophic-looking pattern through against short text, where it is harmless', () => {
    const shortSubject = 'a'.repeat(REDOS_LENGTH_GUARD - 2) + '!';
    expect(shortSubject.length).toBeLessThan(REDOS_LENGTH_GUARD);
    const result = runRegex('(a+)+$', '', shortSubject);
    expect(result.ok).toBe(true);
  });

  it('refuses a catastrophic-backtracking pattern once the text is long enough to hang', () => {
    const longSubject = 'a'.repeat(REDOS_LENGTH_GUARD + 20) + '!';
    const result = runRegex('(a+)+$', '', longSubject);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exponentially|freeze/i);
  });

  it('never blocks a real match with a merely nested-looking but unambiguous group', () => {
    // The slug preset's shape: a literal glues each repetition, so there is no actual
    // ambiguity for the engine to backtrack over, however long the input.
    const longSubject = 'tag-'.repeat(30) + 'end';
    const result = runRegex('[a-z0-9]+(?:-[a-z0-9]+)*', 'g', longSubject);
    expect(result.ok).toBe(true);
  });
});

describe('hasCatastrophicBacktrackingRisk', () => {
  it.each([
    ['(a+)+$', true],
    ['(\\d*)+', true],
    ['([a-zA-Z]+)*$', true],
    ['(.*)+', true],
    ['(a+)*', true],
  ])('flags the bare nested-repetition shape: %s', (pattern, expected) => {
    expect(hasCatastrophicBacktrackingRisk(pattern)).toBe(expected);
  });

  it.each(COMMON_PATTERNS.map((preset) => [preset.id, preset.pattern] as const))(
    'does not flag the built-in preset "%s"',
    (_id, pattern) => {
      expect(hasCatastrophicBacktrackingRisk(pattern)).toBe(false);
    }
  );

  it('does not flag a group repeated a bounded number of times', () => {
    expect(hasCatastrophicBacktrackingRisk('(?:\\d{1,3}\\.){3}\\d{1,3}')).toBe(false);
  });

  it('does not flag an unquantified group containing repetition', () => {
    expect(hasCatastrophicBacktrackingRisk('(a+)')).toBe(false);
  });

  it('returns false rather than throwing on a malformed pattern', () => {
    expect(hasCatastrophicBacktrackingRisk('(')).toBe(false);
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

  it('refuses a catastrophic-backtracking pattern once the subject is long enough to hang', () => {
    const result = applyReplace('(a+)+$', '', 'a'.repeat(REDOS_LENGTH_GUARD + 20), 'x');
    expect(result.ok).toBe(false);
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

  it('refuses when the longest single line is long enough for catastrophic backtracking to hang', () => {
    const longLine = 'a'.repeat(REDOS_LENGTH_GUARD + 20);
    const result = testLines('(a+)+$', '', `short\n${longLine}\nshort2`);
    expect(result.ok).toBe(false);
  });

  it('is not tripped by many short lines, only by a single long one', () => {
    const manyShortLines = Array(500).fill('short').join('\n');
    const result = testLines('(a+)+$', '', manyShortLines);
    expect(result.ok).toBe(true);
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

describe('buildPatternTree / flattenPatternGroups', () => {
  it('finds a single numbered group and reproduces its text', () => {
    const tree = buildPatternTree('a(b)c');
    const groups = flattenPatternGroups(tree);
    expect(groups).toEqual([{ index: 1, name: undefined }]);
  });

  it('assigns indexes left-to-right, including for nested groups', () => {
    const tree = buildPatternTree('(a(b)c)(d)');
    const groups = flattenPatternGroups(tree);
    expect(groups.map((g) => g.index)).toEqual([1, 2, 3]);
  });

  it('captures the name of a named group', () => {
    const tree = buildPatternTree('(?<year>\\d{4})');
    const groups = flattenPatternGroups(tree);
    expect(groups).toEqual([{ index: 1, name: 'year' }]);
  });

  it('does not assign an index to non-capturing groups or lookaround', () => {
    const tree = buildPatternTree('(?:abc)(?=x)(?!y)(?<=z)(?<!w)(v)');
    const groups = flattenPatternGroups(tree);
    expect(groups).toEqual([{ index: 1, name: undefined }]);
  });

  it('does not treat a group-like sequence inside a character class as a group', () => {
    const tree = buildPatternTree('[(a)](b)');
    const groups = flattenPatternGroups(tree);
    expect(groups).toEqual([{ index: 1, name: undefined }]);
  });

  it('does not crash on malformed input such as an unclosed group', () => {
    expect(() => buildPatternTree('(abc')).not.toThrow();
    expect(() => buildPatternTree('[abc')).not.toThrow();
  });

  it('rebuilds to the exact original pattern text', () => {
    const flattenText = (nodes: ReturnType<typeof buildPatternTree>): string =>
      nodes.map((n) => (n.type === 'text' ? n.text : flattenText(n.children))).join('');
    const pattern = '(?<user>[\\w.+-]+)@(?:foo|(?<domain>[\\w-]+))';
    expect(flattenText(buildPatternTree(pattern))).toBe(pattern);
  });
});

describe('detectFlavorHints', () => {
  it('flags Python/PCRE named group syntax', () => {
    const hints = detectFlavorHints('(?P<year>\\d{4})');
    expect(hints.some((h) => h.includes('(?P<name>'))).toBe(true);
  });

  it('flags a Python named back-reference', () => {
    const hints = detectFlavorHints('(?P<a>x)(?P=a)');
    expect(hints.some((h) => h.includes('(?P=name)'))).toBe(true);
  });

  it('flags an atomic group', () => {
    expect(detectFlavorHints('(?>abc)').some((h) => h.includes('atomic group'))).toBe(true);
  });

  it('flags a possessive quantifier', () => {
    expect(detectFlavorHints('a++').some((h) => h.includes('Possessive'))).toBe(true);
  });

  it('flags a POSIX character class', () => {
    expect(detectFlavorHints('[[:alpha:]]+').some((h) => h.includes('POSIX'))).toBe(true);
  });

  it('flags an inline mode modifier', () => {
    expect(detectFlavorHints('(?i)abc').some((h) => h.includes('Inline mode'))).toBe(true);
  });

  it('flags \\A / \\Z / \\z anchors', () => {
    expect(detectFlavorHints('\\Aabc\\z').some((h) => h.includes('\\A'))).toBe(true);
  });

  it('returns nothing for an ordinary JavaScript pattern', () => {
    expect(detectFlavorHints('(?<user>[\\w.+-]+)@(?<domain>[\\w-]+)')).toEqual([]);
  });

  it('does not confuse a named group with an inline modifier', () => {
    expect(detectFlavorHints('(?<year>\\d{4})')).toEqual([]);
  });
});

describe('COMMON_PATTERNS', () => {
  it('every preset compiles and matches at least once in its own sample', () => {
    for (const preset of COMMON_PATTERNS) {
      const result = runRegex(preset.pattern, preset.flags, preset.sample);
      expect(result.ok, `${preset.id} should compile`).toBe(true);
      if (result.ok) {
        expect(result.value.matches.length, `${preset.id} should match its sample`).toBeGreaterThan(0);
      }
    }
  });

  it('has a unique id for every preset', () => {
    const ids = COMMON_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
