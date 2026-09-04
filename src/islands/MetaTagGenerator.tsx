import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  buildMetaTags,
  formatSearchBreadcrumb,
  truncateForPreview,
  truncateByPixelWidth,
  DEFAULT_META_TAG_OPTIONS,
  OG_TYPES,
  RECOMMENDED_DESCRIPTION_MAX,
  RECOMMENDED_TITLE_MAX,
  SERP_TITLE_FONT_PX,
  SERP_TITLE_MAX_WIDTH_PX,
  SERP_DESCRIPTION_FONT_PX,
  SERP_DESCRIPTION_MAX_WIDTH_PX,
  type MetaTagOptions,
  type OgType,
} from '../lib/tools/metaTags';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

/** Matches `example.input` in meta-tag-generator.mdx — keep the two in step. */
const EXAMPLE: MetaTagOptions = {
  title: 'Acme Widgets — Buy Premium Widgets Online',
  description: 'Shop the full Acme Widgets catalogue. Free shipping over $50, and a 30-day return window on every order.',
  canonicalUrl: 'https://example.com/widgets',
  siteName: 'Acme',
  // A real, always-reachable image rather than an example.com placeholder — example.com
  // hosts nothing, so the card preview below would show a broken image on every visit.
  imageUrl: 'https://devmicrotools.com/og-image.png',
  imageAlt: 'DevMicroTools — sample social preview image',
  ogType: 'product',
  locale: 'en_US',
  twitterCard: 'summary_large_image',
  twitterSite: '@acme',
  twitterCreator: '',
  themeColor: '#0ea5e9',
  robotsIndex: 'index',
  robotsFollow: 'follow',
};

const COMMON_LOCALES = ['en_US', 'en_GB', 'es_ES', 'fr_FR', 'de_DE', 'pt_BR', 'ja_JP', 'zh_CN'];

type ShareState = MetaTagOptions;

