import { describe, expect, it } from 'vitest';
import { buildCurlCommand, buildFetchInit, shellEscape, DEFAULT_CURL_OPTIONS, type CurlCommandOptions } from './curlCommand';

const options = (overrides: Partial<CurlCommandOptions> = {}): CurlCommandOptions => ({
  ...DEFAULT_CURL_OPTIONS,
  ...overrides,
});

describe('shellEscape', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it('escapes an embedded single quote', () => {
    expect(shellEscape("it's here")).toBe("'it'\\''s here'");
  });

  it('leaves double quotes, spaces and unicode untouched inside the quotes', () => {
    expect(shellEscape('say "hi" 你好 😀')).toBe("'say \"hi\" 你好 😀'");
  });

  it('handles an empty string', () => {
    expect(shellEscape('')).toBe("''");
  });
});

describe('buildCurlCommand', () => {
  it('builds a minimal single-line GET command', () => {
    const result = buildCurlCommand(options({ url: 'https://example.com/api', multiline: false }));
    expect(result).toEqual({ ok: true, value: "curl 'https://example.com/api'" });
  });

  it('builds a multiline command by default', () => {
    const result = buildCurlCommand(options({ url: 'https://example.com/api' }));
    expect(result).toEqual({ ok: true, value: "curl \\\n  'https://example.com/api'" });
  });

  it('includes -X for a non-GET method but omits it for GET', () => {
    const post = buildCurlCommand(options({ url: 'https://example.com', method: 'POST', multiline: false }));
    expect(post.ok && post.value).toContain('-X POST');

    const get = buildCurlCommand(options({ url: 'https://example.com', method: 'GET', multiline: false }));
    expect(get.ok && get.value).not.toContain('-X');
  });

  it('adds an explicit -X GET when a GET request also has a body, so curl does not silently switch to POST', () => {
    const result = buildCurlCommand(
      options({ url: 'https://example.com', method: 'GET', bodyType: 'raw', body: '{"query":"*"}', multiline: false })
    );
    expect(result.ok && result.value).toBe("curl -X GET -d '{\"query\":\"*\"}' 'https://example.com'");
  });

  it('does not add -X for GET with no body', () => {
    const result = buildCurlCommand(options({ url: 'https://example.com', method: 'GET', bodyType: 'none', multiline: false }));
    expect(result.ok && result.value).not.toContain('-X');
  });

  it('adds a -H flag per header, skipping blank keys', () => {
    const result = buildCurlCommand(
      options({
        url: 'https://example.com',
        headers: [
          { key: 'Accept', value: 'application/json' },
          { key: '  ', value: 'ignored' },
          { key: 'X-Token', value: "value's here" },
        ],
        multiline: false,
      })
    );
    expect(result.ok && result.value).toBe(
      "curl -H 'Accept: application/json' -H 'X-Token: value'\\''s here' 'https://example.com'"
    );
  });

  it('adds -d for a raw body without touching headers', () => {
    const result = buildCurlCommand(
      options({ url: 'https://example.com', method: 'POST', bodyType: 'raw', body: 'a=1&b=2', multiline: false })
    );
    expect(result.ok && result.value).toBe("curl -X POST -d 'a=1&b=2' 'https://example.com'");
  });

  it('auto-adds Content-Type for a JSON body when none is set', () => {
    const result = buildCurlCommand(
      options({ url: 'https://example.com', method: 'POST', bodyType: 'json', body: '{"a":1}', multiline: false })
    );
    expect(result.ok && result.value).toBe(
      "curl -X POST -H 'Content-Type: application/json' -d '{\"a\":1}' 'https://example.com'"
    );
  });

  it('does not duplicate Content-Type if the caller already set one (case-insensitively)', () => {
    const result = buildCurlCommand(
      options({
        url: 'https://example.com',
        method: 'POST',
        bodyType: 'json',
        body: '{"a":1}',
        headers: [{ key: 'content-type', value: 'application/json; charset=utf-8' }],
        multiline: false,
      })
    );
    expect(result.ok && result.value).toBe(
      "curl -X POST -H 'content-type: application/json; charset=utf-8' -d '{\"a\":1}' 'https://example.com'"
    );
  });

  it('rejects an invalid JSON body', () => {
    const result = buildCurlCommand(options({ url: 'https://example.com', bodyType: 'json', body: '{not json' }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/valid JSON/);
  });

  it('adds basic auth as -u user:pass', () => {
    const result = buildCurlCommand(options({ url: 'https://example.com', authUser: 'alice', authPass: 'p@ss', multiline: false }));
    expect(result.ok && result.value).toBe("curl -u 'alice:p@ss' 'https://example.com'");
  });

  it('adds every enabled flag', () => {
    const result = buildCurlCommand(
      options({
        url: 'https://example.com',
        insecure: true,
        followRedirects: true,
        includeResponseHeaders: true,
        silent: true,
        multiline: false,
      })
    );
    expect(result.ok && result.value).toBe("curl -k -L -i -s 'https://example.com'");
  });

  it('rejects an empty URL', () => {
    const result = buildCurlCommand(options({ url: '   ' }));
    expect(result).toEqual({ ok: false, error: 'Enter a URL to build a curl command.' });
  });

  it('rejects a malformed URL', () => {
    const result = buildCurlCommand(options({ url: 'not a url' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-http(s) scheme', () => {
    const result = buildCurlCommand(options({ url: 'ftp://example.com/file' }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/http:\/\/ or https:\/\//);
  });

  it('escapes a URL containing special characters', () => {
    const result = buildCurlCommand(options({ url: "https://example.com/?q=it's a test", multiline: false }));
    expect(result.ok && result.value).toBe("curl 'https://example.com/?q=it'\\''s a test'");
  });
});

describe('buildFetchInit', () => {
  it('carries headers over, skipping blank keys', () => {
    const init = buildFetchInit(
      options({ headers: [{ key: 'Accept', value: 'application/json' }, { key: '  ', value: 'ignored' }] })
    );
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.body).toBeUndefined();
  });

  it('includes the body for a raw or JSON body type', () => {
    const init = buildFetchInit(options({ bodyType: 'raw', body: 'a=1' }));
    expect(init.body).toBe('a=1');
  });

  it('omits the body when bodyType is none', () => {
    const init = buildFetchInit(options({ bodyType: 'none', body: 'a=1' }));
    expect(init.body).toBeUndefined();
  });

  it('auto-adds Content-Type for a JSON body when none is set', () => {
    const init = buildFetchInit(options({ bodyType: 'json', body: '{"a":1}' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('does not override an explicit Content-Type header', () => {
    const init = buildFetchInit(
      options({ bodyType: 'json', body: '{"a":1}', headers: [{ key: 'Content-Type', value: 'application/vnd.api+json' }] })
    );
    expect(init.headers['Content-Type']).toBe('application/vnd.api+json');
  });

  it('adds a base64-encoded Basic auth Authorization header', () => {
    const init = buildFetchInit(options({ authUser: 'alice', authPass: 'p@ss' }));
    expect(init.headers['Authorization']).toBe(`Basic ${btoa('alice:p@ss')}`);
  });

  it('adds no Authorization header when no username is set', () => {
    const init = buildFetchInit(options());
    expect(init.headers['Authorization']).toBeUndefined();
  });
});
