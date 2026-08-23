import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import ImageBase64Tool from './ImageBase64Tool';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const dropFile = (file: File) => {
  const dropzone = document.querySelector('.dropzone')!;
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
};

describe('<ImageBase64Tool />', () => {
  it('starts on Image → Base64 with no image chosen', () => {
    render(<ImageBase64Tool />);

    expect(screen.getByRole('button', { name: /image → base64/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/no image chosen yet/i)).toBeInTheDocument();
  });

  it('encodes a dropped image and shows a preview, base64 output, and paste-ready snippets', async () => {
    render(<ImageBase64Tool />);
    const file = new File([PNG_SIGNATURE], 'pixel.png', { type: 'image/png' });

    dropFile(file);

    const preview = await screen.findByAltText('pixel.png');
    expect(preview).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,'));
    expect(screen.getByText(/<img src="data:image\/png/)).toBeInTheDocument();
    expect(screen.getByText(/background-image: url/)).toBeInTheDocument();
  });

  it('shows a visible error for a non-image file instead of silently doing nothing', async () => {
    render(<ImageBase64Tool />);
    const file = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });

    dropFile(file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/not an image/i);
  });

  it('loads a working example when "Load example" is pressed in Base64 → Image', async () => {
    render(<ImageBase64Tool />);
    fireEvent.click(screen.getByRole('button', { name: /base64 → image/i }));

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    const preview = await screen.findByAltText('Decoded preview');
    expect(preview).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,'));
    expect(screen.getByText(/detected type: image\/png/i)).toBeInTheDocument();
  });

  it('decodes bare base64 pasted into Base64 → Image, sniffing the format', async () => {
    render(<ImageBase64Tool />);
    fireEvent.click(screen.getByRole('button', { name: /base64 → image/i }));

    fireEvent.input(screen.getByLabelText(/base64 or data url/i), { target: { value: bytesToBase64(PNG_SIGNATURE) } });

    const preview = await screen.findByAltText('Decoded preview');
    expect(preview).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,'));
    expect(screen.getByText(/detected type: image\/png/i)).toBeInTheDocument();
  });

  it('shows a visible error for malformed base64 instead of a blank preview', async () => {
    render(<ImageBase64Tool />);
    fireEvent.click(screen.getByRole('button', { name: /base64 → image/i }));

    fireEvent.input(screen.getByLabelText(/base64 or data url/i), { target: { value: 'not*valid*base64!!!' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('clears the chosen file and its output when Clear is pressed', async () => {
    render(<ImageBase64Tool />);
    const file = new File([PNG_SIGNATURE], 'pixel.png', { type: 'image/png' });
    dropFile(file);
    await screen.findByAltText('pixel.png');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByText(/no image chosen yet/i)).toBeInTheDocument();
  });
});
