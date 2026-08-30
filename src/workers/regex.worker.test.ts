import { describe, it, expect } from 'vitest';
import { handleRegexRequest } from './regex.worker';

describe('handleRegexRequest', () => {
  it('runs a pattern and returns its matches', async () => {
    const result = await handleRegexRequest({ kind: 'run', pattern: '\\d+', flags: 'g', subject: 'a1 b22' });
    if (result.kind !== 'run') throw new Error('expected a run result');
    expect(result.value.matches.map((m) => m.text)).toEqual(['1', '22']);
  });

  it('applies a replacement', async () => {
    const result = await handleRegexRequest({ kind: 'replace', pattern: 'a', flags: 'g', subject: 'banana', replacement: 'o' });
    if (result.kind !== 'replace') throw new Error('expected a replace result');
    expect(result.value).toBe('bonono');
  });

  it('tests each line independently', async () => {
    const result = await handleRegexRequest({ kind: 'testLines', pattern: '^\\d+$', flags: '', subject: '1\nx\n2' });
    if (result.kind !== 'testLines') throw new Error('expected a testLines result');
    expect(result.value.map((r) => r.matched)).toEqual([true, false, true]);
  });

  it('rejects a flagged catastrophic-backtracking pattern against long text, via the static guard', async () => {
    await expect(
      handleRegexRequest({ kind: 'run', pattern: '(a+)+$', flags: '', subject: 'a'.repeat(30) + '!' })
    ).rejects.toThrow(/exponentially longer/i);
  });
});
