import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ORGANIZE_SETTINGS,
  MAX_HISTORY,
  backgroundImageFormat,
  canMoveSelection,
  cleanStampText,
  collateDuplex,
  describeChanges,
  displaySize,
  displayToUserMatrix,
  duplicatePages,
  fitImage,
  formatPageNumber,
  initialPages,
  insertBlankPage,
  insertFilePages,
  isPristine,
  moveSelection,
  movePage,
  outputNameFor,
  pageNumberLabels,
  parseHexColor,
  planBackground,
  planHeaderFooter,
  planOrganize,
  planPageNumbers,
  planWatermark,
  pushHistory,
  redoHistory,
  removePages,
  reversePages,
  rotatePages,
  selectionRun,
  stampOrigin,
  startHistory,
  toUserSpace,
  undoHistory,
  unsupportedCharacter,
  watermarkLayout,
  type OrganizePage,
  type OrganizeSettings,
} from './pdfOrganize';

/** The source page numbers (1-based, "B" for blank) of a list, for readable expectations. */
const order = (pages: readonly OrganizePage[]) => pages.map((page) => (page.source ? (page.source.file === 0 ? page.source.page + 1 : `${page.source.file}:${page.source.page + 1}`) : 'B'));
const ids = (...values: number[]) => new Set(values);

describe('page list edits', () => {
  it('starts as the document, page for page', () => {
    const pages = initialPages(3);
    expect(order(pages)).toEqual([1, 2, 3]);
    expect(isPristine(pages, 3)).toBe(true);
    expect(initialPages(0)).toEqual([]);
  });

  it('rotates selected pages either way, wrapping at 360°', () => {
    const pages = rotatePages(initialPages(2), ids(1), -90);
    expect(pages.map((page) => page.rotation)).toEqual([270, 0]);
    expect(rotatePages(pages, ids(1), 90)[0]?.rotation).toBe(0);
    expect(rotatePages(rotatePages(initialPages(1), ids(1), 180), ids(1), 180)[0]?.rotation).toBe(0);
    expect(isPristine(pages, 2)).toBe(false);
  });

  it('removes and duplicates pages, giving copies fresh ids', () => {
    const pages = initialPages(3);
    expect(order(removePages(pages, ids(2)))).toEqual([1, 3]);
    const duplicated = duplicatePages(pages, ids(1, 3));
    expect(order(duplicated)).toEqual([1, 1, 2, 3, 3]);
    expect(new Set(duplicated.map((page) => page.id)).size).toBe(5);
  });

  it('inserts a blank page after the selection, or at the end', () => {
    const pages = initialPages(3);
    expect(order(insertBlankPage(pages, ids(1)).pages)).toEqual([1, 'B', 2, 3]);
    expect(order(insertBlankPage(pages, ids(1, 2)).pages)).toEqual([1, 2, 'B', 3]);
    const atEnd = insertBlankPage(pages, ids());
    expect(order(atEnd.pages)).toEqual([1, 2, 3, 'B']);
    expect(atEnd.pages.at(-1)?.id).toBe(atEnd.id);
    expect(order(insertBlankPage([], ids()).pages)).toEqual(['B']);
  });

  it('inserts another file’s pages after the selection', () => {
    const { pages, ids: added } = insertFilePages(initialPages(2), ids(1), 1, 2);
    expect(order(pages)).toEqual([1, '1:1', '1:2', 2]);
    expect(added).toHaveLength(2);
    expect(describeChanges(pages, 2)).toBe('2 pages inserted from other PDFs');
  });

  it('moves a selection one place, gathering scattered pages, and knows when it can’t', () => {
    const pages = initialPages(5);
    expect(order(moveSelection(pages, ids(2, 4), -1))).toEqual([2, 1, 4, 3, 5]);
    expect(order(moveSelection(pages, ids(1, 3), -1))).toEqual([1, 3, 2, 4, 5]);
    expect(order(moveSelection(pages, ids(4, 5), 1))).toEqual([1, 2, 3, 4, 5]);
    expect(order(moveSelection(pages, ids(1), 1))).toEqual([2, 1, 3, 4, 5]);
    expect(canMoveSelection(pages, ids(1), -1)).toBe(false);
    expect(canMoveSelection(pages, ids(1), 1)).toBe(true);
    expect(canMoveSelection(pages, ids(), 1)).toBe(false);
  });

  it('moves one page by drag, and ignores an unknown id', () => {
    expect(order(movePage(initialPages(3), 1, 2))).toEqual([2, 3, 1]);
    expect(order(movePage(initialPages(3), 99, 0))).toEqual([1, 2, 3]);
  });

  it('reverses the document', () => {
    expect(order(reversePages(initialPages(3)))).toEqual([3, 2, 1]);
  });

  it('collates a one-sided scan of double-sided pages', () => {
    // Fronts 1–3 scanned in order, then backs from the last sheet (6) to the first (4).
    expect(order(collateDuplex(initialPages(6)))).toEqual([1, 6, 2, 5, 3, 4]);
    // An odd count: the extra page is a front with no back.
    expect(order(collateDuplex(initialPages(5)))).toEqual([1, 5, 2, 4, 3]);
    expect(order(collateDuplex(initialPages(4), false))).toEqual([1, 3, 2, 4]);
    expect(collateDuplex([])).toEqual([]);
  });

  it('selects a run between two pages, in either direction', () => {
    const pages = initialPages(5);
    expect(selectionRun(pages, 2, 4)).toEqual([2, 3, 4]);
    expect(selectionRun(pages, 4, 2)).toEqual([2, 3, 4]);
    expect(selectionRun(pages, null, 3)).toEqual([3]);
    expect(selectionRun(pages, 99, 3)).toEqual([3]);
    expect(selectionRun(pages, 1, 99)).toEqual([]);
  });

  it('describes what changed', () => {
    const pages = initialPages(4);
    expect(describeChanges(pages, 4)).toBe('No changes to the pages yet');
    const edited = insertBlankPage(duplicatePages(rotatePages(removePages(reversePages(pages), ids(2)), ids(1), 90), ids(3)), ids()).pages;
    expect(describeChanges(edited, 4)).toBe('reordered · 1 page rotated · 1 page removed · 1 copy added · 1 blank page added');
  });

  it('handles a very large document', () => {
    const pages = initialPages(10_000);
    const moved = moveSelection(pages, ids(10_000), -1);
    expect(order(moved).slice(-2)).toEqual([10_000, 9_999]);
    expect(order(collateDuplex(pages)).slice(0, 4)).toEqual([1, 10_000, 2, 9_999]);
  });
});

