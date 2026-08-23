import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import QrCodeGenerator from './QrCodeGenerator';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<QrCodeGenerator />', () => {
  it('generates a QR preview for the default text on mount', async () => {
    render(<QrCodeGenerator />);
    await waitFor(() => {
      expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument();
    });
  });

  it('shows a visible error and clears the preview when the input is emptied', async () => {
    render(<QrCodeGenerator />);
    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/enter some text/i);
    expect(document.querySelector('.qr-preview__image svg')).not.toBeInTheDocument();
  });

  it('shows a visible error for text over the length cap', async () => {
    render(<QrCodeGenerator />);
    fireEvent.input(screen.getByLabelText(/text or url/i), { target: { value: 'a'.repeat(2000) } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/too long/i);
  });

  it('regenerates the preview when the error correction level changes', async () => {
    render(<QrCodeGenerator />);
    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());
    const before = document.querySelector('.qr-preview__image svg')!.getAttribute('viewBox');

    fireEvent.change(screen.getByLabelText(/error correction level/i), { target: { value: 'H' } });

    await waitFor(() => {
      const after = document.querySelector('.qr-preview__image svg')!.getAttribute('viewBox');
      expect(after).not.toBe(before);
    });
  });

  it('offers PNG and SVG download buttons once a code exists', async () => {
    render(<QrCodeGenerator />);
    expect(await screen.findByRole('button', { name: /download png/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download svg/i })).toBeInTheDocument();
  });

  it('does not offer "Copy image" when the Clipboard image API is unavailable', async () => {
    render(<QrCodeGenerator />);
    await screen.findByRole('button', { name: /download png/i });
    expect(screen.queryByRole('button', { name: /copy image/i })).not.toBeInTheDocument();
  });
});
