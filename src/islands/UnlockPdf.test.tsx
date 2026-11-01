import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import UnlockPdf from './UnlockPdf';
import { fixture, FIXTURE_OWNER_PASSWORD, FIXTURE_USER_PASSWORD } from '../lib/tools/pdfUnlockFixtures';

// jsdom has no Worker. The mocked worker runs the real request handler, so the real pdf-lib
// and cipher code runs end to end.
vi.mock('../workers/pdfUnlock.worker?worker', async () => {
  const { createFakeWorkerClass } = await import('../../test/fakeWorker');
  const { handlePdfUnlockRequest } = await import('../workers/pdfUnlock.worker');
  return { default: createFakeWorkerClass(handlePdfUnlockRequest) };
});

const pdfFile = (bytes: Uint8Array | string, name = 'report.pdf', type = 'application/pdf') =>
  new File([typeof bytes === 'string' ? bytes : (bytes as Uint8Array<ArrayBuffer>)], name, { type });

function drop(file: File) {
  const dropzone = screen.getByText(/drag a file here/i).closest('.dropzone');
  if (!dropzone) throw new Error('dropzone not found');
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
}

const typePassword = (value: string) => fireEvent.input(screen.getByLabelText('Password'), { target: { value } });

/** Drops a restricted, password-protected fixture and waits for the tool to describe it. */
async function loadLockedFixture(name: Parameters<typeof fixture>[0] = 'aes-256-objstm') {
  render(<UnlockPdf />);
  drop(pdfFile(fixture(name), 'locked.pdf'));
  await screen.findByText(/Encryption:/, {}, { timeout: 10_000 });
}

beforeEach(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake-${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnlockPdf', () => {
  it('renders the controls and a disabled Unlock button', () => {
    render(<UnlockPdf />);
    expect(screen.getByLabelText(/choose a pdf to unlock/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load example/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /unlock pdf/i })).toBeDisabled();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('has no share link, since the input is a password', () => {
    render(<UnlockPdf />);
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull();
  });

  it('describes the encryption, that a password is needed, and the restrictions', async () => {
    await loadLockedFixture();
    expect(screen.getByText('AES-256')).toBeInTheDocument();
    expect(screen.getByText(/needs a password to open/i)).toBeInTheDocument();
    expect(screen.getByText(/Restricts: .*Copying text and images/)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('unlocks with the permissions password and offers a download', async () => {
    await loadLockedFixture();
    typePassword(FIXTURE_OWNER_PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: /unlock pdf/i }));

    const download = await screen.findByRole('button', { name: /download locked-unlocked\.pdf/i }, { timeout: 10_000 });
    expect(screen.getByText(/Unlocked · 3 pages/)).toBeInTheDocument();
    expect(screen.getByText(/opened with the permissions password/i)).toBeInTheDocument();
    expect(screen.getByText(/Restrictions removed: .*Copying text and images/)).toBeInTheDocument();

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(download);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('previews the unlocked document below the result, and drops the preview when the password changes', async () => {
    await loadLockedFixture();
    typePassword(FIXTURE_OWNER_PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: /unlock pdf/i }));
    const preview = await screen.findByTitle('Unlocked PDF preview', {}, { timeout: 10_000 });
    expect(preview.tagName).toBe('IFRAME');
    expect(preview.getAttribute('src')).toMatch(/^blob:.*#view=FitH$/);
    expect(screen.getByRole('link', { name: /open in new tab/i })).toHaveAttribute('target', '_blank');

    typePassword('something else');
    expect(screen.queryByTitle('Unlocked PDF preview')).toBeNull();
  });

  it('asks to confirm removing restrictions when only the open password is given', async () => {
    await loadLockedFixture();
    typePassword(FIXTURE_USER_PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: /unlock pdf/i }));
    expect(await screen.findByRole('alert', {}, { timeout: 10_000 })).toHaveTextContent(/I own this document/);

    fireEvent.click(screen.getByRole('checkbox', { name: /i own this document/i }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /unlock pdf/i }));
    await screen.findByTestId('pdf-result', {}, { timeout: 10_000 });
    expect(screen.getByText(/opened with the open password/i)).toBeInTheDocument();
  });

  it('says so when the password is wrong, and keeps the form usable', async () => {
    await loadLockedFixture();
    typePassword('not-it');
    fireEvent.click(screen.getByRole('button', { name: /unlock pdf/i }));
    expect(await screen.findByRole('alert', {}, { timeout: 10_000 })).toHaveTextContent(/doesn’t open this PDF/);
    expect(screen.getByRole('button', { name: /unlock pdf/i })).toBeEnabled();
    expect(screen.queryByTestId('pdf-result')).toBeNull();
  });

  it('asks for a password when none is typed', async () => {
    await loadLockedFixture();
    fireEvent.click(screen.getByRole('button', { name: /unlock pdf/i }));
    expect(await screen.findByRole('alert', {}, { timeout: 10_000 })).toHaveTextContent(/needs a password/);
  });

  it('opens a restrictions-only file with no password once the removal is confirmed', async () => {
    await loadLockedFixture('aes-256-restricted-only-objstm');
    expect(screen.getByText(/opens without a password/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /i own this document/i }));
    fireEvent.click(screen.getByRole('button', { name: /unlock pdf/i }));
    await screen.findByTestId('pdf-result', {}, { timeout: 10_000 });
    expect(screen.getByText(/opened without a password/i)).toBeInTheDocument();
  });

  it('discards a finished result when the password changes', async () => {
    await loadLockedFixture();
    typePassword(FIXTURE_OWNER_PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: /unlock pdf/i }));
    await screen.findByTestId('pdf-result', {}, { timeout: 10_000 });
    typePassword('something else');
    expect(screen.queryByTestId('pdf-result')).toBeNull();
    expect(screen.getByRole('button', { name: /unlock pdf/i })).toBeEnabled();
  });

  it('Show reveals the password', async () => {
    await loadLockedFixture();
    fireEvent.click(screen.getByRole('checkbox', { name: /show/i }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });

  it('tells the visitor when a PDF is not protected', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage();
    render(<UnlockPdf />);
    drop(pdfFile(await doc.save(), 'plain.pdf'));
    expect(await screen.findByText(/isn’t password-protected/, {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlock pdf/i })).toBeDisabled();
  });

  it('fills in the example PDF and its password, and unlocks it', async () => {
    render(<UnlockPdf />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect(await screen.findByText(/Encryption:/, {}, { timeout: 10_000 })).toBeInTheDocument();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('Sample-Pass-42');
    fireEvent.click(screen.getByRole('button', { name: /unlock pdf/i }));
    await screen.findByRole('button', { name: /download quarterly-report-protected-unlocked\.pdf/i }, { timeout: 10_000 });
    expect(screen.getByText(/The file had no permission restrictions/)).toBeInTheDocument();
  });

  it('shows a helpful error for a file that is not a PDF', async () => {
    render(<UnlockPdf />);
    drop(pdfFile('hello', 'photo.png', 'image/png'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a PDF/);
  });

  it('shows a helpful error for a .pdf whose contents are not a PDF', async () => {
    render(<UnlockPdf />);
    drop(pdfFile('just some text renamed to pdf'));
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/doesn’t start with a PDF header/);
    expect(screen.getByRole('button', { name: /unlock pdf/i })).toBeDisabled();
  });

  it('Clear removes the file, result and password', async () => {
    render(<UnlockPdf />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/Encryption:/, {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByText(/Encryption:/)).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });
});
