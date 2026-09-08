import { type ToolResult, ok, err } from './result';

/**
 * A character ramp: the ordered set of characters an image's tones are mapped onto.
 *
 * Ordered **lightest first, darkest last** throughout this module — so `characters[0]` is
 * whatever should stand in for "nothing here" (usually a space) and the final character is
 * the densest ink. That direction is a deliberate single convention: the classic published
 * ramps are written darkest-first, and mixing the two orders is exactly the kind of thing
 * that silently produces a photographic negative.
 */
export interface CharacterRamp {
  id: string;
  label: string;
  /** Lightest → darkest. May contain non-ASCII characters (see the `blocks` ramp). */
  characters: string;
  /** One-line explanation, shown as the preset button's tooltip. */
  description: string;
}

/**
 * Paul Bourke's 70-level ramp, the most widely cited "long" ASCII ramp, reversed here to
 * this module's lightest-first convention (it is published darkest-first, starting `$@B%8&WM#*`
 * and ending in a space).
 */
const DETAILED_RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

export const CHARACTER_RAMPS: readonly CharacterRamp[] = [
  {
    id: 'blocks',
    label: 'Blocks',
    characters: ' ░▒▓█',
    description: 'Unicode shading blocks — solid, poster-like output instead of sparse punctuation. Not plain ASCII.',
  },
  {
    id: 'standard',
    label: 'Standard',
    characters: ' .:-=+*#%@',
    description: 'The classic ten-step ASCII ramp — plain ASCII, so it pastes anywhere, including places that mangle Unicode.',
  },
  {
    id: 'detailed',
    label: 'Detailed',
    characters: DETAILED_RAMP,
    description: 'Seventy tonal steps — the most detail, and the most rewarding on a wide output and a photo with smooth gradients.',
  },
  {
    id: 'silhouette',
    label: 'Silhouette',
    characters: ' @',
    description: 'Two steps only — every pixel becomes either ink or background, like a stencil.',
  },
];

/** Sentinel id for "the visitor typed their own ramp", which is not in `CHARACTER_RAMPS`. */
export const CUSTOM_RAMP_ID = 'custom';

/**
 * Blocks, not one of the punctuation ramps.
 *
 * The shading blocks are solid rather than sparse, so a first result reads as a picture at a
 * glance instead of as a field of speckled punctuation — worth more as a default than plain
 * ASCII is, since anywhere the art actually gets pasted these days (a terminal, an editor, a
 * README) handles Unicode fine. "Standard" is one click away for the cases that don't.
 */
export const DEFAULT_RAMP_ID = 'blocks';

export const MIN_COLUMNS = 20;
export const MAX_COLUMNS = 220;
export const DEFAULT_COLUMNS = 100;

/**
 * A monospace character's width divided by its height, used to stop the output looking
 * vertically stretched: a text cell is roughly twice as tall as it is wide, so an image
 * mapped one character per pixel would come out at half its true height.
 *
 * 0.5 is the ratio of a typical monospace advance width (~0.6em) to the 1.2 line-height
 * this module's own renderers set — `renderAsciiHtmlDocument` and the island's preview both
 * pin `line-height: 1.2` precisely so the proportions assumed here hold in what is seen.
 */
export const CHARACTER_ASPECT_RATIO = 0.5;

/**
 * Ceiling on total character cells, so a pathologically tall, narrow image (which produces
 * an enormous row count for even a modest column count) can't lock up the tab or produce a
 * megabytes-long string. 200,000 cells covers the full 220-column width at ~900 rows —
 * far beyond any output a person would actually read or paste.
 */
export const MAX_ASCII_CELLS = 200_000;

/**
 * Fraction of pixels ignored at each end of the histogram when working out an image's
 * usable tonal range. Without it a single blown-out highlight or one black pixel would
 * define the whole range and the stretch would do nothing — the same reason an image
 * editor's "auto levels" clips a little off each end rather than using the true extremes.
 */
export const AUTO_LEVELS_CLIP = 0.005;

/** Below this alpha a pixel is treated as absent and left out of the histogram entirely — a
 *  mostly-transparent logo's background must not get a vote on what "white" means here. */
const OPAQUE_ENOUGH = 8;

