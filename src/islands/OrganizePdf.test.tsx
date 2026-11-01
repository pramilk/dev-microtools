import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import OrganizePdf from './OrganizePdf';

// jsdom has no Worker. The mocked worker runs the real request handler, so the real pdf-lib
// organize engine runs end to end on every test (with a stand-in image codec, which only
// compression would use).
vi.mock('../workers/pdfOrganize.worker?worker', async () => {
  const { mockWorkerModule } = await import('../../test/fakeWorker');
  const { handlePdfOrganizeRequest } = await import('../workers/pdfOrganize.worker');
  const codec = {
    decodeJpeg: async (_bytes: Uint8Array, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
    encodeJpeg: async () => new Uint8Array([0xff, 0xd8]),
    encodePng: async () => new Uint8Array([0x89, 0x50]),
  };
  return mockWorkerModule((request: Parameters<typeof handlePdfOrganizeRequest>[0]) => handlePdfOrganizeRequest(request, codec));
});

// jsdom has no canvas, so pdf.js can't draw here — the real thumbnails are covered by the e2e
// spec. This stand-in "draws" every page as a tiny blob, and measures page 3 (index 2) of any
// file as blank paper and every other page as covered in ink.
vi.mock('./shared/pdfThumbnails', () => ({
  openThumbnailDocument: async () => ({
    pageCount: 1000,
    render: async (page: number) => new Blob([`page ${page}`], { type: 'image/jpeg' }),
    // Opaque white paper for page 3, opaque black for the rest (transparent pixels count as paper).
    renderPixels: async (page: number) => ({ data: Uint8ClampedArray.from({ length: 4 * 100 }, (_, i) => (i % 4 === 3 || page === 2 ? 255 : 0)), width: 10, height: 10 }),
    destroy: async () => {},
  }),
}));

const SLOW = { timeout: 10_000 };

const cards = () => screen.getAllByTestId('organize-page');
const card = (position: number) => {
  const match = cards()[position - 1];
  if (!match) throw new Error(`no page at position ${position}`);
  return match;
};
/** What each card says under its thumbnail: its position, plus where it came from if moved. */
const labels = () => cards().map((item) => item.querySelector('.orgpdf-card__row')?.textContent?.trim());
const select = (position: number, shiftKey = false) => fireEvent.click(card(position).querySelector('.orgpdf-card') as Element, { shiftKey });
const result = () => screen.findByTestId('organize-result', {}, SLOW);

async function loadExample() {
  fireEvent.click(screen.getByRole('button', { name: /load example/i }));
  await waitFor(() => expect(cards()).toHaveLength(6), SLOW);
  await waitFor(() => expect(screen.getByTestId('organize-result')).toHaveTextContent(/6 pages/), SLOW);
}

async function pdfFile(name: string, pages: number): Promise<File> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300 + i, 400]);
  return new File([(await doc.save()) as Uint8Array<ArrayBuffer>], name, { type: 'application/pdf' });
}

function drop(file: File) {
  const dropzone = document.querySelector('.dropzone');
  if (!dropzone) throw new Error('dropzone not found');
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
}

