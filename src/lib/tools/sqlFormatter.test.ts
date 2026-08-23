import { describe, it, expect } from 'vitest';
import { formatSql, MAX_INPUT_LENGTH } from './sqlFormatter';

describe('formatSql', () => {
  it('formats a query with uppercase keywords by default', async () => {
    const result = await formatSql('select a,b from t where a=1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('SELECT');
    expect(result.value).toContain('FROM');
    expect(result.value).toContain('WHERE');
    expect(result.value).toMatch(/a,\s*\n\s*b/);
  });

  it('lowercases keywords when keywordCase is "lower"', async () => {
    const result = await formatSql('SELECT a FROM t WHERE a=1', { dialect: 'sql', keywordCase: 'lower', tabWidth: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('select');
    expect(result.value).toContain('from');
    expect(result.value).not.toContain('SELECT');
  });

  it('preserves the original keyword casing when keywordCase is "preserve"', async () => {
    const result = await formatSql('Select a From t Where a=1', { dialect: 'sql', keywordCase: 'preserve', tabWidth: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('Select');
    expect(result.value).toContain('From');
    expect(result.value).toContain('Where');
  });

  it('respects the requested indent width', async () => {
    const two = await formatSql('SELECT a FROM t', { dialect: 'sql', keywordCase: 'upper', tabWidth: 2 });
    const four = await formatSql('SELECT a FROM t', { dialect: 'sql', keywordCase: 'upper', tabWidth: 4 });
    expect(two.ok && four.ok).toBe(true);
    if (!two.ok || !four.ok) return;
    expect(two.value).toContain('\n  a');
    expect(four.value).toContain('\n    a');
  });

  it('formats dialect-specific syntax (PostgreSQL cast operator)', async () => {
    const result = await formatSql('SELECT a::text FROM t', { dialect: 'postgresql', keywordCase: 'upper', tabWidth: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('a::text');
  });

  it('formats dialect-specific syntax (T-SQL bracketed identifiers and TOP)', async () => {
    const result = await formatSql('SELECT TOP 5 [Name] FROM [Users]', {
      dialect: 'transactsql',
      keywordCase: 'upper',
      tabWidth: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('[Name]');
    expect(result.value).toContain('TOP 5');
  });

  it('preserves unicode and emoji inside string literals', async () => {
    const result = await formatSql("SELECT '日本語 emoji 😀' AS greeting FROM t");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('日本語 emoji 😀');
  });

  it('rejects empty input', async () => {
    const result = await formatSql('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/enter some sql/i);
  });

  it('rejects input past the size limit', async () => {
    const huge = `SELECT ${'a'.repeat(MAX_INPUT_LENGTH)} FROM t`;
    const result = await formatSql(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too large/i);
  });

  it('reports malformed SQL with a short, human-readable message instead of a grammar dump', async () => {
    const result = await formatSql('SELECT * FROM foo WHERE (a=1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/could not format this sql/i);
    expect(result.error.split('\n')).toHaveLength(1);
    expect(result.error.length).toBeLessThan(200);
  });

  it('reports an unterminated string literal clearly', async () => {
    const result = await formatSql("SELECT 'unterminated FROM t");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/could not format this sql/i);
  });
});
