import { describe, it, expect } from 'vitest';
import {
  AUTO_LEVELS_CLIP,
  CHARACTER_RAMPS,
  CHARACTER_ASPECT_RATIO,
  DEFAULT_COLUMNS,
  DEFAULT_RAMP_ID,
  MAX_ASCII_CELLS,
  MAX_COLUMNS,
  MIN_COLUMNS,
  adjustChannel,
  computeAsciiDimensions,
  computeLevelRange,
  normalizeChannel,
  imageToAsciiGrid,
  rampById,
  relativeLuminance,
  renderAsciiColorMarkup,
  renderAsciiHtmlDocument,
  renderAsciiText,
  toCharacterLevels,
  validateAsciiDimensions,
  validateCharacters,
  type AsciiOptions,
} from './asciiArt';

/** Auto levels off, so every mapping expectation below reads against the literal pixel
 *  values rather than against a stretched version of them. The stretch has its own tests. */
const OPTIONS: AsciiOptions = { characters: ' .:-=+*#%@', invert: false, autoLevels: false, brightness: 0, contrast: 0 };

/** Builds an RGBA buffer from a list of `[r, g, b, a]` tuples, so a test can state pixels literally. */
const pixels = (values: [number, number, number, number][]): Uint8ClampedArray =>
  new Uint8ClampedArray(values.flat());

/** A solid-colour RGBA buffer of `width * height` pixels. */
const solid = (width: number, height: number, rgba: [number, number, number, number]): Uint8ClampedArray =>
  pixels(Array.from({ length: width * height }, () => rgba));

