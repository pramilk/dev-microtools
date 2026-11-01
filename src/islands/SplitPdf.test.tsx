import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import SplitPdf from './SplitPdf';

// jsdom has no Worker. The mocked worker runs the real request handler, so the real pdf-lib
// split engine runs end to end on every test.
vi.mock('../workers/pdfSplit.worker?worker', async () => {
  const { mockWorkerModule } = await import('../../test/fakeWorker');
  const { handlePdfSplitRequest } = await import('../workers/pdfSplit.worker');
  return mockWorkerModule(handlePdfSplitRequest);
});

// jsdom has no canvas, so pdf.js can't draw here — the real thumbnails are covered by the e2e
// spec. This stand-in "draws" every page as a tiny blob, so the grid's behaviour is tested.
const thumbnailsOpened = vi.hoisted(() => vi.fn());
vi.mock('./shared/pdfThumbnails', () => ({
  openThumbnailDocument: async () => {
    thumbnailsOpened();
    return {
      pageCount: 1000,
      render: async (page: number) => new Blob([`page ${page}`], { type: 'image/jpeg' }),
      destroy: async () => {},
    };
  },
}));

const zipped = vi.hoisted(() => vi.fn<(entries: { name: string; blob: Blob }[], zipName: string) => Promise<void>>(async () => {}));
vi.mock('./shared/downloadZip', () => ({ downloadZip: zipped }));

const SLOW = { timeout: 10_000 };

const pageCard = (pageNumber: number) => {
  const card = screen.getAllByTestId('split-page')[pageNumber - 1];
  if (!card) throw new Error(`no card for page ${pageNumber}`);
  return card;
};

const partNames = () => screen.getAllByTestId('split-part').map((row) => row.querySelector('.splitpdf-row__name')?.textContent);
const part = (name: string) => {
  const match = screen.getAllByTestId('split-part').find((row) => row.querySelector('.splitpdf-row__name')?.textContent === name);
  if (!match) throw new Error(`no part named ${name}`);
  return match;
};

