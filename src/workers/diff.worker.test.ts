import { describe, it, expect } from 'vitest';
import { handleDiffRequest } from './diff.worker';

describe('handleDiffRequest', () => {
  it('diffs plain text line by line', async () => {
    const summary = await handleDiffRequest({
      kind: 'text',
      left: 'a\nb\n',
      right: 'a\nc\n',
      mode: 'line',
      ignoreCase: false,
      ignoreWhitespace: false,
    });
    expect(summary.identical).toBe(false);
  });

  it('treats equivalent JSON as identical', async () => {
    const summary = await handleDiffRequest({ kind: 'json', left: '{"a":1,"b":2}', right: '{"b":2,"a":1}' });
    expect(summary.identical).toBe(true);
  });

  it('rejects with the underlying tool error when both sides are empty', async () => {
    await expect(
      handleDiffRequest({ kind: 'text', left: '', right: '', mode: 'line', ignoreCase: false, ignoreWhitespace: false })
    ).rejects.toThrow(/paste text/i);
  });
});
