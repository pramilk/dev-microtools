import { type ToolResult, ok, err } from './result';

export type SchemaType = 'Article' | 'Product' | 'FAQPage' | 'HowTo' | 'Organization' | 'BreadcrumbList';

export const SCHEMA_TYPES: readonly { value: SchemaType; label: string; hint: string }[] = [
  { value: 'Article', label: 'Article', hint: 'A blog post or news article.' },
  { value: 'Product', label: 'Product', hint: 'A product page with an offer and optional rating.' },
  { value: 'FAQPage', label: 'FAQ page', hint: 'A list of question-and-answer pairs.' },
  { value: 'HowTo', label: 'How-to', hint: 'A sequence of steps for completing a task.' },
  { value: 'Organization', label: 'Organization', hint: "A company or site's own identity." },
  { value: 'BreadcrumbList', label: 'Breadcrumbs', hint: "A page's position in the site hierarchy." },
];

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function requireAbsoluteUrl(value: string, label: string): ToolResult<string> {
  const trimmed = value.trim();
  if (!isAbsoluteHttpUrl(trimmed)) {
    return err(`${label} "${value}" is not a full URL — include the scheme, e.g. https://example.com/page.`);
  }
  return ok(trimmed);
}

/** Pretty-printed and `</script>`-safe, matching lib/jsonLd.ts's escaping — but indented,
 *  since this output is meant to be read and reviewed before it's pasted anywhere. */
