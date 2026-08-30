import { type ToolResult, ok, err } from './result';

/**
 * Why a crawler is fetching your pages, and what comes back to you if it does.
 *
 * The split is by *purpose*, not technique — every crawler here scrapes, so "scraper" is
 * not a category that means anything on its own. What separates the groups is what the
 * fetch is turned into (a model, an answer that cites you, a search result, a data feed
 * someone else sells) and whether there is a named party behind it publishing a policy.
 * That is the line people actually want to draw when they arrive here, and it runs
 * between these groups rather than between individual bots.
 */
export type CrawlerGroupId = 'ai-training' | 'ai-search' | 'ai-agent' | 'search' | 'seo' | 'scraper';

export interface CrawlerGroup {
  id: CrawlerGroupId;
  label: string;
  /** One line, shown above the group in the UI and as a comment in the generated file. */
  description: string;
}

export const CRAWLER_GROUPS: readonly CrawlerGroup[] = [
  {
    id: 'ai-training',
    label: 'AI training crawlers',
    description:
      'Take a copy to train a model. Named companies that publish an opt-out token — but nothing comes back to you.',
  },
  {
    id: 'ai-search',
    label: 'AI answer engines',
    description: 'Index pages to answer questions, normally citing and linking you as the source.',
  },
  {
    id: 'ai-agent',
    label: 'User-triggered AI fetchers',
    description: 'Fetch a page only because a person asked an assistant about that URL.',
  },
  {
    id: 'search',
    label: 'Search engines',
    description: 'Classic web search indexes — the crawlers that send you the most traffic back. Block with care.',
  },
  {
    id: 'seo',
    label: 'SEO & backlink crawlers',
    description: 'Take a copy to build a link or contact index sold to other people, usually your competitors.',
  },
  {
    id: 'scraper',
    label: 'Content resellers & unidentified bots',
    description:
      'Take a copy to resell or mirror the page itself, or run as an unmodified script with no product and no policy behind it.',
  },
];

export interface Crawler {
  /** The `User-agent:` token — also the key used in options, presets and share links. */
  id: string;
  /**
   * Extra tokens emitted on their own `User-agent:` lines beside `id`. Only for bots that
   * genuinely answer to more than one name (a casing variant some parsers treat as
   * distinct, or a renamed crawler still shipping under its old name).
   */
  aliases?: readonly string[];
  vendor: string;
  group: CrawlerGroupId;
  /** One line on what it does with what it takes. Shown next to the bot in the UI. */
  purpose: string;
  /**
   * Set only where there is a documented, widely-reported record of ignoring robots.txt.
   * Drives a warning: a rule here records intent, but stopping these needs the edge.
   */
  ignoresRobots?: true;
}

/**
 * The crawler catalogue.
 *
 * This is the one part of the tool that goes stale — bots get launched, renamed and
 * retired every few months — so it is deliberately one flat exported const: refreshing it
 * means adding or editing a row, with no other file to touch. Everything else (the UI
 * grouping, the presets, the generated file) derives from it.
 *
 * Last reviewed: 2026-08-29.
 */
