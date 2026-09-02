/**
 * Pure request -> `ServerSignals` mapping used by the Worker in `index.ts`, kept
 * separate so it's testable with a plain `Request` object under ordinary Vitest — no
 * Workers runtime required. The Worker's `fetch` handler stays thin glue around this.
 */
import type { ServerSignals } from '../lib/tools/browserFingerprint';

/**
 * The subset of Cloudflare's `request.cf` object this reads. Declared locally rather
 * than pulled from `@cloudflare/workers-types`, so the Worker's types stay self-contained
 * and never leak Workers-runtime globals into the rest of this DOM-typed codebase.
 */
export interface IncomingRequestCfProperties {
  city?: string;
  region?: string;
  country?: string;
  continent?: string;
  postalCode?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
  colo?: string;
  asn?: number;
  asOrganization?: string;
  httpProtocol?: string;
  tlsVersion?: string;
  tlsCipher?: string;
}

/**
 * Headers a browser actually sends that are safe and informative to show back to the
 * same visitor who sent them. Deliberately excludes the raw `Cookie` value (presence is
 * shown instead, via `cookiesSent`) and any internal `cf-*`/proxy headers that aren't
 * something the *browser* chose to send.
 */
const VISIBLE_HEADERS = [
  'user-agent',
  'accept',
  'accept-language',
  'accept-encoding',
  'referer',
  'dnt',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-fetch-user',
  'upgrade-insecure-requests',
] as const;

export function extractServerSignals(request: Request, cf: IncomingRequestCfProperties | undefined): ServerSignals {
  const headers: Record<string, string> = {};
  for (const name of VISIBLE_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }

  return {
    ip: request.headers.get('cf-connecting-ip'),
    city: cf?.city ?? null,
    region: cf?.region ?? null,
    country: cf?.country ?? null,
    continent: cf?.continent ?? null,
    postalCode: cf?.postalCode ?? null,
    latitude: cf?.latitude ?? null,
    longitude: cf?.longitude ?? null,
    timezone: cf?.timezone ?? null,
    colo: cf?.colo ?? null,
    asn: cf?.asn ?? null,
    asOrganization: cf?.asOrganization ?? null,
    httpProtocol: cf?.httpProtocol ?? null,
    tlsVersion: cf?.tlsVersion ?? null,
    tlsCipher: cf?.tlsCipher ?? null,
    cookiesSent: request.headers.get('cookie') !== null,
    headers,
  };
}

/**
 * Serializes signals for inline injection into the page's `<head>`. Escaping `<` stops
 * a crafted header value (e.g. a `Referer` containing `</script>`) from breaking out of
 * the injected `<script>` tag — everything here originates from the visitor's own
 * request, so nothing about it can be assumed safe to embed unescaped.
 */
export function serializeServerSignals(signals: ServerSignals): string {
  return JSON.stringify(signals).replace(/</g, '\\u003c');
}
