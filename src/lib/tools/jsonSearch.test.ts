import { describe, it, expect } from 'vitest';
import { findTextMatches, toTextSearchSegments, searchJsonTree } from './jsonSearch';

describe('findTextMatches', () => {
  it('finds every case-insensitive occurrence', () => {
    expect(findTextMatches('foo bar FOO baz foo', 'foo')).toEqual([0, 8, 16]);
  });

  it('returns an empty array for no match', () => {
    expect(findTextMatches('hello world', 'xyz')).toEqual([]);
  });

  it('returns an empty array for an empty query', () => {
    expect(findTextMatches('hello world', '')).toEqual([]);
  });

  it('returns an empty array for empty text', () => {
    expect(findTextMatches('', 'foo')).toEqual([]);
  });

  it('handles overlapping-looking runs without infinite looping', () => {
    expect(findTextMatches('aaaa', 'aa')).toEqual([0, 2]);
  });

  it('matches unicode substrings', () => {
    expect(findTextMatches('héllo wörld héllo', 'héllo')).toEqual([0, 12]);
  });
});

describe('toTextSearchSegments', () => {
  it('returns the whole text as one unmatched segment when there are no positions', () => {
    expect(toTextSearchSegments('hello', [], 3)).toEqual([{ text: 'hello', matchIndex: null }]);
  });

  it('splits text into alternating matched and unmatched segments', () => {
    const segments = toTextSearchSegments('foo bar foo', [0, 8], 3);
    expect(segments).toEqual([
      { text: 'foo', matchIndex: 0 },
      { text: ' bar ', matchIndex: null },
      { text: 'foo', matchIndex: 1 },
    ]);
  });

  it('handles a match at the very end with no trailing text', () => {
    const segments = toTextSearchSegments('xxfoo', [2], 3);
    expect(segments).toEqual([
      { text: 'xx', matchIndex: null },
      { text: 'foo', matchIndex: 0 },
    ]);
  });
});

describe('searchJsonTree', () => {
  it('finds a match by object key', () => {
    const result = searchJsonTree({ name: 'ada', role: 'engineer' }, 'name');
    expect(result.matchCount).toBe(1);
    expect(result.keepPaths.has('$/name')).toBe(true);
    expect(result.keepPaths.has('$/role')).toBe(false);
  });

  it('finds a match by scalar value', () => {
    const result = searchJsonTree({ name: 'ada', role: 'engineer' }, 'engineer');
    expect(result.matchCount).toBe(1);
    expect(result.keepPaths.has('$/role')).toBe(true);
  });

  it('keeps every ancestor of a nested match, not just the match itself', () => {
    const result = searchJsonTree({ meta: { tags: ['x', 'target', 'y'] } }, 'target');
    expect(result.matchCount).toBe(1);
    expect(result.keepPaths.has('$')).toBe(true); // root is an ancestor of the match too
    expect(result.keepPaths.has('$/meta')).toBe(true);
    expect(result.keepPaths.has('$/meta/tags')).toBe(true);
    expect(result.keepPaths.has('$/meta/tags/1')).toBe(true);
    expect(result.keepPaths.has('$/meta/tags/0')).toBe(false);
  });

  it('matches array indices used as keys', () => {
    const result = searchJsonTree(['a', 'b', 'c'], 'b');
    expect(result.matchCount).toBe(1);
    expect(result.keepPaths.has('$/1')).toBe(true);
  });

  it('is case-insensitive', () => {
    const result = searchJsonTree({ Name: 'Ada' }, 'ada');
    expect(result.matchCount).toBe(1);
  });

  it('returns no matches and an empty keep set for an empty query', () => {
    const result = searchJsonTree({ a: 1 }, '');
    expect(result.matchCount).toBe(0);
    expect(result.keepPaths.size).toBe(0);
  });

  it('returns no matches when nothing in the document matches', () => {
    const result = searchJsonTree({ a: 1, b: [1, 2] }, 'zzz');
    expect(result.matchCount).toBe(0);
    expect(result.keepPaths.size).toBe(0);
  });

  it('matches null and boolean values via their JSON representation', () => {
    const result = searchJsonTree({ active: true, deleted: null }, 'true');
    expect(result.matchCount).toBe(1);
    expect(result.keepPaths.has('$/active')).toBe(true);
  });

  it('matches a bare scalar document at the root', () => {
    const result = searchJsonTree('hello world', 'world');
    expect(result.matchCount).toBe(1);
    expect(result.keepPaths.has('$')).toBe(true);
  });
});
