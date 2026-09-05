import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/tools/sentenceCase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tools/sentenceCase')>();
  return {
    ...actual,
    // The real `classifyWithTransformer` depends on a multi-megabyte WASM model — this
    // worker file is thin glue, so the only thing worth verifying here is that it wires its
    // request through to `applySentenceCase` at all, not that the real model works (that's
    // this module's own, deliberately absent, unit test — see its doc comment).
    classifyWithTransformer: vi.fn(async () => []),
  };
});

describe('handleSentenceCaseRequest', () => {
  it('runs sentence case on the requested text and returns the result', async () => {
    const { handleSentenceCaseRequest } = await import('./sentenceCase.worker');

    const result = await handleSentenceCaseRequest({ text: 'john smith went to paris.' });

    expect(result.text).toBe('John Smith went to Paris.');
    expect(result.lowConfidenceRanges).toEqual([]);
  });
});
