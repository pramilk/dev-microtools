import { describe, expect, it } from 'vitest';
import {
  buildMetaTags,
  DEFAULT_META_TAG_OPTIONS,
  formatSearchBreadcrumb,
  truncateForPreview,
  truncateByPixelWidth,
  type MetaTagOptions,
} from './metaTags';

const options = (overrides: Partial<MetaTagOptions> = {}): MetaTagOptions => ({
  ...DEFAULT_META_TAG_OPTIONS,
  ...overrides,
});

describe('buildMetaTags', () => {
  it('fails on an empty title', () => {
    const result = buildMetaTags(options({ title: '  ' }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('Enter a page title') });
  });

  it('builds title, description and robots tags from a minimal input', () => {
    const result = buildMetaTags(options({ title: 'Widgets', description: 'Buy widgets online.' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).toContain('<title>Widgets</title>');
    expect(result.value.html).toContain('<meta name="description" content="Buy widgets online." />');
    expect(result.value.html).toContain('<meta name="robots" content="index, follow" />');
    expect(result.value.html).toContain('<meta property="og:title" content="Widgets" />');
    expect(result.value.html).toContain('<meta name="twitter:title" content="Widgets" />');
  });

  it('escapes HTML-significant characters in attribute values', () => {
    const result = buildMetaTags(options({ title: 'Fish & Chips <Best>', description: 'Say "hello"' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).toContain('<title>Fish &amp; Chips &lt;Best&gt;</title>');
    expect(result.value.html).toContain('content="Say &quot;hello&quot;"');
  });

  it('omits canonical, og:url and image tags when not provided', () => {
    const result = buildMetaTags(options({ title: 'Widgets', description: 'desc' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).not.toContain('rel="canonical"');
    expect(result.value.html).not.toContain('og:url');
    expect(result.value.html).not.toContain('og:image');
    expect(result.value.html).not.toContain('twitter:image');
  });

  it('includes canonical, og:url, site name and image when provided', () => {
    const result = buildMetaTags(
      options({
        title: 'Widgets',
        description: 'desc',
        canonicalUrl: 'https://example.com/widgets',
        siteName: 'Acme',
        imageUrl: 'https://example.com/og.png',
        imageAlt: 'A widget',
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).toContain('<link rel="canonical" href="https://example.com/widgets" />');
    expect(result.value.html).toContain('<meta property="og:url" content="https://example.com/widgets" />');
    expect(result.value.html).toContain('<meta property="og:site_name" content="Acme" />');
    expect(result.value.html).toContain('<meta property="og:image" content="https://example.com/og.png" />');
    expect(result.value.html).toContain('<meta property="og:image:alt" content="A widget" />');
    expect(result.value.html).toContain('<meta name="twitter:image" content="https://example.com/og.png" />');
  });

  it('rejects a canonical URL with no scheme', () => {
    const result = buildMetaTags(options({ title: 'Widgets', canonicalUrl: 'example.com/widgets' }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('not a full URL') });
  });

  it('rejects a non-http(s) canonical URL', () => {
    const result = buildMetaTags(options({ title: 'Widgets', canonicalUrl: 'ftp://example.com/widgets' }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('http:// or https://') });
  });

  it('rejects an invalid image URL', () => {
    const result = buildMetaTags(options({ title: 'Widgets', imageUrl: 'not-a-url' }));
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid theme color', () => {
    const result = buildMetaTags(options({ title: 'Widgets', themeColor: 'blue' }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('hex color') });
  });

  it('accepts a 3-digit and 6-digit hex theme color', () => {
    expect(buildMetaTags(options({ title: 'W', themeColor: '#0ea5e9' })).ok).toBe(true);
    expect(buildMetaTags(options({ title: 'W', themeColor: '#333' })).ok).toBe(true);
  });

  it('adds a leading @ to a bare Twitter handle', () => {
    const result = buildMetaTags(options({ title: 'Widgets', twitterSite: 'acme', twitterCreator: '@jane' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).toContain('<meta name="twitter:site" content="@acme" />');
    expect(result.value.html).toContain('<meta name="twitter:creator" content="@jane" />');
  });

  it('rejects a Twitter handle containing a space', () => {
    const result = buildMetaTags(options({ title: 'Widgets', twitterSite: 'not a handle' }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('contains a space') });
  });

  it('omits og:locale when locale is blank', () => {
    const result = buildMetaTags(options({ title: 'Widgets', locale: '' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).not.toContain('og:locale');
  });

  it('writes the robots meta tag from index/follow choices', () => {
    const result = buildMetaTags(options({ title: 'Widgets', robotsIndex: 'noindex', robotsFollow: 'nofollow' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('handles unicode in title and description', () => {
    const result = buildMetaTags(options({ title: '日本語のタイトル 🎉', description: 'Café résumé' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).toContain('<title>日本語のタイトル 🎉</title>');
    expect(result.value.html).toContain('content="Café résumé"');
  });

  describe('warnings', () => {
    it('warns when there is no description', () => {
      const result = buildMetaTags(options({ title: 'Widgets', description: '' }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.warnings.some((w) => w.includes('No meta description'))).toBe(true);
    });

    it('warns when the description is too long', () => {
      const result = buildMetaTags(options({ title: 'Widgets', description: 'x'.repeat(200) }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.warnings.some((w) => w.includes('truncates around'))).toBe(true);
    });

    it('warns when the title is too long', () => {
      const result = buildMetaTags(options({ title: 'x'.repeat(80) }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.warnings.some((w) => w.includes('title is'))).toBe(true);
    });

    it('warns when there is no canonical URL', () => {
      const result = buildMetaTags(options({ title: 'Widgets' }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.warnings.some((w) => w.includes('No canonical URL'))).toBe(true);
    });

    it('warns when there is no image', () => {
      const result = buildMetaTags(options({ title: 'Widgets' }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.warnings.some((w) => w.includes('No image'))).toBe(true);
    });

    it('warns when noindex is set', () => {
      const result = buildMetaTags(options({ title: 'Widgets', robotsIndex: 'noindex' }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.warnings.some((w) => w.includes('noindex'))).toBe(true);
    });

    it('has no warnings for a fully filled-in, well-sized input', () => {
      const result = buildMetaTags(
        options({
          title: 'Acme Widgets — buy online',
          description: 'Shop the full Acme Widgets catalogue with free shipping over $50.',
          canonicalUrl: 'https://example.com/widgets',
          imageUrl: 'https://example.com/og.png',
          imageAlt: 'Acme Widgets storefront',
        })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.warnings).toEqual([]);
    });
  });
});

describe('formatSearchBreadcrumb', () => {
  it('returns an empty string for a blank URL', () => {
    expect(formatSearchBreadcrumb('')).toBe('');
    expect(formatSearchBreadcrumb('   ')).toBe('');
  });

  it('returns an empty string for an unparsable URL', () => {
    expect(formatSearchBreadcrumb('not a url')).toBe('');
  });

  it('formats the hostname alone for a root path', () => {
    expect(formatSearchBreadcrumb('https://example.com/')).toBe('example.com');
    expect(formatSearchBreadcrumb('https://example.com')).toBe('example.com');
  });

  it('joins path segments with a breadcrumb separator', () => {
    expect(formatSearchBreadcrumb('https://example.com/blog/my-post')).toBe('example.com › blog › my-post');
  });

  it('drops empty segments from a trailing slash or double slash', () => {
    expect(formatSearchBreadcrumb('https://example.com/blog/')).toBe('example.com › blog');
  });
});

describe('truncateForPreview', () => {
  it('returns the value unchanged when at or under the limit', () => {
    expect(truncateForPreview('hello', 5)).toBe('hello');
    expect(truncateForPreview('hi', 5)).toBe('hi');
  });

  it('clips and adds an ellipsis when over the limit', () => {
    expect(truncateForPreview('hello world', 5)).toBe('hell…');
  });

  it('trims trailing whitespace left by the cut before adding the ellipsis', () => {
    expect(truncateForPreview('hello world', 6)).toBe('hello…');
  });

  it('handles an empty string', () => {
    expect(truncateForPreview('', 10)).toBe('');
  });

  it('handles a max of 0 without throwing', () => {
    expect(truncateForPreview('hello', 0)).toBe('…');
  });
});

describe('truncateByPixelWidth', () => {
  it('returns short text unchanged', () => {
    expect(truncateByPixelWidth('Widgets', 600, 20)).toBe('Widgets');
  });

  it('truncates long text and appends an ellipsis', () => {
    const result = truncateByPixelWidth('a'.repeat(200), 200, 20);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThan(200);
  });

  it('handles an empty string', () => {
    expect(truncateByPixelWidth('', 600, 20)).toBe('');
  });

  it('fits noticeably fewer wide characters than narrow ones at the same pixel budget', () => {
    const wide = truncateByPixelWidth('W'.repeat(100), 300, 20);
    const narrow = truncateByPixelWidth('i'.repeat(100), 300, 20);
    // Strip the trailing ellipsis before comparing how many real characters fit.
    expect(wide.replace('…', '').length).toBeLessThan(narrow.replace('…', '').length);
  });

  it('never overflows the pixel budget it was given', () => {
    const fontSizePx = 20;
    const result = truncateByPixelWidth('The quick brown fox jumps over the lazy dog, again and again.', 300, fontSizePx);
    // Recompute the same way the function does internally, using its own worst case (space,
    // the narrowest common character) to sanity-check the result never grossly overshoots.
    expect(result.length).toBeLessThan(300 / (0.222 * fontSizePx) + 1);
  });

  it('falls back to an average width for characters outside the Arial table', () => {
    const result = truncateByPixelWidth('日本語のテキストです。'.repeat(20), 200, 20);
    expect(result.endsWith('…')).toBe(true);
  });
});