async function loadExample() {
  fireEvent.click(screen.getByRole('button', { name: /load example/i }));
  const result = await screen.findByTestId('split-result', {}, SLOW);
  await waitFor(() => expect(result).toHaveTextContent(/3 files from 6 pages/), SLOW);
  return result;
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
  zipped.mockClear();
  thumbnailsOpened.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<SplitPdf />', () => {
  it('starts empty, with a dropzone, Load example, and a disabled Clear', () => {
    render(<SplitPdf />);
    expect(screen.getByLabelText(/choose a pdf to split/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load example/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(screen.queryByRole('group', { name: /split mode/i })).toBeNull();
    expect(screen.queryByTestId('split-result')).toBeNull();
  });

  it('splits the example by its ranges, with per-part details, preview and downloads', async () => {
    render(<SplitPdf />);
    const result = await loadExample();
    expect(screen.getByLabelText(/page ranges — one file each/i)).toHaveValue('1, 2-3, 4-6');
    expect(screen.getByText(/6 pages · .* · 9 bookmarks/)).toBeInTheDocument();
    expect(partNames()).toEqual(['employee-handbook-page-1.pdf', 'employee-handbook-pages-2-3.pdf', 'employee-handbook-pages-4-6.pdf']);
    expect(within(part('employee-handbook-page-1.pdf')).getByText('3 links to other parts removed')).toBeInTheDocument();
    expect(within(part('employee-handbook-pages-2-3.pdf')).getByText('3 bookmarks')).toBeInTheDocument();
    expect(within(part('employee-handbook-pages-4-6.pdf')).getByText('1 form field')).toBeInTheDocument();
    expect(result).toHaveTextContent(/Pages 4–6 · 3 pages/);

    expect(screen.getByTitle('Preview of employee-handbook-page-1.pdf').getAttribute('src')).toMatch(/^blob:.*#view=FitH$/);
    fireEvent.click(screen.getByRole('button', { name: 'Preview employee-handbook-pages-2-3.pdf' }));
    expect(screen.getByRole('button', { name: 'Preview employee-handbook-pages-2-3.pdf' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Preview of employee-handbook-pages-2-3.pdf')).toBeInTheDocument();

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Download employee-handbook-pages-4-6.pdf' }));
    expect(click).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /download all \(\.zip\)/i }));
    await waitFor(() => expect(zipped).toHaveBeenCalledTimes(1));
    const [entries, zipName] = zipped.mock.calls[0] ?? [[], ''];
    expect(zipName).toBe('employee-handbook-split.zip');
    expect(entries.map((entry) => entry.name)).toEqual(partNames());
  });

  it('validates ranges inline and waits for a fix before re-splitting', async () => {
    render(<SplitPdf />);
    await loadExample();
    const ranges = screen.getByLabelText(/page ranges — one file each/i);

    fireEvent.input(ranges, { target: { value: '1-2, 9' } });
    expect(ranges).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Page 9 doesn’t exist — this file has 6 pages/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('split-result')).toBeNull());

    fireEvent.input(ranges, { target: { value: '1-2+6, 3-5' } });
    expect(ranges).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByText('2 files: Pages 1–2, 6 · Pages 3–5')).toBeInTheDocument();
    await waitFor(() => expect(partNames()).toEqual(['employee-handbook-part-01.pdf', 'employee-handbook-pages-3-5.pdf']), SLOW);
  });

  it('extracts every range into one PDF when "Save all ranges as one PDF" is ticked', async () => {
    render(<SplitPdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('checkbox', { name: /save all ranges as one pdf/i }));
    await waitFor(() => expect(partNames()).toEqual(['employee-handbook-extracted.pdf']), SLOW);
    expect(screen.getByTestId('split-result')).toHaveTextContent(/1 file from 6 pages/);
    expect(screen.getByRole('button', { name: /^download pdf$/i })).toHaveAttribute('title', 'Save as employee-handbook-extracted.pdf');
  });

  it('splits every N pages and by bookmarks', async () => {
    render(<SplitPdf />);
    await loadExample();

    fireEvent.click(screen.getByRole('button', { name: 'Every N pages' }));
    fireEvent.input(screen.getByLabelText(/pages per file/i), { target: { value: '4' } });
    await waitFor(() => expect(partNames()).toEqual(['employee-handbook-pages-1-4.pdf', 'employee-handbook-pages-5-6.pdf']), SLOW);
    fireEvent.input(screen.getByLabelText(/pages per file/i), { target: { value: 'x' } });
    expect(screen.getByText(/“x” isn’t a whole number/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'By bookmarks' }));
    await waitFor(
      () =>
        expect(partNames()).toEqual([
          'employee-handbook-01-Contents.pdf',
          'employee-handbook-02-1-Working-here.pdf',
          'employee-handbook-03-2-Benefits.pdf',
          'employee-handbook-04-3-Sign-off.pdf',
        ]),
      SLOW
    );
    fireEvent.change(screen.getByLabelText(/split at/i), { target: { value: '2' } });
    await waitFor(() => expect(screen.getAllByTestId('split-part')).toHaveLength(6), SLOW);
  });

  it('splits by file size', async () => {
    render(<SplitPdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: 'By file size' }));
    const size = screen.getByLabelText(/max size per file/i);
    expect(size).toHaveValue('5');
    // The whole 6-page sample is far under 5 MB, so it stays in one file.
    await waitFor(() => expect(partNames()).toEqual(['employee-handbook-pages-1-6.pdf']), SLOW);

    // Switching unit converts the number, so the limit itself doesn't change.
    fireEvent.click(screen.getByRole('button', { name: 'KB' }));
    expect(screen.getByRole('button', { name: 'KB' })).toHaveAttribute('aria-pressed', 'true');
    expect(size).toHaveValue('5120');
    fireEvent.input(size, { target: { value: '10' } });
    expect(screen.getByText(/at least 50 KB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'MB' }));
    expect(size).toHaveValue('0.01');
  });

  it('renames parts with a custom prefix', async () => {
    render(<SplitPdf />);
    await loadExample();
    fireEvent.input(screen.getByPlaceholderText('employee-handbook'), { target: { value: 'HR pack' } });
    await waitFor(() => expect(partNames()[0]).toBe('HR pack-page-1.pdf'), SLOW);
  });

  it('starts a dropped file with ranges that cut it in half, and disables By bookmarks when it has none', async () => {
    render(<SplitPdf />);
    drop(await pdfFile('plain.pdf', 5));
    await waitFor(() => expect(screen.getByLabelText(/page ranges — one file each/i)).toHaveValue('1-3, 4-5'), SLOW);
    expect(screen.getByRole('button', { name: 'By bookmarks' })).toBeDisabled();
    await waitFor(() => expect(partNames()).toEqual(['plain-pages-1-3.pdf', 'plain-pages-4-5.pdf']), SLOW);
  });

  it('shows a visible error for a non-PDF and for a broken .pdf', async () => {
    render(<SplitPdf />);
    drop(new File(['hello'], 'photo.png', { type: 'image/png' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/"photo\.png" isn't a PDF/);

    drop(new File(['not really a pdf'], 'broken.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText(/doesn’t start with a PDF header/, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /split mode/i })).toBeNull();
  });

  it('only loads the page previewer once "Pick pages" is opened', async () => {
    render(<SplitPdf />);
    await loadExample();
    expect(screen.queryAllByTestId('split-page')).toHaveLength(0);
    expect(thumbnailsOpened).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pick pages' }));
    expect(screen.getAllByTestId('split-page')).toHaveLength(6);
    await waitFor(() => expect(screen.getAllByRole('img', { name: /^Page \d$/ })).toHaveLength(6), SLOW);
    expect(screen.getByRole('img', { name: 'Page 1' }).getAttribute('src')).toMatch(/^blob:/);
    expect(thumbnailsOpened).toHaveBeenCalledTimes(1);
  });

  it('puts the picked pages into one PDF, in document order', async () => {
    render(<SplitPdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: 'Pick pages' }));
    expect(screen.getByText(/click the pages you want/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('split-result')).toBeNull());

    fireEvent.click(pageCard(5));
    fireEvent.click(screen.getByLabelText('Pick page 2'));
    expect(screen.getByLabelText('Pick page 2')).toBeChecked();
    expect(screen.getByLabelText('Pick page 5')).toBeChecked();
    expect(screen.getByLabelText('Pick page 1')).not.toBeChecked();
    expect(screen.getByText(/2 of 6 pages picked → 1 file: Pages 2, 5/)).toBeInTheDocument();
    await waitFor(() => expect(partNames()).toEqual(['employee-handbook-extracted.pdf']), SLOW);
    expect(screen.getByTestId('split-result')).toHaveTextContent(/Pages 2, 5 · 2 pages/);

    // Clicking a picked page again unpicks it.
    fireEvent.click(pageCard(5));
    expect(screen.getByLabelText('Pick page 5')).not.toBeChecked();
  });

  it('Shift-click picks a run, and each picked page can be its own file', async () => {
    render(<SplitPdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: 'Pick pages' }));
    fireEvent.click(pageCard(2));
    fireEvent.click(pageCard(4), { shiftKey: true });
    expect([1, 2, 3, 4, 5, 6].map((page) => (screen.getByLabelText(`Pick page ${page}`) as HTMLInputElement).checked)).toEqual([false, true, true, true, false, false]);

    fireEvent.click(screen.getByRole('checkbox', { name: /save each picked page as its own file/i }));
    await waitFor(() => expect(partNames()).toEqual(['employee-handbook-page-2.pdf', 'employee-handbook-page-3.pdf', 'employee-handbook-page-4.pdf']), SLOW);
  });

  it('selects all and none', async () => {
    render(<SplitPdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: 'Pick pages' }));
    expect(screen.getByRole('button', { name: 'Select none' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText(/6 of 6 pages picked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled();
    await waitFor(() => expect(partNames()).toEqual(['employee-handbook-extracted.pdf']), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    expect(screen.getByLabelText('Pick page 3')).not.toBeChecked();
    await waitFor(() => expect(screen.queryByTestId('split-result')).toBeNull());
  });

  it('Clear removes the file, the result and custom settings', async () => {
    render(<SplitPdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('checkbox', { name: /keep bookmarks in each file/i }));
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    await waitFor(() => expect(screen.queryByTestId('split-result')).toBeNull());
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();

    await loadExample();
    expect(screen.getByRole('checkbox', { name: /keep bookmarks in each file/i })).toBeChecked();
  });
});
