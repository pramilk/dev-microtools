import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import Base58Tool from './Base58Tool';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<Base58Tool />', () => {
  it('encodes text as it is typed', async () => {
    render(<Base58Tool />);
    typeInto(screen.getByLabelText(/plain text/i), 'hello world');

    expect(await screen.findByText('StV1DL6CwTryKyV')).toBeInTheDocument();
  });

  it('decodes when switched to decode mode', async () => {
    render(<Base58Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/base58/i), 'StV1DL6CwTryKyV');

    expect(await screen.findByText('hello world')).toBeInTheDocument();
  });

  it('shows an error for input outside the base58 alphabet', async () => {
    render(<Base58Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/base58/i), '0OIl');

    expect(await screen.findByRole('alert')).toHaveTextContent(/alphabet/i);
  });

  it('does not show a stack trace or crash on malformed input', async () => {
    render(<Base58Tool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/base58/i), 'not-valid-input!!');

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).not.toMatch(/at Object|TypeError|undefined is not/i);
  });

  it('round-trips using the swap button', async () => {
    render(<Base58Tool />);
    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    await screen.findByText('Cn8eVZg');

    fireEvent.click(screen.getByRole('button', { name: /use result as input/i }));
    expect(await screen.findByText('hello')).toBeInTheDocument();
  });

  it('clears the input', async () => {
    render(<Base58Tool />);
    const input = screen.getByLabelText(/plain text/i) as HTMLTextAreaElement;
    typeInto(input, 'hello');
    await screen.findByText('Cn8eVZg');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(input.value).toBe('');
  });

  it('copies the output to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<Base58Tool />);
    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    await screen.findByText('Cn8eVZg');

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));

    await screen.findByRole('button', { name: /^copied$/i });
    expect(writeText).toHaveBeenCalledWith('Cn8eVZg');
  });

  it('shows empty output and no error before anything is typed', () => {
    render(<Base58Tool />);
    expect(screen.getByText('Encoded output appears here.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