describe('CHARACTER_RAMPS', () => {
  it('exposes the four presets, each starting with a space so blank areas stay blank', () => {
    expect(CHARACTER_RAMPS.map((ramp) => ramp.id)).toEqual(['blocks', 'standard', 'detailed', 'silhouette']);
    for (const ramp of CHARACTER_RAMPS) {
      expect(ramp.characters.startsWith(' ')).toBe(true);
      expect(toCharacterLevels(ramp.characters).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('orders every preset lightest-first, which the whole module depends on', () => {
    // The last character of a lightest-first ramp is the densest ink; a space could never be.
    for (const ramp of CHARACTER_RAMPS) {
      expect(ramp.characters.at(-1)).not.toBe(' ');
    }
  });

  it('defaults to the first ramp offered, so the UI and the logic agree', () => {
    expect(rampById(DEFAULT_RAMP_ID)).toBeDefined();
    expect(CHARACTER_RAMPS[0]!.id).toBe(DEFAULT_RAMP_ID);
    expect(rampById('not-a-ramp')).toBeUndefined();
  });

  it('gives the detailed ramp the 70 levels the published Bourke ramp has', () => {
    expect(toCharacterLevels(rampById('detailed')!.characters)).toHaveLength(70);
  });
});

describe('toCharacterLevels', () => {
  it('splits by whole characters, not UTF-16 code units', () => {
    expect(toCharacterLevels(' .#')).toEqual([' ', '.', '#']);
    expect(toCharacterLevels(' ░▒▓█')).toEqual([' ', '░', '▒', '▓', '█']);
    // An astral-plane character is two UTF-16 code units but one ramp level.
    expect(toCharacterLevels(' 🌑')).toEqual([' ', '🌑']);
  });
});

describe('validateCharacters', () => {
  it('accepts any ramp of two or more characters', () => {
    expect(validateCharacters(' @')).toEqual({ ok: true, value: [' ', '@'] });
    expect(validateCharacters(' .:-=+*#%@').ok).toBe(true);
  });

  it('rejects an empty ramp with a message saying what is expected', () => {
    const result = validateCharacters('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least two characters/i);
  });

  it('rejects a single-character ramp rather than emitting one repeated character', () => {
    const result = validateCharacters('#');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/single character/i);
  });

  it('counts an astral-plane pair as one level, so a lone emoji is still rejected', () => {
    expect(validateCharacters('🌑').ok).toBe(false);
    expect(validateCharacters(' 🌑').ok).toBe(true);
  });
});

describe('computeAsciiDimensions', () => {
  it('corrects for a text cell being taller than it is wide', () => {
    // A square image at 100 columns is 50 rows, not 100 — otherwise it renders stretched.
    expect(computeAsciiDimensions(400, 400, 100)).toEqual({ columns: 100, rows: 50 });
    expect(CHARACTER_ASPECT_RATIO).toBe(0.5);
  });

  it('keeps the source aspect ratio for non-square images', () => {
    expect(computeAsciiDimensions(300, 225, 100)).toEqual({ columns: 100, rows: 38 });
    expect(computeAsciiDimensions(1920, 1080, 120)).toEqual({ columns: 120, rows: 34 });
  });

  it('clamps the requested width into the supported range', () => {
    expect(computeAsciiDimensions(100, 100, 5).columns).toBe(MIN_COLUMNS);
    expect(computeAsciiDimensions(100, 100, 10_000).columns).toBe(MAX_COLUMNS);
    expect(computeAsciiDimensions(100, 100, 88.6).columns).toBe(89);
  });

  it('never returns zero rows for an extremely wide, short image', () => {
    expect(computeAsciiDimensions(4000, 10, 100).rows).toBe(1);
  });

  it('returns a usable grid rather than NaN for a degenerate size', () => {
    expect(computeAsciiDimensions(0, 0, DEFAULT_COLUMNS)).toEqual({ columns: DEFAULT_COLUMNS, rows: 1 });
  });
});

describe('validateAsciiDimensions', () => {
  it('accepts a grid inside the cell budget', () => {
    expect(validateAsciiDimensions(220, 900)).toEqual({ ok: true, value: true });
  });

  it('rejects a grid over the cell budget, naming the row count and the limit', () => {
    const result = validateAsciiDimensions(200, 5000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('5,000');
      expect(result.error).toContain(MAX_ASCII_CELLS.toLocaleString());
    }
  });
});

describe('relativeLuminance', () => {
  it('returns 0 for black and 1 for white', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 10);
  });

  it('weights green far above blue, matching Rec. 709', () => {
    expect(relativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance(0, 0, 255)).toBeCloseTo(0.0722, 4);
    expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 4);
  });
});

describe('computeLevelRange', () => {
  it('finds the narrow band a flat, mid-tone image actually occupies', () => {
    const band: [number, number, number, number][] = [];
    for (let level = 90; level <= 170; level += 1) band.push([level, level, level, 255]);
    const range = computeLevelRange(pixels(band), band.length, 1);
    expect(range.min).toBeGreaterThanOrEqual(89);
    expect(range.max).toBeLessThanOrEqual(171);
    expect(range.max - range.min).toBeLessThan(90);
  });

  it('reports essentially the full range for an image that already spans black to white', () => {
    const spread: [number, number, number, number][] = [];
    for (let level = 0; level <= 255; level += 1) spread.push([level, level, level, 255]);
    const range = computeLevelRange(pixels(spread), spread.length, 1);
    // Not exactly 0-255: the clip fraction trims a pixel off each end, by design.
    expect(range.min).toBeLessThanOrEqual(2);
    expect(range.max).toBeGreaterThanOrEqual(253);
  });

  it('ignores a handful of outliers rather than letting one stray pixel define the range', () => {
    // A 100-160 band plus one pure-black and one pure-white pixel. Both outliers sit inside
    // the clip fraction, so the reported range is the band, not 0-255.
    const values: [number, number, number, number][] = [];
    for (let i = 0; i < 400; i += 1) {
      const level = 100 + (i % 61);
      values.push([level, level, level, 255]);
    }
    values[0] = [0, 0, 0, 255];
    values[1] = [255, 255, 255, 255];
    expect(Math.floor(values.length * AUTO_LEVELS_CLIP)).toBeGreaterThanOrEqual(2);

    const range = computeLevelRange(pixels(values), values.length, 1);
    expect(range.min).toBeGreaterThan(50);
    expect(range.max).toBeLessThan(200);
  });

  it('leaves an almost-uniform image alone instead of amplifying its noise', () => {
    const nearlyFlat: [number, number, number, number][] = [
      [128, 128, 128, 255],
      [131, 131, 131, 255],
    ];
    expect(computeLevelRange(pixels(nearlyFlat), 2, 1)).toEqual({ min: 0, max: 255 });
  });

  it('excludes transparent pixels, so a logo’s empty background gets no vote', () => {
    const logo: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [100, 100, 100, 255],
      [140, 140, 140, 255],
    ];
    const range = computeLevelRange(pixels(logo), 4, 1);
    expect(range.min).toBeGreaterThan(0);
    expect(range.max).toBeLessThan(255);
  });

  it('falls back to the full range when every pixel is transparent', () => {
    expect(computeLevelRange(solid(4, 1, [10, 10, 10, 0]), 4, 1)).toEqual({ min: 0, max: 255 });
  });
});

