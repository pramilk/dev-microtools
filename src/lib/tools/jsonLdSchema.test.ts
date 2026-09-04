import { describe, expect, it } from 'vitest';
import {
  EMPTY_ARTICLE,
  EMPTY_PRODUCT,
  EMPTY_HOWTO,
  EMPTY_ORGANIZATION,
  buildArticleJsonLd,
  buildProductJsonLd,
  buildFaqPageJsonLd,
  buildHowToJsonLd,
  buildOrganizationJsonLd,
  buildBreadcrumbListJsonLd,
  type ArticleFields,
  type ProductFields,
  type HowToFields,
  type OrganizationFields,
} from './jsonLdSchema';

describe('buildArticleJsonLd', () => {
  it('builds minimal valid Article schema from just a headline', () => {
    const result = buildArticleJsonLd({ ...EMPTY_ARTICLE, headline: 'My Post' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jsonLd).toMatchObject({ '@context': 'https://schema.org', '@type': 'Article', headline: 'My Post' });
      expect(result.value.scriptTag).toContain('<script type="application/ld+json">');
      expect(result.value.warnings.length).toBeGreaterThan(0);
    }
  });

  it('rejects an empty headline', () => {
    expect(buildArticleJsonLd(EMPTY_ARTICLE).ok).toBe(false);
  });

  it('rejects an overlong headline', () => {
    const result = buildArticleJsonLd({ ...EMPTY_ARTICLE, headline: 'x'.repeat(111) });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed image URL', () => {
    const result = buildArticleJsonLd({ ...EMPTY_ARTICLE, headline: 'My Post', imageUrl: 'not-a-url' });
    expect(result.ok).toBe(false);
  });

  it('builds nested author and publisher objects', () => {
    const fields: ArticleFields = {
      ...EMPTY_ARTICLE,
      headline: 'My Post',
      authorName: 'Jane Doe',
      publisherName: 'Acme',
      publisherLogoUrl: 'https://example.com/logo.png',
    };
    const result = buildArticleJsonLd(fields);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jsonLd.author).toEqual({ '@type': 'Person', name: 'Jane Doe' });
      expect(result.value.jsonLd.publisher).toEqual({
        '@type': 'Organization',
        name: 'Acme',
        logo: { '@type': 'ImageObject', url: 'https://example.com/logo.png' },
      });
    }
  });

  it('has no warnings once every recommended field is filled', () => {
    const fields: ArticleFields = {
      headline: 'My Post',
      description: 'A description.',
      imageUrl: 'https://example.com/image.png',
      authorName: 'Jane Doe',
      datePublished: '2026-01-01',
      dateModified: '2026-01-02',
      publisherName: 'Acme',
      publisherLogoUrl: 'https://example.com/logo.png',
      pageUrl: 'https://example.com/post',
    };
    const result = buildArticleJsonLd(fields);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings).toEqual([]);
  });
});

