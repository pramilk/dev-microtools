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

  if (algorithm === 'MD5') {
    // Loaded separately so a failed module fetch reports something actionable
    // rather than the bundler's internal error text.
    let md5: (value: string) => string;
    try {
      md5 = (await import('blueimp-md5')).default;
    } catch {
      return err('Could not load the MD5 implementation. Check your connection and reload the page.');
    }

    try {
      return ok(md5(input));
    } catch (error) {
      return err(messageFrom(error, 'Could not compute the MD5 hash.'));
    }
  }

  try {
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

/** Above this, hashing on the main thread would freeze the tab for too long. */
export const MAX_HASHABLE_FILE_BYTES = 500 * 1024 * 1024;

/**
 * Hashes an entire file with every supported algorithm — the common reason to want
 * this tool at all is verifying a downloaded file's published checksum.
 *
 * MD5 needs `spark-md5` rather than `blueimp-md5`: blueimp-md5's public API always
 * re-encodes its input as UTF-8 text, which corrupts arbitrary binary bytes. spark-md5
 * hashes an ArrayBuffer directly, so file contents survive unchanged.
 */
export async function hashFile(
  file: File
): Promise<ToolResult<{ algorithm: HashAlgorithm; digest: string }[]>> {
  if (file.size === 0) return err('That file is empty — nothing to hash.');
  if (file.size > MAX_HASHABLE_FILE_BYTES) {
    return err(
      `That file is too large to hash in the browser (limit ${Math.floor(MAX_HASHABLE_FILE_BYTES / (1024 * 1024))} MB).`
    );
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    return err(messageFrom(error, 'Could not read that file.'));
  }

  const results: { algorithm: HashAlgorithm; digest: string }[] = [];
  for (const algorithm of HASH_ALGORITHMS) {
    if (algorithm === 'MD5') {
      // `spark-md5` is a CommonJS `export =` module; the bundler wraps it as
      // `{ default: SparkMD5 }` at runtime, which the DefinitelyTyped `export =`
      // declaration doesn't reflect for a dynamic `import()` — hence the cast.
      type SparkMD5Static = typeof import('spark-md5');
      let SparkMD5: SparkMD5Static;
      try {
        const loaded = (await import('spark-md5')) as unknown as { default: SparkMD5Static };
        SparkMD5 = loaded.default;
      } catch {
        return err('Could not load the MD5 implementation. Check your connection and reload the page.');
      }
      try {
        results.push({ algorithm, digest: SparkMD5.ArrayBuffer.hash(buffer) });
      } catch (error) {
        return err(messageFrom(error, 'Could not compute the MD5 hash.'));
      }
      continue;
    }

    try {
      const digest = await crypto.subtle.digest(algorithm, buffer);
      results.push({ algorithm, digest: toHex(digest) });
    } catch (error) {
      return err(messageFrom(error, `Could not compute the ${algorithm} hash.`));
    }
  }
  return ok(results);
}

/**
 * Computes a keyed hash (HMAC) of text, so the digest also proves whoever produced it
 * knew the shared secret — not just that the message wasn't altered.
 */
export async function hmacText(
  input: string,
  key: string,
  algorithm: HashAlgorithm
): Promise<ToolResult<string>> {
  if (input === '') return err('Nothing to hash — enter some text first.');
  if (key === '') return err('Enter a secret key to compute an HMAC.');

  if (algorithm === 'MD5') {
    let md5: (value: string, key?: string) => string;
    try {
      md5 = (await import('blueimp-md5')).default;
    } catch {
      return err('Could not load the MD5 implementation. Check your connection and reload the page.');
    }
    try {
      return ok(md5(input, key));
    } catch (error) {
      return err(messageFrom(error, 'Could not compute the HMAC-MD5.'));
    }
  }

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(key),
      { name: 'HMAC', hash: algorithm },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(input));
    return ok(toHex(signature));
  } catch (error) {
    return err(messageFrom(error, `Could not compute the HMAC-${algorithm}.`));
  }
}

/** Computes the HMAC for every supported algorithm in one pass. */
export async function hmacAll(
  input: string,
  key: string
): Promise<ToolResult<{ algorithm: HashAlgorithm; digest: string }[]>> {
  if (input === '') return err('Nothing to hash — enter some text first.');
  if (key === '') return err('Enter a secret key to compute an HMAC.');

  const results: { algorithm: HashAlgorithm; digest: string }[] = [];
  for (const algorithm of HASH_ALGORITHMS) {
    const result = await hmacText(input, key, algorithm);
    if (!result.ok) return err(result.error);
    results.push({ algorithm, digest: result.value });
  }
  return ok(results);
}