beforeEach(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake-${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<OrganizePdf />', () => {
  it('starts empty, with a dropzone, Load example, and a disabled Clear', () => {
    render(<OrganizePdf />);
    expect(screen.getByLabelText(/choose a pdf to organize/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load example/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(screen.queryByTestId('organize-page')).toBeNull();
    expect(screen.queryByTestId('organize-result')).toBeNull();
  });

  it('shows every page of the example and writes it, ready to download', async () => {
    render(<OrganizePdf />);
    await loadExample();
    expect(labels()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(screen.getByText('No changes to the pages yet')).toBeInTheDocument();
    const output = await result();
    expect(output).toHaveTextContent('quarterly-report-organized.pdf');
    expect(output).toHaveTextContent('6 bookmarks');
    expect(screen.getByTitle('Preview of quarterly-report-organized.pdf').getAttribute('src')).toMatch(/^blob:/);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('moves, rotates and removes the selected pages, with undo and redo', async () => {
    render(<OrganizePdf />);
    await loadExample();

    select(2);
    expect(screen.getByText(/1 of 6 pages selected/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /later/i }));
    expect(labels().slice(0, 3)).toEqual(['1', '2p. 3', '3p. 2']);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate page 4 left' }));
    fireEvent.click(screen.getByRole('button', { name: /remove page 5/i }));
    expect(cards()).toHaveLength(5);
    expect(screen.getByText('reordered · 1 page rotated · 1 page removed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('organize-result')).toHaveTextContent(/5 pages/), SLOW);
    expect(screen.getByTestId('organize-result')).toHaveTextContent('5 bookmarks');

    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    expect(cards()).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: /^redo$/i }));
    expect(cards()).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    expect(labels()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('selects a run with Shift-click, and supports keyboard shortcuts', async () => {
    render(<OrganizePdf />);
    await loadExample();
    select(2);
    select(4, true);
    expect(screen.getByText(/3 of 6 pages selected/)).toBeInTheDocument();
    const grid = screen.getByRole('list', { name: /pages/i });
    fireEvent.keyDown(grid, { key: 'Delete' });
    expect(cards()).toHaveLength(3);
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true });
    expect(cards()).toHaveLength(6);
    fireEvent.keyDown(grid, { key: 'a', ctrlKey: true });
    expect(screen.getByText(/6 of 6 pages selected/)).toBeInTheDocument();
    // Selection actions are disabled until something is selected.
    fireEvent.click(screen.getByRole('button', { name: /select none/i }));
    expect(screen.getByRole('button', { name: /rotate left/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /remove selected pages/i })).toBeDisabled();
  });

  it('adds blank pages and duplicates, reverses, and collates a duplex scan', async () => {
    render(<OrganizePdf />);
    await loadExample();
    select(1);
    fireEvent.click(screen.getByRole('button', { name: /duplicate/i }));
    fireEvent.click(screen.getByRole('button', { name: /\+ blank page/i }));
    expect(labels().slice(0, 4)).toEqual(['1', '2p. 1', '3Blank', '4p. 2']);
    expect(within(card(3)).getByRole('img', { name: 'Blank page' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    fireEvent.click(screen.getByRole('button', { name: /collate duplex scan/i }));
    expect(labels()).toEqual(['1', '2p. 6', '3p. 2', '4p. 5', '5p. 3', '6p. 4']);
    fireEvent.click(screen.getByRole('button', { name: /^reverse$/i }));
    expect(labels()[0]).toBe('1p. 4');
  });

  it('inserts the pages of another PDF after the selection and selects them', async () => {
    render(<OrganizePdf />);
    await loadExample();
    select(1);
    const input = screen.getByLabelText(/insert pages from other pdfs/i);
    fireEvent.change(input, { target: { files: [await pdfFile('signature.pdf', 2)] } });
    await waitFor(() => expect(cards()).toHaveLength(8), SLOW);
    expect(labels().slice(0, 4)).toEqual(['1', '2PDF 2 · p. 1', '3PDF 2 · p. 2', '4p. 2']);
    expect(screen.getByText(/2 of 8 pages selected/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('organize-result')).toHaveTextContent(/8 pages · .* · from 2 PDFs/), SLOW);

    fireEvent.change(input, { target: { files: [new File(['nope'], 'notes.txt', { type: 'text/plain' })] } });
    expect(await screen.findByText(/“notes\.txt”/)).toBeInTheDocument();
  });

  it('finds blank pages and selects them for review', async () => {
    render(<OrganizePdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: /find blank pages/i }));
    expect(await screen.findByText(/Found 1 blank page — it’s selected/, {}, SLOW)).toBeInTheDocument();
    expect(card(3)).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText(/1 of 6 pages selected/)).toBeInTheDocument();
  });

  it('opens a page full size from its zoom button and steps through the pages', async () => {
    render(<OrganizePdf />);
    await loadExample();
    fireEvent.click(within(card(2)).getByRole('button', { name: /view page 2 full size/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Page 2 of 6' });
    expect(await within(dialog).findByRole('img', { name: 'Page 2 of 6' })).toBeInTheDocument();
    // Zooming never selects the page.
    expect(card(2)).toHaveAttribute('data-selected', 'false');
    fireEvent.click(within(dialog).getByRole('button', { name: /next/i }));
    expect(await screen.findByRole('dialog', { name: 'Page 3 of 6' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('adds page numbers, a header and a watermark, explaining bad settings', async () => {
    render(<OrganizePdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('checkbox', { name: /page numbers/i }));
    const fromPage = screen.getByLabelText(/number from page/i);
    fireEvent.input(fromPage, { target: { value: '9' } });
    expect(await screen.findByText(/“Number from page” is 9, but the organized PDF has 6 pages/)).toBeInTheDocument();
    fireEvent.input(fromPage, { target: { value: '2' } });
    await waitFor(() => expect(screen.getByTestId('organize-result')).toHaveTextContent('5 pages numbered'), SLOW);

    fireEvent.click(screen.getByRole('checkbox', { name: /watermark/i }));
    const text = screen.getByDisplayValue('CONFIDENTIAL');
    fireEvent.input(text, { target: { value: 'ЧЕРНОВИК' } });
    expect(await screen.findByText(/“Ч” can’t be drawn/)).toBeInTheDocument();
    fireEvent.input(text, { target: { value: 'DRAFT' } });
    await waitFor(() => expect(screen.queryByText(/can’t be drawn/)).toBeNull());

    fireEvent.click(screen.getByRole('checkbox', { name: /header or footer text/i }));
    expect(await screen.findByText(/Type the header or footer text/)).toBeInTheDocument();
  });

  it('asks for a usable background image', async () => {
    render(<OrganizePdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: /^image$/i }));
    expect(await screen.findByText(/Choose a JPG or PNG image to use as the background/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/background image/i), { target: { files: [new File(['gif'], 'paper.gif', { type: 'image/gif' })] } });
    expect((await screen.findAllByText(/a PDF can only contain those directly/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /^colour$/i }));
    await waitFor(() => expect(screen.queryByText(/JPG or PNG/)).toBeNull());
  });

  it('explains when every page has been removed', async () => {
    render(<OrganizePdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: /select all/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove selected pages/i }));
    expect(await screen.findByText(/Every page has been removed/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('organize-result')).toBeNull());
  });

  it('rejects a file that isn’t a PDF, and opens a dropped one', async () => {
    render(<OrganizePdf />);
    drop(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    drop(await pdfFile('scan.pdf', 3));
    await waitFor(() => expect(cards()).toHaveLength(3), SLOW);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((await result())).toHaveTextContent('scan-organized.pdf');
  });

  it('clears the PDF and every setting', async () => {
    render(<OrganizePdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('checkbox', { name: /page numbers/i }));
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    await waitFor(() => expect(screen.queryByTestId('organize-page')).toBeNull());
    expect(screen.queryByTestId('organize-result')).toBeNull();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });
});
