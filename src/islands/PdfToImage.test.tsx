import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import PdfToImage from './PdfToImage';

// jsdom has no canvas, so pdf.js can't draw here — the real renderer is covered by the e2e spec.
// This stand-in has 6 pages and "draws" each as a small blob, recording what it was asked for.
const rendered = vi.hoisted(() => vi.fn<(page: number, options: Record<string, unknown>) => void>());
const openState = vi.hoisted(() => ({ failWith: null as string | null, failPage: null as number | null }));
vi.mock('./shared/pdfThumbnails', () => ({
  openThumbnailDocument: async () => {
    if (openState.failWith) throw new Error(openState.failWith);
    return {
      pageCount: 6,
      render: async (page: number) => new Blob([`thumb ${page}`], { type: 'image/jpeg' }),
      renderImage: async (page: number, options: { format: string }) => {
        rendered(page, options);
        if (openState.failPage === page) throw new Error('the page is damaged');
        return { blob: new Blob([`page ${page}`], { type: options.format === 'png' ? 'image/png' : 'image/jpeg' }), width: 1240, height: 1754, capped: false };
      },
      destroy: async () => {},
    };
  },
}));

const zipped = vi.hoisted(() => vi.fn<(entries: { name: string; blob: Blob }[], zipName: string) => Promise<void>>(async () => {}));
vi.mock('./shared/downloadZip', () => ({ downloadZip: zipped }));

const SLOW = { timeout: 10_000 };

const pdfFile = (name = 'report.pdf', type = 'application/pdf') => new File(['%PDF-1.7 fake'], name, { type });

function drop(file: File) {
  const dropzone = screen.getByText(/drag a file here/i).closest('.dropzone');
  if (!dropzone) throw new Error('dropzone not found');
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
}

async function loadPdf(name = 'report.pdf') {
  render(<PdfToImage />);
  drop(pdfFile(name));
  await screen.findByText(/^6 pages · /, {}, SLOW);
}

const convertButton = () => screen.getByRole('button', { name: /^convert/i });
const imageNames = () => screen.getAllByTestId('p2i-image').map((card) => card.querySelector('.p2i-image__name')?.textContent);
const chooseMode = () => fireEvent.click(screen.getByRole('radio', { name: /choose pages/i }));