describe('normalizeChannel', () => {
  it('stretches the given window onto 0-255', () => {
    expect(normalizeChannel(90, 90, 170)).toBe(0);
    expect(normalizeChannel(170, 90, 170)).toBe(255);
    expect(normalizeChannel(130, 90, 170)).toBeCloseTo(127.5, 1);
  });

  it('clamps values outside the window instead of overshooting', () => {
    expect(normalizeChannel(20, 90, 170)).toBe(0);
    expect(normalizeChannel(250, 90, 170)).toBe(255);
  });

  it('is the identity for the full range, and refuses to divide by an empty one', () => {
    expect(normalizeChannel(77, 0, 255)).toBe(77);
    expect(normalizeChannel(77, 200, 200)).toBe(77);
    expect(normalizeChannel(77, 200, 100)).toBe(77);
  });
});

describe('adjustChannel', () => {
  it('is the identity at neutral settings', () => {
    for (const channel of [0, 64, 128, 200, 255]) {
      expect(adjustChannel(channel, 0, 0)).toBeCloseTo(channel, 10);
    }
  });

  it('shifts every channel by the brightness amount and clamps at the ends', () => {
    expect(adjustChannel(100, 20, 0)).toBeCloseTo(151, 0);
    expect(adjustChannel(250, 100, 0)).toBe(255);
    expect(adjustChannel(10, -100, 0)).toBe(0);
  });

  it('pushes values away from mid-grey with positive contrast and towards it with negative', () => {
    expect(adjustChannel(200, 0, 50)).toBeGreaterThan(200);
    expect(adjustChannel(50, 0, 50)).toBeLessThan(50);
    expect(adjustChannel(200, 0, -100)).toBeCloseTo(128, 10);
    expect(adjustChannel(50, 0, -100)).toBeCloseTo(128, 10);
  });

  it('clamps a contrast setting outside the slider range instead of producing nonsense', () => {
    expect(adjustChannel(200, 0, 5000)).toBe(255);
    expect(adjustChannel(50, 0, -5000)).toBeCloseTo(128, 10);
  });
});

