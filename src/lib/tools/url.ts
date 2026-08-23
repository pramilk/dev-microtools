import { type ToolResult, ok, err } from './result';

/** Which escaping rules to apply. */
export type UrlEncodeMode = 'component' | 'full';

/**
 * `component` escapes reserved delimiters (&, =, ?, /) and is what you want for a
 * query-string value. `full` preserves them and is for escaping a whole URL.
 */
export function encodeUrl(input: string, mode: UrlEncodeMode = 'component'): ToolResult<string> {
  if (input === '') return err('Nothing to encode — enter some text first.');

  try {
    return ok(mode === 'component' ? encodeURIComponent(input) : encodeURI(input));
  } catch {
    // Thrown for lone surrogates, which cannot be encoded as UTF-8. The native message
    // is just "URI malformed", which tells the user nothing, so we replace it.
    return err(
      'Could not encode that text — it contains an unpaired surrogate character (half of an emoji or similar).'
    );
  }
}

export function decodeUrl(input: string, mode: UrlEncodeMode = 'component'): ToolResult<string> {
  if (input === '') return err('Nothing to decode — paste an encoded string first.');

  try {
    return ok(mode === 'component' ? decodeURIComponent(input) : decodeURI(input));
  } catch {
    // Native message is "URI malformed" — unhelpful, so we explain the actual cause.
    return err(
      'That is not a valid encoded string — check for a stray % that is not followed by two hex digits.'
    );
  }
}

export interface ParsedUrl {
  protocol: string;
  host: string;
  port: string;
  path: string;
  hash: string;
  params: { key: string; value: string }[];
}

/** Breaks a URL into its parts so query strings can be read at a glance. */
export function parseUrl(input: string): ToolResult<ParsedUrl> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Nothing to parse — paste a URL first.');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return err('That is not a valid absolute URL. It needs a scheme, for example https://example.com/path.');
  }

  const params = [...url.searchParams.entries()].map(([key, value]) => ({ key, value }));

  return ok({
    protocol: url.protocol.replace(/:$/, ''),
    host: url.hostname,
    port: url.port,
    path: url.pathname,
    hash: url.hash.replace(/^#/, ''),
    params,
  });
}

/**
 * Rebuilds a URL string from parsed parts — the inverse of `parseUrl`, so a query
 * parameter can be edited as a key/value row instead of as raw encoded text.
 *
 * Goes through the native `URL`/`URLSearchParams` classes rather than string
 * concatenation, so escaping stays correct and matches what `parseUrl` decoded.
 */
export function buildUrl(parts: ParsedUrl): string {
  const authority = parts.port ? `${parts.host}:${parts.port}` : parts.host;
  const url = new URL(`${parts.protocol}://${authority}${parts.path}`);
  url.search = '';
  for (const { key, value } of parts.params) {
    if (key === '') continue;
    url.searchParams.append(key, value);
  }
  url.hash = parts.hash;
  return url.toString();
}
