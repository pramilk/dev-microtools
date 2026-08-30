import { describe, expect, it } from 'vitest';
import {
  buildRobotsTxt,
  policiesForPreset,
  groupStance,
  setGroupPolicy,
  activePresetId,
  crawlerById,
  crawlersInGroup,
  CRAWLERS,
  CRAWLER_GROUPS,
  ROBOTS_PRESETS,
  DEFAULT_ROBOTS_OPTIONS,
  MAX_CRAWL_DELAY,
  type RobotsTxtOptions,
} from './robotsTxt';

const options = (overrides: Partial<RobotsTxtOptions> = {}): RobotsTxtOptions => ({
  ...DEFAULT_ROBOTS_OPTIONS,
  ...overrides,
});

/** The generated file, or a failing expectation — every test here expects success. */
const build = (overrides: Partial<RobotsTxtOptions> = {}) => {
  const result = buildRobotsTxt(options(overrides));
  if (!result.ok) throw new Error(`expected a file, got: ${result.error}`);
  return result.value;
};

/** Rule lines only, so assertions do not depend on comment wording. */
const rules = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

/**
 * The rule lines that apply to one user-agent, i.e. its group's directives. Mirrors how a
 * crawler reads the file: find the group naming me, read the directives under it.
 */
function groupFor(text: string, userAgent: string): string[] {
  const blocks = text.split(/\n\s*\n/);
  const block = blocks.find((candidate) => rules(candidate).includes(`User-agent: ${userAgent}`));
  return block === undefined ? [] : rules(block).filter((line) => !line.startsWith('User-agent:'));
}