export const CRAWLERS: readonly Crawler[] = [
  // ------------------------------------------------------------- AI training
  { id: 'GPTBot', vendor: 'OpenAI', group: 'ai-training', purpose: 'Collects pages to train OpenAI models.' },
  { id: 'ClaudeBot', vendor: 'Anthropic', group: 'ai-training', purpose: 'Collects pages to train Anthropic models.' },
  {
    id: 'anthropic-ai',
    vendor: 'Anthropic',
    group: 'ai-training',
    purpose: 'Older Anthropic crawler token, still seen in server logs.',
  },
  {
    id: 'Google-Extended',
    vendor: 'Google',
    group: 'ai-training',
    purpose: 'Controls Gemini training and AI Overviews use — does not affect Google Search ranking.',
  },
  {
    id: 'Applebot-Extended',
    vendor: 'Apple',
    group: 'ai-training',
    purpose: 'Controls Apple Intelligence training use — does not affect Siri or Spotlight results.',
  },
  {
    id: 'CCBot',
    vendor: 'Common Crawl',
    group: 'ai-training',
    purpose: 'Builds the open corpus most smaller models are trained on.',
  },
  { id: 'meta-externalagent', vendor: 'Meta', group: 'ai-training', purpose: 'Collects pages to train Meta AI models.' },
  {
    id: 'cohere-training-data-crawler',
    aliases: ['cohere-ai'],
    vendor: 'Cohere',
    group: 'ai-training',
    purpose: 'Collects training data for Cohere models.',
  },
  {
    id: 'AI2Bot',
    vendor: 'Allen Institute for AI',
    group: 'ai-training',
    purpose: 'Builds open research corpora for the non-profit AI2 lab.',
  },
  {
    id: 'Bytespider',
    aliases: ['ByteSpider'],
    vendor: 'ByteDance',
    group: 'ai-training',
    purpose: 'Collects training data for ByteDance models.',
    ignoresRobots: true,
  },
  { id: 'PanguBot', vendor: 'Huawei', group: 'ai-training', purpose: 'Collects training data for the PanGu models.' },
  {
    id: 'Timpibot',
    vendor: 'Timpi',
    group: 'ai-training',
    purpose: 'Crawls for a decentralised index sold on to AI products.',
  },

  // --------------------------------------------------------------- AI search
  {
    id: 'OAI-SearchBot',
    vendor: 'OpenAI',
    group: 'ai-search',
    purpose: 'Indexes pages for ChatGPT search results, which link back to the source.',
  },
  {
    id: 'Claude-SearchBot',
    vendor: 'Anthropic',
    group: 'ai-search',
    purpose: 'Indexes pages so Claude can cite them in answers.',
  },
  {
    id: 'PerplexityBot',
    vendor: 'Perplexity',
    group: 'ai-search',
    purpose: 'Indexes pages for Perplexity answers, which cite their sources.',
  },
  {
    id: 'DuckAssistBot',
    vendor: 'DuckDuckGo',
    group: 'ai-search',
    purpose: 'Indexes pages for DuckDuckGo AI-assisted answers.',
  },
  { id: 'YouBot', vendor: 'You.com', group: 'ai-search', purpose: 'Indexes pages for You.com search and answers.' },
  {
    id: 'Amazonbot',
    vendor: 'Amazon',
    group: 'ai-search',
    purpose: 'Indexes pages to answer questions in Alexa and Rufus.',
  },

  // ---------------------------------------------------------------- AI agent
  {
    id: 'ChatGPT-User',
    vendor: 'OpenAI',
    group: 'ai-agent',
    purpose: 'Fetches a page live because a ChatGPT user asked about that URL.',
  },
  {
    id: 'Claude-User',
    vendor: 'Anthropic',
    group: 'ai-agent',
    purpose: 'Fetches a page live because a Claude user asked about that URL.',
  },
  {
    id: 'Perplexity-User',
    vendor: 'Perplexity',
    group: 'ai-agent',
    purpose: 'Fetches a page live in response to a Perplexity question.',
  },
  {
    id: 'MistralAI-User',
    vendor: 'Mistral',
    group: 'ai-agent',
    purpose: 'Fetches a page live in response to a Le Chat question.',
  },
  {
    id: 'meta-externalfetcher',
    vendor: 'Meta',
    group: 'ai-agent',
    purpose: 'Fetches a page live for a Meta AI user, and for link previews.',
  },

  // ---------------------------------------------------------- Search engines
  {
    id: 'Googlebot',
    vendor: 'Google',
    group: 'search',
    purpose: 'Google Search. Blocking this removes the site from Google.',
  },
  { id: 'Bingbot', vendor: 'Microsoft', group: 'search', purpose: 'Bing Search, and the index Copilot answers from.' },
  { id: 'DuckDuckBot', vendor: 'DuckDuckGo', group: 'search', purpose: 'The DuckDuckGo crawler.' },
  { id: 'Applebot', vendor: 'Apple', group: 'search', purpose: 'Siri and Spotlight suggestions.' },
  { id: 'YandexBot', vendor: 'Yandex', group: 'search', purpose: 'Yandex Search — the main index across Russia.' },
  { id: 'Baiduspider', vendor: 'Baidu', group: 'search', purpose: 'Baidu Search — the main index in China.' },

  // --------------------------------------------------------------------- SEO
  { id: 'AhrefsBot', vendor: 'Ahrefs', group: 'seo', purpose: 'Builds the Ahrefs backlink index.' },
  { id: 'SemrushBot', vendor: 'Semrush', group: 'seo', purpose: 'Builds the Semrush backlink and keyword index.' },
  { id: 'MJ12bot', vendor: 'Majestic', group: 'seo', purpose: 'Builds the Majestic backlink index.' },
  { id: 'DotBot', vendor: 'Moz', group: 'seo', purpose: 'Builds the Moz link index.' },
  { id: 'BLEXBot', vendor: 'WebMeUp', group: 'seo', purpose: 'Builds a backlink index sold on to SEO tools.' },
  { id: 'DataForSeoBot', vendor: 'DataForSEO', group: 'seo', purpose: 'Crawls to resell SEO data through an API.' },
  { id: 'Barkrowler', vendor: 'Babbar', group: 'seo', purpose: 'Builds the Babbar link graph.' },
  { id: 'serpstatbot', vendor: 'Serpstat', group: 'seo', purpose: 'Builds the Serpstat backlink index.' },
  { id: 'ZoominfoBot', vendor: 'ZoomInfo', group: 'seo', purpose: 'Harvests company and contact data for sales lists.' },

  // ---------------------------------------------------------------- Scrapers
  {
    id: 'Omgilibot',
    aliases: ['Omgili', 'Webzio-Extended'],
    vendor: 'Webz.io',
    group: 'scraper',
    purpose: 'Scrapes pages to resell as a data feed, including to AI companies.',
  },
  {
    id: 'ImagesiftBot',
    vendor: 'Hive',
    group: 'scraper',
    purpose: 'Bulk-collects images for generative image models.',
  },
  {
    id: 'Diffbot',
    vendor: 'Diffbot',
    group: 'scraper',
    purpose: 'Extracts page content into a knowledge graph it sells.',
  },
  {
    id: 'magpie-crawler',
    vendor: 'Brandwatch',
    group: 'scraper',
    purpose: 'Collects content for media-monitoring products.',
  },
  { id: 'Meltwater', vendor: 'Meltwater', group: 'scraper', purpose: 'Collects content for media-monitoring products.' },
  { id: 'peer39_crawler', vendor: 'Peer39', group: 'scraper', purpose: 'Scans pages for ad-targeting classification.' },
  {
    id: 'VelenPublicWebCrawler',
    vendor: 'Velen',
    group: 'scraper',
    purpose: 'Bulk-collects pages for a resold web dataset.',
  },
  {
    id: 'iaskspider',
    vendor: 'iAsk',
    group: 'scraper',
    purpose: 'Crawls for an AI answer product with no published policy.',
  },
  {
    id: 'Scrapy',
    vendor: 'generic',
    group: 'scraper',
    purpose: 'The default user-agent of an unmodified Scrapy script — never a product.',
    ignoresRobots: true,
  },
  {
    id: 'python-requests',
    vendor: 'generic',
    group: 'scraper',
    purpose: 'The default user-agent of an unmodified Python script — never a product.',
    ignoresRobots: true,
  },
];

