import { type ToolResult, ok, err } from './result';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** "none" sends no `-d` flag at all; "json" additionally validates the body as JSON and
 *  auto-adds a `Content-Type: application/json` header when one isn't already present. */
export type BodyType = 'none' | 'raw' | 'json';

export interface CurlHeader {
  key: string;
  value: string;
}

export interface CurlCommandOptions {
  method: HttpMethod;
  url: string;
  headers: CurlHeader[];
  bodyType: BodyType;
  body: string;
  authUser: string;
  authPass: string;
  insecure: boolean;
  followRedirects: boolean;
  includeResponseHeaders: boolean;
  silent: boolean;
  /** Formatting only — never affects what the command does, only how it's laid out. */
  multiline: boolean;
}

export const DEFAULT_CURL_OPTIONS: CurlCommandOptions = {
  method: 'GET',
  url: '',
  headers: [],
  bodyType: 'none',
  body: '',
  authUser: '',
  authPass: '',
  insecure: false,
  followRedirects: false,
  includeResponseHeaders: false,
  silent: false,
  multiline: true,
};

/**
 * Wraps a value in single quotes for a POSIX shell, escaping any embedded single quote
 * by closing the quote, emitting an escaped literal quote, then reopening it — the
 * standard technique, since nothing can appear literally inside a single-quoted string.
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hasHeaderNamed(headers: CurlHeader[], name: string): boolean {
  return headers.some((header) => header.key.trim().toLowerCase() === name.toLowerCase());
}

/**
 * Builds a copy-pasteable `curl` command from structured request options. Runs entirely
 * client-side — nothing about the request is ever sent anywhere, it's just string
 * assembly with proper shell escaping.
 */
export function buildCurlCommand(options: CurlCommandOptions): ToolResult<string> {
  const url = options.url.trim();
  if (url === '') return err('Enter a URL to build a curl command.');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return err(`"${url}" doesn't look like a valid, absolute URL — include the scheme, e.g. https://example.com/path.`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return err(`curl needs an http:// or https:// URL — "${parsedUrl.protocol}" isn't supported here.`);
  }

  const trimmedBody = options.body.trim();
  if (options.bodyType === 'json' && trimmedBody !== '') {
    try {
      JSON.parse(options.body);
    } catch (error) {
      return err(`Body isn't valid JSON: ${error instanceof Error ? error.message : 'parse error'}.`);
    }
  }

  const cleanHeaders = options.headers.filter((header) => header.key.trim() !== '');
  const hasBody = options.bodyType !== 'none' && options.body !== '';

  const segments: string[] = [];
  // curl infers POST automatically the moment -d is present, with no -X at all — so a GET
  // (or HEAD/etc.) request that also has a body needs an *explicit* -X to actually keep
  // the method the user picked; without it, curl silently sends something other than what
  // the tool says it's building.
  if (options.method !== 'GET' || hasBody) segments.push(`-X ${options.method}`);

  for (const header of cleanHeaders) {
    segments.push(`-H ${shellEscape(`${header.key.trim()}: ${header.value}`)}`);
  }
  if (options.bodyType === 'json' && trimmedBody !== '' && !hasHeaderNamed(cleanHeaders, 'content-type')) {
    segments.push(`-H ${shellEscape('Content-Type: application/json')}`);
  }

  if (hasBody) {
    segments.push(`-d ${shellEscape(options.body)}`);
  }

  if (options.authUser !== '') {
    segments.push(`-u ${shellEscape(`${options.authUser}:${options.authPass}`)}`);
  }

  if (options.insecure) segments.push('-k');
  if (options.followRedirects) segments.push('-L');
  if (options.includeResponseHeaders) segments.push('-i');
  if (options.silent) segments.push('-s');

  segments.push(shellEscape(url));

  const joiner = options.multiline ? ' \\\n  ' : ' ';
  return ok(['curl', ...segments].join(joiner));
}

export interface FetchRequestInit {
  headers: Record<string, string>;
  body?: string;
}

/**
 * Derives `fetch()` header/body options from the same structured request used to build
 * the curl command, so "Send request" fires exactly what the generated command describes.
 * Basic auth becomes an Authorization header, since `fetch` has no separate auth option —
 * the same encoding curl itself applies for `-u`.
 */
export function buildFetchInit(options: CurlCommandOptions): FetchRequestInit {
  const fetchHeaders: Record<string, string> = {};
  for (const header of options.headers) {
    const key = header.key.trim();
    if (key !== '') fetchHeaders[key] = header.value;
  }

  const trimmedBody = options.body.trim();
  if (options.bodyType === 'json' && trimmedBody !== '' && !hasHeaderNamed(options.headers, 'content-type')) {
    fetchHeaders['Content-Type'] = 'application/json';
  }
  if (options.authUser !== '') {
    fetchHeaders['Authorization'] = `Basic ${btoa(`${options.authUser}:${options.authPass}`)}`;
  }

  const init: FetchRequestInit = { headers: fetchHeaders };
  if (options.bodyType !== 'none' && options.body !== '') init.body = options.body;
  return init;
}
