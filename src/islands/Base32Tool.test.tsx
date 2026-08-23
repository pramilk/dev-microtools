import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import Base32Tool from './Base32Tool';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<Base32Tool />', () => {
  it('encodes text as it is typed', async () => {
    render(<Base32Tool />);
    typeInto(screen.getByLabelText(/plain text/i), 'foobar');

    expect(await screen.findByText('MZXW6YTBOI======')).toBeInTheDocument();
  });

  it('encodes multi-byte characters correctly', async () => {
    render(<Base32Tool />);
    typeInto(screen.getByLabelText(/plain text/i), '🎉');

    const encoded = await screen.findByText(/^[A-Z2-7=]+$/);
    expect(encoded).toBeInTheDocument();
  });

  it('decodes when switched to decode mode', async () => {
    render(<Base32Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/base32/i), 'MZXW6YTBOI======');

    expect(await screen.findByText('foobar')).toBeInTheDocument();
  });

  it('decodes case-insensitively and without padding', async () => {
    render(<Base32Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/base32/i), 'mzxw6ytboi');

    expect(await screen.findByText('foobar')).toBeInTheDocument();
  });

  it('shows an error for input outside the base32 alphabet', async () => {
    render(<Base32Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/base32/i), 'not valid!!');

    expect(await screen.findByRole('alert')).toHaveTextContent(/alphabet/i);
  });

  it('omits padding when the option is enabled', async () => {
    render(<Base32Tool />);
    typeInto(screen.getByLabelText(/plain text/i), 'foobar');
    expect(await screen.findByText('MZXW6YTBOI======')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/omit padding/i));
    expect(await screen.findByText('MZXW6YTBOI')).toBeInTheDocument();
  });

  it('clears the input', async () => {
    render(<Base32Tool />);
    const input = screen.getByLabelText(/plain text/i) as HTMLTextAreaElement;
    typeInto(input, 'hello');
    await screen.findByText('NBSWY3DP');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(input.value).toBe('');
  });

  it('copies the output to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<Base32Tool />);
    typeInto(screen.getByLabelText(/plain text/i), 'foobar');
    await screen.findByText('MZXW6YTBOI======');

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith('MZXW6YTBOI======');
  });
});