describe('buildProductJsonLd', () => {
  it('rejects an empty name', () => {
    expect(buildProductJsonLd(EMPTY_PRODUCT).ok).toBe(false);
  });

  it('builds an offer when a price is given', () => {
    const fields: ProductFields = { ...EMPTY_PRODUCT, name: 'Widget', price: '19.99', priceCurrency: 'USD' };
    const result = buildProductJsonLd(fields);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jsonLd.offers).toMatchObject({
        '@type': 'Offer',
        priceCurrency: 'USD',
        price: '19.99',
        availability: 'https://schema.org/InStock',
      });
    }
  });

  it('omits offers entirely when no price is given', () => {
    const result = buildProductJsonLd({ ...EMPTY_PRODUCT, name: 'Widget' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.jsonLd.offers).toBeUndefined();
  });

  it('rejects a malformed price', () => {
    const result = buildProductJsonLd({ ...EMPTY_PRODUCT, name: 'Widget', price: 'nineteen' });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid currency code', () => {
    const result = buildProductJsonLd({ ...EMPTY_PRODUCT, name: 'Widget', price: '19.99', priceCurrency: 'dollars' });
    expect(result.ok).toBe(false);
  });

  it('rejects a rating outside 1-5', () => {
    const result = buildProductJsonLd({ ...EMPTY_PRODUCT, name: 'Widget', ratingValue: '6', reviewCount: '10' });
    expect(result.ok).toBe(false);
  });

  it('omits aggregateRating and warns when only one of rating/reviewCount is set', () => {
    const result = buildProductJsonLd({ ...EMPTY_PRODUCT, name: 'Widget', ratingValue: '4.5' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jsonLd.aggregateRating).toBeUndefined();
      expect(result.value.warnings.some((w) => w.includes('both a value and a review count'))).toBe(true);
    }
  });

  it('builds aggregateRating and warns about fabricated ratings when both are set', () => {
    const result = buildProductJsonLd({ ...EMPTY_PRODUCT, name: 'Widget', ratingValue: '4.5', reviewCount: '120' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jsonLd.aggregateRating).toEqual({ '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: '120' });
      expect(result.value.warnings.some((w) => w.includes('fabricated or unverifiable'))).toBe(true);
    }
  });
});

describe('buildFaqPageJsonLd', () => {
  it('rejects when no complete pair exists', () => {
    expect(buildFaqPageJsonLd([{ question: 'Q with no answer', answer: '' }]).ok).toBe(false);
  });

  it('builds mainEntity from complete pairs only', () => {
    const result = buildFaqPageJsonLd([
      { question: 'What is this?', answer: 'A tool.' },
      { question: 'Incomplete', answer: '' },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jsonLd.mainEntity).toEqual([
        { '@type': 'Question', name: 'What is this?', acceptedAnswer: { '@type': 'Answer', text: 'A tool.' } },
      ]);
    }
  });

  it('always includes the Google rich-result eligibility caveat', () => {
    const result = buildFaqPageJsonLd([{ question: 'What is this?', answer: 'A tool.' }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings.some((w) => w.includes('2023'))).toBe(true);
  });
});

describe('buildHowToJsonLd', () => {
  it('rejects an empty name', () => {
    expect(buildHowToJsonLd(EMPTY_HOWTO).ok).toBe(false);
  });

  it('rejects when there are no steps', () => {
    const result = buildHowToJsonLd({ ...EMPTY_HOWTO, name: 'Make tea' });
    expect(result.ok).toBe(false);
  });

  it('builds steps, supplies and tools', () => {
    const fields: HowToFields = {
      ...EMPTY_HOWTO,
      name: 'Make tea',
      totalTime: 'PT5M',
      supplies: 'Tea bag\nWater',
      tools: 'Kettle',
      steps: [
        { name: 'Boil water', text: 'Boil the water.', imageUrl: '' },
        { name: 'Steep', text: 'Steep the tea bag.', imageUrl: '' },
      ],
    };
    const result = buildHowToJsonLd(fields);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jsonLd.step).toHaveLength(2);
      expect(result.value.jsonLd.supply).toEqual([
        { '@type': 'HowToSupply', name: 'Tea bag' },
        { '@type': 'HowToSupply', name: 'Water' },
      ]);
      expect(result.value.jsonLd.tool).toEqual([{ '@type': 'HowToTool', name: 'Kettle' }]);
      expect(result.value.jsonLd.totalTime).toBe('PT5M');
    }
  });

  it('rejects a malformed ISO 8601 duration', () => {
    const result = buildHowToJsonLd({
      ...EMPTY_HOWTO,
      name: 'Make tea',
      totalTime: '5 minutes',
      steps: [{ name: 'Boil', text: 'Boil water.', imageUrl: '' }],
    });
    expect(result.ok).toBe(false);
  });

  it('always includes the Google How-to retirement caveat', () => {
    const result = buildHowToJsonLd({ ...EMPTY_HOWTO, name: 'Make tea', steps: [{ name: 'Boil', text: 'Boil water.', imageUrl: '' }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings.some((w) => w.includes('retired'))).toBe(true);
  });
});

describe('buildOrganizationJsonLd', () => {
  it('rejects an empty name', () => {
    expect(buildOrganizationJsonLd(EMPTY_ORGANIZATION).ok).toBe(false);
  });

  it('builds sameAs from newline-separated URLs', () => {
    const fields: OrganizationFields = {
      ...EMPTY_ORGANIZATION,
      name: 'Acme',
      sameAs: 'https://twitter.com/acme\nhttps://github.com/acme',
    };
    const result = buildOrganizationJsonLd(fields);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.jsonLd.sameAs).toEqual(['https://twitter.com/acme', 'https://github.com/acme']);
  });

  it('rejects a malformed sameAs URL', () => {
    const result = buildOrganizationJsonLd({ ...EMPTY_ORGANIZATION, name: 'Acme', sameAs: 'not-a-url' });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed email', () => {
    const result = buildOrganizationJsonLd({ ...EMPTY_ORGANIZATION, name: 'Acme', email: 'not-an-email' });
    expect(result.ok).toBe(false);
  });

  it('builds a contactPoint only when at least one contact field is set', () => {
    const withoutContact = buildOrganizationJsonLd({ ...EMPTY_ORGANIZATION, name: 'Acme' });
    expect(withoutContact.ok).toBe(true);
    if (withoutContact.ok) expect(withoutContact.value.jsonLd.contactPoint).toBeUndefined();

    const withContact = buildOrganizationJsonLd({ ...EMPTY_ORGANIZATION, name: 'Acme', email: 'hello@acme.com' });
    expect(withContact.ok).toBe(true);
    if (withContact.ok) expect(withContact.value.jsonLd.contactPoint).toEqual({ '@type': 'ContactPoint', email: 'hello@acme.com' });
  });
});

describe('buildBreadcrumbListJsonLd', () => {
  it('rejects when there are no named items', () => {
    expect(buildBreadcrumbListJsonLd([{ name: '', url: '' }]).ok).toBe(false);
  });

  it('numbers positions starting at 1', () => {
    const result = buildBreadcrumbListJsonLd([
      { name: 'Home', url: 'https://example.com/' },
      { name: 'Blog', url: 'https://example.com/blog' },
      { name: 'Post', url: '' },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jsonLd.itemListElement).toEqual([
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://example.com/blog' },
        { '@type': 'ListItem', position: 3, name: 'Post' },
      ]);
    }
  });

  it('rejects a malformed breadcrumb URL', () => {
    const result = buildBreadcrumbListJsonLd([{ name: 'Home', url: 'not-a-url' }]);
    expect(result.ok).toBe(false);
  });
});