/** An image whose tones already sit within this narrow a band is left alone: stretching it
 *  would amplify sensor noise or JPEG blocking into the full ramp and produce static. */
const MIN_LEVEL_SPAN = 8;

/** The identity range — "use the tones exactly as they are". */
const FULL_RANGE = { min: 0, max: 255 } as const;

export interface AsciiOptions {
  /** The ramp itself, lightest → darkest. Passed as the resolved string, not a ramp id, so this layer never has to know about presets. */
  characters: string;
  /** `true` renders light characters on a dark background (a terminal); `false` dark ink on white (a printed page). */
  invert: boolean;
  /** Stretches the image's actual tonal range across the whole ramp before mapping. See `computeLevelRange`. */
  autoLevels: boolean;
  /** -100 to 100. Applied before contrast. */
  brightness: number;
  /** -100 to 100. */
  contrast: number;
}

/**
 * A rendered grid of characters plus the source colour behind each one.
 *
 * Characters are stored as a flat array of whole characters rather than one string per row
 * so that a ramp containing an astral-plane character (an emoji, say — nothing stops a
 * visitor typing one into the custom ramp field) still indexes 1:1 against `colors`, which
 * per-row string indexing by UTF-16 code unit would not.
 */
export interface AsciiGrid {
  columns: number;
  rows: number;
  /** One whole character per cell, row-major. Length is always `columns * rows`. */
  characters: string[];
  /** RGB triples, row-major, aligned 1:1 with `characters`. Post-adjustment, with alpha already composited against the background. */
  colors: Uint8ClampedArray;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Splits a ramp into whole characters, so multi-code-unit characters survive intact. */
export const toCharacterLevels = (characters: string): string[] => Array.from(characters);

export const rampById = (id: string): CharacterRamp | undefined => CHARACTER_RAMPS.find((ramp) => ramp.id === id);

/**
 * Checks a ramp before any pixel work. A single character can't encode light *and* dark —
 * every cell would come out identical — so that is rejected with an explanation rather than
 * silently producing a rectangle of one repeated character.
 */
export function validateCharacters(characters: string): ToolResult<string[]> {
  const levels = toCharacterLevels(characters);
  if (levels.length === 0) {
    return err('The character set is empty — enter at least two characters, ordered from lightest to darkest.');
  }
  if (levels.length === 1) {
    return err(
      'A single character can’t represent both light and dark areas — enter at least two, ordered from lightest (usually a space) to darkest.'
    );
  }
  return ok(levels);
}

/**
 * The character-grid size an image maps onto at a given output width, corrected for the
 * fact that a text cell is taller than it is wide (see `CHARACTER_ASPECT_RATIO`).
 *
 * Returns at least 1 row so a very wide, very short image (a banner, a progress-bar
 * screenshot) still produces something rather than an empty grid.
 */
export function computeAsciiDimensions(width: number, height: number, columns: number): { columns: number; rows: number } {
  const safeColumns = clamp(Math.round(columns), MIN_COLUMNS, MAX_COLUMNS);
  if (width <= 0 || height <= 0) return { columns: safeColumns, rows: 1 };
  const rows = Math.max(1, Math.round((height / width) * safeColumns * CHARACTER_ASPECT_RATIO));
  return { columns: safeColumns, rows };
}

/** Rejects a grid that would be too large to build or to read — see `MAX_ASCII_CELLS`. */
export function validateAsciiDimensions(columns: number, rows: number): ToolResult<true> {
  if (columns * rows > MAX_ASCII_CELLS) {
    return err(
      `That image is too tall and narrow for a ${columns}-character width — it would produce ${rows.toLocaleString()} rows ` +
        `(${(columns * rows).toLocaleString()} characters, over this tool’s ${MAX_ASCII_CELLS.toLocaleString()} limit). ` +
        'Reduce the width, or crop the image to a less extreme shape first.'
    );
  }
  return ok(true);
}

/**
 * Rec. 709 relative luminance of a gamma-encoded 0-255 RGB triple, returned in 0-1.
 *
 * Computed on the gamma-encoded values directly rather than linearizing first: this is the
 * approximation every ASCII-art converter uses, and it is the right one here — the
 * *perceived* lightness of the resulting characters is what matters, not a physically
 * correct light measurement, and linearized luminance visibly crushes midtones into the
 * dark end of the ramp.
 */
export const relativeLuminance = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * The standard brightness-then-contrast adjustment on a single 0-255 channel.
 *
 * `contrast` is remapped from this tool's -100..100 slider onto the -255..255 range the
 * classic contrast factor `(259(c + 255)) / (255(259 - c))` expects, so +100 is a hard
 * threshold and -100 flattens everything to mid-grey.
 */
/**
 * The tonal range an image actually occupies, as a clipped-percentile 0-255 luminance
 * window — the input to the "Auto levels" stretch.
 *
 * This matters more here than in an ordinary image editor. A ramp has roughly ten to
 * seventy steps, so a photograph whose tones all sit between (say) 60 and 190 spends its
 * entire life in the middle third of the ramp and comes out as undifferentiated mush.
 * Stretching that window across the full ramp first is the single biggest difference
 * between "a picture made of characters" and "a rectangle of noise".
 *
 * Built from a 256-bin histogram rather than by sorting the luminances, so it stays a
 * single linear pass with a fixed allocation even at `MAX_ASCII_CELLS`.
 */
export function computeLevelRange(pixels: Uint8ClampedArray, width: number, height: number): { min: number; max: number } {
  const histogram = new Uint32Array(256);
  let counted = 0;

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    if (pixels[offset + 3]! < OPAQUE_ENOUGH) continue;
    histogram[Math.round(relativeLuminance(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) * 255)]! += 1;
    counted += 1;
  }