describe('imageToAsciiGrid', () => {
  it('maps black to the densest character and white to the lightest', () => {
    const result = imageToAsciiGrid(
      pixels([
        [0, 0, 0, 255],
        [255, 255, 255, 255],
      ]),
      2,
      1,
      OPTIONS
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.characters).toEqual(['@', ' ']);
  });

  it('flips the mapping when inverted, so the art reads on a dark background', () => {
    const result = imageToAsciiGrid(
      pixels([
        [0, 0, 0, 255],
        [255, 255, 255, 255],
      ]),
      2,
      1,
      { ...OPTIONS, invert: true }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.characters).toEqual([' ', '@']);
  });

  it('walks the ramp monotonically across a greyscale gradient', () => {
    const steps: [number, number, number, number][] = Array.from({ length: 10 }, (_, i) => [i * 28, i * 28, i * 28, 255]);
    const result = imageToAsciiGrid(pixels(steps), 10, 1, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ramp = toCharacterLevels(OPTIONS.characters);
    const indexes = result.value.characters.map((character) => ramp.indexOf(character));
    // Brighter pixels use progressively lighter characters, never jumping back darker.
    for (let i = 1; i < indexes.length; i += 1) expect(indexes[i]!).toBeLessThanOrEqual(indexes[i - 1]!);
    expect(indexes[0]).toBe(ramp.length - 1);
    expect(indexes.at(-1)).toBe(0);
  });

  it('composites transparency against the background each mode actually uses', () => {
    // A fully transparent pixel must read as empty in *both* modes — not as solid ink in one.
    const transparent = pixels([[0, 0, 0, 0]]);
    const light = imageToAsciiGrid(transparent, 1, 1, OPTIONS);
    const dark = imageToAsciiGrid(transparent, 1, 1, { ...OPTIONS, invert: true });
    expect(light.ok && light.value.characters).toEqual([' ']);
    expect(dark.ok && dark.value.characters).toEqual([' ']);
  });

  it('blends a half-transparent pixel towards the background rather than ignoring alpha', () => {
    const half = pixels([[0, 0, 0, 128]]);
    const result = imageToAsciiGrid(half, 1, 1, OPTIONS);
    expect(result.ok).toBe(true);
    // Half-transparent black over white is mid-grey, so a mid-ramp character, not '@'.
    if (result.ok) expect(result.value.characters[0]).toBe('+');
  });

  it('keeps the (adjusted) source colour for every cell, for the colour output mode', () => {
    const result = imageToAsciiGrid(pixels([[10, 120, 240, 255]]), 1, 1, OPTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.from(result.value.colors)).toEqual([10, 120, 240]);
  });

  it('applies brightness and contrast before choosing a character', () => {
    const grey = solid(1, 1, [128, 128, 128, 255]);
    const neutral = imageToAsciiGrid(grey, 1, 1, OPTIONS);
    const brightened = imageToAsciiGrid(grey, 1, 1, { ...OPTIONS, brightness: 60 });
    expect(neutral.ok && brightened.ok).toBe(true);
    if (!neutral.ok || !brightened.ok) return;
    const ramp = toCharacterLevels(OPTIONS.characters);
    expect(ramp.indexOf(brightened.value.characters[0]!)).toBeLessThan(ramp.indexOf(neutral.value.characters[0]!));
    expect(brightened.value.colors[0]).toBeGreaterThan(neutral.value.colors[0]!);
  });

  it('spreads a flat mid-tone image across the whole ramp when auto levels is on', () => {
    const band: [number, number, number, number][] = [];
    for (let level = 100; level <= 160; level += 4) band.push([level, level, level, 255]);

    const literal = imageToAsciiGrid(pixels(band), band.length, 1, OPTIONS);
    const stretched = imageToAsciiGrid(pixels(band), band.length, 1, { ...OPTIONS, autoLevels: true });
    expect(literal.ok && stretched.ok).toBe(true);
    if (!literal.ok || !stretched.ok) return;

    // Without the stretch this band lives in a couple of ramp steps; with it, most of the ramp.
    expect(new Set(literal.value.characters).size).toBeLessThan(4);
    expect(new Set(stretched.value.characters).size).toBeGreaterThan(6);
    expect(stretched.value.characters[0]).toBe('@');
    expect(stretched.value.characters.at(-1)).toBe(' ');
  });

  it('leaves an image that already spans black to white unchanged', () => {
    const spread: [number, number, number, number][] = [];
    for (let level = 0; level <= 255; level += 5) spread.push([level, level, level, 255]);

    const literal = imageToAsciiGrid(pixels(spread), spread.length, 1, OPTIONS);
    const stretched = imageToAsciiGrid(pixels(spread), spread.length, 1, { ...OPTIONS, autoLevels: true });
    expect(literal.ok && stretched.ok).toBe(true);
    if (!literal.ok || !stretched.ok) return;
    expect(stretched.value.characters).toEqual(literal.value.characters);
  });

  it('never lets the stretch bleed into a transparent area', () => {
    const logo: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [100, 100, 100, 255],
      [150, 150, 150, 255],
    ];
    const result = imageToAsciiGrid(pixels(logo), 3, 1, { ...OPTIONS, autoLevels: true });
    expect(result.ok).toBe(true);
    // The transparent cell still composites to the white background, so it stays blank.
    if (result.ok) expect(result.value.characters[0]).toBe(' ');
  });

  it('works with a two-character ramp, thresholding into ink or background', () => {
    const result = imageToAsciiGrid(
      pixels([
        [20, 20, 20, 255],
        [230, 230, 230, 255],
      ]),
      2,
      1,
      { ...OPTIONS, characters: ' @' }
    );
    expect(result.ok && result.value.characters).toEqual(['@', ' ']);
  });

  it('works with a ramp of astral-plane characters', () => {
    const result = imageToAsciiGrid(
      pixels([
        [0, 0, 0, 255],
        [255, 255, 255, 255],
      ]),
      2,
      1,
      { ...OPTIONS, characters: '🌕🌑' }
    );
    expect(result.ok && result.value.characters).toEqual(['🌑', '🌕']);
  });

  it('rejects a pixel buffer whose length does not match the stated size', () => {
    const result = imageToAsciiGrid(solid(2, 2, [0, 0, 0, 255]), 3, 3, OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expected 36 values for 3×3, got 16/);
  });

  it('rejects an empty image instead of returning an empty grid', () => {
    const result = imageToAsciiGrid(new Uint8ClampedArray(0), 0, 0, OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no usable pixels/i);
  });

  it('rejects a fractional size, which would silently mis-index the buffer', () => {
    expect(imageToAsciiGrid(solid(2, 2, [0, 0, 0, 255]), 2.5, 1.6, OPTIONS).ok).toBe(false);
  });

  it('surfaces a bad ramp as the ramp error, not a generic failure', () => {
    const result = imageToAsciiGrid(solid(1, 1, [0, 0, 0, 255]), 1, 1, { ...OPTIONS, characters: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least two characters/i);
  });

  it('rejects a grid over the cell budget before allocating it', () => {
    const columns = 220;
    const rows = Math.ceil(MAX_ASCII_CELLS / columns) + 1;
    // Deliberately does not allocate the real buffer: the size check must come first, but
    // the length check comes before it, so give it a matching (sparse) buffer length.
    const result = imageToAsciiGrid(new Uint8ClampedArray(columns * rows * 4), columns, rows, OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too tall and narrow/i);
  });

  it('handles a large image without producing a malformed grid', () => {
    const result = imageToAsciiGrid(solid(200, 400, [90, 90, 90, 255]), 200, 400, OPTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.characters).toHaveLength(80_000);
      expect(result.value.colors).toHaveLength(240_000);
      expect(new Set(result.value.characters).size).toBe(1);
    }
  });
});

