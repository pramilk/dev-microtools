import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import MergePdf from './MergePdf';

// jsdom has no Worker. The mocked worker runs the real request handler, so the real pdf-lib
// merge engine runs end to end on every test.
vi.mock('../workers/pdfMerge.worker?worker', async () => {
  const { mockWorkerModule } = await import('../../test/fakeWorker');
  const { handlePdfMergeRequest } = await import('../workers/pdfMerge.worker');
  return mockWorkerModule(handlePdfMergeRequest);
});

const SLOW = { timeout: 10_000 };

const rowNames = () => screen.getAllByTestId('merge-row').map((row) => row.querySelector('.mergepdf-row__name')?.textContent);
const row = (name: string) => {
  const match = screen.getAllByTestId('merge-row').find((candidate) => candidate.querySelector('.mergepdf-row__name')?.textContent === name);
  if (!match) throw new Error(`no row for ${name}`);
  return match;
};

async function loadExample() {
  fireEvent.click(screen.getByRole('button', { name: /load example/i }));
  return screen.findByTestId('merge-result', {}, SLOW);
}

function drop(files: File[]) {
  const dropzone = document.querySelector('.dropzone');
  if (!dropzone) throw new Error('dropzone not found');
  fireEvent.drop(dropzone, { dataTransfer: { files } });
}

