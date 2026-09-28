import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import RsaEncryptDecrypt from './RsaEncryptDecrypt';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

// RSA key generation takes a moment, especially under jsdom.
const CRYPTO_TIMEOUT = 20000;

const outputText = () => document.querySelector('pre.output')?.textContent ?? '';

/** The primary button, e.g. "Encrypt (RSA-OAEP, SHA-256)" — not the bare direction toggle. */
const actionButton = () => screen.getByRole('button', { name: /^(en|de)crypt \(rsa-/i });

const keyBox = () => screen.getByLabelText(/(public|private) key/i, { selector: 'textarea' }) as HTMLTextAreaElement;

describe('<RsaEncryptDecrypt />', () => {
  it('shows an empty state and disables Encrypt until text and a key are entered', () => {
    render(<RsaEncryptDecrypt />);
    expect(screen.getByText(/ciphertext appears here/i)).toBeInTheDocument();
    expect(actionButton()).toBeDisabled();
    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    expect(actionButton()).toBeDisabled();
    typeInto(keyBox(), '-----BEGIN PUBLIC KEY-----');
    expect(actionButton()).not.toBeDisabled();
  });

  it('decrypts the sample ciphertext with the sample private key', async () => {
    render(<RsaEncryptDecrypt />);
    fireEvent.click(screen.getByRole('button', { name: /^decrypt$/i }));
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect(keyBox().value).toMatch(/BEGIN PRIVATE KEY/);
    expect(screen.getByText(/published demo key pair/i)).toBeInTheDocument();
    fireEvent.click(actionButton());
    await waitFor(() => expect(outputText()).toBe('The deploy key rotates on Friday at 09:00 UTC.'));
  });

  it('encrypts the example, then round-trips it through Decrypt', async () => {
    render(<RsaEncryptDecrypt />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect(keyBox().value).toMatch(/BEGIN PUBLIC KEY/);
    expect(await screen.findByText(/RSA 2048-bit public key \(SPKI PEM\)/)).toBeInTheDocument();
    fireEvent.click(actionButton());
    await waitFor(() => expect(outputText()).toMatch(/^[A-Za-z0-9+/]{342}==$/));

    fireEvent.click(screen.getByRole('button', { name: /decrypt result/i }));
    expect(keyBox().value).toMatch(/BEGIN PRIVATE KEY/);
    fireEvent.click(actionButton());
    await waitFor(() => expect(outputText()).toBe('The deploy key rotates on Friday at 09:00 UTC.'));
  });

  it(
    'generates a key pair that fills both keys and round-trips Unicode with the Hybrid scheme',
    async () => {
      render(<RsaEncryptDecrypt />);
      fireEvent.click(screen.getByRole('button', { name: /generate key pair/i }));
      expect(await screen.findByText(/new 2048-bit key pair/i, {}, { timeout: CRYPTO_TIMEOUT })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /copy private key/i })).toBeInTheDocument();
      expect(keyBox().value).toMatch(/BEGIN PUBLIC KEY/);

      fireEvent.change(screen.getByLabelText(/^scheme$/i), { target: { value: 'hybrid' } });
      const text = 'héllo 🔐 '.repeat(100);
      typeInto(screen.getByLabelText(/plain text/i), text);
      expect(actionButton()).toHaveTextContent('AES-256-GCM');
      fireEvent.click(actionButton());
      await waitFor(() => expect(outputText()).toMatch(/^[A-Za-z0-9+/]+=*$/), { timeout: CRYPTO_TIMEOUT });

      fireEvent.click(screen.getByRole('button', { name: /decrypt result/i }));
      fireEvent.click(actionButton());
      await waitFor(() => expect(outputText()).toBe(text), { timeout: CRYPTO_TIMEOUT });
    },
    CRYPTO_TIMEOUT
  );

  it('shows a visible error when text exceeds the RSA-OAEP limit', async () => {
    render(<RsaEncryptDecrypt />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    typeInto(screen.getByLabelText(/plain text/i), 'x'.repeat(191));
    expect(await screen.findByText(/over the 190-byte RSA-OAEP limit/i)).toBeInTheDocument();
    fireEvent.click(actionButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 190 bytes/i);
  });

  it('shows a visible error for an unrecognised key and for a public key in Decrypt mode', async () => {
    render(<RsaEncryptDecrypt />);
    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    typeInto(keyBox(), 'ssh-rsa AAAAB3Nza user@host');
    expect(await screen.findByText(/ssh-keygen -e/)).toBeInTheDocument();
    fireEvent.click(actionButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/OpenSSH public key/);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    const samplePublicKey = keyBox().value;
    fireEvent.click(screen.getByRole('button', { name: /^decrypt$/i }));
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    typeInto(keyBox(), samplePublicKey);
    fireEvent.click(actionButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/needs the matching private key/);
  });

  it('shows a visible error for malformed ciphertext', async () => {
    render(<RsaEncryptDecrypt />);
    fireEvent.click(screen.getByRole('button', { name: /^decrypt$/i }));
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    typeInto(screen.getByLabelText(/^ciphertext/i), 'not base64 !!');
    fireEvent.click(actionButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid base64/i);
  });

  it('keeps the public and private key separately when switching direction', () => {
    render(<RsaEncryptDecrypt />);
    typeInto(keyBox(), 'public one');
    fireEvent.click(screen.getByRole('button', { name: /^decrypt$/i }));
    expect(keyBox().value).toBe('');
    typeInto(keyBox(), 'private one');
    fireEvent.click(screen.getByRole('button', { name: /^encrypt$/i }));
    expect(keyBox().value).toBe('public one');
  });

  it('clears the text and both keys, and clears stale output when an input changes', async () => {
    render(<RsaEncryptDecrypt />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    fireEvent.click(actionButton());
    await waitFor(() => expect(outputText()).not.toMatch(/appears here/i));

    typeInto(screen.getByLabelText(/plain text/i), 'changed');
    expect(outputText()).toMatch(/appears here/i);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect((screen.getByLabelText(/plain text/i) as HTMLTextAreaElement).value).toBe('');
    expect(keyBox().value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /^decrypt$/i }));
    expect(keyBox().value).toBe('');
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });

  it('has copy and share controls', () => {
    render(<RsaEncryptDecrypt />);
    expect(screen.getAllByRole('button', { name: /copy/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });
});