/** Index for lookups; the catalogue itself stays a list because that is how it is edited. */
const CRAWLERS_BY_ID = new Map(CRAWLERS.map((crawler) => [crawler.id, crawler]));

export const crawlerById = (id: string): Crawler | undefined => CRAWLERS_BY_ID.get(id);

export const crawlersInGroup = (group: CrawlerGroupId): Crawler[] =>
  CRAWLERS.filter((crawler) => crawler.group === group);

export type CrawlerPolicy = 'allow' | 'block';

/** A user-agent the catalogue does not know about, typed in by hand. */
export interface CustomRule {
  /** Free text; crawlers match it as a prefix of their own user-agent token. */
  userAgent: string;
  policy: CrawlerPolicy;
}

export interface RobotsTxtOptions {
  /** The `User-agent: *` fallback — what anything not named below is told. */
  defaultPolicy: CrawlerPolicy;
  /** Explicit per-crawler rules keyed by `Crawler.id`. A crawler absent here falls through to `*`. */
  policies: Record<string, CrawlerPolicy>;
  custom: CustomRule[];
  /** Paths nobody should crawl, e.g. `/admin/`. One per entry, each starting with `/`. */
  disallowPaths: string[];
  /** Exceptions carved back out of a `Disallow`, e.g. `/admin/public/`. */
  allowPaths: string[];
  /** Absolute URL of the sitemap, or '' to omit the line. */
  sitemapUrl: string;
  /** Seconds between requests, or null to omit. Google ignores it; Bing and Yandex honour it. */
  crawlDelay: number | null;
  /** Emit the explanatory `#` comments. Off produces the same rules, just bare. */
  comments: boolean;
}

export const DEFAULT_ROBOTS_OPTIONS: RobotsTxtOptions = {
  defaultPolicy: 'allow',
  policies: {},
  custom: [],
  disallowPaths: [],
  allowPaths: [],
  sitemapUrl: '',
  crawlDelay: null,
  comments: true,
};