describe('the crawler catalogue', () => {
  it('has no duplicate user-agent tokens across ids and aliases', () => {
    const tokens = CRAWLERS.flatMap((crawler) => [crawler.id, ...(crawler.aliases ?? [])]);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('only uses group ids that exist', () => {
    const known = new Set(CRAWLER_GROUPS.map((group) => group.id));
    for (const crawler of CRAWLERS) expect(known.has(crawler.group)).toBe(true);
  });

  it('puts at least one crawler in every group, so no group renders empty', () => {
    for (const group of CRAWLER_GROUPS) expect(crawlersInGroup(group.id).length).toBeGreaterThan(0);
  });

  it('never emits a token containing whitespace, which robots.txt cannot express', () => {
    for (const crawler of CRAWLERS) {
      for (const token of [crawler.id, ...(crawler.aliases ?? [])]) expect(token).not.toMatch(/\s/);
    }
  });

  it('looks a crawler up by id and returns undefined for an unknown one', () => {
    expect(crawlerById('GPTBot')?.vendor).toBe('OpenAI');
    expect(crawlerById('NotARealBot')).toBeUndefined();
  });
});

describe('presets', () => {
  it('expands a group stance into per-crawler rules', () => {
    const preset = ROBOTS_PRESETS.find((candidate) => candidate.id === 'block-ai-training')!;
    const policies = policiesForPreset(preset);

    expect(policies.GPTBot).toBe('block');
    expect(policies['OAI-SearchBot']).toBe('allow');
    // Untouched groups stay absent, so those crawlers fall through to `*`.
    expect(policies.Googlebot).toBeUndefined();
    expect(policies.AhrefsBot).toBeUndefined();
  });

  it('leaves "allow everything" with no named rules at all', () => {
    const preset = ROBOTS_PRESETS.find((candidate) => candidate.id === 'allow-all')!;
    expect(Object.keys(policiesForPreset(preset))).toHaveLength(0);
  });

  it('builds an allow-list stance: named companies in, everything else out', () => {
    const preset = ROBOTS_PRESETS.find((candidate) => candidate.id === 'known-bots-only')!;
    const { text, warnings } = build({
      defaultPolicy: preset.defaultPolicy,
      policies: policiesForPreset(preset),
      comments: false,
    });

    // The catch-all closes the door; the named groups hold it open for the reputable ones.
    expect(groupFor(text, '*')).toEqual(['Disallow: /']);
    for (const id of ['Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User']) {
      expect(groupFor(text, id)).toEqual(['Allow: /']);
    }
    // Anything unnamed — resellers, SEO indexes, tomorrow's crawler — falls to the catch-all.
    expect(text).not.toContain('AhrefsBot');
    expect(text).not.toContain('ImagesiftBot');
    expect(warnings.some((warning) => warning.includes('not named in this file'))).toBe(true);
  });

  it('produces a valid file for every preset', () => {
    for (const preset of ROBOTS_PRESETS) {
      const text = build({ defaultPolicy: preset.defaultPolicy, policies: policiesForPreset(preset) }).text;
      expect(rules(text)[0]).toBe('User-agent: *');
      expect(text.endsWith('\n')).toBe(true);
    }
  });
});

describe('group-level stance', () => {
  it('reports a group as unlisted when nothing in it is named', () => {
    expect(groupStance('seo', {})).toBe('unlisted');
  });

  it('reports the shared stance when every crawler in the group agrees', () => {
    const policies = setGroupPolicy({}, 'seo', 'block');
    expect(groupStance('seo', policies)).toBe('block');
  });

  it('reports mixed as soon as one crawler in the group differs', () => {
    const policies = { ...setGroupPolicy({}, 'seo', 'block'), AhrefsBot: 'allow' as const };
    expect(groupStance('seo', policies)).toBe('mixed');
  });

  it('sets every crawler in a group and leaves other groups untouched', () => {
    const policies = setGroupPolicy({ GPTBot: 'block' }, 'seo', 'block');

    for (const crawler of crawlersInGroup('seo')) expect(policies[crawler.id]).toBe('block');
    expect(policies.GPTBot).toBe('block');
  });

  it('composes two stances that no single preset expresses', () => {
    // The whole point of group controls: "block AI training AND scrapers".
    let policies = setGroupPolicy({}, 'ai-training', 'block');
    policies = setGroupPolicy(policies, 'scraper', 'block');

    expect(groupStance('ai-training', policies)).toBe('block');
    expect(groupStance('scraper', policies)).toBe('block');
    expect(groupStance('search', policies)).toBe('unlisted');
  });

  it('removes the rules again when a group is set back to unlisted', () => {
    const blocked = setGroupPolicy({}, 'seo', 'block');
    const cleared = setGroupPolicy(blocked, 'seo', 'unlisted');

    expect(Object.keys(cleared)).toHaveLength(0);
    expect(groupStance('seo', cleared)).toBe('unlisted');
  });

  it('does not mutate the map it is given', () => {
    const original = { GPTBot: 'block' as const };
    setGroupPolicy(original, 'seo', 'block');
    expect(Object.keys(original)).toEqual(['GPTBot']);
  });
});

describe('activePresetId', () => {
  it('names the preset the current settings exactly match', () => {
    for (const preset of ROBOTS_PRESETS) {
      expect(activePresetId(preset.defaultPolicy, policiesForPreset(preset))).toBe(preset.id);
    }
  });

  it('returns undefined once a single crawler diverges from the preset', () => {
    const preset = ROBOTS_PRESETS.find((candidate) => candidate.id === 'block-ai-training')!;
    const policies = { ...policiesForPreset(preset) };
    delete policies.GPTBot;

    expect(activePresetId(preset.defaultPolicy, policies)).toBeUndefined();
  });

  it('returns undefined when only the default policy differs', () => {
    const preset = ROBOTS_PRESETS.find((candidate) => candidate.id === 'block-ai-training')!;
    expect(activePresetId('block', policiesForPreset(preset))).toBeUndefined();
  });

  it('ignores a stale crawler id, so an old share link still matches its preset', () => {
    const preset = ROBOTS_PRESETS.find((candidate) => candidate.id === 'allow-all')!;
    expect(activePresetId('allow', { RetiredBot2019: 'block' })).toBe(preset.id);
  });
});

describe('buildRobotsTxt', () => {
  it('generates an allow-everything file from the defaults', () => {
    const { text } = build({ comments: false });
    expect(text).toBe('User-agent: *\nAllow: /\n');
  });

  it('emits explanatory comments when asked, without changing the rules', () => {
    const withComments = build({ policies: { GPTBot: 'block' } }).text;
    const without = build({ policies: { GPTBot: 'block' }, comments: false }).text;

    expect(withComments).toContain('#');
    expect(rules(withComments)).toEqual(rules(without));
  });

  it('blocks a named crawler in its own group', () => {
    const { text } = build({ policies: { GPTBot: 'block' }, comments: false });
    expect(text).toBe('User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n');
  });

  it('emits every alias of a crawler as its own User-agent line', () => {
    const { text } = build({ policies: { Bytespider: 'block' }, comments: false });
    expect(groupFor(text, 'Bytespider')).toEqual(['Disallow: /']);
    expect(text).toContain('User-agent: ByteSpider');
  });

  it('repeats site-wide path rules inside each allowed named group', () => {
    // The whole point: a named group inherits nothing from `*`, so an allowed bot would
    // otherwise be free to crawl exactly the paths the author meant to hide.
    const { text } = build({
      policies: { 'OAI-SearchBot': 'allow' },
      disallowPaths: ['/admin/', '/tmp/'],
    });

    expect(groupFor(text, '*')).toEqual(['Disallow: /admin/', 'Disallow: /tmp/', 'Allow: /']);
    expect(groupFor(text, 'OAI-SearchBot')).toEqual(['Disallow: /admin/', 'Disallow: /tmp/', 'Allow: /']);
  });

  it('does not leak path exceptions into a named blocked group', () => {
    const { text } = build({ policies: { GPTBot: 'block' }, allowPaths: ['/public/'], disallowPaths: ['/admin/'] });
    expect(groupFor(text, 'GPTBot')).toEqual(['Disallow: /']);
  });

  it('keeps Allow exceptions in the default group when the default is block', () => {
    const { text } = build({ defaultPolicy: 'block', allowPaths: ['/public/'] });
    expect(groupFor(text, '*')).toEqual(['Allow: /public/', 'Disallow: /']);
  });

  it('groups blocked and allowed crawlers separately, in catalogue order', () => {
    const { text } = build({
      policies: { GPTBot: 'block', CCBot: 'block', PerplexityBot: 'allow' },
      comments: false,
    });

    expect(rules(text)).toEqual([
      'User-agent: *',
      'Allow: /',
      'User-agent: GPTBot',
      'User-agent: CCBot',
      'Disallow: /',
      'User-agent: PerplexityBot',
      'Allow: /',
    ]);
  });

  it('adds the Sitemap line last', () => {
    const { text } = build({ sitemapUrl: 'https://example.com/sitemap.xml', comments: false });
    expect(rules(text).at(-1)).toBe('Sitemap: https://example.com/sitemap.xml');
  });

  it('emits a crawl delay only on the default group', () => {
    const { text } = build({ crawlDelay: 10, policies: { PerplexityBot: 'allow' }, comments: false });
    expect(groupFor(text, '*')).toEqual(['Crawl-delay: 10', 'Allow: /']);
    expect(groupFor(text, 'PerplexityBot')).toEqual(['Allow: /']);
  });

  it('appends custom user-agents as their own group', () => {
    const { text } = build({
      custom: [
        { userAgent: 'MyIntranetBot', policy: 'allow' },
        { userAgent: 'AnnoyingBot', policy: 'block' },
      ],
      comments: false,
    });

    expect(groupFor(text, 'MyIntranetBot')).toEqual(['Allow: /']);
    expect(groupFor(text, 'AnnoyingBot')).toEqual(['Disallow: /']);
  });

  it('ignores blank custom rows rather than emitting an empty User-agent line', () => {
    const { text } = build({ custom: [{ userAgent: '   ', policy: 'block' }], comments: false });
    expect(text).toBe('User-agent: *\nAllow: /\n');
  });

  it('trims and de-duplicates path rules without reordering them', () => {
    const { text } = build({ disallowPaths: ['  /b/  ', '/a/', '/b/', ''], comments: false });
    expect(groupFor(text, '*')).toEqual(['Disallow: /b/', 'Disallow: /a/', 'Allow: /']);
  });

  it('ignores a policy for a crawler the catalogue no longer knows, rather than failing', () => {
    // A share link written before a catalogue refresh must still open.
    const { text } = build({ policies: { RetiredBot2019: 'block' }, comments: false });
    expect(text).toBe('User-agent: *\nAllow: /\n');
  });

  it('always ends with a single trailing newline', () => {
    expect(build().text.endsWith('\n')).toBe(true);
    expect(build().text.endsWith('\n\n')).toBe(false);
  });

  it('stays valid with every catalogued crawler blocked at once', () => {
    const policies = Object.fromEntries(CRAWLERS.map((crawler) => [crawler.id, 'block' as const]));
    const { text } = build({ policies });

    for (const crawler of CRAWLERS) expect(groupFor(text, crawler.id)).toEqual(['Disallow: /']);
  });
});

describe('buildRobotsTxt validation', () => {
  it('rejects a path that does not start with a slash, and suggests the fix', () => {
    const result = buildRobotsTxt(options({ disallowPaths: ['admin/'] }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('/admin/') });
  });

  it('rejects a path containing a space', () => {
    const result = buildRobotsTxt(options({ allowPaths: ['/my docs/'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('%20');
  });

  it('rejects a relative sitemap URL', () => {
    const result = buildRobotsTxt(options({ sitemapUrl: '/sitemap.xml' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('absolute');
  });

  it('rejects a non-http sitemap URL', () => {
    const result = buildRobotsTxt(options({ sitemapUrl: 'ftp://example.com/sitemap.xml' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('http');
  });

  it('rejects an out-of-range or nonsensical crawl delay', () => {
    expect(buildRobotsTxt(options({ crawlDelay: -1 })).ok).toBe(false);
    expect(buildRobotsTxt(options({ crawlDelay: MAX_CRAWL_DELAY + 1 })).ok).toBe(false);
    expect(buildRobotsTxt(options({ crawlDelay: Number.NaN })).ok).toBe(false);
    expect(buildRobotsTxt(options({ crawlDelay: 0 })).ok).toBe(true);
  });

  it('rejects a custom user-agent containing a space', () => {
    const result = buildRobotsTxt(options({ custom: [{ userAgent: 'My Bot', policy: 'block' }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('space');
  });
});

describe('buildRobotsTxt warnings', () => {
  it('warns that a blocking default shuts out crawlers that do not exist yet', () => {
    const { warnings } = build({ defaultPolicy: 'block' });
    expect(warnings.some((warning) => warning.includes('not named in this file'))).toBe(true);
  });

  it('warns that Allow rules do nothing without a Disallow to carve out of', () => {
    const { warnings } = build({ allowPaths: ['/public/'] });
    expect(warnings.some((warning) => warning.includes('no effect'))).toBe(true);
  });

  it('does not warn about Allow rules once something is disallowed', () => {
    const { warnings } = build({ allowPaths: ['/admin/public/'], disallowPaths: ['/admin/'] });
    expect(warnings.some((warning) => warning.includes('no effect'))).toBe(false);
  });

  it('warns that blocking a crawler with a bad record needs the edge, not robots.txt', () => {
    const { warnings } = build({ policies: { Bytespider: 'block' } });
    expect(warnings.some((warning) => warning.includes('Bytespider') && warning.includes('firewall'))).toBe(true);
  });

  it('warns about the real cost of blocking a search engine', () => {
    const { warnings } = build({ policies: { Googlebot: 'block' } });
    expect(warnings.some((warning) => warning.includes('Googlebot'))).toBe(true);
  });

  it('does not warn about search engines that are merely left at the default', () => {
    const { warnings } = build({ policies: { GPTBot: 'block' } });
    expect(warnings.some((warning) => warning.includes('Googlebot'))).toBe(false);
  });

  it('suggests adding a sitemap, and stops once one is there', () => {
    expect(build().warnings.some((warning) => warning.includes('Sitemap'))).toBe(true);
    expect(
      build({ sitemapUrl: 'https://example.com/sitemap.xml' }).warnings.some((warning) => warning.includes('Sitemap'))
    ).toBe(false);
  });
});
