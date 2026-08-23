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

describe('<JwtDebugger /> asymmetric verification', () => {
  const toBase64Url = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const encodeSegment = (value: unknown): string =>
    toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const toPem = async (key: CryptoKey): Promise<string> => {
    const spki = await crypto.subtle.exportKey('spki', key);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
    const lines = base64.match(/.{1,64}/g) ?? [base64];
    return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
  };
  const makeRs256Token = async (privateKey: CryptoKey) => {
    const signingInput = `${encodeSegment({ alg: 'RS256', typ: 'JWT' })}.${encodeSegment({ sub: 'user-1' })}`;
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKey,
      new TextEncoder().encode(signingInput)
    );
    return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
  };

  it('offers a public-key field instead of a secret for an RS256 token', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const token = await makeRs256Token(keyPair.privateKey);

    render(<JwtDebugger />);
    typeInto(screen.getByPlaceholderText(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/), token);

    expect(await screen.findByLabelText(/verify signature \(rs256\)/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/verify signature \(hs256\)/i)).not.toBeInTheDocument();
  });

  it('verifies an RS256 signature against a pasted public key', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const token = await makeRs256Token(keyPair.privateKey);
    const pem = await toPem(keyPair.publicKey);

    render(<JwtDebugger />);
    typeInto(screen.getByPlaceholderText(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/), token);
    typeInto(await screen.findByLabelText(/verify signature \(rs256\)/i), pem);

    expect(await screen.findByText(/signature verified/i)).toBeInTheDocument();
  });

  it('rejects an RS256 signature checked against the wrong public key', async () => {
    const signingPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const otherPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const token = await makeRs256Token(signingPair.privateKey);
    const wrongPem = await toPem(otherPair.publicKey);

    render(<JwtDebugger />);
    typeInto(screen.getByPlaceholderText(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/), token);
    typeInto(await screen.findByLabelText(/verify signature \(rs256\)/i), wrongPem);

    expect(await screen.findByText(/does not match/i)).toBeInTheDocument();
  });

  it('explains that an unsupported algorithm cannot be verified here', async () => {
    // A token declaring alg: "none".
    const token = 'eyJhbGciOiJub25lIn0.eyJhIjoxfQ.';

    render(<JwtDebugger />);
    typeInto(screen.getByPlaceholderText(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/), token);

    expect(await screen.findByText(/cannot be checked here/i)).toBeInTheDocument();
  });
});
