import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import JwtDebugger from './JwtDebugger';

const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
  '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const SECRET = 'your-256-bit-secret';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<JwtDebugger />', () => {
  it('warns that tokens are credentials even though nothing is uploaded', () => {
    render(<JwtDebugger />);
    expect(screen.getByText(/never sent anywhere/i)).toBeInTheDocument();
  });

  it('decodes the header and payload of a valid token', async () => {
    render(<JwtDebugger />);
    typeInto(screen.getByPlaceholderText(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/), SAMPLE);

    expect(await screen.findByText(/"alg": "HS256"/)).toBeInTheDocument();
    expect(await screen.findByText(/"name": "John Doe"/)).toBeInTheDocument();
  });

  it('reports how many segments a malformed token has', async () => {
    render(<JwtDebugger />);
    typeInto(screen.getByPlaceholderText(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/), 'only.two');

    expect(await screen.findByRole('alert')).toHaveTextContent(/has 2/);
  });

  it('flags a token that carries no expiry claim', async () => {
    render(<JwtDebugger />);
    typeInto(screen.getByPlaceholderText(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/), SAMPLE);

    expect(await screen.findByText(/no expiry claim/i)).toBeInTheDocument();
  });

  it('confirms a signature that matches the secret', async () => {
    render(<JwtDebugger />);
    typeInto(screen.getByPlaceholderText(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/), SAMPLE);
    typeInto(await screen.findByLabelText(/verify signature/i), SECRET);

    expect(await screen.findByText(/signature verified/i)).toBeInTheDocument();
  });

  it('reports a signature that does not match', async () => {
    render(<JwtDebugger />);
    typeInto(screen.getByPlaceholderText(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/), SAMPLE);
    typeInto(await screen.findByLabelText(/verify signature/i), 'wrong');

    expect(await screen.findByText(/does not match/i)).toBeInTheDocument();
  });

  it('signs a new token that round-trips back to the same payload', async () => {
    render(<JwtDebugger />);
    fireEvent.click(screen.getByRole('button', { name: /create & sign/i }));

    typeInto(screen.getByLabelText(/payload/i), '{"hello":"world"}');
    fireEvent.click(screen.getByRole('button', { name: /sign token/i }));

    const output = await screen.findByText(/^eyJ/);
    expect(output.textContent!.split('.')).toHaveLength(3);
  });

  it('rejects a payload that is not valid JSON', async () => {
    render(<JwtDebugger />);
    fireEvent.click(screen.getByRole('button', { name: /create & sign/i }));

    typeInto(screen.getByLabelText(/payload/i), 'not json');
    fireEvent.click(screen.getByRole('button', { name: /sign token/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/i);
  });
});