beforeEach(() => {
  rendered.mockClear();
  zipped.mockClear();
  openState.failWith = null;
  openState.failPage = null;
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake-${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PdfToImage', () => {
  it('renders the controls and a disabled Convert button', () => {
    render(<PdfToImage />);
    expect(screen.getByLabelText(/choose a pdf to convert/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load example/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(convertButton()).toBeDisabled();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('has no share link, since the input is a file from disk', () => {
    render(<PdfToImage />);
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull();
  });

  it('defaults to JPEG, balanced quality, 150 DPI and all pages', async () => {
    await loadPdf();
    expect(screen.getByRole('radio', { name: 'JPEG' })).toBeChecked();
    expect(screen.getByLabelText(/JPEG quality \(80%\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Balanced' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Resolution')).toHaveValue('150');
    expect(screen.getByRole('radio', { name: /all pages/i })).toBeChecked();
    expect(convertButton()).toHaveTextContent('Convert 6 pages');
  });

  it('converts every page to JPEG at the chosen settings and lists them', async () => {
    await loadPdf('Q3 report.pdf');
    fireEvent.input(screen.getByLabelText(/JPEG quality/), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: '200' } });
    fireEvent.click(convertButton());

    await screen.findByTestId('p2i-result', {}, SLOW);
    expect(rendered).toHaveBeenCalledTimes(6);
    expect(rendered).toHaveBeenNthCalledWith(1, 0, { format: 'jpeg', quality: 0.6, dpi: 200, transparent: false });
    expect(imageNames()).toEqual(['Q3-report-page-1.jpg', 'Q3-report-page-2.jpg', 'Q3-report-page-3.jpg', 'Q3-report-page-4.jpg', 'Q3-report-page-5.jpg', 'Q3-report-page-6.jpg']);
    expect(screen.getByText(/6 images · .* · Pages 1–6/)).toBeInTheDocument();
    expect(screen.getAllByText(/1240 × 1754 px/)).toHaveLength(6);
  });

  it('applies a quality preset', async () => {
    await loadPdf();
    fireEvent.click(screen.getByRole('button', { name: 'Smallest' }));
    expect(screen.getByLabelText(/JPEG quality \(40%\)/)).toBeInTheDocument();
    fireEvent.click(convertButton());
    await screen.findByTestId('p2i-result', {}, SLOW);
    expect(rendered).toHaveBeenCalledWith(0, expect.objectContaining({ quality: 0.4 }));
  });

  it('switches to PNG, which offers a transparent background instead of a quality', async () => {
    await loadPdf();
    fireEvent.click(screen.getByRole('radio', { name: 'PNG' }));
    expect(screen.queryByLabelText(/JPEG quality/)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /transparent background/i }));
    fireEvent.click(convertButton());
    await screen.findByTestId('p2i-result', {}, SLOW);
    expect(rendered).toHaveBeenCalledWith(0, expect.objectContaining({ format: 'png', transparent: true }));
    expect(imageNames()[0]).toBe('report-page-1.png');
  });

  it('converts only the typed pages', async () => {
    await loadPdf();
    chooseMode();
    expect(convertButton()).toBeDisabled();
    expect(screen.getByText(/no pages chosen yet/i)).toBeInTheDocument();
    fireEvent.input(screen.getByLabelText('Page numbers'), { target: { value: '2-3, 6' } });
    expect(convertButton()).toHaveTextContent('Convert 3 pages');
    fireEvent.click(convertButton());
    await screen.findByTestId('p2i-result', {}, SLOW);
    expect(imageNames()).toEqual(['report-page-2.jpg', 'report-page-3.jpg', 'report-page-6.jpg']);
    expect(screen.getByText(/Pages 2–3, 6/)).toBeInTheDocument();
  });

  it('picks pages from the thumbnails, writing them into the list, and Shift-click picks a run', async () => {
    await loadPdf();
    chooseMode();
    const cards = screen.getAllByTestId('p2i-page');
    expect(cards).toHaveLength(6);
    fireEvent.click(cards[1] as HTMLElement);
    expect(screen.getByLabelText('Page numbers')).toHaveValue('2');
    fireEvent.click(cards[4] as HTMLElement, { shiftKey: true });
    expect(screen.getByLabelText('Page numbers')).toHaveValue('2-5');
    expect(screen.getByText(/4 of 6 pages chosen/)).toBeInTheDocument();
    fireEvent.click(cards[2] as HTMLElement);
    expect(screen.getByLabelText('Page numbers')).toHaveValue('2, 4-5');
    expect(screen.getByRole('checkbox', { name: 'Choose page 2' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Choose page 3' })).not.toBeChecked();
  });

  it('Select all and Select none', async () => {
    await loadPdf();
    chooseMode();
    fireEvent.click(screen.getByRole('button', { name: /select all/i }));
    expect(screen.getByLabelText('Page numbers')).toHaveValue('1-6');
    expect(screen.getByRole('button', { name: /select all/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /select none/i }));
    expect(screen.getByLabelText('Page numbers')).toHaveValue('');
  });

  it('shows a helpful error for a page that does not exist, and keeps Convert disabled', async () => {
    await loadPdf();
    chooseMode();
    fireEvent.input(screen.getByLabelText('Page numbers'), { target: { value: '9' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Page 9 doesn’t exist/);
    expect(convertButton()).toBeDisabled();
    fireEvent.input(screen.getByLabelText('Page numbers'), { target: { value: '2' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(convertButton()).toBeEnabled();
  });

  it('downloads one image, and all of them as a ZIP', async () => {
    await loadPdf();
    fireEvent.click(convertButton());
    await screen.findByTestId('p2i-result', {}, SLOW);

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getAllByRole('button', { name: /^⭳? ?download$/i })[0] as HTMLElement);
    expect(click).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /download all \(6\) as zip/i }));
    await waitFor(() => expect(zipped).toHaveBeenCalledTimes(1));
    const [entries, zipName] = zipped.mock.calls[0] as [{ name: string }[], string];
    expect(zipName).toBe('report-images.zip');
    expect(entries.map((entry) => entry.name)).toEqual(['report-page-1.jpg', 'report-page-2.jpg', 'report-page-3.jpg', 'report-page-4.jpg', 'report-page-5.jpg', 'report-page-6.jpg']);
  });

  it('offers no ZIP for a single image', async () => {
    await loadPdf();
    chooseMode();
    fireEvent.input(screen.getByLabelText('Page numbers'), { target: { value: '4' } });
    fireEvent.click(convertButton());
    await screen.findByTestId('p2i-result', {}, SLOW);
    expect(screen.queryByRole('button', { name: /as zip/i })).toBeNull();
    expect(imageNames()).toEqual(['report-page-4.jpg']);
  });

  it('drops finished images when a setting changes, and frees their URLs', async () => {
    await loadPdf();
    fireEvent.click(convertButton());
    await screen.findByTestId('p2i-result', {}, SLOW);
    fireEvent.click(screen.getByRole('radio', { name: 'PNG' }));
    expect(screen.queryByTestId('p2i-result')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(6);
    expect(convertButton()).toBeEnabled();
  });

  it('says which page failed and keeps the form usable', async () => {
    openState.failPage = 2;
    await loadPdf();
    fireEvent.click(convertButton());
    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent(/Couldn’t convert page 3: the page is damaged/);
    expect(screen.queryByTestId('p2i-result')).toBeNull();
    expect(convertButton()).toBeEnabled();
  });

  it('Stop cancels a running conversion without showing partial results', async () => {
    await loadPdf();
    fireEvent.click(convertButton());
    fireEvent.click(await screen.findByRole('button', { name: /^stop$/i }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByTestId('p2i-result')).toBeNull();
    expect(convertButton()).toBeEnabled();
  });

  it('points a password-protected PDF at Unlock PDF', async () => {
    openState.failWith = 'No password given';
    render(<PdfToImage />);
    drop(pdfFile());
    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent(/Unlock PDF/);
    expect(convertButton()).toBeDisabled();
  });

  it('explains a PDF that cannot be opened', async () => {
    openState.failWith = 'Invalid PDF structure.';
    render(<PdfToImage />);
    drop(pdfFile());
    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent(/Couldn’t open this PDF: Invalid PDF structure/);
  });

  it('rejects a file that is not a PDF', () => {
    render(<PdfToImage />);
    drop(pdfFile('photo.png', 'image/png'));
    expect(screen.getByRole('alert')).toHaveTextContent(/isn't a PDF/);
    expect(convertButton()).toBeDisabled();
  });

  it('Load example generates a sample PDF', async () => {
    render(<PdfToImage />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect(await screen.findByText(/^6 pages · /, {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('product-brief.pdf')).toBeInTheDocument();
  });

  it('Clear removes the file, the images and the settings', async () => {
    await loadPdf();
    fireEvent.click(screen.getByRole('radio', { name: 'PNG' }));
    fireEvent.click(convertButton());
    await screen.findByTestId('p2i-result', {}, SLOW);
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByTestId('p2i-result')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });
});
