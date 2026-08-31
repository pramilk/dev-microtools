import { type ToolResult, ok, err, messageFrom } from './tools/result';
import { gzip, gunzip, supportsCompression } from './compression';

/**
 * Above this, a URL becomes unreliable to paste into chat apps, SMS, or older
 * infrastructure — there is no backend here to store the content behind a short ID
 * instead, so a link that would exceed this is refused rather than silently broken.
 */
export const MAX_SHARE_URL_LENGTH = 1900;

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (value: string): Uint8Array => {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * Packs arbitrary JSON-serialisable state into a compact, URL-safe string, so a
 * tool's current input can be shared as a link with no backend involved.
 *
 * Compressed with gzip before encoding — plain JSON in a URL burns through the
 * practical link-sharing budget fast; compression buys real headroom for typical
 * tool inputs (a regex, a JSON snippet, a couple of diffed paragraphs).
 */
export async function encodeShareState(state: unknown): Promise<ToolResult<string>> {
  if (!supportsCompression()) {
    return err('This browser does not support the compression feature link-sharing needs.');
  }

  try {
    const json = JSON.stringify(state);
    const compressed = await gzip(new TextEncoder().encode(json));
    return ok(toBase64Url(compressed));
  } catch (error) {
    return err(messageFrom(error, 'Could not prepare a shareable link.'));
  }
}

/** The inverse of `encodeShareState`. */
export async function decodeShareState<T>(encoded: string): Promise<ToolResult<T>> {
  if (encoded === '') return err('Nothing to restore.');
  if (!supportsCompression()) {
    return err('This browser does not support the decompression feature restoring a link needs.');
  }

  try {
    const decompressed = await gunzip(fromBase64Url(encoded));
    const json = new TextDecoder('utf-8', { fatal: true }).decode(decompressed);
    return ok(JSON.parse(json) as T);
  } catch (error) {
    return err(messageFrom(error, 'That share link looks corrupted, or was made by a different tool.'));
  }
}

/**
 * Builds the full URL to share, or an error if the result would be too long to be a
 * reliable link.
 */
export async function buildShareUrl(baseUrl: string, state: unknown): Promise<ToolResult<string>> {
  const encoded = await encodeShareState(state);
  if (!encoded.ok) return encoded;

  const url = `${baseUrl}#s=${encoded.value}`;
  if (url.length > MAX_SHARE_URL_LENGTH) {
    return err(
      `This input is too large to share as a link (it would be ${url.length.toLocaleString()} characters). Try a smaller example.`
    );
  }
  return ok(url);
}

/** Extracts the `s=...` payload from a `#s=...` URL fragment. Returns null if absent. */
export function extractShareFragment(hash: string): string | null {
  const match = /^#?s=(.+)$/.exec(hash);
  return match ? match[1]! : null;
}

/** Reads and decodes a share fragment straight from the current page location, if present. */
export async function readShareStateFromLocation<T>(): Promise<ToolResult<T> | null> {
  if (typeof window === 'undefined') return null;
  const fragment = extractShareFragment(window.location.hash);
  if (fragment === null) return null;
  return decodeShareState<T>(fragment);
}
