import { describe, it, expect } from 'vitest';
import { handleMinifierRequest } from './minifier.worker';

describe('handleMinifierRequest', () => {
  it('minifies CSS', async () => {
    const output = await handleMinifierRequest({ input: '.a {\n  color: red;\n}\n', language: 'css' });
    expect(output).toBe('.a{color:red}');
  });

  it('minifies JavaScript via Terser', async () => {
    const output = await handleMinifierRequest({ input: 'function greet(name) {\n  return `hi ${name}`;\n}\n', language: 'js' });
    expect(output).not.toContain('\n');
  });

  it('rejects with the underlying tool error for empty input', async () => {
    await expect(handleMinifierRequest({ input: '', language: 'js' })).rejects.toThrow(/enter some/i);
  });
});
