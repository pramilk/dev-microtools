import { type ToolResult, ok, err, messageFrom } from './result';

/**
 * Base58 (base58btc, the Bitcoin/IPFS alphabet) — arbitrary-precision big-integer base
 * conversion, not bit-packing like base64/32. Excludes 0, O, I and l to avoid characters
 * that look alike in many fonts.
 */
export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const BASE58_PATTERN = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]*$/;

/**
 * Converts bytes to Base58. A leading 0x00 byte would otherwise vanish once the bytes
 * are treated as one big integer, so each leading zero byte is mapped to a leading '1'
 * (alphabet index 0) explicitly, before the big-integer digits are appended.
 */
function bytesToBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;

  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  let digits = '';
  while (value > 0n) {
    const remainder = value % 58n;
    value /= 58n;
    digits = BASE58_ALPHABET[Number(remainder)] + digits;
  }

  return '1'.repeat(leadingZeros) + digits;
}

/** Reverses `bytesToBase58`: each leading '1' becomes a leading 0x00 byte. */
function base58ToBytes(input: string): Uint8Array {
  if (input === '') return new Uint8Array(0);

  let leadingOnes = 0;
  while (leadingOnes < input.length && input[leadingOnes] === '1') leadingOnes++;

  let value = 0n;
  for (const char of input) {
    value = value * 58n + BigInt(BASE58_ALPHABET.indexOf(char));
  }

  const digits: number[] = [];
  while (value > 0n) {
    digits.unshift(Number(value % 256n));
    value /= 256n;
  }

  const bytes = new Uint8Array(leadingOnes + digits.length);
  bytes.set(digits, leadingOnes);
  return bytes;
}

export function encodeBase58(input: string): ToolResult<string> {
  try {
    const bytes = new TextEncoder().encode(input);
    return ok(bytesToBase58(bytes));
  } catch (error) {
    return err(messageFrom(error, 'Could not encode that text.'));
  }
}

export function decodeBase58(input: string): ToolResult<string> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Nothing to decode — paste a Base58 string first.');

  if (!BASE58_PATTERN.test(trimmed)) {
    return err(
      'That is not valid Base58 — it contains characters outside the alphabet. Note that "0" (zero), "O" (capital O), "I" (capital I) and "l" (lowercase L) are never valid Base58 characters.'
    );
  }

  try {
    const bytes = base58ToBytes(trimmed);
    // `fatal` makes malformed UTF-8 an error instead of silently emitting U+FFFD.
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof TypeError) {
      return err('Decoded successfully, but the result is not valid UTF-8 text (it looks like binary data).');
    }
    return err(messageFrom(error, 'That is not valid Base58.'));
  }
}
