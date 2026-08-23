import { type ToolResult, ok, err, messageFrom } from './result';

/**
 * RFC 4648 §6 standard Base32 — NOT Crockford's Base32, which uses a different,
 * incompatible alphabet. Encodes 8 bits per byte into 5-bit groups, 8 groups per
 * 40-bit (5-byte) block, padded with "=" to a multiple of 8 characters.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function bytesToBase32(bytes: Uint8Array, padding: boolean): string {
  let output = '';
  let bitBuffer = 0;
  let bitCount = 0;

  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      output += ALPHABET[(bitBuffer >>> bitCount) & 0x1f];
    }
  }

  if (bitCount > 0) {
    output += ALPHABET[(bitBuffer << (5 - bitCount)) & 0x1f];
  }

  if (!padding) return output;

  const remainder = output.length % 8;
  return remainder === 0 ? output : output + '='.repeat(8 - remainder);
}

function base32ToBytes(input: string): Uint8Array {
  const bytes: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;

  for (const char of input) {
    bitBuffer = (bitBuffer << 5) | ALPHABET.indexOf(char);
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((bitBuffer >>> bitCount) & 0xff);
    }
  }

  return Uint8Array.from(bytes);
}

export function encodeBase32(input: string, options?: { padding?: boolean }): ToolResult<string> {
  if (input === '') return err('Nothing to encode — enter some text first.');

  const padding = options?.padding ?? true;

  try {
    const bytes = new TextEncoder().encode(input);
    return ok(bytesToBase32(bytes, padding));
  } catch (error) {
    return err(messageFrom(error, 'Could not encode that text.'));
  }
}

export function decodeBase32(input: string): ToolResult<string> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Nothing to decode — paste a base32 string first.');

  // Lenient: case-insensitive, tolerant of missing padding and wrapped whitespace.
  const candidate = trimmed.replace(/\s+/g, '').toUpperCase();

  if (!/^[A-Z2-7]*={0,6}$/.test(candidate)) {
    return err('That is not valid base32 — it contains characters outside the alphabet (A-Z, 2-7).');
  }

  const unpadded = candidate.replace(/=+$/, '');

  try {
    const bytes = base32ToBytes(unpadded);
    // `fatal` makes malformed UTF-8 an error instead of silently emitting U+FFFD.
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof TypeError) {
      return err('Decoded successfully, but the result is not valid UTF-8 text (it looks like binary data).');
    }
    return err(messageFrom(error, 'That is not valid base32.'));
  }
}
