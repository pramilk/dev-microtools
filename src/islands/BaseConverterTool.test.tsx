import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import BaseConverterTool from './BaseConverterTool';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

const selectFormat = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('<BaseConverterTool /> base64 (default format)', () => {
  it('encodes text as it is typed', async () => {
    render(<BaseConverterTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'foobar');

    expect(await screen.findByText('Zm9vYmFy')).toBeInTheDocument();
  });

  it('encodes multi-byte characters correctly', async () => {
    render(<BaseConverterTool />);
    typeInto(screen.getByLabelText(/plain text/i), '🎉');

    expect(await screen.findByText('8J+OiQ==')).toBeInTheDocument();
  });

  it('decodes when switched to decode mode', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^decode$/i);
    typeInto(screen.getByLabelText(/base64/i), 'Zm9vYmFy');

    expect(await screen.findByText('foobar')).toBeInTheDocument();
  });

  it('shows an error for input outside the base64 alphabet', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^decode$/i);
    typeInto(screen.getByLabelText(/base64/i), 'not valid!!');

    expect(await screen.findByRole('alert')).toHaveTextContent(/alphabet/i);
  });

  it('produces URL-safe output when the option is enabled', async () => {
    render(<BaseConverterTool />);
    typeInto(screen.getByLabelText(/plain text/i), '~~~?>>>');
    expect(await screen.findByText('fn5+Pz4+Pg==')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/url-safe/i));
    expect(await screen.findByText('fn5-Pz4-Pg')).toBeInTheDocument();
  });

  it('round-trips using the swap button', async () => {
    render(<BaseConverterTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    await screen.findByText('aGVsbG8=');

    fireEvent.click(screen.getByRole('button', { name: /use result as input/i }));
    expect(await screen.findByText('hello')).toBeInTheDocument();
  });

  it('clears the input', async () => {
    render(<BaseConverterTool />);
    const input = screen.getByLabelText(/plain text/i) as HTMLTextAreaElement;
    typeInto(input, 'hello');
    await screen.findByText('aGVsbG8=');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(input.value).toBe('');
  });

  it('encodes an uploaded file as a data: URL once switched to File source', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^file$/i);

    const file = new File(['foobar'], 'test.txt', { type: 'text/plain' });
    const fileInput = screen.getByLabelText(/choose a file to encode/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText('data:text/plain;base64,Zm9vYmFy')).toBeInTheDocument();
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });

  it('drops the data: URL prefix when that option is unchecked', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^file$/i);

    const file = new File(['foobar'], 'test.txt', { type: 'text/plain' });
    const fileInput = screen.getByLabelText(/choose a file to encode/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByText('data:text/plain;base64,Zm9vYmFy');

    fireEvent.click(screen.getByLabelText(/data: url prefix/i));
    expect(await screen.findByText('Zm9vYmFy')).toBeInTheDocument();
  });

  it('shows an image preview when a data: image URL is pasted for decoding', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^decode$/i);
    typeInto(screen.getByLabelText(/base64/i), 'data:image/png;base64,Zm9vYmFy');

    const preview = (await screen.findByAltText('Decoded preview')) as HTMLImageElement;
    expect(preview.src).toContain('data:image/png;base64,Zm9vYmFy');
  });

  it('offers a download button once there is output', async () => {
    render(<BaseConverterTool />);
    expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();

    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    await screen.findByText('aGVsbG8=');
    expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled();
  });
});

describe('<BaseConverterTool /> base32', () => {
  it('encodes and decodes, including the omit-padding option', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^base32$/i);
    typeInto(screen.getByLabelText(/plain text/i), 'foobar');
    expect(await screen.findByText('MZXW6YTBOI======')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/omit padding/i));
    expect(await screen.findByText('MZXW6YTBOI')).toBeInTheDocument();
  });

  it('decodes case-insensitively and without padding', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^base32$/i);
    selectFormat(/^decode$/i);
    typeInto(screen.getByLabelText(/base32/i), 'mzxw6ytboi');

    expect(await screen.findByText('foobar')).toBeInTheDocument();
  });

  it('shows an error for input outside the base32 alphabet', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^base32$/i);
    selectFormat(/^decode$/i);
    typeInto(screen.getByLabelText(/base32/i), 'not valid!!');

    expect(await screen.findByRole('alert')).toHaveTextContent(/alphabet/i);
  });

  // Base32 and Base58 used to lack both of these while Base64 had them — an inconsistency
  // inside a single merged tool. They now match.
  it('offers a File source and a download button, matching base64', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^base32$/i);

    expect(screen.getByRole('button', { name: /^file$/i })).toBeInTheDocument();

    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    expect(await screen.findByRole('button', { name: /download/i })).toBeInTheDocument();
  });
});

describe('<BaseConverterTool /> base58', () => {
  it('encodes and decodes', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^base58$/i);
    typeInto(screen.getByLabelText(/plain text/i), 'hello world');

    expect(await screen.findByText('StV1DL6CwTryKyV')).toBeInTheDocument();
  });

  it('shows an error for input outside the base58 alphabet', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^base58$/i);
    selectFormat(/^decode$/i);
    typeInto(screen.getByLabelText(/base58/i), '0OIl');

    expect(await screen.findByRole('alert')).toHaveTextContent(/alphabet/i);
  });

  it('copies the output to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<BaseConverterTool />);
    selectFormat(/^base58$/i);
    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    await screen.findByText('Cn8eVZg');

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith('Cn8eVZg');
  });
});

describe('<BaseConverterTool /> format switching', () => {
  it('keeps typed input when switching formats, recomputing the result', async () => {
    render(<BaseConverterTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'foobar');
    await screen.findByText('Zm9vYmFy');

    selectFormat(/^base58$/i);
    expect(await screen.findByText('t1Zv2yaZ')).toBeInTheDocument();
  });

  // File mode is no longer base64-only, so switching format keeps the chosen source
  // instead of silently dropping the visitor back to text.
  it('keeps the File source when switching format', async () => {
    render(<BaseConverterTool />);
    selectFormat(/^file$/i);
    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();

    selectFormat(/^base32$/i);
    expect(screen.getByRole('button', { name: /^file$/i })).toBeInTheDocument();
    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
  });
});

describe('<BaseConverterTool /> deep links and share state', () => {
  it('preselects the format from a ?format= query param, matching a redirect from an old tool URL', async () => {
    const url = new URL(window.location.href);
    url.search = '?format=base32';
    window.history.pushState(null, '', url);

    render(<BaseConverterTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'foobar');
    expect(await screen.findByText('MZXW6YTBOI======')).toBeInTheDocument();

    window.history.pushState(null, '', window.location.pathname);
  });

  it('restores input, direction and format from a shared link on load', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({
      format: 'base58',
      input: 'hello world',
      direction: 'encode',
      urlSafe: false,
      padding: true,
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<BaseConverterTool />);

    expect(await screen.findByText('StV1DL6CwTryKyV')).toBeInTheDocument();
    window.location.hash = '';
  });
});
