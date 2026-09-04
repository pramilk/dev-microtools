import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  SCHEMA_TYPES,
  PRODUCT_AVAILABILITY,
  EMPTY_ARTICLE,
  EMPTY_PRODUCT,
  EMPTY_FAQ_ITEM,
  EMPTY_HOWTO,
  EMPTY_HOWTO_STEP,
  EMPTY_ORGANIZATION,
  EMPTY_BREADCRUMB_ITEM,
  buildArticleJsonLd,
  buildProductJsonLd,
  buildFaqPageJsonLd,
  buildHowToJsonLd,
  buildOrganizationJsonLd,
  buildBreadcrumbListJsonLd,
  type SchemaType,
  type ArticleFields,
  type ProductFields,
  type FaqItem,
  type HowToFields,
  type HowToStep,
  type OrganizationFields,
  type BreadcrumbItem,
} from '../lib/tools/jsonLdSchema';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

function updateAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}
function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** Matches `example.input`/`output` in json-ld-generator.mdx (the Article tab) — keep in step. */
const EXAMPLE_ARTICLE: ArticleFields = {
  headline: 'How CSP Headers Actually Stop Injected Scripts',
  description: 'A walkthrough of how a Content-Security-Policy blocks script injection in practice, with real header examples.',
  imageUrl: 'https://devmicrotools.com/og-image.png',
  authorName: 'Jane Doe',
  datePublished: '2026-09-01',
  dateModified: '2026-09-03',
  publisherName: 'DevMicroTools',
  publisherLogoUrl: 'https://devmicrotools.com/favicon.svg',
  pageUrl: 'https://example.com/blog/csp-headers-explained',
};

const EXAMPLE_PRODUCT: ProductFields = {
  ...EMPTY_PRODUCT,
  name: 'Acme Mechanical Keyboard',
  description: 'A hot-swappable 75% mechanical keyboard with per-key RGB.',
  imageUrl: 'https://devmicrotools.com/og-image.png',
  brand: 'Acme',
  sku: 'ACME-KB-75',
  pageUrl: 'https://example.com/products/mechanical-keyboard',
  price: '89.99',
  priceCurrency: 'USD',
  ratingValue: '4.6',
  reviewCount: '238',
};

const EXAMPLE_FAQ: FaqItem[] = [
  { question: 'What is JSON-LD?', answer: 'A way to embed structured data in a page as a single JSON block, separate from the visible HTML.' },
  { question: 'Does adding this schema guarantee a rich result?', answer: 'No — it makes a page eligible; Google still decides whether and how to show one.' },
];

const EXAMPLE_HOWTO: HowToFields = {
  name: 'How to Clear Your Browser Cache',
  description: 'Steps to clear cached files and cookies in a modern browser.',
  totalTime: 'PT2M',
  supplies: '',
  tools: 'Web browser',
  steps: [
    { name: 'Open settings', text: 'Open your browser’s settings or preferences menu.', imageUrl: '' },
    { name: 'Find privacy options', text: 'Navigate to the privacy or history section.', imageUrl: '' },
    { name: 'Clear data', text: 'Select cached images and files, then confirm.', imageUrl: '' },
  ],
};

const EXAMPLE_ORGANIZATION: OrganizationFields = {
  ...EMPTY_ORGANIZATION,
  name: 'Acme Inc.',
  url: 'https://example.com',
  logoUrl: 'https://devmicrotools.com/og-image.png',
  description: 'Maker of fine widgets since 2010.',
  sameAs: 'https://twitter.com/acme\nhttps://github.com/acme',
  email: 'hello@example.com',
};

const EXAMPLE_BREADCRUMBS: BreadcrumbItem[] = [
  { name: 'Home', url: 'https://example.com/' },
  { name: 'Blog', url: 'https://example.com/blog' },
  { name: 'How CSP Headers Actually Stop Injected Scripts', url: '' },
];

interface ShareState {
  type: SchemaType;
  article: ArticleFields;
  product: ProductFields;
  faq: FaqItem[];
  howTo: HowToFields;
  organization: OrganizationFields;
  breadcrumbs: BreadcrumbItem[];
}