beforeEach(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake-${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<MergePdf />', () => {
  it('starts empty, with a multi-file dropzone, Load example, and a disabled Clear', () => {
    render(<MergePdf />);
    expect(screen.getByLabelText(/choose pdfs to merge/i)).toHaveAttribute('multiple');
    expect(screen.getByText(/drag one or more pdfs here/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load example/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(screen.queryByTestId('merge-result')).toBeNull();
  });

  it('merges the example files and shows a preview, stats and a download', async () => {
    render(<MergePdf />);
    const result = await loadExample();
    expect(rowNames()).toEqual(['cover-letter.pdf', 'quarterly-report.pdf', 'appendix.pdf']);
    expect(within(row('quarterly-report.pdf')).getByText('4 bookmarks')).toBeInTheDocument();
    expect(within(row('appendix.pdf')).getByText('1 form field')).toBeInTheDocument();

    await waitFor(() => expect(result).toHaveTextContent(/6 pages from 3 files/));
    expect(result).toHaveTextContent(/7 bookmarks · 1 form field kept fillable/);
    const frame = screen.getByTitle('Merged PDF preview');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('src')).toMatch(/^blob:.*#view=FitH$/);

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const download = screen.getByRole('button', { name: /download merged pdf/i });
    expect(download).toHaveAttribute('title', 'Save as merged.pdf');
    fireEvent.click(download);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('reorders with the arrow buttons, announces it, keeps focus, and re-merges', async () => {
    render(<MergePdf />);
    await loadExample();
    const up = screen.getByRole('button', { name: 'Move appendix.pdf up' });
    up.focus();
    fireEvent.click(up);
    expect(rowNames()).toEqual(['cover-letter.pdf', 'appendix.pdf', 'quarterly-report.pdf']);
    expect(screen.getByText('Moved appendix.pdf to position 2 of 3.')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move appendix.pdf up' })));

    fireEvent.click(screen.getByRole('button', { name: 'Move appendix.pdf up' }));
    expect(rowNames()[0]).toBe('appendix.pdf');
    // Now first, its Up button is disabled — focus moves to Down instead of being lost.
    expect(screen.getByRole('button', { name: 'Move appendix.pdf up' })).toBeDisabled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move appendix.pdf down' })));
    await waitFor(() => expect(screen.getByTestId('merge-result')).toHaveTextContent(/6 pages/), SLOW);
  });

  it('sorts by name and reverses the order', async () => {
    render(<MergePdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: 'Sort A–Z' }));
    expect(rowNames()).toEqual(['appendix.pdf', 'cover-letter.pdf', 'quarterly-report.pdf']);
    fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    expect(rowNames()).toEqual(['quarterly-report.pdf', 'cover-letter.pdf', 'appendix.pdf']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort Z–A' }));
    expect(rowNames()).toEqual(['quarterly-report.pdf', 'cover-letter.pdf', 'appendix.pdf']);
  });

  it('reorders by dragging a row’s handle onto another row', async () => {
    render(<MergePdf />);
    await loadExample();
    const handle = row('cover-letter.pdf').querySelector('.mergepdf-row__handle');
    if (!handle) throw new Error('no handle');
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '', types: ['text/plain'], files: [] };
    fireEvent.dragStart(handle, { dataTransfer });
    // jsdom's synthetic drag events carry no pointer position, so this lands in the upper
    // half of the target row — "insert before". The real-browser half-split is covered by e2e.
    const target = row('appendix.pdf');
    fireEvent.dragOver(target, { dataTransfer });
    expect(target.className).toContain('mergepdf-row--drop-before');
    fireEvent.drop(target, { dataTransfer });
    expect(rowNames()).toEqual(['quarterly-report.pdf', 'cover-letter.pdf', 'appendix.pdf']);
    expect(target.className).not.toContain('mergepdf-row--drop');
  });

  it('validates page ranges inline and merges only the chosen pages', async () => {
    render(<MergePdf />);
    const result = await loadExample();
    await waitFor(() => expect(result).toHaveTextContent(/6 pages/));
    const range = screen.getByLabelText('Pages to include from quarterly-report.pdf');

    fireEvent.input(range, { target: { value: '9' } });
    expect(range).toHaveAttribute('aria-invalid', 'true');
    expect(within(row('quarterly-report.pdf')).getByText(/Page 9 doesn’t exist — this file has 3 pages/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/fix the highlighted page range/i);
    await waitFor(() => expect(screen.queryByTestId('merge-result')).toBeNull());

    fireEvent.input(range, { target: { value: '3-1' } });
    expect(range).toHaveAttribute('aria-invalid', 'false');
    expect(within(row('quarterly-report.pdf')).getByText('3 of 3 pages')).toBeInTheDocument();
    fireEvent.input(range, { target: { value: '1, 3' } });
    expect(within(row('quarterly-report.pdf')).getByText('2 of 3 pages')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('merge-result')).toHaveTextContent(/5 pages from 3 files/), SLOW);
  });

  it('cycles a file’s rotation through 90° steps', async () => {
    render(<MergePdf />);
    await loadExample();
    const rotate = () => screen.getByRole('button', { name: /rotate pages of cover-letter\.pdf/i });
    expect(rotate()).toHaveAccessibleName('Rotate pages of cover-letter.pdf — currently 0°');
    fireEvent.click(rotate());
    expect(rotate()).toHaveTextContent('↻ 90°');
    fireEvent.click(rotate());
    fireEvent.click(rotate());
    fireEvent.click(rotate());
    expect(rotate()).toHaveAccessibleName('Rotate pages of cover-letter.pdf — currently 0°');
  });

  it('applies merge options and a custom file name', async () => {
    render(<MergePdf />);
    const result = await loadExample();
    await waitFor(() => expect(result).toHaveTextContent(/7 bookmarks/));

    fireEvent.click(screen.getByRole('checkbox', { name: /add a bookmark for each file/i }));
    await waitFor(() => expect(screen.getByTestId('merge-result')).toHaveTextContent(/4 bookmarks/), SLOW);
    fireEvent.click(screen.getByRole('checkbox', { name: /blank page after odd-length files/i }));
    await waitFor(() => expect(screen.getByTestId('merge-result')).toHaveTextContent(/8 pages.*2 blank pages added/), SLOW);

    fireEvent.input(screen.getByLabelText(/file name for the merged pdf/i), { target: { value: 'Board pack' } });
    expect(screen.getByRole('button', { name: /download merged pdf/i })).toHaveAttribute('title', 'Save as Board pack.pdf');
  });

  it('removes a file and re-merges without it', async () => {
    render(<MergePdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: 'Remove appendix.pdf' }));
    expect(rowNames()).toEqual(['cover-letter.pdf', 'quarterly-report.pdf']);
    await waitFor(() => expect(screen.getByTestId('merge-result')).toHaveTextContent(/4 pages from 2 files/), SLOW);
  });

  it('rejects a non-PDF file with a visible error, and keeps the PDFs from the same drop', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage();
    render(<MergePdf />);
    drop([new File(['hello'], 'photo.png', { type: 'image/png' }), new File([(await doc.save()) as Uint8Array<ArrayBuffer>], 'real.pdf', { type: 'application/pdf' })]);
    expect(screen.getByRole('alert')).toHaveTextContent(/"photo\.png" isn't a PDF/);
    expect(rowNames()).toEqual(['real.pdf']);
    expect(await screen.findByText(/add another pdf to merge/i, {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('merge-result')).toHaveTextContent(/1 page from 1 file/), SLOW);
  });

  it('marks an unreadable .pdf in the list and leaves it out of the merge', async () => {
    render(<MergePdf />);
    await loadExample();
    drop([new File(['not really a pdf'], 'broken.pdf', { type: 'application/pdf' })]);
    expect(await within(row('broken.pdf')).findByText(/can’t be merged: .*PDF header/i, {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText(/files that can’t be read are left out/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('merge-result')).toHaveTextContent(/6 pages from 3 files/), SLOW);
  });

  it('Clear removes every file, the result and custom options', async () => {
    render(<MergePdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('checkbox', { name: /keep each file’s own bookmarks/i }));
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryAllByTestId('merge-row')).toHaveLength(0);
    await waitFor(() => expect(screen.queryByTestId('merge-result')).toBeNull());
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();

    await loadExample();
    expect(screen.getByRole('checkbox', { name: /keep each file’s own bookmarks/i })).toBeChecked();
  });
});
