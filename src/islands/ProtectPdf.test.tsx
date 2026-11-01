import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import ProtectPdf from './ProtectPdf';

// jsdom has no Worker. The mocked worker runs the real request handler, so the real pdf-lib
// and cipher code runs end to end.
vi.mock('../workers/pdfProtect.worker?worker', async () => {
  const { createFakeWorkerClass } = await import('../../test/fakeWorker');
  const { handlePdfProtectRequest } = await import('../workers/pdfProtect.worker');
  return { default: createFakeWorkerClass(handlePdfProtectRequest) };
});

const pdfFile = (bytes: Uint8Array | string, name = 'report.pdf', type = 'application/pdf') =>
  new File([typeof bytes === 'string' ? bytes : (bytes as Uint8Array<ArrayBuffer>)], name, { type });

function drop(file: File) {
  const dropzone = screen.getByText(/drag a file here/i).closest('.dropzone');
  if (!dropzone) throw new Error('dropzone not found');
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
}

async function onePagePdf(): Promise<File> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage();
  return pdfFile(await doc.save(), 'plain.pdf');
}

const type = (label: RegExp | string, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });

async function loadPlainPdf() {
  render(<ProtectPdf />);
  drop(await onePagePdf());
  await screen.findByText(/1 page ·/);
}

beforeEach(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake-${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProtectPdf', () => {
  it('renders the controls, a dropzone and a disabled Protect button', () => {
    render(<ProtectPdf />);
    expect(screen.getByLabelText(/choose a pdf to protect/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Open password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/permissions password/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Encryption')).toHaveValue('aes256');
    expect(screen.getByRole('button', { name: /load example/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /protect pdf/i })).toBeDisabled();
  });

  it('has no share link, since the input is a password', () => {
    render(<ProtectPdf />);
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull();
  });

  it('reads a chosen PDF and shows its page count', async () => {
    await loadPlainPdf();
    expect(screen.getByText(/1 page ·/)).toBeInTheDocument();
  });

  it('keeps Protect disabled until there is a password or a restriction', async () => {
    await loadPlainPdf();
    const button = screen.getByRole('button', { name: /protect pdf/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/enter an open password, or restrict/i)).toBeInTheDocument();

    type('Open password', 'correct horse battery');
    expect(button).toBeEnabled();
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it('protects the PDF and offers a download', async () => {
    await loadPlainPdf();
    type('Open password', 'correct horse battery');
    fireEvent.click(screen.getByRole('button', { name: /protect pdf/i }));

    const download = await screen.findByRole('button', { name: /download plain-protected\.pdf/i }, { timeout: 10_000 });
    expect(screen.getByText(/Protected with AES-256 · 1 page/)).toBeInTheDocument();
    expect(screen.getByText(/asks for the open password/i)).toBeInTheDocument();
    expect(screen.getByText(/no permissions are restricted/i)).toBeInTheDocument();

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(download);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('lists the restrictions and warns that a generated permissions password is thrown away', async () => {
    await loadPlainPdf();
    fireEvent.click(screen.getByRole('checkbox', { name: /allow copying/i }));
    fireEvent.change(screen.getByLabelText('Printing'), { target: { value: 'none' } });
    fireEvent.click(screen.getByRole('button', { name: /protect pdf/i }));
    await screen.findByTestId('pdf-result', {}, { timeout: 10_000 });
    expect(screen.getByText(/opens without a password/i)).toBeInTheDocument();
    expect(screen.getByText(/Restricted: Printing, Copying text and images/)).toBeInTheDocument();
    expect(screen.getByText(/can’t be lifted later/)).toBeInTheDocument();
  });

  it('shows why an equal permissions password is refused', async () => {
    await loadPlainPdf();
    type('Open password', 'same-password-123');
    type(/permissions password/i, 'same-password-123');
    fireEvent.click(screen.getByRole('checkbox', { name: /allow editing/i }));
    expect(screen.getByText(/anyone who opens the file has full rights/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /protect pdf/i })).toBeDisabled();
  });

  it('explains the AES-128 character limit', async () => {
    await loadPlainPdf();
    fireEvent.change(screen.getByLabelText('Encryption'), { target: { value: 'aes128' } });
    type('Open password', 'pass✓word');
    expect(screen.getByText(/open password has characters AES-128 can't store/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /protect pdf/i })).toBeDisabled();
  });

  it('discards a finished result when a setting changes', async () => {
    await loadPlainPdf();
    type('Open password', 'correct horse battery');
    fireEvent.click(screen.getByRole('button', { name: /protect pdf/i }));
    await screen.findByTestId('pdf-result', {}, { timeout: 10_000 });
    type('Open password', 'a different password 1');
    expect(screen.queryByTestId('pdf-result')).toBeNull();
    expect(screen.getByRole('button', { name: /protect pdf/i })).toBeEnabled();
  });

  it('Show reveals the passwords, and Generate fills a strong one', () => {
    render(<ProtectPdf />);
    fireEvent.click(screen.getAllByRole('checkbox', { name: /show/i })[0] as HTMLInputElement);
    expect(screen.getByLabelText('Open password')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    expect((screen.getByLabelText('Open password') as HTMLInputElement).value).toHaveLength(20);
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it('fills in the example PDF, password and restrictions', async () => {
    render(<ProtectPdf />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect(await screen.findByText(/3 pages ·/, {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText(/quarterly-report\.pdf/)).toBeInTheDocument();
    expect((screen.getByLabelText('Open password') as HTMLInputElement).value).toBe('Sample-Pass-42');
    expect(screen.getByRole('checkbox', { name: /allow copying/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /allow editing/i })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /protect pdf/i }));
    await screen.findByRole('button', { name: /download quarterly-report-protected\.pdf/i }, { timeout: 10_000 });
    expect(screen.getByText(/Restricted: Copying text and images, Editing content/)).toBeInTheDocument();
  });

  it('warns about a digitally signed PDF', async () => {
    const { PDFDocument, PDFName, PDFString } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage();
    const sig = doc.context.register(doc.context.obj({ FT: 'Sig', T: PDFString.of('Signature1'), V: doc.context.obj({ Type: 'Sig' }) }));
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [sig], SigFlags: 3 }));
    render(<ProtectPdf />);
    drop(pdfFile(await doc.save(), 'signed.pdf'));
    expect(await screen.findByText(/digitally signed/i)).toBeInTheDocument();
  });

  it('shows a helpful error for a file that is not a PDF', async () => {
    render(<ProtectPdf />);
    drop(pdfFile('hello', 'photo.png', 'image/png'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a PDF/);
  });

  it('shows a helpful error for a .pdf whose contents are not a PDF, and keeps Protect disabled', async () => {
    render(<ProtectPdf />);
    drop(pdfFile('just some text renamed to pdf'));
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/doesn’t start with a PDF header/);
    expect(screen.getByRole('button', { name: /protect pdf/i })).toBeDisabled();
  });

  it('refuses an already-protected PDF with a clear message', async () => {
    await loadPlainPdf();
    type('Open password', 'correct horse battery');
    fireEvent.click(screen.getByRole('button', { name: /protect pdf/i }));
    await screen.findByTestId('pdf-result', {}, { timeout: 10_000 });
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    drop(pdfFile(bytes, 'locked.pdf'));
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/already password-protected/);
  });

  it('Clear removes the file, result, passwords and settings', async () => {
    render(<ProtectPdf />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/3 pages ·/, {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByText(/quarterly-report\.pdf/)).toBeNull();
    expect((screen.getByLabelText('Open password') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('checkbox', { name: /allow copying/i })).toBeChecked();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });
});