export default function JsonLdGenerator() {
  const [type, setType] = useState<SchemaType>('Article');
  const [article, setArticle] = useState<ArticleFields>(EMPTY_ARTICLE);
  const [product, setProduct] = useState<ProductFields>(EMPTY_PRODUCT);
  const [faq, setFaq] = useState<FaqItem[]>([{ ...EMPTY_FAQ_ITEM }]);
  const [howTo, setHowTo] = useState<HowToFields>({ ...EMPTY_HOWTO, steps: [{ ...EMPTY_HOWTO_STEP }] });
  const [organization, setOrganization] = useState<OrganizationFields>(EMPTY_ORGANIZATION);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ ...EMPTY_BREADCRUMB_ITEM }]);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setType(state.type ?? 'Article');
      if (state.article) setArticle({ ...EMPTY_ARTICLE, ...state.article });
      if (state.product) setProduct({ ...EMPTY_PRODUCT, ...state.product });
      if (state.faq?.length) setFaq(state.faq);
      if (state.howTo) setHowTo(state.howTo);
      if (state.organization) setOrganization({ ...EMPTY_ORGANIZATION, ...state.organization });
      if (state.breadcrumbs?.length) setBreadcrumbs(state.breadcrumbs);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => {
    switch (type) {
      case 'Article':
        return buildArticleJsonLd(article);
      case 'Product':
        return buildProductJsonLd(product);
      case 'FAQPage':
        return buildFaqPageJsonLd(faq);
      case 'HowTo':
        return buildHowToJsonLd(howTo);
      case 'Organization':
        return buildOrganizationJsonLd(organization);
      case 'BreadcrumbList':
        return buildBreadcrumbListJsonLd(breadcrumbs);
    }
  }, [type, article, product, faq, howTo, organization, breadcrumbs]);

  const primaryFieldFilled = useMemo(() => {
    switch (type) {
      case 'Article':
        return article.headline.trim() !== '';
      case 'Product':
        return product.name.trim() !== '';
      case 'FAQPage':
        return faq.some((item) => item.question.trim() !== '' || item.answer.trim() !== '');
      case 'HowTo':
        return howTo.name.trim() !== '';
      case 'Organization':
        return organization.name.trim() !== '';
      case 'BreadcrumbList':
        return breadcrumbs.some((item) => item.name.trim() !== '');
    }
  }, [type, article, product, faq, howTo, organization, breadcrumbs]);

  const scriptTag = result.ok ? result.value.scriptTag : '';
  const warnings = result.ok ? result.value.warnings : [];
  const error = primaryFieldFilled && !result.ok ? result.error : null;

  const loadExample = () => {
    switch (type) {
      case 'Article':
        setArticle(EXAMPLE_ARTICLE);
        break;
      case 'Product':
        setProduct(EXAMPLE_PRODUCT);
        break;
      case 'FAQPage':
        setFaq(EXAMPLE_FAQ);
        break;
      case 'HowTo':
        setHowTo(EXAMPLE_HOWTO);
        break;
      case 'Organization':
        setOrganization(EXAMPLE_ORGANIZATION);
        break;
      case 'BreadcrumbList':
        setBreadcrumbs(EXAMPLE_BREADCRUMBS);
        break;
    }
  };

  const clearAll = () => {
    setArticle(EMPTY_ARTICLE);
    setProduct(EMPTY_PRODUCT);
    setFaq([{ ...EMPTY_FAQ_ITEM }]);
    setHowTo({ ...EMPTY_HOWTO, steps: [{ ...EMPTY_HOWTO_STEP }] });
    setOrganization(EMPTY_ORGANIZATION);
    setBreadcrumbs([{ ...EMPTY_BREADCRUMB_ITEM }]);
  };

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="field jsonld-type-field">
          <label class="field__label" for="jsonld-type">
            <span>Schema type</span>
          </label>
          <select id="jsonld-type" class="select" value={type} onChange={(event) => setType((event.target as HTMLSelectElement).value as SchemaType)}>
            {SCHEMA_TYPES.map((entry) => (
              <option value={entry.value} key={entry.value} title={entry.hint}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <span class="tool-bar__spacer" />
        <ShareLinkButton
          getState={(): ShareState => ({ type, article, product, faq, howTo, organization, breadcrumbs })}
          describe="this schema"
        />
        <button type="button" class="btn" onClick={loadExample} title="Fill in a worked example for this schema type">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} title="Reset every field on every tab">
          Clear
        </button>
      </div>

      {type === 'Article' && <ArticleForm fields={article} onChange={(patch) => setArticle((f) => ({ ...f, ...patch }))} />}
      {type === 'Product' && <ProductForm fields={product} onChange={(patch) => setProduct((f) => ({ ...f, ...patch }))} />}
      {type === 'FAQPage' && (
        <FaqForm
          items={faq}
          onChange={(index, patch) => setFaq((list) => updateAt(list, index, patch))}
          onAdd={() => setFaq((list) => [...list, { ...EMPTY_FAQ_ITEM }])}
          onRemove={(index) => setFaq((list) => (list.length > 1 ? removeAt(list, index) : list))}
        />
      )}
      {type === 'HowTo' && (
        <HowToForm
          fields={howTo}
          onChange={(patch) => setHowTo((f) => ({ ...f, ...patch }))}
          onStepChange={(index, patch) => setHowTo((f) => ({ ...f, steps: updateAt(f.steps, index, patch) }))}
          onStepAdd={() => setHowTo((f) => ({ ...f, steps: [...f.steps, { ...EMPTY_HOWTO_STEP }] }))}
          onStepRemove={(index) => setHowTo((f) => ({ ...f, steps: f.steps.length > 1 ? removeAt(f.steps, index) : f.steps }))}
        />
      )}
      {type === 'Organization' && <OrganizationForm fields={organization} onChange={(patch) => setOrganization((f) => ({ ...f, ...patch }))} />}
      {type === 'BreadcrumbList' && (
        <BreadcrumbForm
          items={breadcrumbs}
          onChange={(index, patch) => setBreadcrumbs((list) => updateAt(list, index, patch))}
          onAdd={() => setBreadcrumbs((list) => [...list, { ...EMPTY_BREADCRUMB_ITEM }])}
          onRemove={(index) => setBreadcrumbs((list) => (list.length > 1 ? removeAt(list, index) : list))}
        />
      )}

      <OutputPane
        label="JSON-LD"
        value={scriptTag}
        placeholder="Fill in the form above to generate structured data."
        tall
        describe="this JSON-LD script"
        actions={<DownloadButton value={scriptTag} filename="structured-data.html" describe="this JSON-LD script" />}
      />
      <ErrorMessage message={error} />

      {warnings.length > 0 && (
        <div class="msg msg--info">
          <span class="msg__icon" aria-hidden="true">i</span>
          <ul class="jsonld-warnings">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <p class="field__hint">
        Paste the block above into the page's <code>&lt;head&gt;</code> (or anywhere in <code>&lt;body&gt;</code> — search
        engines read it either way). Validate it with Google's{' '}
        <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer">
          Rich Results Test
        </a>{' '}
        once it's live.
      </p>

      <style>{`
        .jsonld-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
        .jsonld-grid--three { grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); }
        .jsonld-type-field { min-width: 12rem; }
        .jsonld-warnings { margin: 0; padding-left: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
        .jsonld-list { display: flex; flex-direction: column; gap: var(--space-3); }
        .jsonld-row { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-3); }
        .jsonld-row__head { display: flex; align-items: center; justify-content: space-between; }
        .jsonld-row__title { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; }
      `}</style>
    </div>
  );
}

function inputHandler(setter: (value: string) => void) {
  return (event: Event) => setter((event.target as HTMLInputElement).value);
}
function textareaHandler(setter: (value: string) => void) {
  return (event: Event) => setter((event.target as HTMLTextAreaElement).value);
}

function ArticleForm({ fields, onChange }: { fields: ArticleFields; onChange: (patch: Partial<ArticleFields>) => void }) {
  return (
    <>
      <div class="field">
        <label class="field__label" for="jsonld-article-headline">
          <span>Headline</span>
        </label>
        <input
          id="jsonld-article-headline"
          type="text"
          class="input"
          placeholder="How CSP Headers Actually Stop Injected Scripts"
          value={fields.headline}
          onInput={inputHandler((v) => onChange({ headline: v }))}
        />
        <span class="field__hint">Required. Becomes the schema's headline — Google truncates around 110 characters.</span>
      </div>
      <div class="field">
        <label class="field__label" for="jsonld-article-description">
          <span>Description</span>
        </label>
        <textarea
          id="jsonld-article-description"
          class="textarea textarea--short"
          value={fields.description}
          onInput={textareaHandler((v) => onChange({ description: v }))}
        />
        <span class="field__hint">A short summary of the article. Optional but recommended.</span>
      </div>
      <div class="jsonld-grid">
        <div class="field">
          <label class="field__label" for="jsonld-article-image">
            <span>Image URL</span>
          </label>
          <input id="jsonld-article-image" type="url" class="input" value={fields.imageUrl} onInput={inputHandler((v) => onChange({ imageUrl: v }))} />
          <span class="field__hint">Must be absolute. Article rich results generally require at least one image.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-article-author">
            <span>Author name</span>
          </label>
          <input id="jsonld-article-author" type="text" class="input" value={fields.authorName} onInput={inputHandler((v) => onChange({ authorName: v }))} />
          <span class="field__hint">The article's byline. Optional but recommended for E-E-A-T signals.</span>
        </div>
      </div>
      <div class="jsonld-grid jsonld-grid--three">
        <div class="field">
          <label class="field__label" for="jsonld-article-published">
            <span>Date published</span>
          </label>
          <input id="jsonld-article-published" type="date" class="input" value={fields.datePublished} onInput={inputHandler((v) => onChange({ datePublished: v }))} />
          <span class="field__hint">When this article first went live. Optional but recommended.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-article-modified">
            <span>Date modified</span>
          </label>
          <input id="jsonld-article-modified" type="date" class="input" value={fields.dateModified} onInput={inputHandler((v) => onChange({ dateModified: v }))} />
          <span class="field__hint">When it was last substantively updated. Optional.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-article-page-url">
            <span>Page URL</span>
          </label>
          <input id="jsonld-article-page-url" type="url" class="input" value={fields.pageUrl} onInput={inputHandler((v) => onChange({ pageUrl: v }))} />
          <span class="field__hint">This article's own permanent address — becomes mainEntityOfPage. Optional.</span>
        </div>
      </div>
      <div class="jsonld-grid">
        <div class="field">
          <label class="field__label" for="jsonld-article-publisher">
            <span>Publisher name</span>
          </label>
          <input id="jsonld-article-publisher" type="text" class="input" value={fields.publisherName} onInput={inputHandler((v) => onChange({ publisherName: v }))} />
          <span class="field__hint">The site or company publishing this article. Optional.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-article-publisher-logo">
            <span>Publisher logo URL</span>
          </label>
          <input
            id="jsonld-article-publisher-logo"
            type="url"
            class="input"
            value={fields.publisherLogoUrl}
            onInput={inputHandler((v) => onChange({ publisherLogoUrl: v }))}
          />
          <span class="field__hint">Must be absolute. Only used if Publisher name is set.</span>
        </div>
      </div>
    </>
  );
}

function ProductForm({ fields, onChange }: { fields: ProductFields; onChange: (patch: Partial<ProductFields>) => void }) {
  return (
    <>
      <div class="jsonld-grid">
        <div class="field">
          <label class="field__label" for="jsonld-product-name">
            <span>Product name</span>
          </label>
          <input id="jsonld-product-name" type="text" class="input" value={fields.name} onInput={inputHandler((v) => onChange({ name: v }))} />
          <span class="field__hint">Required. The product's name, as a customer would search for it.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-product-image">
            <span>Image URL</span>
          </label>
          <input id="jsonld-product-image" type="url" class="input" value={fields.imageUrl} onInput={inputHandler((v) => onChange({ imageUrl: v }))} />
          <span class="field__hint">Must be absolute. Product rich results require at least one image.</span>
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="jsonld-product-description">
          <span>Description</span>
        </label>
        <textarea
          id="jsonld-product-description"
          class="textarea textarea--short"
          value={fields.description}
          onInput={textareaHandler((v) => onChange({ description: v }))}
        />
        <span class="field__hint">A short summary of the product. Optional.</span>
      </div>
      <div class="jsonld-grid jsonld-grid--three">
        <div class="field">
          <label class="field__label" for="jsonld-product-brand">
            <span>Brand</span>
          </label>
          <input id="jsonld-product-brand" type="text" class="input" value={fields.brand} onInput={inputHandler((v) => onChange({ brand: v }))} />
          <span class="field__hint">The manufacturer or brand name. Optional.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-product-sku">
            <span>SKU</span>
          </label>
          <input id="jsonld-product-sku" type="text" class="input" value={fields.sku} onInput={inputHandler((v) => onChange({ sku: v }))} />
          <span class="field__hint">Your own stock-keeping unit or product code. Optional.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-product-page-url">
            <span>Product page URL</span>
          </label>
          <input id="jsonld-product-page-url" type="url" class="input" value={fields.pageUrl} onInput={inputHandler((v) => onChange({ pageUrl: v }))} />
          <span class="field__hint">Where this product can be bought — becomes the offer's URL. Optional.</span>
        </div>
      </div>
      <div class="jsonld-grid jsonld-grid--three">
        <div class="field">
          <label class="field__label" for="jsonld-product-price">
            <span>Price</span>
          </label>
          <input id="jsonld-product-price" type="text" class="input" placeholder="19.99" value={fields.price} onInput={inputHandler((v) => onChange({ price: v }))} />
          <span class="field__hint">A plain number, no currency symbol. Leaving it blank omits the offer entirely.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-product-currency">
            <span>Currency</span>
          </label>
          <input
            id="jsonld-product-currency"
            type="text"
            class="input"
            placeholder="USD"
            value={fields.priceCurrency}
            onInput={inputHandler((v) => onChange({ priceCurrency: v }))}
          />
          <span class="field__hint">3-letter ISO 4217 code, e.g. USD or EUR. Only used if Price is set.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-product-availability">
            <span>Availability</span>
          </label>
          <select
            id="jsonld-product-availability"
            class="select"
            value={fields.availability}
            onChange={(event) => onChange({ availability: (event.target as HTMLSelectElement).value as ProductFields['availability'] })}
          >
            {PRODUCT_AVAILABILITY.map((entry) => (
              <option value={entry.value} key={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          <span class="field__hint">Whether it's currently in stock. Only used if Price is set.</span>
        </div>
      </div>
      <div class="jsonld-grid">
        <div class="field">
          <label class="field__label" for="jsonld-product-rating">
            <span>Rating value (1-5)</span>
          </label>
          <input
            id="jsonld-product-rating"
            type="text"
            class="input"
            placeholder="4.5"
            value={fields.ratingValue}
            onInput={inputHandler((v) => onChange({ ratingValue: v }))}
          />
          <span class="field__hint">Only use a real, verifiable rating — see the FAQ below. Requires Review count too.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-product-review-count">
            <span>Review count</span>
          </label>
          <input
            id="jsonld-product-review-count"
            type="text"
            class="input"
            placeholder="120"
            value={fields.reviewCount}
            onInput={inputHandler((v) => onChange({ reviewCount: v }))}
          />
          <span class="field__hint">How many reviews that rating is based on. Requires Rating value too.</span>
        </div>
      </div>
    </>
  );
}

function FaqForm({
  items,
  onChange,
  onAdd,
  onRemove,
}: {
  items: FaqItem[];
  onChange: (index: number, patch: Partial<FaqItem>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div class="jsonld-list">
      {items.map((item, index) => (
        <div class="jsonld-row" key={index}>
          <div class="jsonld-row__head">
            <span class="jsonld-row__title">Question {index + 1}</span>
            <button type="button" class="btn" onClick={() => onRemove(index)} disabled={items.length <= 1} title="Remove this question">
              Remove
            </button>
          </div>
          <div class="field">
            <label class="field__label" for={`jsonld-faq-q-${index}`}>
              <span>Question</span>
            </label>
            <input
              id={`jsonld-faq-q-${index}`}
              type="text"
              class="input"
              value={item.question}
              onInput={inputHandler((v) => onChange(index, { question: v }))}
            />
            <span class="field__hint">The exact question, as a visitor would ask it.</span>
          </div>
          <div class="field">
            <label class="field__label" for={`jsonld-faq-a-${index}`}>
              <span>Answer</span>
            </label>
            <textarea
              id={`jsonld-faq-a-${index}`}
              class="textarea textarea--short"
              value={item.answer}
              onInput={textareaHandler((v) => onChange(index, { answer: v }))}
            />
            <span class="field__hint">A complete, direct answer — both question and answer are required for this pair to appear in the output.</span>
          </div>
        </div>
      ))}
      <button type="button" class="btn" onClick={onAdd}>
        + Add question
      </button>
    </div>
  );
}

function HowToForm({
  fields,
  onChange,
  onStepChange,
  onStepAdd,
  onStepRemove,
}: {
  fields: HowToFields;
  onChange: (patch: Partial<HowToFields>) => void;
  onStepChange: (index: number, patch: Partial<HowToStep>) => void;
  onStepAdd: () => void;
  onStepRemove: (index: number) => void;
}) {
  return (
    <>
      <div class="field">
        <label class="field__label" for="jsonld-howto-name">
          <span>Title</span>
        </label>
        <input id="jsonld-howto-name" type="text" class="input" value={fields.name} onInput={inputHandler((v) => onChange({ name: v }))} />
        <span class="field__hint">Required. The task this How-to accomplishes, e.g. "How to Clear Your Browser Cache".</span>
      </div>
      <div class="field">
        <label class="field__label" for="jsonld-howto-description">
          <span>Description</span>
        </label>
        <textarea
          id="jsonld-howto-description"
          class="textarea textarea--short"
          value={fields.description}
          onInput={textareaHandler((v) => onChange({ description: v }))}
        />
        <span class="field__hint">What the finished result looks like, or why it matters. Optional but recommended.</span>
      </div>
      <div class="jsonld-grid jsonld-grid--three">
        <div class="field">
          <label class="field__label" for="jsonld-howto-total-time" title="ISO 8601 duration, e.g. PT30M for 30 minutes or PT1H30M for 1 hour 30 minutes">
            <span>Total time</span>
          </label>
          <input
            id="jsonld-howto-total-time"
            type="text"
            class="input"
            placeholder="PT30M"
            value={fields.totalTime}
            onInput={inputHandler((v) => onChange({ totalTime: v }))}
          />
          <span class="field__hint">ISO 8601 duration — PT30M is 30 minutes, PT1H30M is 1 hour 30 minutes. Optional.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-howto-supplies">
            <span>Supplies (one per line)</span>
          </label>
          <textarea id="jsonld-howto-supplies" class="textarea textarea--short" value={fields.supplies} onInput={textareaHandler((v) => onChange({ supplies: v }))} />
          <span class="field__hint">Consumable items used up during the task, e.g. "Tea bag". Optional.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-howto-tools">
            <span>Tools (one per line)</span>
          </label>
          <textarea id="jsonld-howto-tools" class="textarea textarea--short" value={fields.tools} onInput={textareaHandler((v) => onChange({ tools: v }))} />
          <span class="field__hint">Reusable equipment needed, not consumed, e.g. "Kettle". Optional.</span>
        </div>
      </div>

      <div class="jsonld-list">
        {fields.steps.map((step, index) => (
          <div class="jsonld-row" key={index}>
            <div class="jsonld-row__head">
              <span class="jsonld-row__title">Step {index + 1}</span>
              <button type="button" class="btn" onClick={() => onStepRemove(index)} disabled={fields.steps.length <= 1} title="Remove this step">
                Remove
              </button>
            </div>
            <div class="field">
              <label class="field__label" for={`jsonld-step-name-${index}`}>
                <span>Step name</span>
              </label>
              <input
                id={`jsonld-step-name-${index}`}
                type="text"
                class="input"
                value={step.name}
                onInput={inputHandler((v) => onStepChange(index, { name: v }))}
              />
              <span class="field__hint">A short label for this step, e.g. "Boil water".</span>
            </div>
            <div class="field">
              <label class="field__label" for={`jsonld-step-text-${index}`}>
                <span>Step instructions</span>
              </label>
              <textarea
                id={`jsonld-step-text-${index}`}
                class="textarea textarea--short"
                value={step.text}
                onInput={textareaHandler((v) => onStepChange(index, { text: v }))}
              />
              <span class="field__hint">What to actually do in this step. Falls back to the step name if left blank.</span>
            </div>
            <div class="field">
              <label class="field__label" for={`jsonld-step-image-${index}`}>
                <span>Step image URL</span>
              </label>
              <input
                id={`jsonld-step-image-${index}`}
                type="url"
                class="input"
                value={step.imageUrl}
                onInput={inputHandler((v) => onStepChange(index, { imageUrl: v }))}
              />
              <span class="field__hint">Must be absolute. Optional.</span>
            </div>
          </div>
        ))}
        <button type="button" class="btn" onClick={onStepAdd}>
          + Add step
        </button>
      </div>
    </>
  );
}

function OrganizationForm({ fields, onChange }: { fields: OrganizationFields; onChange: (patch: Partial<OrganizationFields>) => void }) {
  return (
    <>
      <div class="jsonld-grid">
        <div class="field">
          <label class="field__label" for="jsonld-org-name">
            <span>Organization name</span>
          </label>
          <input id="jsonld-org-name" type="text" class="input" value={fields.name} onInput={inputHandler((v) => onChange({ name: v }))} />
          <span class="field__hint">Required. The organization's official name.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-org-url">
            <span>Website URL</span>
          </label>
          <input id="jsonld-org-url" type="url" class="input" value={fields.url} onInput={inputHandler((v) => onChange({ url: v }))} />
          <span class="field__hint">The organization's own homepage. Optional.</span>
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="jsonld-org-description">
          <span>Description</span>
        </label>
        <textarea
          id="jsonld-org-description"
          class="textarea textarea--short"
          value={fields.description}
          onInput={textareaHandler((v) => onChange({ description: v }))}
        />
        <span class="field__hint">A short description of the organization. Optional.</span>
      </div>
      <div class="jsonld-grid">
        <div class="field">
          <label class="field__label" for="jsonld-org-logo">
            <span>Logo URL</span>
          </label>
          <input id="jsonld-org-logo" type="url" class="input" value={fields.logoUrl} onInput={inputHandler((v) => onChange({ logoUrl: v }))} />
          <span class="field__hint">Must be absolute. Used by Google's Knowledge Panel and similar features. Optional but recommended.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-org-sameas">
            <span>Social profile URLs (one per line)</span>
          </label>
          <textarea id="jsonld-org-sameas" class="textarea textarea--short" value={fields.sameAs} onInput={textareaHandler((v) => onChange({ sameAs: v }))} />
          <span class="field__hint">Official profiles — Twitter/X, GitHub, LinkedIn — confirming this is the same entity across the web. Optional.</span>
        </div>
      </div>
      <div class="jsonld-grid jsonld-grid--three">
        <div class="field">
          <label class="field__label" for="jsonld-org-phone">
            <span>Phone</span>
          </label>
          <input id="jsonld-org-phone" type="text" class="input" value={fields.telephone} onInput={inputHandler((v) => onChange({ telephone: v }))} />
          <span class="field__hint">Shown as a contact point. Optional.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-org-contact-type">
            <span>Contact type</span>
          </label>
          <input
            id="jsonld-org-contact-type"
            type="text"
            class="input"
            placeholder="customer service"
            value={fields.contactType}
            onInput={inputHandler((v) => onChange({ contactType: v }))}
          />
          <span class="field__hint">What this contact point is for, e.g. "customer service" or "sales". Optional.</span>
        </div>
        <div class="field">
          <label class="field__label" for="jsonld-org-email">
            <span>Email</span>
          </label>
          <input id="jsonld-org-email" type="email" class="input" value={fields.email} onInput={inputHandler((v) => onChange({ email: v }))} />
          <span class="field__hint">Shown as a contact point. Optional.</span>
        </div>
      </div>
    </>
  );
}

function BreadcrumbForm({
  items,
  onChange,
  onAdd,
  onRemove,
}: {
  items: BreadcrumbItem[];
  onChange: (index: number, patch: Partial<BreadcrumbItem>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div class="jsonld-list">
      {items.map((item, index) => (
        <div class="jsonld-row" key={index}>
          <div class="jsonld-row__head">
            <span class="jsonld-row__title">Position {index + 1}</span>
            <button type="button" class="btn" onClick={() => onRemove(index)} disabled={items.length <= 1} title="Remove this breadcrumb">
              Remove
            </button>
          </div>
          <div class="jsonld-grid">
            <div class="field">
              <label class="field__label" for={`jsonld-crumb-name-${index}`}>
                <span>Name</span>
              </label>
              <input
                id={`jsonld-crumb-name-${index}`}
                type="text"
                class="input"
                value={item.name}
                onInput={inputHandler((v) => onChange(index, { name: v }))}
              />
              <span class="field__hint">Required. The label shown in the trail, e.g. "Blog".</span>
            </div>
            <div class="field">
              <label class="field__label" for={`jsonld-crumb-url-${index}`}>
                <span>URL</span>
              </label>
              <input
                id={`jsonld-crumb-url-${index}`}
                type="url"
                class="input"
                value={item.url}
                onInput={inputHandler((v) => onChange(index, { url: v }))}
              />
              <span class="field__hint">This step's page address. Leave the last item's URL blank if it's the current page.</span>
            </div>
          </div>
        </div>
      ))}
      <button type="button" class="btn" onClick={onAdd}>
        + Add breadcrumb
      </button>
    </div>
  );
}
