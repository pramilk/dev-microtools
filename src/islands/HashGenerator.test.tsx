import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { createFakeWorkerClass } from '../../test/fakeWorker';
import { handleHashRequest } from '../workers/hash.worker';
import HashGenerator from './HashGenerator';

// jsdom has no real Worker; this runs the same request-handling logic the real
// hash.worker.ts uses, synchronously, so the test still exercises real hashing.
vi.mock('../workers/hash.worker?worker', () => ({
  default: createFakeWorkerClass(handleHashRequest),
}));

const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const MD5_ABC = '900150983cd24fb0d6963f7d28e17f72';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<HashGenerator />', () => {
  it('shows no digests before any input', () => {
    render(<HashGenerator />);
    expect(screen.queryByText('SHA-256')).not.toBeInTheDocument();
  });

  it('computes the correct SHA-256 digest', async () => {
    render(<HashGenerator />);
    typeInto(screen.getByLabelText(/text to hash/i), 'abc');

    expect(await screen.findByText(SHA256_ABC)).toBeInTheDocument();
  });

  it('computes MD5 via the dynamically imported library', async () => {
    render(<HashGenerator />);
    typeInto(screen.getByLabelText(/text to hash/i), 'abc');

    expect(await screen.findByText(MD5_ABC)).toBeInTheDocument();
  });

  it('labels the broken algorithms as insecure', async () => {
    render(<HashGenerator />);
    typeInto(screen.getByLabelText(/text to hash/i), 'abc');

    await screen.findByText(SHA256_ABC);
    expect(screen.getAllByText('insecure')).toHaveLength(2);
  });

  it('confirms a matching checksum and names the algorithm', async () => {
    render(<HashGenerator />);
    typeInto(screen.getByLabelText(/text to hash/i), 'abc');
    await screen.findByText(SHA256_ABC);

    typeInto(screen.getByLabelText(/compare against/i), SHA256_ABC);
    expect(await screen.findByText(/match — this is the SHA-256 digest/i)).toBeInTheDocument();
  });

  it('reports when a checksum matches nothing', async () => {
    render(<HashGenerator />);
    typeInto(screen.getByLabelText(/text to hash/i), 'abc');
    await screen.findByText(SHA256_ABC);

    typeInto(screen.getByLabelText(/compare against/i), 'deadbeef');
    expect(await screen.findByText(/no match against any algorithm/i)).toBeInTheDocument();
  });

  it('clears the digests when the input is cleared', async () => {
    render(<HashGenerator />);
    typeInto(screen.getByLabelText(/text to hash/i), 'abc');
    await screen.findByText(SHA256_ABC);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.queryByText(SHA256_ABC)).not.toBeInTheDocument();
  });

  it('hashes an uploaded file after switching to File mode', async () => {
    render(<HashGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^file$/i }));

    const file = new File(['abc'], 'abc.txt', { type: 'text/plain' });
    const fileInput = screen.getByLabelText(/choose a file to hash/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText(SHA256_ABC)).toBeInTheDocument();
    expect(screen.getByText('abc.txt')).toBeInTheDocument();
  });

  it('computes a different digest once HMAC is enabled with a key', async () => {
    render(<HashGenerator />);
    typeInto(screen.getByLabelText(/text to hash/i), 'abc');
    await screen.findByText(SHA256_ABC);

    fireEvent.click(screen.getByLabelText(/use hmac/i));
    typeInto(screen.getByLabelText(/hmac secret key/i), 'secret');

    await waitFor(() => {
      expect(screen.queryByText(SHA256_ABC)).not.toBeInTheDocument();
    });
    expect(screen.getByText('SHA-256')).toBeInTheDocument();
  });

  it('asks for a key before computing an HMAC', async () => {
    render(<HashGenerator />);
    typeInto(screen.getByLabelText(/text to hash/i), 'abc');
    await screen.findByText(SHA256_ABC);

    fireEvent.click(screen.getByLabelText(/use hmac/i));
    expect(await screen.findByRole('alert')).toHaveTextContent(/secret key/i);
  });
});

describe('<HashGenerator /> share link and download', () => {
  it('offers a download button for the digest list once there is one', async () => {
    render(<HashGenerator />);
    typeInto(screen.getByLabelText(/text to hash/i), 'abc');

    expect(await screen.findByRole('button', { name: /download/i })).not.toBeDisabled();
  });

  it('restores the text input from a shared link, never the HMAC key', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({ input: 'abc' });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<HashGenerator />);

    expect(await screen.findByText(SHA256_ABC)).toBeInTheDocument();
    expect(screen.queryByLabelText(/hmac secret key/i)).not.toBeInTheDocument();
    window.location.hash = '';
  });
});
