import { describe, it, expect } from 'vitest';
import { buildBoxShadowCss, buildBoxShadowDeclaration, DEFAULT_SHADOW_LAYER, SHADOW_PRESETS, type ShadowLayer } from './boxShadow';

const layer = (overrides: Partial<ShadowLayer> = {}): ShadowLayer => ({
  ...DEFAULT_SHADOW_LAYER,
  ...overrides,
});

describe('buildBoxShadowCss', () => {
  it('builds a single-layer shadow with rgba colour', () => {
    const result = buildBoxShadowCss([layer({ offsetX: 0, offsetY: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.35)' })]);
    expect(result).toEqual({ ok: true, value: '0px 4px 12px 0px rgb(0 0 0 / 0.35)' });
  });

  it('renders an opaque colour without an alpha segment', () => {
    const result = buildBoxShadowCss([layer({ color: '#000000' })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('rgb(0 0 0)');
  });

  it('prefixes inset shadows with "inset"', () => {
    const result = buildBoxShadowCss([layer({ inset: true })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.startsWith('inset ')).toBe(true);
  });

  it('joins multiple layers with a comma, outermost first', () => {
    const result = buildBoxShadowCss([
      layer({ offsetY: 1, blur: 2, color: '#fff' }),
      layer({ offsetY: 2, blur: 4, color: '#000' }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const [first, second] = result.value.split(', ');
      expect(first).toContain('1px 2px');
      expect(second).toContain('2px 4px');
    }
  });

  it('allows negative offsets and spread', () => {
    const result = buildBoxShadowCss([layer({ offsetX: -5, offsetY: -5, spread: -2 })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('-5px -5px');
  });

  it('rejects an empty layer list', () => {
    expect(buildBoxShadowCss([]).ok).toBe(false);
  });

  it('rejects a negative blur radius', () => {
    const result = buildBoxShadowCss([layer({ blur: -1 })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/blur/i);
  });

  it('rejects an unparseable colour with a helpful message', () => {
    const result = buildBoxShadowCss([layer({ color: 'not-a-colour' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not-a-colour/);
  });
});

describe('buildBoxShadowDeclaration', () => {
  it('wraps the value in a box-shadow declaration', () => {
    const result = buildBoxShadowDeclaration([layer({ offsetX: 0, offsetY: 4, blur: 12, spread: 0, color: '#000000' })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('box-shadow: 0px 4px 12px 0px rgb(0 0 0);');
  });

  it('propagates an error rather than producing a broken declaration', () => {
    expect(buildBoxShadowDeclaration([]).ok).toBe(false);
  });
});

describe('SHADOW_PRESETS', () => {
  it('has a unique name per preset', () => {
    const names = SHADOW_PRESETS.map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every preset builds valid CSS', () => {
    for (const preset of SHADOW_PRESETS) {
      expect(buildBoxShadowCss(preset.layers).ok).toBe(true);
    }
  });
});
