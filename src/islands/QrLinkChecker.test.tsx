import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import QrLinkChecker from './QrLinkChecker';

const { readImagePixels, decodeQrFromPixels } = vi.hoisted(() => ({
  readImagePixels: vi.fn(),
  decodeQrFromPixels: vi.fn(),
}));

vi.mock('./shared/imagePixels', () => ({ readImagePixels }));
vi.mock('../lib/tools/qrDecode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tools/qrDecode')>();
  return { ...actual, decodeQrFromPixels };
});

const typeInto = (element: HTMLElement, value: string) => fireEvent.input(element, { target: { value } });
const contents = () => screen.getByLabelText(/qr code contents/i);

const pickImage = (name = 'code.png') => {
  const input = screen.getByLabelText(/choose an image containing a qr code/i);
  const file = new File(['x'], name, { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  readImagePixels.mockReset();
  decodeQrFromPixels.mockReset();
  readImagePixels.mockResolvedValue({ ok: true, value: { data: new Uint8ClampedArray(4), width: 1, height: 1 } });
});

describe('<QrLinkChecker />', () => {
  it('shows nothing until there is content', () => {
    render(<QrLinkChecker />);
    expect(screen.queryByText(/what was checked/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a direct link when pasted text is a plain address', async () => {
    render(<QrLinkChecker />);
    typeInto(contents(), 'https://example.com/menu');
    expect(await screen.findByText('Goes directly to this address')).toBeInTheDocument();
    expect(screen.getByText('What was checked')).toBeInTheDocument();
  });

  it('flags a dynamic-QR service as a middleman', async () => {
    render(<QrLinkChecker />);
    typeInto(contents(), 'https://qrco.de/abc123');
    expect(await screen.findByText('Goes through a middleman first')).toBeInTheDocument();
    expect(screen.getByText(/dynamic qr service: qrco\.de/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /static qr code/i })).toHaveAttribute('href', '/qr-code-generator/');
  });

  it('flags a dangerous scheme', async () => {
    render(<QrLinkChecker />);
    typeInto(contents(), 'javascript:alert(1)');
    expect(await screen.findByText('Do not open this')).toBeInTheDocument();
  });

  it('compares against the address the visitor expected', async () => {
    render(<QrLinkChecker />);
    typeInto(contents(), 'https://qrco.de/abc123');
    typeInto(screen.getByLabelText(/address you expected/i), 'https://acme-bakery.com');
    expect(await screen.findByText(/does not match/i)).toBeInTheDocument();
  });

  it('shows an error for an expected address that is not a URL', async () => {
    render(<QrLinkChecker />);
    typeInto(contents(), 'https://example.com');
    typeInto(screen.getByLabelText(/address you expected/i), 'not a url');
    expect(await screen.findByText(/full url or a domain/i)).toBeInTheDocument();
  });

  it('fills the contents from a scanned image', async () => {
    decodeQrFromPixels.mockResolvedValue({ ok: true, value: 'https://bit.ly/3abc12' });
    render(<QrLinkChecker />);
    pickImage();
    await waitFor(() => expect(contents()).toHaveValue('https://bit.ly/3abc12'));
    expect(await screen.findByText('Goes through a middleman first')).toBeInTheDocument();
  });

  it('shows a preview of the loaded image and removes it with the file', async () => {
    decodeQrFromPixels.mockResolvedValue({ ok: true, value: 'https://example.com' });
    render(<QrLinkChecker />);
    expect(screen.queryByRole('img', { name: /uploaded qr code/i })).not.toBeInTheDocument();

    pickImage('poster.png');
    const preview = await screen.findByRole('img', { name: /uploaded qr code: poster\.png/i });
    expect(preview).toHaveAttribute('src', 'blob:preview');

    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    await waitFor(() => expect(screen.queryByRole('img', { name: /uploaded qr code/i })).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('shows a visible error when no QR code is found', async () => {
    decodeQrFromPixels.mockResolvedValue({ ok: false, error: 'No QR code was found in that image.' });
    render(<QrLinkChecker />);
    pickImage('blank.png');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/blank\.png/);
    expect(alert).toHaveTextContent(/no qr code was found/i);
    expect(contents()).toHaveValue('');
  });

  it('shows the error when the image cannot be opened', async () => {
    readImagePixels.mockResolvedValue({ ok: false, error: 'That file could not be opened as an image.' });
    render(<QrLinkChecker />);
    pickImage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be opened/i);
  });

  it('removes scanned contents when the image is removed', async () => {
    decodeQrFromPixels.mockResolvedValue({ ok: true, value: 'https://example.com' });
    render(<QrLinkChecker />);
    pickImage();
    await waitFor(() => expect(contents()).toHaveValue('https://example.com'));
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(contents()).toHaveValue('');
  });

  it('loads the example and clears it again', async () => {
    render(<QrLinkChecker />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect(contents()).toHaveValue('https://qrco.de/bgK4mP?utm_source=poster');
    expect(await screen.findByText(/does not match/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(contents()).toHaveValue('');
    expect(screen.queryByText('Goes through a middleman first')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });

  it('offers a copy button for the decoded contents, disabled when empty', async () => {
    render(<QrLinkChecker />);
    expect(screen.getByRole('button', { name: /copy contents/i })).toBeDisabled();
    typeInto(contents(), 'https://example.com/menu');
    await screen.findByText('What was checked');
    expect(screen.getByRole('button', { name: /copy contents/i })).toBeEnabled();
  });

  it('has a share link for ordinary links but hides it for Wi-Fi codes', async () => {
    render(<QrLinkChecker />);
    typeInto(contents(), 'https://example.com');
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();

    typeInto(contents(), 'WIFI:T:WPA;S:Cafe;P:hunter2;;');
    await screen.findByText(/joins a wi-fi network/i);
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });

  it('explains that the code is not a link', async () => {
    render(<QrLinkChecker />);
    typeInto(contents(), 'WIFI:T:WPA;S:Cafe;P:hunter2;;');
    expect(await screen.findByText('Not a web link')).toBeInTheDocument();
  });
});