describe('history', () => {
  it('undoes and redoes, and a new edit clears the redo stack', () => {
    let history = startHistory('a');
    history = pushHistory(history, 'b');
    history = pushHistory(history, 'c');
    history = undoHistory(history);
    expect(history.present).toBe('b');
    history = redoHistory(history);
    expect(history.present).toBe('c');
    history = pushHistory(undoHistory(history), 'd');
    expect(history.present).toBe('d');
    expect(history.future).toEqual([]);
  });

  it('ignores undo/redo with nothing to do, and a no-op push', () => {
    const history = startHistory(1);
    expect(undoHistory(history)).toBe(history);
    expect(redoHistory(history)).toBe(history);
    expect(pushHistory(history, 1)).toBe(history);
  });

  it('keeps at most MAX_HISTORY steps', () => {
    let history = startHistory(0);
    for (let i = 1; i <= MAX_HISTORY + 50; i++) history = pushHistory(history, i);
    expect(history.past).toHaveLength(MAX_HISTORY);
  });
});

describe('page geometry', () => {
  const box = { x: 10, y: 20, width: 300, height: 400 };

  it('swaps width and height for quarter turns', () => {
    expect(displaySize(box, 0)).toEqual({ width: 300, height: 400 });
    expect(displaySize(box, 90)).toEqual({ width: 400, height: 300 });
    expect(displaySize(box, 270)).toEqual({ width: 400, height: 300 });
    expect(displaySize(box, -90)).toEqual({ width: 400, height: 300 });
    expect(displaySize(box, 450)).toEqual({ width: 400, height: 300 });
  });

  it('maps the displayed bottom-left corner to the right user-space corner', () => {
    // As displayed, (0, 0) is bottom-left. Rotated 90° clockwise, that's user space's bottom-right.
    expect(toUserSpace(box, 0, 0, 0)).toEqual({ x: 10, y: 20, angle: 0 });
    expect(toUserSpace(box, 90, 0, 0)).toEqual({ x: 310, y: 20, angle: 90 });
    expect(toUserSpace(box, 180, 0, 0)).toEqual({ x: 310, y: 420, angle: 180 });
    expect(toUserSpace(box, 270, 0, 0)).toEqual({ x: 10, y: 420, angle: 270 });
  });

  it('maps the displayed top-right corner too, for every rotation', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const shown = displaySize(box, rotation);
      const corner = toUserSpace(box, rotation, shown.width, shown.height);
      const opposite = toUserSpace(box, rotation, 0, 0);
      // Opposite corners of the crop box, whatever the rotation.
      expect(Math.abs(corner.x - opposite.x)).toBe(300);
      expect(Math.abs(corner.y - opposite.y)).toBe(400);
    }
    expect(displayToUserMatrix(box, 0)).toEqual([1, 0, 0, 1, 10, 20]);
  });

  it('places edge text inside the margins', () => {
    const page = { width: 600, height: 800 };
    expect(stampOrigin('bottom-left', page, 50, 10)).toEqual({ dx: 28, dy: 28 });
    expect(stampOrigin('bottom-right', page, 50, 10)).toEqual({ dx: 522, dy: 28 });
    expect(stampOrigin('top-center', page, 50, 10)).toEqual({ dx: 275, dy: 800 - 28 - 7.2 });
  });

  it('centres the watermark, fitting it to the page', () => {
    const page = { width: 600, height: 800 };
    const flat = watermarkLayout({ layout: 'horizontal', span: 0.5 }, page, 5);
    expect(flat.angle).toBe(0);
    expect(flat.size).toBe(60);
    expect(flat.dx + (5 * flat.size) / 2).toBeCloseTo(300);
    const diagonal = watermarkLayout({ layout: 'diagonal', span: 0.6 }, page, 5);
    expect(diagonal.angle).toBeCloseTo(53.13, 1);
    // One short word never becomes taller than a third of the short side.
    expect(watermarkLayout({ layout: 'horizontal', span: 0.8 }, page, 0.5).size).toBe(200);
  });

  it('fits a background image', () => {
    const page = { width: 600, height: 800 };
    expect(fitImage('stretch', page, { width: 10, height: 10 })).toEqual({ x: 0, y: 0, width: 600, height: 800 });
    expect(fitImage('contain', page, { width: 100, height: 100 })).toEqual({ x: 0, y: 100, width: 600, height: 600 });
    expect(fitImage('cover', page, { width: 100, height: 100 })).toEqual({ x: -100, y: 0, width: 800, height: 800 });
    expect(fitImage('cover', page, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 600, height: 800 });
  });
});