export default function MetaTagGenerator() {
  const [options, setOptions] = useState<MetaTagOptions>(DEFAULT_META_TAG_OPTIONS);
  // Tracks whether the *current* imageUrl failed to load, so the card preview can fall back
  // to a labelled placeholder instead of the browser's broken-image glyph. Reset on every
  // change to imageUrl itself — otherwise a fix to a previously-broken URL would stay stuck
  // showing the old failure.
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  useEffect(() => setImagePreviewFailed(false), [options.imageUrl]);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setOptions({ ...DEFAULT_META_TAG_OPTIONS, ...restored.value });
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const patch = (partial: Partial<MetaTagOptions>) => setOptions((current) => ({ ...current, ...partial }));

  const result = useMemo(() => buildMetaTags(options), [options]);
  const html = result.ok ? result.value.html : '';
  const warnings = result.ok ? result.value.warnings : [];
  const error = options.title.trim() !== '' && !result.ok ? result.error : null;

  const loadExample = () => setOptions(EXAMPLE);
  const clearAll = () => setOptions(DEFAULT_META_TAG_OPTIONS);
  const isEmpty = useMemo(() => JSON.stringify(options) === JSON.stringify(DEFAULT_META_TAG_OPTIONS), [options]);

  const previewTitle = truncateByPixelWidth(options.title.trim() || 'Your page title', SERP_TITLE_MAX_WIDTH_PX, SERP_TITLE_FONT_PX);
  const previewDescription = truncateByPixelWidth(
    options.description.trim() || 'Your meta description will appear here once you type one in.',
    SERP_DESCRIPTION_MAX_WIDTH_PX,
    SERP_DESCRIPTION_FONT_PX
  );
  const previewBreadcrumb = formatSearchBreadcrumb(options.canonicalUrl) || 'example.com';
  const previewDomain = (() => {
    try {
      return new URL(options.canonicalUrl.trim()).hostname;
    } catch {
      return 'example.com';
    }
  })();

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={(): ShareState => options} describe="this page's meta tags" />
        <button type="button" class="btn" onClick={loadExample} title="Fill in a worked product-page example">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={isEmpty} title="Reset every field">
          Clear
        </button>
      </div>

      <div class="meta-grid">
        <div class="field">
          <label class="field__label" for="meta-title">
            <span>Page title</span>
            <span class="field__hint tnum">{options.title.length}/{RECOMMENDED_TITLE_MAX}</span>
          </label>
          <input
            id="meta-title"
            type="text"
            class="input"
            placeholder="Acme Widgets — Buy Premium Widgets Online"
            value={options.title}
            aria-invalid={error !== null}
            onInput={(event) => patch({ title: (event.target as HTMLInputElement).value })}
          />
          <span class="field__hint">Becomes &lt;title&gt;, og:title and twitter:title.</span>
        </div>

        <div class="field">
          <label class="field__label" for="meta-canonical">
            <span>Canonical URL</span>
          </label>
          <input
            id="meta-canonical"
            type="url"
            class="input"
            placeholder="https://example.com/widgets"
            value={options.canonicalUrl}
            onInput={(event) => patch({ canonicalUrl: (event.target as HTMLInputElement).value })}
          />
          <span class="field__hint">This exact page's own address — drives rel=canonical and og:url.</span>
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="meta-description">
          <span>Meta description</span>
          <span class="field__hint tnum">{options.description.length}/{RECOMMENDED_DESCRIPTION_MAX}</span>
        </label>
        <textarea
          id="meta-description"
          class="textarea textarea--short"
          placeholder="Shop the full Acme Widgets catalogue. Free shipping over $50, and a 30-day return window."
          value={options.description}
          onInput={(event) => patch({ description: (event.target as HTMLTextAreaElement).value })}
        />
        <span class="field__hint">The snippet shown under the title in search results and most link previews.</span>
      </div>

      <div class="meta-grid">
        <div class="field">
          <label class="field__label" for="meta-image">
            <span>Image URL</span>
          </label>
          <input
            id="meta-image"
            type="url"
            class="input"
            placeholder="https://example.com/og/widgets.png"
            value={options.imageUrl}
            onInput={(event) => patch({ imageUrl: (event.target as HTMLInputElement).value })}
          />
          <span class="field__hint">Must be absolute — crawlers building a card preview do not resolve relative paths. 1200×630 recommended.</span>
        </div>

        <div class="field">
          <label class="field__label" for="meta-image-alt">
            <span>Image alt text</span>
          </label>
          <input
            id="meta-image-alt"
            type="text"
            class="input"
            placeholder="A shelf of Acme widgets in red, blue and green"
            value={options.imageAlt}
            onInput={(event) => patch({ imageAlt: (event.target as HTMLInputElement).value })}
          />
          <span class="field__hint">Read aloud by screen readers on platforms that support og:image:alt.</span>
        </div>
      </div>

      <div class="meta-grid meta-grid--three">
        <div class="field">
          <label class="field__label" for="meta-site-name">
            <span>Site name</span>
          </label>
          <input
            id="meta-site-name"
            type="text"
            class="input"
            placeholder="Acme"
            value={options.siteName}
            onInput={(event) => patch({ siteName: (event.target as HTMLInputElement).value })}
          />
          <span class="field__hint">The brand or publication behind the page — shown next to the title on platforms that render og:site_name. Optional.</span>
        </div>

        <div class="field">
          <label class="field__label" for="meta-og-type">
            <span>Open Graph type</span>
          </label>
          <select
            id="meta-og-type"
            class="select"
            value={options.ogType}
            title="What kind of content this page is — shown to platforms that render a richer card for articles or products"
            onChange={(event) => patch({ ogType: (event.target as HTMLSelectElement).value as OgType })}
          >
            {OG_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <span class="field__hint">What kind of content this is. Most pages are Website; use Article for a blog post or Product for a product page.</span>
        </div>

        <div class="field">
          <label class="field__label" for="meta-locale">
            <span>Locale</span>
          </label>
          <input
            id="meta-locale"
            type="text"
            class="input"
            list="meta-locales"
            placeholder="en_US"
            value={options.locale}
            title="Language and region of this page's content, e.g. en_US or fr_FR"
            onInput={(event) => patch({ locale: (event.target as HTMLInputElement).value })}
          />
          <datalist id="meta-locales">
            {COMMON_LOCALES.map((locale) => (
              <option value={locale} key={locale} />
            ))}
          </datalist>
          <span class="field__hint">Language and region of this page's content, e.g. en_US or fr_FR. Leave blank to omit og:locale.</span>
        </div>
      </div>

      <div class="meta-grid meta-grid--three">
        <div class="field">
          <span class="field__label">
            <span>Twitter/X card</span>
          </span>
          <div class="seg" role="group" aria-label="Twitter card type">
            <button
              type="button"
              class="seg__btn"
              aria-pressed={options.twitterCard === 'summary'}
              title="Small square image beside the title"
              onClick={() => patch({ twitterCard: 'summary' })}
            >
              Summary
            </button>
            <button
              type="button"
              class="seg__btn"
              aria-pressed={options.twitterCard === 'summary_large_image'}
              title="Full-width image above the title"
              onClick={() => patch({ twitterCard: 'summary_large_image' })}
            >
              Large image
            </button>
          </div>
          <span class="field__hint">Summary shows a small square image beside the text; Large image shows a full-width image above it.</span>
        </div>

        <div class="field">
          <label class="field__label" for="meta-twitter-site">
            <span>Twitter/X site handle</span>
          </label>
          <input
            id="meta-twitter-site"
            type="text"
            class="input"
            placeholder="@acme"
            value={options.twitterSite}
            title="The site's own account — the @ is added automatically if you leave it off"
            onInput={(event) => patch({ twitterSite: (event.target as HTMLInputElement).value })}
          />
          <span class="field__hint">The site's own X account. The @ is added automatically if you leave it off. Optional.</span>
        </div>

        <div class="field">
          <label class="field__label" for="meta-twitter-creator">
            <span>Twitter/X creator handle</span>
          </label>
          <input
            id="meta-twitter-creator"
            type="text"
            class="input"
            placeholder="@jane"
            value={options.twitterCreator}
            title="The author's account, when different from the site account"
            onInput={(event) => patch({ twitterCreator: (event.target as HTMLInputElement).value })}
          />
          <span class="field__hint">The individual author's account, when it's different from the site account above. Optional.</span>
        </div>
      </div>

      <div class="meta-grid meta-grid--three">
        <div class="field">
          <span class="field__label">
            <span>Search indexing</span>
          </span>
          <div class="seg" role="group" aria-label="Robots index directive">
            <button
              type="button"
              class="seg__btn"
              aria-pressed={options.robotsIndex === 'index'}
              title="Allow this page to appear in search results"
              onClick={() => patch({ robotsIndex: 'index' })}
            >
              Index
            </button>
            <button
              type="button"
              class="seg__btn"
              aria-pressed={options.robotsIndex === 'noindex'}
              title="Exclude this page from search results entirely"
              onClick={() => patch({ robotsIndex: 'noindex' })}
            >
              Noindex
            </button>
          </div>
          <span class="field__hint">Index lets this page appear in search results; Noindex excludes it entirely, even if other pages link to it.</span>
        </div>

        <div class="field">
          <span class="field__label">
            <span>Link following</span>
          </span>
          <div class="seg" role="group" aria-label="Robots follow directive">
            <button
              type="button"
              class="seg__btn"
              aria-pressed={options.robotsFollow === 'follow'}
              title="Allow crawlers to follow links found on this page"
              onClick={() => patch({ robotsFollow: 'follow' })}
            >
              Follow
            </button>
            <button
              type="button"
              class="seg__btn"
              aria-pressed={options.robotsFollow === 'nofollow'}
              title="Ask crawlers not to follow links found on this page"
              onClick={() => patch({ robotsFollow: 'nofollow' })}
            >
              Nofollow
            </button>
          </div>
          <span class="field__hint">Follow lets crawlers follow links found on this page; Nofollow asks them not to pass authority through those links.</span>
        </div>

        <div class="field">
          <label class="field__label swatch-field" for="meta-theme-color" title="Sets the browser UI color on supporting mobile browsers — optional">
            <span>Theme color</span>
            <span class="swatch-field__control">
              <input
                id="meta-theme-color"
                type="color"
                class="color-picker"
                aria-label="Theme color swatch"
                value={/^#[0-9a-fA-F]{6}$/.test(options.themeColor) ? options.themeColor : '#0ea5e9'}
                onInput={(event) => patch({ themeColor: (event.target as HTMLInputElement).value })}
              />
              <input
                type="text"
                class="input meta-theme-text"
                placeholder="#0ea5e9"
                aria-label="Theme color hex value"
                value={options.themeColor}
                onInput={(event) => patch({ themeColor: (event.target as HTMLInputElement).value })}
              />
            </span>
          </label>
          <span class="field__hint">Tints the browser address bar on supporting mobile browsers, e.g. Chrome on Android. Optional.</span>
        </div>
      </div>

      <OutputPane
        label="Meta tags"
        value={html}
        placeholder="Enter a page title above to generate meta tags."
        tall
        describe="these meta tags"
        actions={<DownloadButton value={html} filename="meta-tags.html" describe="these meta tags" />}
      />

      {warnings.length > 0 && (
        <div class="msg msg--warning">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <ul class="meta-warnings">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <ErrorMessage message={error} />

      <div class="meta-previews">
        <div class="meta-preview">
          <h3
            class="meta-preview__title"
            title="Truncated by approximate rendered pixel width, the way Google's result actually clips — not a flat character count"
          >
            Google search preview
          </h3>
          <div class="meta-preview__search">
            <div class="meta-preview__search-site">
              <span class="meta-preview__favicon" aria-hidden="true" />
              <span>{previewBreadcrumb}</span>
            </div>
            <p class="meta-preview__search-title">{previewTitle}</p>
            <p class="meta-preview__search-desc">{previewDescription}</p>
          </div>
        </div>

        <div class="meta-preview">
          <h3 class="meta-preview__title">Social card preview</h3>
          <div class={`meta-preview__card${options.twitterCard === 'summary' ? ' meta-preview__card--summary' : ''}`}>
            <div class="meta-preview__card-image">
              {options.imageUrl.trim() !== '' && !imagePreviewFailed ? (
                <img
                  src={options.imageUrl.trim()}
                  alt=""
                  loading="lazy"
                  onError={() => setImagePreviewFailed(true)}
                />
              ) : (
                <span class="meta-preview__card-image-placeholder">
                  {options.imageUrl.trim() === '' ? 'No image set' : "Image didn't load — check the URL is correct and publicly reachable"}
                </span>
              )}
            </div>
            <div class="meta-preview__card-body">
              <p class="meta-preview__card-domain">{previewDomain}</p>
              <p class="meta-preview__card-title">{truncateForPreview(options.title.trim() || 'Your page title', 70)}</p>
              <p class="meta-preview__card-desc">{truncateForPreview(options.description.trim() || 'Your description will appear here.', 120)}</p>
            </div>
          </div>
        </div>
      </div>

      <p class="field__hint">
        Place every line from the output pane inside your page's <code>&lt;head&gt;</code>. Previews above are
        approximations — actual rendering (image cropping, line wrapping) varies by platform.
      </p>

      <style>{`
        .meta-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
        .meta-grid--three { grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); }
        .tnum { font-variant-numeric: tabular-nums; }
        .swatch-field { display: flex; flex-direction: column; gap: var(--space-2); }
        .swatch-field__control { display: flex; align-items: center; gap: var(--space-2); }
        .color-picker { width: 2.75rem; height: 2.25rem; padding: 0.2rem; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface); cursor: pointer; flex-shrink: 0; }
        .meta-theme-text { max-width: 8rem; }
        .meta-warnings { margin: 0; padding-left: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }

        .meta-previews { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
        .meta-preview__title { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em; color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0 0 var(--space-2); }

        .meta-preview__search { padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); font-family: var(--font-sans); }
        .meta-preview__search-site { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); color: var(--text-muted); }
        .meta-preview__favicon { width: 1rem; height: 1rem; border-radius: 50%; background: var(--border-strong); flex-shrink: 0; }
        .meta-preview__search-title { margin: var(--space-1) 0 0.2rem; font-size: 1.15rem; line-height: 1.3; color: #1a0dab; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .meta-preview__search-title { color: #8ab4f8; }
        }
        :root[data-theme="dark"] .meta-preview__search-title { color: #8ab4f8; }
        .meta-preview__search-desc { margin: 0; font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; }

        .meta-preview__card { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface); font-family: var(--font-sans); }
        .meta-preview__card-image { aspect-ratio: 1200 / 630; background: var(--surface-2); display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .meta-preview__card-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .meta-preview__card-image-placeholder { font-size: var(--text-xs); color: var(--text-subtle); text-align: center; padding: var(--space-2); }
        .meta-preview__card-body { padding: var(--space-3); display: flex; flex-direction: column; gap: 0.2rem; }
        .meta-preview__card-domain { margin: 0; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .04em; color: var(--text-subtle); }
        .meta-preview__card-title { margin: 0; font-size: var(--text-sm); font-weight: 650; color: var(--text); line-height: 1.35; }
        .meta-preview__card-desc { margin: 0; font-size: var(--text-xs); color: var(--text-muted); line-height: 1.4; }

        /* Summary card: small square image beside the text, matching the real Twitter/X layout. */
        .meta-preview__card--summary { display: flex; align-items: stretch; }
        .meta-preview__card--summary .meta-preview__card-image { width: 6rem; aspect-ratio: 1 / 1; flex-shrink: 0; }
        .meta-preview__card--summary .meta-preview__card-body { flex: 1; min-width: 0; }
      `}</style>
    </div>
  );
}