describe('renderAsciiText', () => {
  it('emits one line per row', () => {
    const grid = imageToAsciiGrid(solid(3, 2, [0, 0, 0, 255]), 3, 2, OPTIONS);
    expect(grid.ok && renderAsciiText(grid.value)).toBe('@@@\n@@@');
  });

  it('trims trailing blank space, which is invisible but dominates the output size', () => {
    const row: [number, number, number, number][] = [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
    ];
    const grid = imageToAsciiGrid(pixels(row), 3, 1, OPTIONS);
    expect(grid.ok && renderAsciiText(grid.value)).toBe('@');
  });

  it('keeps interior spaces, which carry the shape', () => {
    const grid = imageToAsciiGrid(
      pixels([
        [0, 0, 0, 255],
        [255, 255, 255, 255],
        [0, 0, 0, 255],
      ]),
      3,
      1,
      OPTIONS
    );
    expect(grid.ok && renderAsciiText(grid.value)).toBe('@ @');
  });

  it('produces an all-empty line rather than a broken one for a blank row', () => {
    const grid = imageToAsciiGrid(solid(4, 1, [255, 255, 255, 255]), 4, 1, OPTIONS);
    expect(grid.ok && renderAsciiText(grid.value)).toBe('');
  });
});

describe('renderAsciiColorMarkup', () => {
  it('groups a run of same-coloured characters into a single span', () => {
    const grid = imageToAsciiGrid(solid(3, 1, [16, 32, 48, 255]), 3, 1, OPTIONS);
    expect(grid.ok && renderAsciiColorMarkup(grid.value)).toBe('<span style="color:#102030">%%%</span>');
  });

  it('starts a new span only when the colour actually changes', () => {
    const grid = imageToAsciiGrid(
      pixels([
        [0, 0, 0, 255],
        [0, 0, 0, 255],
        [255, 0, 0, 255],
      ]),
      3,
      1,
      OPTIONS
    );
    expect(grid.ok && renderAsciiColorMarkup(grid.value)).toBe(
      '<span style="color:#000000">@@</span><span style="color:#ff0000">#</span>'
    );
  });

  it('escapes ramp characters that are also HTML syntax', () => {
    const grid = imageToAsciiGrid(
      pixels([
        [0, 0, 0, 255],
        [255, 255, 255, 255],
      ]),
      2,
      1,
      { ...OPTIONS, characters: '&<>' }
    );
    expect(grid.ok && renderAsciiColorMarkup(grid.value)).toContain('&gt;');
    expect(grid.ok && renderAsciiColorMarkup(grid.value)).toContain('&amp;');
    expect(grid.ok && renderAsciiColorMarkup(grid.value)).not.toMatch(/>[<&]</);
  });

  it('separates rows with a newline so a <pre> lays them out correctly', () => {
    const grid = imageToAsciiGrid(solid(1, 2, [0, 0, 0, 255]), 1, 2, OPTIONS);
    expect(grid.ok && renderAsciiColorMarkup(grid.value).split('\n')).toHaveLength(2);
  });
});