  if (counted === 0) return { ...FULL_RANGE };

  const clip = Math.floor(counted * AUTO_LEVELS_CLIP);

  let min = 0;
  for (let seen = 0; min < 255; min += 1) {
    seen += histogram[min]!;
    if (seen > clip) break;
  }

  let max = 255;
  for (let seen = 0; max > 0; max -= 1) {
    seen += histogram[max]!;
    if (seen > clip) break;
  }

  if (max - min < MIN_LEVEL_SPAN) return { ...FULL_RANGE };
  return { min, max };
}

/** Rescales a 0-255 channel so `min` becomes 0 and `max` becomes 255 — the levels stretch
 *  itself, applied identically to R, G and B so a colour image keeps its hues. */
export function normalizeChannel(channel: number, min: number, max: number): number {
  if (max <= min) return channel;
  return clamp(((channel - min) * 255) / (max - min), 0, 255);
}

export function adjustChannel(channel: number, brightness: number, contrast: number): number {
  const contrastRange = (clamp(contrast, -100, 100) / 100) * 255;
  const factor = (259 * (contrastRange + 255)) / (255 * (259 - contrastRange));
  const brightened = channel + (clamp(brightness, -100, 100) / 100) * 255;
  return clamp(factor * (brightened - 128) + 128, 0, 255);
}

/**
 * Maps an already-downscaled RGBA buffer onto a character grid — the whole point of the
 * tool, and deliberately the only part of it that is pure.
 *
 * The caller is responsible for resizing the source image down to `width` × `height` first
 * (the island does that with a canvas, which is inherently DOM-bound), so this function
 * works on exactly one pixel per output character and never has to resample.
 *
 * Alpha is composited against the background the chosen mode will actually be displayed on
 * — white when `invert` is false, black when it is true — rather than ignored or treated as
 * white unconditionally. That is what makes a transparent-background PNG logo come out as a
 * clean silhouette in *both* modes instead of a solid block of ink in one of them.
 */