function toReadableJsonLd(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function scriptTag(jsonLd: unknown): string {
  return `<script type="application/ld+json">\n${toReadableJsonLd(jsonLd)}\n</script>`;
}

export interface SchemaResult {
  jsonLd: Record<string, unknown>;
  scriptTag: string;
  warnings: string[];
}

// --------------------------------------------------------------------------------- Article

export interface ArticleFields {
  headline: string;
  description: string;
  imageUrl: string;
  authorName: string;
  datePublished: string;
  dateModified: string;
  publisherName: string;
  publisherLogoUrl: string;
  pageUrl: string;
}

export const EMPTY_ARTICLE: ArticleFields = {
  headline: '',
  description: '',
  imageUrl: '',
  authorName: '',
  datePublished: '',
  dateModified: '',
  publisherName: '',
  publisherLogoUrl: '',
  pageUrl: '',
};

export function buildArticleJsonLd(fields: ArticleFields): ToolResult<SchemaResult> {
  const headline = fields.headline.trim();
  if (headline === '') return err('Enter a headline to generate Article schema.');
  if (headline.length > 110) {
    return err(`The headline is ${headline.length} characters — Google truncates Article headlines around 110.`);
  }

  for (const [label, value] of [
    ['Image URL', fields.imageUrl],
    ['Page URL', fields.pageUrl],
    ['Publisher logo URL', fields.publisherLogoUrl],
  ] as const) {
    if (value.trim() !== '') {
      const result = requireAbsoluteUrl(value, label);
      if (!result.ok) return result;
    }
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
  };
  const description = fields.description.trim();
  if (description !== '') jsonLd.description = description;
  if (fields.imageUrl.trim() !== '') jsonLd.image = [fields.imageUrl.trim()];
  if (fields.datePublished.trim() !== '') jsonLd.datePublished = fields.datePublished.trim();
  if (fields.dateModified.trim() !== '') jsonLd.dateModified = fields.dateModified.trim();
  if (fields.authorName.trim() !== '') jsonLd.author = { '@type': 'Person', name: fields.authorName.trim() };
  if (fields.publisherName.trim() !== '') {
    const publisher: Record<string, unknown> = { '@type': 'Organization', name: fields.publisherName.trim() };
    if (fields.publisherLogoUrl.trim() !== '') {
      publisher.logo = { '@type': 'ImageObject', url: fields.publisherLogoUrl.trim() };
    }
    jsonLd.publisher = publisher;
  }
  if (fields.pageUrl.trim() !== '') {
    jsonLd.mainEntityOfPage = { '@type': 'WebPage', '@id': fields.pageUrl.trim() };
  }

  const warnings: string[] = [];
  if (description === '') warnings.push('No description — Google may generate its own snippet instead.');
  if (fields.imageUrl.trim() === '') warnings.push('No image — Article rich results generally require at least one image.');
  if (fields.datePublished.trim() === '') warnings.push('No datePublished — recommended so search engines can show and sort by publish date.');
  if (fields.authorName.trim() === '') warnings.push('No author — recommended for E-E-A-T signals and byline display.');

  return ok({ jsonLd, scriptTag: scriptTag(jsonLd), warnings });
}

// --------------------------------------------------------------------------------- Product

export type ProductAvailability = 'InStock' | 'OutOfStock' | 'PreOrder' | 'LimitedAvailability';

export const PRODUCT_AVAILABILITY: readonly { value: ProductAvailability; label: string }[] = [
  { value: 'InStock', label: 'In stock' },
  { value: 'OutOfStock', label: 'Out of stock' },
  { value: 'PreOrder', label: 'Pre-order' },
  { value: 'LimitedAvailability', label: 'Limited availability' },
];

export interface ProductFields {
  name: string;
  description: string;
  imageUrl: string;
  brand: string;
  sku: string;
  pageUrl: string;
  priceCurrency: string;
  price: string;
  availability: ProductAvailability;
  ratingValue: string;
  reviewCount: string;
}

export const EMPTY_PRODUCT: ProductFields = {
  name: '',
  description: '',
  imageUrl: '',
  brand: '',
  sku: '',
  pageUrl: '',
  priceCurrency: 'USD',
  price: '',
  availability: 'InStock',
  ratingValue: '',
  reviewCount: '',
};

const CURRENCY_CODE = /^[A-Z]{3}$/;

export function buildProductJsonLd(fields: ProductFields): ToolResult<SchemaResult> {
  const name = fields.name.trim();
  if (name === '') return err('Enter a product name to generate Product schema.');

  for (const [label, value] of [
    ['Image URL', fields.imageUrl],
    ['Product page URL', fields.pageUrl],
  ] as const) {
    if (value.trim() !== '') {
      const result = requireAbsoluteUrl(value, label);
      if (!result.ok) return result;
    }
  }

  const price = fields.price.trim();
  if (price !== '' && !/^\d+(\.\d{1,2})?$/.test(price)) {
    return err(`"${price}" is not a valid price — use a plain number like 19.99, with no currency symbol.`);
  }
  const priceCurrency = fields.priceCurrency.trim().toUpperCase();
  if (price !== '' && !CURRENCY_CODE.test(priceCurrency)) {
    return err(`"${fields.priceCurrency}" is not a valid ISO 4217 currency code — use a 3-letter code like USD or EUR.`);
  }

  const ratingValue = fields.ratingValue.trim();
  const reviewCount = fields.reviewCount.trim();
  if (ratingValue !== '') {
    const rating = Number(ratingValue);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return err('Rating value must be a number between 1 and 5.');
    }
  }
  if (reviewCount !== '' && (!/^\d+$/.test(reviewCount) || Number(reviewCount) < 1)) {
    return err('Review count must be a positive whole number.');
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
  };
  const description = fields.description.trim();
  if (description !== '') jsonLd.description = description;
  if (fields.imageUrl.trim() !== '') jsonLd.image = [fields.imageUrl.trim()];
  if (fields.brand.trim() !== '') jsonLd.brand = { '@type': 'Brand', name: fields.brand.trim() };
  if (fields.sku.trim() !== '') jsonLd.sku = fields.sku.trim();

  if (price !== '') {
    const offer: Record<string, unknown> = {
      '@type': 'Offer',
      priceCurrency,
      price,
      availability: `https://schema.org/${fields.availability}`,
    };
    if (fields.pageUrl.trim() !== '') offer.url = fields.pageUrl.trim();
    jsonLd.offers = offer;
  }

  if (ratingValue !== '' && reviewCount !== '') {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue,
      reviewCount,
    };
  }

  const warnings: string[] = [];
  if (fields.imageUrl.trim() === '') warnings.push('No image — Product rich results require at least one image.');
  if (price === '') warnings.push('No price — offers is omitted entirely without one.');
  if ((ratingValue !== '') !== (reviewCount !== '')) {
    warnings.push('A rating needs both a value and a review count — aggregateRating is omitted until both are filled in.');
  }
  if (ratingValue !== '' && reviewCount !== '') {
    warnings.push(
      'Only use aggregateRating for genuine reviews you can verify — Google can manually penalize structured data with fabricated or unverifiable ratings.'
    );
  }

  return ok({ jsonLd, scriptTag: scriptTag(jsonLd), warnings });
}

