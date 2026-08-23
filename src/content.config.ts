import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
// Imported directly rather than re-exported from astro:content, which is deprecated.
import { z } from 'zod';

/**
 * Tool content schema.
 *
 * The content fields below are deliberately REQUIRED, not optional. A tool page that
 * is just an interactive widget with no written explanation is thin content — it ranks
 * badly and is a documented AdSense rejection cause. Making these required means a
 * half-documented tool fails the build instead of silently shipping.
 *
 * Do not relax these to optional to "add the content later".
 */
const tools = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/tools' }),
  schema: z
    .object({
      /** Short name used in nav, cards and breadcrumbs. e.g. "JSON Formatter" */
      title: z.string().min(3).max(40),
      /** Page <h1>. May be longer and more descriptive than `title`. */
      headline: z.string().min(10).max(70),
      /** Meta description. Google truncates around 160 characters. */
      description: z.string().min(70).max(160),
      /** One-line summary shown on the homepage tool card. */
      summary: z.string().min(20).max(120),
      category: z.enum(['Convert', 'Generate', 'Inspect', 'Compare', 'Format', 'Style']),
      /** Sort order within the homepage listing. Lower shows first. */
      order: z.number().int().nonnegative(),

      /** What the tool is and what problem it solves. At least a real paragraph. */
      whatIsIt: z.string().min(200),
      /** Concrete situations where someone reaches for this tool. */
      useCases: z.array(z.string().min(30)).min(3),
      /** Step-by-step usage instructions. */
      howTo: z.array(z.string().min(15)).min(3),
      /** A worked example so the page demonstrates the tool, not just describes it. */
      example: z.object({
        label: z.string().min(3),
        input: z.string().min(1),
        output: z.string().min(1),
        note: z.string().optional(),
      }),
      /** Genuine questions people actually ask. Not keyword padding. */
      faq: z
        .array(
          z.object({
            q: z.string().min(10),
            a: z.string().min(50),
          })
        )
        .min(3),

      /** Slugs of related tools, for internal linking. */
      related: z.array(z.string()).min(2).max(4),

      /** Used for `dateModified` in structured data. */
      updated: z.coerce.date(),
    })
    .strict(),
});

export const collections = { tools };
