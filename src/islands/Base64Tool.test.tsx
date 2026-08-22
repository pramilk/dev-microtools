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
});
