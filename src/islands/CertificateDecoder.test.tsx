import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import CertificateDecoder from './CertificateDecoder';
import { EC_CSR_PEM, EC_LEAF_PEM, RSA_CA_PEM, RSA_LEAF_PEM, SHA1_PEM } from '../lib/tools/x509Fixtures';

// Inside every fixture's validity window (they start 2026-11-06). Only the clock is faked.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2027-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const input = () => screen.getByLabelText(/certificate or csr/i) as HTMLTextAreaElement;
const paste = (value: string) => fireEvent.input(input(), { target: { value } });

describe('<CertificateDecoder />', () => {
  it('shows only the empty input at first', () => {
    render(<CertificateDecoder />);
    expect(input()).toHaveValue('');
    expect(screen.queryByText(/no problems found/i)).not.toBeInTheDocument();
  });

  it('decodes a pasted certificate and shows the subject, issuer and key', async () => {
    render(<CertificateDecoder />);
    paste(EC_LEAF_PEM);

    expect(await screen.findByText(/example\.test — no problems found/i)).toBeInTheDocument();
    // Self-signed, so the subject and the issuer are the same text: one row each.
    expect(screen.getAllByText('C=US, ST=California, L=San Francisco, O=Example Inc, OU=Engineering, CN=example.test', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getByText('EC P-256 (prime256v1)', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('ecdsa-with-SHA256', { selector: 'dd' })).toBeInTheDocument();
  });

  it('lists the Subject Alternative Names with their types', async () => {
    render(<CertificateDecoder />);
    paste(EC_LEAF_PEM);

    await screen.findByText(/names \(san\)/i);
    expect(screen.getByText('*.example.test')).toBeInTheDocument();
    expect(screen.getByText('192.0.2.1')).toBeInTheDocument();
    expect(screen.getByText('admin@example.test')).toBeInTheDocument();
  });

  it('computes the SHA-256 fingerprint OpenSSL reports', async () => {
    render(<CertificateDecoder />);
    paste(EC_LEAF_PEM);

    expect(await screen.findByText(/^2E:2A:F1:24:E1:C3/)).toBeInTheDocument();
    expect(screen.getByText(/pin-sha256="az\/S9Z\/FP9SJQZy1J7k/)).toBeInTheDocument();
  });

  it('flags an expired certificate as a problem', async () => {
    vi.setSystemTime(Date.parse('2040-01-01T00:00:00Z'));
    render(<CertificateDecoder />);
    paste(EC_LEAF_PEM);

    expect(await screen.findByText(/example\.test — problems found/i)).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('flags a SHA-1 signature as a problem', async () => {
    render(<CertificateDecoder />);
    paste(SHA1_PEM);

    expect(await screen.findByText(/weak signature algorithm/i)).toBeInTheDocument();
  });

  it('decodes a certificate request without dates', async () => {
    render(<CertificateDecoder />);
    paste(EC_CSR_PEM);

    expect(await screen.findByText(/certificate request \(csr\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/valid until/i)).not.toBeInTheDocument();
  });

  it('shows every certificate in a pasted chain, with a chain check', async () => {
    render(<CertificateDecoder />);
    paste(`${RSA_LEAF_PEM}\n${RSA_CA_PEM}`);

    expect(await screen.findByText(/certificate 1 of 2: www\.example\.test/i)).toBeInTheDocument();
    expect(screen.getByText(/certificate 2 of 2: example root ca/i)).toBeInTheDocument();
    expect(screen.getByText(/chain of 2 links up by name/i)).toBeInTheDocument();
  });

  it('refuses a private key with a clear error and decodes nothing', async () => {
    render(<CertificateDecoder />);
    paste('-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49\n-----END PRIVATE KEY-----');

    expect(await screen.findByRole('alert')).toHaveTextContent(/private key.*do not paste/i);
    expect(screen.queryByText(/problems found|no problems found/i)).not.toBeInTheDocument();
  });

  it('shows a visible error for text that is not a certificate', async () => {
    render(<CertificateDecoder />);
    paste('this is not a certificate');

    expect(await screen.findByRole('alert')).toHaveTextContent(/no certificate found/i);
  });

  it('shows a visible error for a corrupted certificate', async () => {
    render(<CertificateDecoder />);
    paste('-----BEGIN CERTIFICATE-----\nMIIBAAAA\n-----END CERTIFICATE-----');

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid certificate|truncated|unexpectedly/i);
  });

  it('checks a hostname, including wildcards', async () => {
    render(<CertificateDecoder />);
    paste(EC_LEAF_PEM);
    await screen.findByText(/names \(san\)/i);

    fireEvent.input(screen.getByLabelText(/check a hostname/i), { target: { value: 'api.example.test' } });
    expect(await screen.findByText(/matches the wildcard \*\.example\.test/i)).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText(/check a hostname/i), { target: { value: 'other.test' } });
    expect(await screen.findByText(/^not covered/i)).toBeInTheDocument();
  });

  it('fills the example certificate and hostname', async () => {
    render(<CertificateDecoder />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(input().value).toContain('-----BEGIN CERTIFICATE-----');
    expect((screen.getByLabelText(/check a hostname/i) as HTMLInputElement).value).toBe('api.example.test');
    expect(await screen.findByText(/matches the wildcard/i)).toBeInTheDocument();
  });

  it('clears the input, hostname and results', async () => {
    render(<CertificateDecoder />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/no problems found/i);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(input()).toHaveValue('');
    expect((screen.getByLabelText(/check a hostname/i) as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/no problems found/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });

  it('copies a plain-text report', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<CertificateDecoder />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/^2E:2A:F1/);

    fireEvent.click(screen.getByRole('button', { name: /copy report/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/Certificate: example\.test/);
    expect(writeText.mock.calls[0][0]).toMatch(/SHA-256:\s+2E:2A:F1/);
  });

  it('disables Copy report until something is decoded', () => {
    render(<CertificateDecoder />);
    expect(screen.getByRole('button', { name: /copy report/i })).toBeDisabled();
  });

  it('offers a share link, since certificates are public data', () => {
    render(<CertificateDecoder />);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('explains how to get a certificate, collapsed and above the input', () => {
    render(<CertificateDecoder />);
    const help = screen.getByText(/how do i get a certificate/i).closest('details') as HTMLDetailsElement;

    expect(help.open).toBe(false);
    expect(help.compareDocumentPosition(input()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(help).getByRole('heading', { name: /chrome/i })).toBeInTheDocument();
    expect(within(help).getByRole('heading', { name: /firefox/i })).toBeInTheDocument();
    expect(within(help).getByRole('heading', { name: /openssl/i })).toBeInTheDocument();
    expect(within(help).getByText(/never paste a private key/i)).toBeInTheDocument();
  });

  it('lists the raw extensions in a collapsed section', async () => {
    render(<CertificateDecoder />);
    paste(RSA_LEAF_PEM);

    const summary = await screen.findByText(/all extensions \(/i);
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText('Authority Information Access')).toBeInTheDocument();
  });
});