/** Highest crawl-delay worth offering — past an hour the directive means nothing anyway. */
export const MAX_CRAWL_DELAY = 3600;

export interface RobotsPreset {
  id: string;
  label: string;
  /** The button's tooltip — what this stance actually costs you. */
  description: string;
  defaultPolicy: CrawlerPolicy;
  /** Group-level stance, expanded against the catalogue into per-crawler rules. */
  groups: Partial<Record<CrawlerGroupId, CrawlerPolicy>>;
}

export const ROBOTS_PRESETS: readonly RobotsPreset[] = [
  {
    id: 'allow-all',
    label: 'Allow everything',
    description: 'No crawler is singled out — every bot may crawl the whole site.',
    defaultPolicy: 'allow',
    groups: {},
  },
  {
    id: 'known-bots-only',
    label: 'Known bots only',
    description:
      'Allow every named company that publishes a crawler policy — search engines, AI answer engines, user-triggered fetchers and AI training crawlers — and block everything else by default, including SEO indexes, content resellers and anything unidentified.',
    defaultPolicy: 'block',
    groups: { search: 'allow', 'ai-search': 'allow', 'ai-agent': 'allow', 'ai-training': 'allow' },
  },
  {
    id: 'block-ai-training',
    label: 'Block AI training',
    description: 'Stay out of model training sets, but stay visible in AI answers that link back to you.',
    defaultPolicy: 'allow',
    groups: { 'ai-training': 'block', 'ai-search': 'allow', 'ai-agent': 'allow' },
  },
  {
    id: 'block-all-ai',
    label: 'Block all AI',
    description: 'Block training crawlers, AI answer engines and user-triggered fetchers alike.',
    defaultPolicy: 'allow',
    groups: { 'ai-training': 'block', 'ai-search': 'block', 'ai-agent': 'block' },
  },
  {
    id: 'block-scrapers',
    label: 'Block scrapers & SEO bots',
    description: 'Keep search and AI crawlers; drop the content resellers and backlink indexes.',
    defaultPolicy: 'allow',
    groups: { scraper: 'block', seo: 'block' },
  },
  {
    id: 'search-only',
    label: 'Search engines only',
    description: 'Block everything by default and allow only the classic search engines.',
    defaultPolicy: 'block',
    groups: { search: 'allow' },
  },
];

/**
 * The stance the tool opens on. Not "allow everything": an empty two-line file teaches a
 * first-time visitor nothing, and blocking training crawlers while staying visible to the
 * AI search engines that link back is the reason most people arrive here.
 */
export const DEFAULT_PRESET_ID = 'block-ai-training';

export const presetById = (id: string): RobotsPreset | undefined =>
  ROBOTS_PRESETS.find((preset) => preset.id === id);

/** Expands a preset's group-level stance into the per-crawler rules the generator works in. */
export function policiesForPreset(preset: RobotsPreset): Record<string, CrawlerPolicy> {
  const policies: Record<string, CrawlerPolicy> = {};
  for (const crawler of CRAWLERS) {
    const policy = preset.groups[crawler.group];
    if (policy) policies[crawler.id] = policy;
  }
  return policies;
}

/**
 * What a crawler (or a whole group) is set to, from the UI's point of view.
 *
 * `unlisted` is the absence of a rule, not a third rule: the crawler is left out of the
 * file entirely and follows whatever `User-agent: *` says. It is a separate idea from
 * `allow` precisely because naming a crawler changes which group it obeys, so "allowed"
 * and "not mentioned" produce different files even when the default is `allow`.
 */
export type PolicyChoice = CrawlerPolicy | 'unlisted';

/** `mixed` when the crawlers in a group disagree — the group control shows no selection. */
export type GroupStance = PolicyChoice | 'mixed';

export function groupStance(group: CrawlerGroupId, policies: Record<string, CrawlerPolicy>): GroupStance {
  const stances = new Set<PolicyChoice>(
    crawlersInGroup(group).map((crawler) => policies[crawler.id] ?? 'unlisted')
  );
  if (stances.size !== 1) return 'mixed';
  const [only] = stances;
  return only ?? 'unlisted';
}

/**
 * Sets every crawler in a group at once.
 *
 * Returns a new map rather than mutating, and — unlike applying a preset — touches only
 * this group, which is what makes two stances composable: blocking AI training and
 * blocking scrapers are two calls, not a preset that has to anticipate the combination.
 */
