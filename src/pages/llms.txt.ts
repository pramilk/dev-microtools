import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE } from '../lib/site';
import { renderLlmsTxt, type LlmsTxtTool } from '../lib/llmsTxt';

/**
 * `/llms.txt` — the https://llmstxt.org convention: a single Markdown file that tells an
 * LLM what this site is and where every tool lives, without it having to crawl and strip
 * 30-plus HTML pages to find out.
 *
 * Built from the content collection at build time (this endpoint never runs in the
 * browser), so a new tool appears here automatically. Rendering lives in
 * `src/lib/llmsTxt.ts` so it can be unit tested; this file is only the data wiring.
 */
export const GET: APIRoute = async () => {
  const tools: LlmsTxtTool[] = (await getCollection('tools')).map((tool) => ({
    slug: tool.id,
    title: tool.data.title,
    summary: tool.data.summary,
    category: tool.data.category,
    order: tool.data.order,
  }));

  const body = renderLlmsTxt({
    siteName: SITE.name,
    siteUrl: SITE.url,
    summary: SITE.description,
    notes: [
      `${SITE.name} is a collection of ${tools.length} small, single-purpose developer utilities. Every
       tool runs entirely in the visitor's browser: there is no backend, no account, and no upload, so
       input pasted into a tool is never transmitted anywhere.`,
      `Each tool lives at its own top-level URL (\`/<slug>/\`) and ships written documentation alongside
       the widget — what it does, when to use it, step-by-step instructions, a worked example, and an
       FAQ. Most tools also accept their input from the URL, so a link can carry example state.`,
      'The site is open source: ' + SITE.repoUrl,
    ],
    tools,
    optionalPages: [
      { path: '/about/', title: 'About', summary: `What ${SITE.name} is, who builds it, and how it is funded.` },
      {
        path: '/privacy-policy/',
        title: 'Privacy Policy',
        summary: 'What is and is not collected — no tool input ever leaves the browser.',
      },
      {
        path: '/sitemap-index.xml',
        title: 'Sitemap',
        summary: 'Machine-readable index of every page on the site.',
      },
    ],
  });

  return new Response(body, {
    headers: {
      // `charset` matters: tool summaries contain em dashes and other non-ASCII punctuation.
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