describe('page numbers', () => {
  const settings = { ...DEFAULT_ORGANIZE_SETTINGS.numbers, enabled: true };

  it('formats numbers', () => {
    expect(formatPageNumber('n', 3, 12)).toBe('3');
    expect(formatPageNumber('page-n', 3, 12)).toBe('Page 3');
    expect(formatPageNumber('n-of-total', 3, 12)).toBe('3 / 12');
    expect(formatPageNumber('page-n-of-total', 3, 12)).toBe('Page 3 of 12');
  });

  it('labels from a chosen page and number, counting but not labelling blanks', () => {
    const plan = planPageNumbers({ ...settings, format: 'n-of-total', fromPage: '2', start: '5' }, 4);
    if (!plan.ok || !plan.value) throw new Error('expected a plan');
    expect(pageNumberLabels(plan.value, [false, false, true, false])).toEqual([null, '5 / 7', null, '7 / 7']);
    expect(pageNumberLabels({ ...plan.value, skipBlank: false }, [false, false, true, false])).toEqual([null, '5 / 7', '6 / 7', '7 / 7']);
  });

  it('is off unless enabled, and explains bad numbers', () => {
    expect(planPageNumbers(DEFAULT_ORGANIZE_SETTINGS.numbers, 3)).toEqual({ ok: true, value: null });
    expect(planPageNumbers({ ...settings, start: 'one' }, 3)).toMatchObject({ ok: false, error: expect.stringMatching(/Start at/) });
    expect(planPageNumbers({ ...settings, start: '' }, 3)).toMatchObject({ ok: false });
    expect(planPageNumbers({ ...settings, fromPage: '0' }, 3)).toMatchObject({ ok: false, error: expect.stringMatching(/Number from page/) });
    expect(planPageNumbers({ ...settings, fromPage: '4' }, 3)).toMatchObject({ ok: false, error: expect.stringMatching(/has 3 pages/) });
    expect(planPageNumbers({ ...settings, start: ' 0 ' }, 3)).toMatchObject({ ok: true });
  });
});