// --------------------------------------------------------------------------------- FAQPage

export interface FaqItem {
  question: string;
  answer: string;
}

export const EMPTY_FAQ_ITEM: FaqItem = { question: '', answer: '' };

export function buildFaqPageJsonLd(items: FaqItem[]): ToolResult<SchemaResult> {
  const filled = items.filter((item) => item.question.trim() !== '' && item.answer.trim() !== '');
  if (filled.length === 0) return err('Add at least one question and answer to generate FAQ schema.');

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: filled.map((item) => ({
      '@type': 'Question',
      name: item.question.trim(),
      acceptedAnswer: { '@type': 'Answer', text: item.answer.trim() },
    })),
  };

  const warnings: string[] = [];
  if (items.some((item) => (item.question.trim() === '') !== (item.answer.trim() === ''))) {
    warnings.push('A question with no answer (or an answer with no question) is skipped in the output — fill in both sides of each pair.');
  }
  warnings.push(
    'Google restricted FAQ rich results in search to government and well-known health sites as of 2023 — this markup is still valid schema.org and other engines/assistants may still use it, but do not expect a Google search rich result from it on a typical site.'
  );

  return ok({ jsonLd, scriptTag: scriptTag(jsonLd), warnings });
}

// --------------------------------------------------------------------------------- HowTo

export interface HowToStep {
  name: string;
  text: string;
  imageUrl: string;
}

export const EMPTY_HOWTO_STEP: HowToStep = { name: '', text: '', imageUrl: '' };

export interface HowToFields {
  name: string;
  description: string;
  totalTime: string;
  supplies: string;
  tools: string;
  steps: HowToStep[];
}

export const EMPTY_HOWTO: HowToFields = {
  name: '',
  description: '',
  totalTime: '',
  supplies: '',
  tools: '',
  steps: [],
};

const ISO_8601_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/;

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildHowToJsonLd(fields: HowToFields): ToolResult<SchemaResult> {
  const name = fields.name.trim();
  if (name === '') return err('Enter a title to generate How-to schema.');

  const steps = fields.steps.filter((step) => step.name.trim() !== '' || step.text.trim() !== '');
  if (steps.length === 0) return err('Add at least one step to generate How-to schema.');

  for (const step of steps) {
    if (step.imageUrl.trim() !== '') {
      const result = requireAbsoluteUrl(step.imageUrl, `Step "${step.name.trim() || step.text.trim().slice(0, 30)}"'s image URL`);
      if (!result.ok) return result;
    }
  }

  const totalTime = fields.totalTime.trim();
  if (totalTime !== '' && !ISO_8601_DURATION.test(totalTime)) {
    return err(`"${totalTime}" is not a valid ISO 8601 duration — use a format like PT30M (30 minutes) or PT1H30M (1 hour 30 minutes).`);
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    step: steps.map((step) => {
      const stepEntry: Record<string, unknown> = { '@type': 'HowToStep' };
      if (step.name.trim() !== '') stepEntry.name = step.name.trim();
      stepEntry.text = step.text.trim() || step.name.trim();
      if (step.imageUrl.trim() !== '') stepEntry.image = step.imageUrl.trim();
      return stepEntry;
    }),
  };
  const description = fields.description.trim();
  if (description !== '') jsonLd.description = description;
  if (totalTime !== '') jsonLd.totalTime = totalTime;
  const supplies = splitLines(fields.supplies);
  if (supplies.length > 0) jsonLd.supply = supplies.map((name) => ({ '@type': 'HowToSupply', name }));
  const tools = splitLines(fields.tools);
  if (tools.length > 0) jsonLd.tool = tools.map((name) => ({ '@type': 'HowToTool', name }));

  const warnings: string[] = [
    'Google retired the dedicated How-to rich result in most locales in 2023 — this markup is still valid schema.org and may still be used by other search engines and voice assistants, but do not expect a Google-specific rich result from it.',
  ];
  if (description === '') warnings.push('No description — recommended for context on what the finished task looks like.');

  return ok({ jsonLd, scriptTag: scriptTag(jsonLd), warnings });
}