export function imageToAsciiGrid(pixels: Uint8ClampedArray, width: number, height: number, options: AsciiOptions): ToolResult<AsciiGrid> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return err('The image has no usable pixels — its width and height must both be at least 1.');
  }
  if (pixels.length !== width * height * 4) {
    return err(`Pixel data doesn’t match the given size: expected ${width * height * 4} values for ${width}×${height}, got ${pixels.length}.`);
  }

  const validated = validateCharacters(options.characters);
  if (!validated.ok) return err(validated.error);
  const levels = validated.value;
  const lastLevel = levels.length - 1;

  const dimensionCheck = validateAsciiDimensions(width, height);
  if (!dimensionCheck.ok) return err(dimensionCheck.error);

  const background = options.invert ? 0 : 255;
  const characters: string[] = new Array<string>(width * height);
  const colors = new Uint8ClampedArray(width * height * 3);

  // Measured on the source pixels, before compositing: a transparent area is excluded from
  // the histogram outright, so the background it would be composited onto is irrelevant.
  const range = options.autoLevels ? computeLevelRange(pixels, width, height) : FULL_RANGE;

  const prepare = (channel: number, alpha: number): number =>
    adjustChannel(normalizeChannel(channel, range.min, range.max) * alpha + background * (1 - alpha), options.brightness, options.contrast);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const alpha = pixels[offset + 3]! / 255;

    const r = prepare(pixels[offset]!, alpha);
    const g = prepare(pixels[offset + 1]!, alpha);
    const b = prepare(pixels[offset + 2]!, alpha);

    const luminance = relativeLuminance(r, g, b);
    // In normal mode the ink is dark, so a dark pixel needs the *densest* character: the
    // ramp index tracks how much ink a cell wants, which is the inverse of its luminance.
    // Inverted, the characters themselves are the light part, so the mapping flips.
    const inkLevel = options.invert ? luminance : 1 - luminance;

    characters[index] = levels[clamp(Math.round(inkLevel * lastLevel), 0, lastLevel)]!;
    colors[index * 3] = r;
    colors[index * 3 + 1] = g;
    colors[index * 3 + 2] = b;
  }

  return ok({ columns: width, rows: height, characters, colors });
}

/**
 * The grid as plain text, one line per row.
 *
 * Trailing whitespace is trimmed from every line: it is invisible either way, and on a
 * mostly-empty image it is the majority of the output's size — a real difference when the
 * result is being pasted into a code comment, a commit message or a README.
 */
export function renderAsciiText(grid: AsciiGrid): string {
  const lines: string[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    const start = row * grid.columns;
    lines.push(grid.characters.slice(start, start + grid.columns).join('').replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const toHex = (r: number, g: number, b: number): string => `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;

/**
 * The grid as HTML for the *inside* of a `<pre>`: each run of same-coloured characters
 * wrapped in one `<span style="color:…">`.
 *
 * Runs are grouped rather than emitting one span per character because a span-per-character
 * document for a 100×50 grid is 5,000 spans and several hundred kilobytes; grouping cuts
 * that substantially on any real photograph, where neighbouring cells constantly share a
 * colour.
 *
 * Every character is HTML-escaped — the ramp is visitor-supplied text (the custom ramp
 * field), so `<`, `>` and `&` genuinely can appear here.
 */
export function renderAsciiColorMarkup(grid: AsciiGrid): string {
  const lines: string[] = [];

  for (let row = 0; row < grid.rows; row += 1) {
    let line = '';
    let run = '';
    let runColor = '';

    const flush = () => {
      if (run === '') return;
      line += `<span style="color:${runColor}">${escapeHtml(run)}</span>`;
      run = '';
    };

    for (let column = 0; column < grid.columns; column += 1) {
      const index = row * grid.columns + column;
      const color = toHex(grid.colors[index * 3]!, grid.colors[index * 3 + 1]!, grid.colors[index * 3 + 2]!);
      if (color !== runColor) {
        flush();
        runColor = color;
      }
      run += grid.characters[index]!;
    }
    flush();
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * A standalone, self-contained HTML document of the coloured art — the download counterpart
 * to `renderAsciiColorMarkup`.
 *
 * `line-height: 1.2` against a monospace face is not decoration: it is the same ratio
 * `CHARACTER_ASPECT_RATIO` assumed when the row count was computed, so the saved file keeps
 * the image's true proportions instead of a squashed or stretched version of them.
 */
export function renderAsciiHtmlDocument(grid: AsciiGrid, options: { invert: boolean; title?: string }): string {
  const background = options.invert ? '#000000' : '#ffffff';
  const title = escapeHtml(options.title ?? 'ASCII art');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  html, body { background: ${background}; }
  body { margin: 0; padding: 1rem; }
  pre {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 8px;
    line-height: 1.2;
    white-space: pre;
    letter-spacing: 0;
  }
</style>
</head>
<body>
<pre>${renderAsciiColorMarkup(grid)}</pre>
</body>
</html>
`;
}
