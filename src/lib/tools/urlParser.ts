import { type ToolResult, ok, err } from './result';

export interface QueryParam {
  key: string;
  value: string;
}

export interface ParsedUrl {
  href: string;
  protocol: string;
  origin: string;
  username: string;
  password: string;
  hostname: string;
  /** Empty when the URL does not specify a port explicitly (see FAQ re: effective port). */
  port: string;
  pathname: string;
  /** Raw query string including the leading "?", or "" when there is none. */
  search: string;
  /** Raw fragment including the leading "#", or "" when there is none. */
  hash: string;
  queryParams: QueryParam[];
}

const INVALID_URL_MESSAGE =
  'Enter a full URL, including the scheme (e.g. https://…) — a relative path cannot be parsed on its own.';

/**
 * The native `URL` constructor throws a TypeError with just the message "Invalid URL"
 * on anything malformed or relative — unhelpful, so every caller goes through this
 * instead of catching the constructor directly.
 */
function toUrl(input: string): ToolResult<URL> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter a URL first.');

  try {
    return ok(new URL(trimmed));
  } catch {
    return err(INVALID_URL_MESSAGE);
  }
}

/**
 * Decomposes a full, absolute URL into its components. Requires a scheme — there is
 * no base to resolve a relative URL against, so a relative input is rejected rather
 * than guessed at.
 */
export function parseUrl(input: string): ToolResult<ParsedUrl> {
  const result = toUrl(input);
  if (!result.ok) return err(result.error);
  const url = result.value;

  const queryParams = [...url.searchParams.entries()].map(([key, value]) => ({ key, value }));

  return ok({
    href: url.href,
    protocol: url.protocol,
    origin: url.origin,
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    queryParams,
  });
}

/**
 * Reassembles a full URL string from `base`, with its entire query string replaced by
 * one freshly serialized from `queryParams` (in array order, so duplicate keys survive).
 * Powers the "edit params as rows, watch the URL update" UX.
 */
export function rebuildUrl(base: string, queryParams: QueryParam[]): ToolResult<string> {
  const result = toUrl(base);
  if (!result.ok) return err(result.error);
  const url = result.value;

  url.search = '';
  for (const { key, value } of queryParams) {
    if (key === '') continue;
    url.searchParams.append(key, value);
  }

  return ok(url.href);
}
