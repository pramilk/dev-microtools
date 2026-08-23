import { describe, it, expect } from 'vitest';
import {
  buildGradientCss,
  buildGradientDeclaration,
  DEFAULT_GRADIENT_OPTIONS,
  GRADIENT_PRESETS,
  type GradientOptions,
} from './gradient';

const options = (overrides: Partial<GradientOptions> = {}): GradientOptions => ({
  ...DEFAULT_GRADIENT_OPTIONS,
  stops: DEFAULT_GRADIENT_OPTIONS.stops.map((stop) => ({ ...stop })),
  ...overrides,
});

describe('buildGradientCss', () => {
  it('builds a linear gradient with normalised hex stops', () => {
    const result = buildGradientCss(options({ type: 'linear', angle: 90 }));
    expect(result).toEqual({ ok: true, value: 'linear-gradient(90deg, #3cbcd4 0%, #6b21a8 100%)' });
  });

  it('builds a radial gradient', () => {
    const result = buildGradientCss(options({ type: 'radial', shape: 'circle', position: 'top left' }));
    expect(result).toEqual({ ok: true, value: 'radial-gradient(circle at top left, #3cbcd4 0%, #6b21a8 100%)' });
  });

  it('builds a conic gradient', () => {
    const result = buildGradientCss(options({ type: 'conic', angle: 45, position: 'center' }));
    expect(result).toEqual({ ok: true, value: 'conic-gradient(from 45deg at center, #3cbcd4 0%, #6b21a8 100%)' });
  });

  it('accepts rgb() and named colours, normalising both to hex', () => {
    const result = buildGradientCss(
      options({
        stops: [
          { color: 'rgb(255 0 0)', position: 0 },
          { color: 'teal', position: 100 },
        ],
      })
    );
    expect(result).toEqual({ ok: true, value: 'linear-gradient(90deg, #ff0000 0%, #008080 100%)' });
  });

  it('supports more than two stops', () => {
    const result = buildGradientCss(
      options({
        stops: [
          { color: '#fff', position: 0 },
          { color: '#888', position: 50 },
          { color: '#000', position: 100 },
        ],
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('linear-gradient(90deg, #ffffff 0%, #888888 50%, #000000 100%)');
  });

  it('rejects fewer than two stops', () => {
    const result = buildGradientCss(options({ stops: [{ color: '#fff', position: 0 }] }));
    expect(result.ok).toBe(false);
  });

  it('rejects an out-of-range stop position', () => {
    const result = buildGradientCss(
      options({ stops: [{ color: '#fff', position: -5 }, { color: '#000', position: 100 }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/out of range/);
  });

  it('rejects an unparseable colour with a helpful message', () => {
    const result = buildGradientCss(
      options({ stops: [{ color: 'not-a-colour', position: 0 }, { color: '#000', position: 100 }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not-a-colour/);
  });
});

describe('GRADIENT_PRESETS', () => {
  it('has a unique name per preset', () => {
    const names = GRADIENT_PRESETS.map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every preset builds valid CSS as a linear gradient', () => {
    for (const preset of GRADIENT_PRESETS) {
      const result = buildGradientCss({ ...DEFAULT_GRADIENT_OPTIONS, stops: preset.stops });
      expect(result.ok).toBe(true);
    }
  });
});

describe('buildGradientDeclaration', () => {
  it('wraps the gradient in a background declaration', () => {
    const result = buildGradientDeclaration(options());
    expect(result).toEqual({ ok: true, value: 'background: linear-gradient(90deg, #3cbcd4 0%, #6b21a8 100%);' });
  });

  it('propagates an error rather than producing a broken declaration', () => {
    const result = buildGradientDeclaration(options({ stops: [] }));
    expect(result.ok).toBe(false);
  });
});
