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

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

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

  it('switches to Wi-Fi mode and generates a code once an SSID is entered', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^wi-fi$/i }));

    // No SSID yet — same "enter something" state as any other empty content type.
    expect(document.querySelector('.qr-preview__image svg')).not.toBeInTheDocument();

    fireEvent.input(screen.getByLabelText(/network name/i), { target: { value: 'MyHomeNetwork' } });

    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());
  });

  it('shows an error for an incomplete location before both coordinates are filled in', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^location$/i }));
    fireEvent.click(screen.getByText(/enter coordinates manually/i));

    fireEvent.input(screen.getByLabelText(/latitude/i), { target: { value: '40.6892' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/latitude and longitude/i);
  });

  it('fills in coordinates automatically as a Google Maps link is pasted', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^location$/i }));

    fireEvent.input(screen.getByLabelText(/google maps link/i), {
      target: { value: 'https://www.google.com/maps/place/@40.6892,-74.0445,17z' },
    });

    fireEvent.click(screen.getByText(/enter coordinates manually/i));
    expect(screen.getByLabelText(/latitude/i)).toHaveValue('40.6892');
    expect(screen.getByLabelText(/longitude/i)).toHaveValue('-74.0445');
    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());
  });

  it('stays silent while a link is still being typed, and only errors once the field is left', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^location$/i }));

    const link = screen.getByLabelText(/google maps link/i);
    fireEvent.input(link, { target: { value: 'https://maps.app.goo.gl/AbCdEf' } });
    expect(screen.queryByText(/couldn't find coordinates/i)).not.toBeInTheDocument();

    fireEvent.blur(link);
    expect(await screen.findByText(/couldn't find coordinates/i)).toBeInTheDocument();
  });

  it('locks error correction to High once a logo preset is chosen', async () => {
    render(<QrCodeGenerator />);
    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());

    fireEvent.click(screen.getByText(/customize appearance/i));
    fireEvent.click(screen.getByTitle(/use the email icon as the logo/i));

    await waitFor(() => {
      expect(screen.getByLabelText(/error correction level/i)).toHaveValue('H');
    });
    expect(screen.getByLabelText(/error correction level/i)).toBeDisabled();
    expect(document.querySelector('.qr-preview__image svg image')).toBeInTheDocument();
  });

  it('locks error correction to High once a logo file is uploaded', async () => {
    render(<QrCodeGenerator />);
    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());

    fireEvent.click(screen.getByText(/customize appearance/i));
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/choose a logo image/i), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByLabelText(/error correction level/i)).toHaveValue('H');
    });
    expect(screen.getByLabelText(/error correction level/i)).toBeDisabled();
  });
});