describe('text stamps', () => {
  it('accepts Windows-1252 text and names the first character it can’t draw', () => {
    expect(unsupportedCharacter('Café – “Draft” €5 ©')).toBeNull();
    expect(unsupportedCharacter('Größe Ærø')).toBeNull();
    expect(unsupportedCharacter('Draft 草稿')).toBe('草');
    expect(unsupportedCharacter('ok 👍')).toBe('👍');
    expect(unsupportedCharacter('tab\there')).toBe('\t');
    expect(unsupportedCharacter('soft­hyphen')).toBe('­');
  });

  it('collapses whitespace, including non-breaking spaces and new lines', () => {
    expect(cleanStampText('  Acme  Corp\n\tLtd ')).toBe('Acme Corp Ltd');
  });

  it('plans a header/footer and a watermark, explaining what’s wrong', () => {
    const header = { ...DEFAULT_ORGANIZE_SETTINGS.headerFooter, enabled: true };
    expect(planHeaderFooter({ ...header, text: '  ' })).toMatchObject({ ok: false, error: expect.stringMatching(/Type the header/) });
    expect(planHeaderFooter({ ...header, text: 'x'.repeat(161) })).toMatchObject({ ok: false, error: expect.stringMatching(/under 160/) });
    expect(planHeaderFooter({ ...header, text: 'Привет' })).toMatchObject({ ok: false, error: expect.stringMatching(/“П” can’t be drawn/) });
    expect(planHeaderFooter({ ...header, text: ' Acme ' })).toMatchObject({ ok: true, value: { text: 'Acme' } });

    const watermark = { ...DEFAULT_ORGANIZE_SETTINGS.watermark, enabled: true };
    expect(planWatermark({ ...watermark, text: '' })).toMatchObject({ ok: false });
    expect(planWatermark({ ...watermark, opacity: 0 })).toMatchObject({ ok: true, value: { opacity: 0.05 } });
    expect(planWatermark({ ...watermark, opacity: 250 })).toMatchObject({ ok: true, value: { opacity: 1 } });
    expect(planWatermark({ ...watermark, text: 'x'.repeat(81) })).toMatchObject({ ok: false });
  });
});

