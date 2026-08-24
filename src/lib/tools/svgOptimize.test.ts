import { describe, it, expect } from 'vitest';
import { optimizeSvg, MAX_SVG_INPUT_LENGTH } from './svgOptimize';

const SVG_WITH_CRUFT = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"
     x="0px" y="0px" viewBox="0 0 100 100" xml:space="preserve">
  <!-- a circle -->
  <g id="Layer_1">
    <circle cx="50.000000" cy="50.000000" r="40.123456789" fill="#ff0000" />
  </g>
</svg>
`;

describe('optimizeSvg', () => {
  it('shrinks real-world exporter cruft into compact markup', async () => {
    const result = await optimizeSvg(SVG_WITH_CRUFT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeLessThan(SVG_WITH_CRUFT.length);
    expect(result.value).not.toContain('Generator: Adobe Illustrator');
    expect(result.value).not.toContain('<!--');
  });

  it('keeps the viewBox so the optimized SVG can still scale responsively', async () => {
    const result = await optimizeSvg(SVG_WITH_CRUFT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('viewBox');
  });

  it('produces markup that still contains a valid <svg> root', async () => {
    const result = await optimizeSvg('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatch(/<svg[\s>]/);
  });

  it('errors on empty input', async () => {
    const result = await optimizeSvg('   ');
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/paste or drop/i) });
  });

  it('errors when the input has no <svg> root element', async () => {
    const result = await optimizeSvg('<div>not svg</div>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't look like svg/i);
  });

  it('errors on malformed XML with a friendly message, not a raw stack trace', async () => {
    const result = await optimizeSvg('<svg viewBox="0 0 10 10"><rect width="10"></svg>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.error).toBe('string');
  });

  it('errors when input exceeds the length cap', async () => {
    const huge = `<svg viewBox="0 0 1 1">${'<!-- x -->'.repeat(MAX_SVG_INPUT_LENGTH)}</svg>`;
    const result = await optimizeSvg(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });

  it('rounds numbers to fewer decimal places at a lower precision', async () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5.123456" cy="5.123456" r="4.987654"/></svg>';
    const low = await optimizeSvg(svg, { precision: 1 });
    const high = await optimizeSvg(svg, { precision: 8 });
    expect(low.ok && high.ok).toBe(true);
    if (!low.ok || !high.ok) return;
    expect(low.value.length).toBeLessThanOrEqual(high.value.length);
    expect(low.value).toContain('5.1');
    expect(high.value).toContain('5.123456');
  });

  it('rounds transform-matrix decomposition to fewer decimal places at a lower transformPrecision', async () => {
    // A <use> keeps its own transform attribute rather than having it baked into path
    // coordinates (unlike a shape SVGO can convert straight to a <path>), so this is a
    // case where transformPrecision's rounding is actually visible in the output.
    const svg =
      '<svg viewBox="0 0 10 10"><defs><rect id="r" width="2" height="2"/></defs><use href="#r" transform="matrix(0.83907153,0.54401671,-0.54401671,0.83907153,1.23456789,2.3456789)"/></svg>';
    const low = await optimizeSvg(svg, { transformPrecision: 1 });
    const high = await optimizeSvg(svg, { transformPrecision: 8 });
    expect(low.ok && high.ok).toBe(true);
    if (!low.ok || !high.ok) return;
    expect(low.value).not.toBe(high.value);
    expect(high.value.length).toBeGreaterThan(low.value.length);
  });

  it('keeps optimizing over multiple passes by default, fully collapsing nested useless groups', async () => {
    const svg = '<svg viewBox="0 0 10 10"><g><g><g><rect width="10" height="10"/></g></g></g></svg>';
    const result = await optimizeSvg(svg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toContain('<g>');
  });

  it('runs only a single pass when multipass is disabled', async () => {
    const svg = '<svg viewBox="0 0 10 10"><g><g><g><rect width="10" height="10"/></g></g></g></svg>';
    const singlePass = await optimizeSvg(svg, { multipass: false });
    const multiPass = await optimizeSvg(svg, { multipass: true });
    expect(singlePass.ok && multiPass.ok).toBe(true);
    if (!singlePass.ok || !multiPass.ok) return;
    expect(singlePass.value.length).toBeGreaterThanOrEqual(multiPass.value.length);
  });

  it('strips an empty, editor-boilerplate <desc> by default, matching SVGO defaults', async () => {
    const svg = '<svg viewBox="0 0 10 10"><desc></desc><rect width="10" height="10"/></svg>';
    const result = await optimizeSvg(svg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toContain('<desc');
  });

  it('keeps real <desc> content when keepDescription is set even where the default would still remove it', async () => {
    const svg = '<svg viewBox="0 0 10 10"><desc></desc><rect width="10" height="10"/></svg>';
    const withDefault = await optimizeSvg(svg);
    const kept = await optimizeSvg(svg, { keepDescription: true });
    expect(withDefault.ok && kept.ok).toBe(true);
    if (!withDefault.ok || !kept.ok) return;
    expect(withDefault.value).not.toContain('<desc');
    // An empty <desc> is retained as an empty element once removeDesc itself is disabled —
    // proving the override reached the plugin, since the default pass above strips it.
    expect(kept.value).toContain('<desc');
  });

  const GRADIENT_SVG =
    '<svg viewBox="0 0 10 10"><defs><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#grad)"/></svg>';

  it('keeps a referenced id and its url() reference in sync (default preset minifies both together)', async () => {
    const result = await optimizeSvg(GRADIENT_SVG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = /id="([^"]+)"/.exec(result.value)?.[1];
    expect(id).toBeTruthy();
    expect(result.value).toContain(`url(#${id})`);
  });

  it('adds a shared prefix to referenced ids when prefixIds is set, avoiding collisions between multiple optimized SVGs on one page', async () => {
    const withoutPrefix = await optimizeSvg(GRADIENT_SVG);
    const withPrefix = await optimizeSvg(GRADIENT_SVG, { prefixIds: true });
    expect(withoutPrefix.ok && withPrefix.ok).toBe(true);
    if (!withoutPrefix.ok || !withPrefix.ok) return;

    const idWithoutPrefix = /id="([^"]+)"/.exec(withoutPrefix.value)?.[1];
    const idWithPrefix = /id="([^"]+)"/.exec(withPrefix.value)?.[1];
    expect(idWithPrefix).not.toBe(idWithoutPrefix);
    // The reference stays in sync with the renamed id — this is why prefixIds is safe to
    // apply even to gradients/patterns other elements point at, unlike a naive find/replace.
    expect(withPrefix.value).toContain(`url(#${idWithPrefix})`);
  });
});
