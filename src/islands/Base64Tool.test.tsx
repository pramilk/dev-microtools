import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import Base64Tool from './Base64Tool';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<Base64Tool />', () => {
  it('encodes text as it is typed', async () => {
    render(<Base64Tool />);
    typeInto(screen.getByLabelText(/plain text/i), 'foobar');

    expect(await screen.findByText('Zm9vYmFy')).toBeInTheDocument();
  });

  it('encodes multi-byte characters correctly', async () => {
    render(<Base64Tool />);
    typeInto(screen.getByLabelText(/plain text/i), '🎉');

    expect(await screen.findByText('8J+OiQ==')).toBeInTheDocument();
  });

  it('decodes when switched to decode mode', async () => {
    render(<Base64Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/base64/i), 'Zm9vYmFy');

    expect(await screen.findByText('foobar')).toBeInTheDocument();
  });

  it('shows an error for input outside the base64 alphabet', async () => {
    render(<Base64Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/base64/i), 'not valid!!');

    expect(await screen.findByRole('alert')).toHaveTextContent(/alphabet/i);
  });

  it('produces URL-safe output when the option is enabled', async () => {
    render(<Base64Tool />);
    // This input encodes to "fn5+Pz4+Pg==", which exercises both + and / substitution
    // as well as padding removal.
    typeInto(screen.getByLabelText(/plain text/i), '~~~?>>>');
    expect(await screen.findByText('fn5+Pz4+Pg==')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/url-safe/i));
    expect(await screen.findByText('fn5-Pz4-Pg')).toBeInTheDocument();
  });

  it('round-trips using the swap button', async () => {
    render(<Base64Tool />);
    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    await screen.findByText('aGVsbG8=');

    fireEvent.click(screen.getByRole('button', { name: /use result as input/i }));
    expect(await screen.findByText('hello')).toBeInTheDocument();
  });

  it('clears the input', async () => {
    render(<Base64Tool />);
    const input = screen.getByLabelText(/plain text/i) as HTMLTextAreaElement;
    typeInto(input, 'hello');
    await screen.findByText('aGVsbG8=');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(input.value).toBe('');
  });

  it('encodes an uploaded file as a data: URL once switched to File source', async () => {
    render(<Base64Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^file$/i }));

    const file = new File(['foobar'], 'test.txt', { type: 'text/plain' });
    const fileInput = screen.getByLabelText(/choose a file to encode/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText('data:text/plain;base64,Zm9vYmFy')).toBeInTheDocument();
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });

  it('drops the data: URL prefix when that option is unchecked', async () => {
    render(<Base64Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^file$/i }));

    const file = new File(['foobar'], 'test.txt', { type: 'text/plain' });
    const fileInput = screen.getByLabelText(/choose a file to encode/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByText('data:text/plain;base64,Zm9vYmFy');

    fireEvent.click(screen.getByLabelText(/data: url prefix/i));
    expect(await screen.findByText('Zm9vYmFy')).toBeInTheDocument();
  });

  it('shows an image preview for an image file', async () => {
    render(<Base64Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^file$/i }));

    const file = new File(['fakepixels'], 'photo.png', { type: 'image/png' });
    const fileInput = screen.getByLabelText(/choose a file to encode/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    const preview = (await screen.findByAltText('photo.png')) as HTMLImageElement;
    expect(preview.src).toContain('data:image/png;base64,');
  });

  it('shows an image preview when a data: image URL is pasted for decoding', async () => {
    render(<Base64Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/base64/i), 'data:image/png;base64,Zm9vYmFy');

    const preview = (await screen.findByAltText('Decoded preview')) as HTMLImageElement;
    expect(preview.src).toContain('data:image/png;base64,Zm9vYmFy');
  });
});

describe('<Base64Tool /> share link and download', () => {
  it('offers a download button once there is output', async () => {
    render(<Base64Tool />);
    expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();

    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    await screen.findByText('aGVsbG8=');
    expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled();
  });

  it('restores input and direction from a shared link on load', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({ input: 'foobar', direction: 'encode', urlSafe: false });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<Base64Tool />);

    expect(await screen.findByText('Zm9vYmFy')).toBeInTheDocument();
    window.location.hash = '';
  });
});
