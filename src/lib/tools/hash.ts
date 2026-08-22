import { type ToolResult, ok, err, messageFrom } from './result';

export const HASH_ALGORITHMS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

const toHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
};

/**
 * Hashes text with the requested algorithm.
 *
 * SHA-* use the browser's native SubtleCrypto. MD5 is not in the Web Crypto spec —
 * deliberately, because it is cryptographically broken — so it is loaded from a small
 * library only when actually requested, keeping it out of the bundle for everyone else.
 */
export async function hashText(
  input: string,
  algorithm: HashAlgorithm
): Promise<ToolResult<string>> {
  if (input === '') return err('Nothing to hash — enter some text first.');

  try {
    if (algorithm === 'MD5') {
      const { default: md5 } = await import('blueimp-md5');
      return ok(md5(input));
    }

    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest(algorithm, bytes);
    return ok(toHex(digest));
  } catch (error) {
    return err(messageFrom(error, `Could not compute the ${algorithm} hash.`));
  }
}

/** Computes every supported digest in one pass, for the "all algorithms" view. */
export async function hashAll(
  input: string
): Promise<ToolResult<{ algorithm: HashAlgorithm; digest: string }[]>> {
  if (input === '') return err('Nothing to hash — enter some text first.');

  const results: { algorithm: HashAlgorithm; digest: string }[] = [];
  for (const algorithm of HASH_ALGORITHMS) {
    const result = await hashText(input, algorithm);
    if (!result.ok) return err(result.error);
    results.push({ algorithm, digest: result.value });
  }
  return ok(results);
}

/** Constant-time-ish comparison helper for the "does this match?" check. */
export const digestsMatch = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== '';