describe('renderAsciiHtmlDocument', () => {
  it('produces a standalone document with the art inside a pre', () => {
    const grid = imageToAsciiGrid(solid(2, 1, [0, 0, 0, 255]), 2, 1, OPTIONS);
    expect(grid.ok).toBe(true);
    if (!grid.ok) return;
    const html = renderAsciiHtmlDocument(grid.value, { invert: false });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<pre><span style="color:#000000">@@</span></pre>');
  });

  it('pins the line-height the row count was computed against', () => {
    const grid = imageToAsciiGrid(solid(1, 1, [0, 0, 0, 255]), 1, 1, OPTIONS);
    expect(grid.ok && renderAsciiHtmlDocument(grid.value, { invert: false })).toContain('line-height: 1.2');
  });

  it('uses a background matching the chosen mode', () => {
    const grid = imageToAsciiGrid(solid(1, 1, [0, 0, 0, 255]), 1, 1, OPTIONS);
    expect(grid.ok).toBe(true);
    if (!grid.ok) return;
    expect(renderAsciiHtmlDocument(grid.value, { invert: true })).toContain('background: #000000');
    expect(renderAsciiHtmlDocument(grid.value, { invert: false })).toContain('background: #ffffff');
  });

  it('escapes a title taken from an uploaded file name', () => {
    const grid = imageToAsciiGrid(solid(1, 1, [0, 0, 0, 255]), 1, 1, OPTIONS);
    expect(grid.ok).toBe(true);
    if (!grid.ok) return;
    const html = renderAsciiHtmlDocument(grid.value, { invert: false, title: '<script>x</script>.png' });
    expect(html).toContain('<title>&lt;script&gt;x&lt;/script&gt;.png</title>');
    expect(html).not.toContain('<script>');
  });
});
