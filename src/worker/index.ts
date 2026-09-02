/**
 * Deliberately the only Worker on this otherwise fully static site — see the comment
 * above `run_worker_first` in wrangler.jsonc for why it's scoped to exactly one route.
 *
 * This makes no extra network request of its own: it intercepts the *same* request that
 * was already going to fetch the page, reads what that request revealed (IP, geo, ASN,
 * headers), and injects it into the HTML before returning it — nothing a visitor's
 * browser wasn't already sending to load the page at all. The mapping logic lives in
 * `serverSignals.ts`, tested there with a plain `Request`; this file is thin routing and
 * HTMLRewriter glue that isn't practical to unit test outside the Workers runtime.
 */
import { extractServerSignals, serializeServerSignals, type IncomingRequestCfProperties } from './serverSignals';

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
}

interface CfRequest extends Request {
  readonly cf?: IncomingRequestCfProperties;
}

interface RewritableElement {
  append(content: string, options?: { html?: boolean }): RewritableElement;
}

declare class HTMLRewriter {
  on(selector: string, handlers: { element(element: RewritableElement): void }): HTMLRewriter;
  transform(response: Response): Response;
}

class InjectIntoHead {
  constructor(private readonly script: string) {}

  element(element: RewritableElement): void {
    element.append(this.script, { html: true });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);

    // Only HTML responses have a <head> to inject into — the route match in
    // wrangler.jsonc already limits this to the one page, but a direct request for a
    // non-HTML asset under that same path prefix (there shouldn't be one) falls through
    // untouched rather than risk corrupting it.
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response;

    const cf = (request as CfRequest).cf;
    const signals = extractServerSignals(request, cf);
    const script = `<script>window.__SERVER_REQUEST_INFO__=${serializeServerSignals(signals)}</script>`;

    const rewritten = new HTMLRewriter().on('head', new InjectIntoHead(script)).transform(response);

    // This response is personalized (it embeds the visitor's own IP and headers), so it
    // must never be cached and handed to a different visitor.
    const headers = new Headers(rewritten.headers);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(rewritten.body, { status: rewritten.status, statusText: rewritten.statusText, headers });
  },
};