export function setGroupPolicy(
  policies: Record<string, CrawlerPolicy>,
  group: CrawlerGroupId,
  choice: PolicyChoice
): Record<string, CrawlerPolicy> {
  const next = { ...policies };
  for (const crawler of crawlersInGroup(group)) {
    if (choice === 'unlisted') delete next[crawler.id];
    else next[crawler.id] = choice;
  }
  return next;
}

/**
 * The preset the current state exactly matches, if any, so the preset row can show which
 * one is active instead of being a write-only set of buttons.
 */
export function activePresetId(
  defaultPolicy: CrawlerPolicy,
  policies: Record<string, CrawlerPolicy>
): string | undefined {
  const named = Object.keys(policies).filter((id) => CRAWLERS_BY_ID.has(id));

  return ROBOTS_PRESETS.find((preset) => {
    if (preset.defaultPolicy !== defaultPolicy) return false;
    const expected = policiesForPreset(preset);
    const expectedKeys = Object.keys(expected);
    if (expectedKeys.length !== named.length) return false;
    return expectedKeys.every((id) => policies[id] === expected[id]);
  })?.id;
}

export interface RobotsTxtResult {
  text: string;
  /**
   * Legal, but probably not what the author meant — a rule that cannot do anything, or one
   * that costs more than they realise. Kept beside the output rather than folded into the
   * file as comments, so the file itself stays clean.
   */
  warnings: string[];
}

const comment = (lines: string[]): string => lines.map((line) => (line === '' ? '#' : `# ${line}`)).join('\n');

const RULE_PRECEDENCE_NOTE = [
  'A crawler obeys only the most specific group that names it, and ignores every other',
  'group — including `*`. Rules meant for everyone are therefore repeated inside each',
  'named group below rather than inherited from it.',
];

/** Trims, drops blanks and de-duplicates a path list without reordering it. */
function cleanPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  return cleaned;
}

function validatePaths(paths: string[], directive: 'Disallow' | 'Allow'): string | null {
  for (const path of paths) {
    if (!path.startsWith('/')) {
      return `${directive} paths must start with "/" — "${path}" does not. Write it as /${path.replace(/^\/+/, '')} instead.`;
    }
    if (/\s/.test(path)) {
      return `"${path}" contains a space. A robots.txt rule ends at the first space, so encode it as %20.`;
    }
  }
  return null;
}

/**
 * Builds a robots.txt from a per-crawler stance.
 *
 * Pure string assembly: the hard part of this tool is deciding *who* gets in, which the
 * catalogue above carries, not the syntax. Path rules are repeated into every allowed
 * named group deliberately — a named group inheriting nothing from `*` is the single most
 * common way a hand-written robots.txt accidentally exposes the paths it meant to hide.
 */
