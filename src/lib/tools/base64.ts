import { type ToolResult, ok, err, messageFrom } from './result';

/**
 * Base64 helpers that are correct for Unicode.
 *
 * `btoa`/`atob` operate on "binary strings" (one byte per code unit) and throw on any
 * character above U+00FF. Every function here round-trips through UTF-8 bytes so that
 * emoji, accents and CJK text encode and decode correctly.
 */

const toBinaryString = (bytes: Uint8Array): string => {
  // Chunked to avoid blowing the argument limit on large inputs.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return binary;
};

/** Converts standard base64 to the URL-safe alphabet and strips padding. */
export const toUrlSafe = (base64: string): string =>
  base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Converts URL-safe base64 back to the standard alphabet, restoring padding. */
export const fromUrlSafe = (base64url: string): string => {
  const standard = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = standard.length % 4;
  return remainder === 0 ? standard : standard + '='.repeat(4 - remainder);
};

export function encodeBase64(input: string, urlSafe = false): ToolResult<string> {
  if (input === '') return err('Nothing to encode — enter some text first.');

  try {
    const bytes = new TextEncoder().encode(input);
    const encoded = btoa(toBinaryString(bytes));
    return ok(urlSafe ? toUrlSafe(encoded) : encoded);
  } catch (error) {
    return err(messageFrom(error, 'Could not encode that text.'));
  }
}

const bytesToBase64 = (bytes: Uint8Array): string => btoa(toBinaryString(bytes));

/**
 * Encodes an entire file to base64 — the point being to embed it as a `data:` URL,
 * e.g. inlining a small image directly in CSS or HTML.
 */
export async function encodeFileToBase64(
  file: File
): Promise<ToolResult<{ base64: string; dataUrl: string; mimeType: string }>> {
  if (file.size === 0) return err('That file is empty — nothing to encode.');

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    return err(messageFrom(error, 'Could not read that file.'));
  }

  try {
    const base64 = bytesToBase64(new Uint8Array(buffer));
    const mimeType = file.type || 'application/octet-stream';
    return ok({ base64, dataUrl: `data:${mimeType};base64,${base64}`, mimeType });
  } catch (error) {
    return err(messageFrom(error, 'Could not encode that file.'));
  }
}

/** True for a `data:image/...;base64,...` URL — used to offer an image preview. */
export const isImageDataUrl = (input: string): boolean =>
  /^data:image\/[a-z0-9.+-]+;base64,/i.test(input.trim());

export function decodeBase64(input: string): ToolResult<string> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Nothing to decode — paste a base64 string first.');

  // Accept both alphabets and tolerate whitespace/newlines from wrapped payloads.
  const candidate = fromUrlSafe(trimmed.replace(/\s+/g, ''));

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(candidate)) {
    return err('That is not valid base64 — it contains characters outside the alphabet.');
  }

  try {
    const binary = atob(candidate);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    // `fatal` makes malformed UTF-8 an error instead of silently emitting U+FFFD.
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof TypeError) {
      return err('Decoded successfully, but the result is not valid UTF-8 text (it looks like binary data).');
    }
    return err(messageFrom(error, 'That is not valid base64.'));
  }
}
