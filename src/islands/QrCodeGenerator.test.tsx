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

  it('rejects a non-image file chosen as a logo instead of accepting it', async () => {
    render(<QrCodeGenerator />);
    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());

    fireEvent.click(screen.getByText(/customize appearance/i));
    const file = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/choose a logo image/i), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't look like an image/i);
    // Error correction stays untouched (not forced to High) since no logo was actually accepted.
    expect(screen.getByLabelText(/error correction level/i)).not.toBeDisabled();
  });

  it('shows a length counter for the email body that reflects the whole encoded payload, not just the field', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^email$/i }));

    fireEvent.input(screen.getByLabelText(/recipient email/i), { target: { value: 'a@b.com' } });
    fireEvent.input(screen.getByLabelText(/^body/i), { target: { value: 'hello world' } });

    // "mailto:a@b.com?body=hello%20world" is longer than the 11-character body alone.
    expect(screen.getByText(/^\d+\/1500$/)).toHaveTextContent(/^(?!11\/)\d+\/1500$/);
  });

  it('fills in the Google Maps link field when Load example is used in Location mode', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^location$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    expect(screen.getByLabelText(/google maps link/i)).toHaveValue('https://www.google.com/maps/place/@40.6892,-74.0445,17z');
    fireEvent.click(screen.getByText(/enter coordinates manually/i));
    expect(screen.getByLabelText(/latitude/i)).toHaveValue('40.6892');
    expect(screen.getByLabelText(/longitude/i)).toHaveValue('-74.0445');
    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());
  });

  it('shows a length counter for the SMS message that reflects the whole encoded payload', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^sms$/i }));

    fireEvent.input(screen.getByLabelText(/phone number/i), { target: { value: '+15550100' } });
    fireEvent.input(screen.getByLabelText(/^message/i), { target: { value: 'hi' } });

    // "SMSTO:+15550100:hi" — prefix + phone number add well over the 2-character message.
    expect(screen.getByText('18/1500')).toBeInTheDocument();
  });

  it('switches to Payment mode and generates a PayPal.me code once a recipient is entered', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^payment$/i }));

    expect(document.querySelector('.qr-preview__image svg')).not.toBeInTheDocument();

    fireEvent.input(screen.getByLabelText(/paypal\.me username/i), { target: { value: 'yourname' } });

    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());
  });

  it('shows Venmo-specific fields and a note field when Venmo is selected', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^payment$/i }));

    fireEvent.change(screen.getByLabelText(/^provider$/i), { target: { value: 'venmo' } });

    expect(screen.getByLabelText(/venmo username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/note \(optional\)/i)).toBeInTheDocument();
  });

  it('hides the note field for PayPal, which has no note parameter', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^payment$/i }));

    expect(screen.queryByLabelText(/note \(optional\)/i)).not.toBeInTheDocument();
  });

  it('points Stripe/Square/Zelle link owners to Text/URL mode instead of offering them as providers', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^payment$/i }));

    expect(screen.getByText(/stripe or square checkout link/i)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /zelle/i })).not.toBeInTheDocument();
  });

  it('fills in a sample PayPal payment when Load example is used in Payment mode', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^payment$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    expect(screen.getByLabelText(/paypal\.me username/i)).toHaveValue('yourname');
    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());
  });

  it('bakes an optional label into the downloaded image, growing the SVG height', async () => {
    render(<QrCodeGenerator />);
    await waitFor(() => expect(document.querySelector('.qr-preview__image svg')).toBeInTheDocument());
    const before = document.querySelector('.qr-preview__image svg')!.getAttribute('viewBox');

    fireEvent.click(screen.getByText(/customize appearance/i));
    fireEvent.input(screen.getByLabelText(/label below code/i), { target: { value: 'Pay with PayPal' } });

    await waitFor(() => {
      const svg = document.querySelector('.qr-preview__image svg')!;
      expect(svg.getAttribute('viewBox')).not.toBe(before);
      expect(svg.innerHTML).toContain('Pay with PayPal');
    });
  });

  it('suggests a provider-specific placeholder for the label in Payment mode', async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^payment$/i }));
    fireEvent.click(screen.getByText(/customize appearance/i));

    expect(screen.getByPlaceholderText('Pay with PayPal')).toBeInTheDocument();
  });
});