export function buildRobotsTxt(options: RobotsTxtOptions): ToolResult<RobotsTxtResult> {
  const disallowPaths = cleanPaths(options.disallowPaths);
  const allowPaths = cleanPaths(options.allowPaths);

  const pathError = validatePaths(disallowPaths, 'Disallow') ?? validatePaths(allowPaths, 'Allow');
  if (pathError) return err(pathError);

  const sitemapUrl = options.sitemapUrl.trim();
  if (sitemapUrl !== '') {
    let parsed: URL;
    try {
      parsed = new URL(sitemapUrl);
    } catch {
      return err(
        `"${sitemapUrl}" is not a full URL. A Sitemap line needs an absolute address, e.g. https://example.com/sitemap.xml`
      );
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return err('The sitemap URL must be an http:// or https:// address.');
    }
  }

  const { crawlDelay } = options;
  if (crawlDelay !== null && (!Number.isFinite(crawlDelay) || crawlDelay < 0 || crawlDelay > MAX_CRAWL_DELAY)) {
    return err(`Crawl-delay must be between 0 and ${MAX_CRAWL_DELAY} seconds.`);
  }

  const custom = options.custom
    .map((rule) => ({ ...rule, userAgent: rule.userAgent.trim() }))
    .filter((rule) => rule.userAgent !== '');
  for (const rule of custom) {
    if (/\s/.test(rule.userAgent)) {
      return err(
        `"${rule.userAgent}" is not a usable user-agent token — it contains a space. Use the single word from the bot's User-Agent header.`
      );
    }
  }

  const allowRules = [
    ...disallowPaths.map((path) => `Disallow: ${path}`),
    ...allowPaths.map((path) => `Allow: ${path}`),
    'Allow: /',
  ];
  // A named blocked group is blocked outright. Only the `*` group keeps the Allow
  // exceptions, since "block everyone except these paths" is a real stance and this is
  // the only way robots.txt can express it.
  const blockRules = ['Disallow: /'];
  const defaultRules =
    options.defaultPolicy === 'allow'
      ? allowRules
      : [...allowPaths.map((path) => `Allow: ${path}`), 'Disallow: /'];

  const blocks: string[] = [];

  if (options.comments) {
    blocks.push(
      comment([
        'robots.txt',
        '',
        ...RULE_PRECEDENCE_NOTE,
        '',
        'None of this is enforcement: robots.txt is a request that well-behaved crawlers',
        'honour voluntarily. Anything that must be blocked has to be blocked at the edge.',
      ])
    );
  }

  const defaultHeader = options.comments
    ? [
        comment([
          options.defaultPolicy === 'allow'
            ? 'Default — every crawler not named below.'
            : 'Default — every crawler not named below is told to stay out entirely.',
        ]),
      ]
    : [];

  blocks.push(
    [
      ...defaultHeader,
      'User-agent: *',
      ...(crawlDelay === null ? [] : [`Crawl-delay: ${crawlDelay}`]),
      ...defaultRules,
    ].join('\n')
  );

  for (const group of CRAWLER_GROUPS) {
    for (const policy of ['allow', 'block'] as const) {
      const named = crawlersInGroup(group.id).filter((crawler) => options.policies[crawler.id] === policy);
      if (named.length === 0) continue;

      const header = options.comments
        ? [comment([`${group.label} — ${policy === 'allow' ? 'allowed' : 'blocked'}.`, group.description])]
        : [];

      blocks.push(
        [
          ...header,
          ...named.flatMap((crawler) => [crawler.id, ...(crawler.aliases ?? [])].map((name) => `User-agent: ${name}`)),
          ...(policy === 'allow' ? allowRules : blockRules),
        ].join('\n')
      );
    }
  }

  for (const policy of ['allow', 'block'] as const) {
    const named = custom.filter((rule) => rule.policy === policy);
    if (named.length === 0) continue;

    const header = options.comments
      ? [comment([`Your own rules — ${policy === 'allow' ? 'allowed' : 'blocked'}.`])]
      : [];

    blocks.push(
      [
        ...header,
        ...named.map((rule) => `User-agent: ${rule.userAgent}`),
        ...(policy === 'allow' ? allowRules : blockRules),
      ].join('\n')
    );
  }

  if (sitemapUrl !== '') blocks.push(`Sitemap: ${sitemapUrl}`);

  // ------------------------------------------------------------------ warnings
  const warnings: string[] = [];

  if (options.defaultPolicy === 'block') {
    warnings.push(
      'Everything not named in this file is blocked — including search engines you have not explicitly allowed, and any crawler launched after you write this.'
    );
    if (disallowPaths.length > 0) {
      warnings.push(
        'The Disallow paths are redundant while the default is "block": the whole site is already off-limits to anything unnamed, so they are left out of the file.'
      );
    }
  } else if (allowPaths.length > 0 && disallowPaths.length === 0) {
    warnings.push(
      'An Allow rule only does something where a Disallow rule would otherwise cover the same path. Nothing here disallows these paths, so those lines have no effect.'
    );
  }

  const stubborn = CRAWLERS.filter(
    (crawler) => crawler.ignoresRobots && options.policies[crawler.id] === 'block'
  ).map((crawler) => crawler.id);
  if (stubborn.length > 0) {
    const one = stubborn.length === 1;
    warnings.push(
      `${stubborn.join(', ')} ${one ? 'has' : 'have'} a documented record of ignoring robots.txt. The rule records your intent, but only a firewall or CDN rule will actually stop ${one ? 'it' : 'them'}.`
    );
  }

  const blockedSearch = crawlersInGroup('search').filter((crawler) => options.policies[crawler.id] === 'block');
  if (blockedSearch.length > 0) {
    const one = blockedSearch.length === 1;
    warnings.push(
      `Blocking ${blockedSearch.map((crawler) => crawler.id).join(', ')} removes this site from ${one ? 'that search engine' : 'those search engines'} entirely, not just from its AI features.`
    );
  }

  if (sitemapUrl === '') {
    warnings.push('No Sitemap line. Adding one is the cheapest way to help search engines find every page.');
  }

  return ok({ text: `${blocks.join('\n\n')}\n`, warnings });
}