describe('background', () => {
  it('parses colours', () => {
    expect(parseHexColor('#ff0000')).toEqual([1, 0, 0]);
    expect(parseHexColor('00FF00')).toEqual([0, 1, 0]);
    expect(parseHexColor('#fff')).toBeNull();
    expect(parseHexColor('red')).toBeNull();
  });

  it('accepts JPG and PNG images, by type or by extension', () => {
    expect(backgroundImageFormat({ type: 'image/jpeg', name: 'a', size: 10 })).toEqual({ ok: true, value: 'jpeg' });
    expect(backgroundImageFormat({ type: '', name: 'a.PNG', size: 10 })).toEqual({ ok: true, value: 'png' });
    expect(backgroundImageFormat({ type: 'image/webp', name: 'a.webp', size: 10 })).toMatchObject({ ok: false, error: expect.stringMatching(/JPG or PNG/) });
    expect(backgroundImageFormat({ type: 'image/png', name: 'a.png', size: 0 })).toMatchObject({ ok: false, error: expect.stringMatching(/empty/) });
    expect(backgroundImageFormat({ type: 'image/png', name: 'a.png', size: 26 * 1024 * 1024 })).toMatchObject({ ok: false, error: expect.stringMatching(/over 25 MB/) });
  });

  it('plans a colour or an image background', () => {
    const background = DEFAULT_ORGANIZE_SETTINGS.background;
    expect(planBackground(background, null)).toEqual({ ok: true, value: null });
    expect(planBackground({ ...background, kind: 'color', color: '#000000' }, null)).toMatchObject({ ok: true, value: { kind: 'color', color: [0, 0, 0] } });
    expect(planBackground({ ...background, kind: 'color', color: 'nope' }, null)).toMatchObject({ ok: false });
    expect(planBackground({ ...background, kind: 'image' }, null)).toMatchObject({ ok: false, error: expect.stringMatching(/Choose a JPG or PNG/) });
    expect(planBackground({ ...background, kind: 'image', opacity: 50 }, { type: 'image/png', name: 'a.png', size: 9 })).toMatchObject({
      ok: true,
      value: { kind: 'image', format: 'png', opacity: 0.5 },
    });
  });
});

describe('planOrganize', () => {
  const settings: OrganizeSettings = DEFAULT_ORGANIZE_SETTINGS;

  it('turns the page list and settings into a plan', () => {
    const result = planOrganize(rotatePages(initialPages(2), ids(2), 90), { ...settings, compression: 'strong' }, [2]);
    expect(result).toEqual({
      ok: true,
      value: {
        pages: [
          { source: { file: 0, page: 0 }, rotation: 0 },
          { source: { file: 0, page: 1 }, rotation: 90 },
        ],
        keepBookmarks: true,
        pageNumbers: null,
        headerFooter: null,
        watermark: null,
        background: null,
        compression: 'strong',
      },
    });
  });

  it('refuses an empty or all-blank document, and pages that don’t exist', () => {
    expect(planOrganize([], settings, [3])).toMatchObject({ ok: false, error: expect.stringMatching(/Every page has been removed/) });
    expect(planOrganize(removePages(insertBlankPage(initialPages(1), ids()).pages, ids(1)), settings, [1])).toMatchObject({ ok: false, error: expect.stringMatching(/Only blank pages/) });
    expect(planOrganize(initialPages(3), settings, [2])).toMatchObject({ ok: false, error: expect.stringMatching(/Page 3 of file 1 doesn’t exist/) });
    expect(planOrganize(insertFilePages(initialPages(1), ids(), 1, 1).pages, settings, [1])).toMatchObject({ ok: false });
  });

  it('refuses page numbers and a header/footer in the same spot', () => {
    const clash = {
      ...settings,
      numbers: { ...settings.numbers, enabled: true, position: 'top-left' as const },
      headerFooter: { ...settings.headerFooter, enabled: true, text: 'Acme', position: 'top-left' as const },
    };
    expect(planOrganize(initialPages(1), clash, [1])).toMatchObject({ ok: false, error: expect.stringMatching(/both set to top left/) });
  });

  it('caps the page count', () => {
    expect(planOrganize(initialPages(10_001), settings, [10_001])).toMatchObject({ ok: false, error: expect.stringMatching(/up to 10,000 pages/) });
  });

  it('names the output after the source, or what was typed', () => {
    expect(outputNameFor('', 'report.pdf')).toBe('report-organized.pdf');
    expect(outputNameFor(' final: v2 ', 'report.pdf')).toBe('final v2.pdf');
    expect(outputNameFor('résumé.PDF', 'x.pdf')).toBe('résumé.pdf');
  });
});