// --------------------------------------------------------------------------- Organization

export interface OrganizationFields {
  name: string;
  url: string;
  logoUrl: string;
  description: string;
  sameAs: string;
  telephone: string;
  contactType: string;
  email: string;
}

export const EMPTY_ORGANIZATION: OrganizationFields = {
  name: '',
  url: '',
  logoUrl: '',
  description: '',
  sameAs: '',
  telephone: '',
  contactType: '',
  email: '',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildOrganizationJsonLd(fields: OrganizationFields): ToolResult<SchemaResult> {
  const name = fields.name.trim();
  if (name === '') return err('Enter an organization name to generate Organization schema.');

  for (const [label, value] of [
    ['Website URL', fields.url],
    ['Logo URL', fields.logoUrl],
  ] as const) {
    if (value.trim() !== '') {
      const result = requireAbsoluteUrl(value, label);
      if (!result.ok) return result;
    }
  }

  const sameAs = splitLines(fields.sameAs);
  for (const url of sameAs) {
    if (!isAbsoluteHttpUrl(url)) return err(`"${url}" in Social profile URLs is not a full URL.`);
  }

  const email = fields.email.trim();
  if (email !== '' && !EMAIL_PATTERN.test(email)) return err(`"${email}" is not a valid email address.`);

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
  };
  if (fields.url.trim() !== '') jsonLd.url = fields.url.trim();
  if (fields.logoUrl.trim() !== '') jsonLd.logo = fields.logoUrl.trim();
  const description = fields.description.trim();
  if (description !== '') jsonLd.description = description;
  if (sameAs.length > 0) jsonLd.sameAs = sameAs;

  const telephone = fields.telephone.trim();
  const contactType = fields.contactType.trim();
  if (telephone !== '' || contactType !== '' || email !== '') {
    const contactPoint: Record<string, unknown> = { '@type': 'ContactPoint' };
    if (telephone !== '') contactPoint.telephone = telephone;
    if (contactType !== '') contactPoint.contactType = contactType;
    if (email !== '') contactPoint.email = email;
    jsonLd.contactPoint = contactPoint;
  }

  const warnings: string[] = [];
  if (fields.logoUrl.trim() === '') warnings.push('No logo — recommended so Google Knowledge Panel and search results can show your brand mark.');
  if (sameAs.length === 0) warnings.push('No social profile URLs (sameAs) — these help search engines confirm this is the same organization across the web.');

  return ok({ jsonLd, scriptTag: scriptTag(jsonLd), warnings });
}

// ------------------------------------------------------------------------- BreadcrumbList

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export const EMPTY_BREADCRUMB_ITEM: BreadcrumbItem = { name: '', url: '' };

export function buildBreadcrumbListJsonLd(items: BreadcrumbItem[]): ToolResult<SchemaResult> {
  const filled = items.filter((item) => item.name.trim() !== '');
  if (filled.length === 0) return err('Add at least one breadcrumb with a name to generate BreadcrumbList schema.');

  for (const item of filled) {
    if (item.url.trim() !== '') {
      const result = requireAbsoluteUrl(item.url, `"${item.name.trim()}"'s URL`);
      if (!result.ok) return result;
    }
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: filled.map((item, index) => {
      const entry: Record<string, unknown> = { '@type': 'ListItem', position: index + 1, name: item.name.trim() };
      if (item.url.trim() !== '') entry.item = item.url.trim();
      return entry;
    }),
  };

  const warnings: string[] = [];
  if (filled.some((item) => item.url.trim() === '')) {
    warnings.push("A breadcrumb with no URL is fine for the current page (the last item), but any earlier one without a URL isn't a valid link for search engines to follow.");
  }

  return ok({ jsonLd, scriptTag: scriptTag(jsonLd), warnings });
}
