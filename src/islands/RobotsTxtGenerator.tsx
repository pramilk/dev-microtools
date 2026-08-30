import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  buildRobotsTxt,
  policiesForPreset,
  crawlersInGroup,
  presetById,
  groupStance,
  setGroupPolicy,
  activePresetId,
  CRAWLER_GROUPS,
  ROBOTS_PRESETS,
  DEFAULT_PRESET_ID,
  MAX_CRAWL_DELAY,
  type CrawlerGroupId,
  type CrawlerPolicy,
  type CustomRule,
  type PolicyChoice,
} from '../lib/tools/robotsTxt';
import {
  buildLlmsTxtScaffold,
  COMMON_SECTIONS,
  type LlmsTxtScaffoldOptions,
  type ScaffoldLink,
} from '../lib/tools/llmsTxtScaffold';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

type Mode = 'robots' | 'llms';

/**
 * The robots.txt form's own state. Paths and the crawl delay are held as the raw strings
 * the user typed rather than as the parsed `string[]` / `number | null` the generator
 * takes: a textarea that reformats itself mid-edit (eating a trailing newline, say) is
 * unusable, and an empty number field is not the same thing as zero.
 */
interface RobotsFormState {
  defaultPolicy: CrawlerPolicy;
  policies: Record<string, CrawlerPolicy>;
  custom: CustomRule[];
  disallowText: string;
  allowText: string;
  sitemapUrl: string;
  crawlDelay: string;
  comments: boolean;
}

interface ShareState {
  mode: Mode;
  robots: RobotsFormState;
  llms: LlmsTxtScaffoldOptions;
}

const EMPTY_ROBOTS: RobotsFormState = {
  defaultPolicy: 'allow',
  policies: {},
  custom: [],
  disallowText: '',
  allowText: '',
  sitemapUrl: '',
  crawlDelay: '',
  comments: true,
};

/** Opens on a real stance rather than an empty form, so the output is useful on arrival. */
const initialRobots = (): RobotsFormState => {
  const preset = presetById(DEFAULT_PRESET_ID);
  return preset === undefined
    ? EMPTY_ROBOTS
    : { ...EMPTY_ROBOTS, defaultPolicy: preset.defaultPolicy, policies: policiesForPreset(preset) };
};

/** Matches `example.input`/`example.output` in robots-txt-generator.mdx — keep the two in step. */
const EXAMPLE_ROBOTS: RobotsFormState = {
  ...EMPTY_ROBOTS,
  policies: { GPTBot: 'block', CCBot: 'block', 'OAI-SearchBot': 'allow' },
  disallowText: '/admin/\n/cart/',
  sitemapUrl: 'https://example.com/sitemap.xml',
};

const EMPTY_LLMS: LlmsTxtScaffoldOptions = {
  siteName: '',
  siteUrl: '',
  summary: '',
  notes: '',
  links: [],
};

let nextLinkId = 0;
const newLink = (overrides: Partial<ScaffoldLink> = {}): ScaffoldLink => ({
  id: `link-${(nextLinkId += 1)}`,
  section: 'Docs',
  title: '',
  url: '',
  description: '',
  ...overrides,
});

const exampleLlms = (): LlmsTxtScaffoldOptions => ({
  siteName: 'Acme Widgets',
  siteUrl: 'https://example.com',
  summary: 'Developer documentation for the Acme Widgets API and command-line tool.',
  notes:
    'Everything under /docs/ is versioned; unversioned URLs always point at the current release.\n\n' +
    'Code samples are MIT licensed and may be reproduced without attribution.',
  links: [
    newLink({ section: 'Docs', title: 'Quickstart', url: '/docs/quickstart', description: 'Install the CLI and make your first call.' }),
    newLink({ section: 'Docs', title: 'Authentication', url: '/docs/auth', description: 'API keys, scopes and token rotation.' }),
    newLink({ section: 'API', title: 'REST reference', url: '/api/rest', description: 'Every endpoint, with request and response shapes.' }),
    newLink({ section: 'Optional', title: 'Changelog', url: '/changelog', description: 'Release notes, newest first.' }),
  ],
});

/** One path per line; blank lines are the user's formatting, not input. */
const toPaths = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '');

/**
 * The three states a crawler or a group can be in. "Not listed" is deliberately worded as
 * an absence rather than a policy: it is what keeps a crawler out of the file entirely,
 * which is a different file — and a different meaning — from naming it and allowing it.
 */
const GROUP_CHOICES: readonly { choice: PolicyChoice; label: string; hint: string }[] = [
  {
    choice: 'unlisted',
    label: 'Not listed',
    hint: 'Write no rule for these — they follow the “Every other crawler” setting above',
  },
  { choice: 'allow', label: 'Allow', hint: 'Name these in the file and let them crawl the whole site' },
  { choice: 'block', label: 'Block', hint: 'Name these in the file and ask them to stay out entirely' },
];

/**
 * The stance summary shown on a collapsed group, so a closed section still says whether
 * anything inside it has been decided.
 */
function describeGroup(group: CrawlerGroupId, policies: Record<string, CrawlerPolicy>): string {
  const crawlers = crawlersInGroup(group);
  const allowed = crawlers.filter((crawler) => policies[crawler.id] === 'allow').length;
  const blocked = crawlers.filter((crawler) => policies[crawler.id] === 'block').length;

  const parts: string[] = [];
  if (blocked > 0) parts.push(`${blocked} blocked`);
  if (allowed > 0) parts.push(`${allowed} allowed`);
  if (parts.length === 0) return `${crawlers.length} crawlers · not listed`;
  return `${crawlers.length} crawlers · ${parts.join(', ')}`;
}

export default function RobotsTxtGenerator() {
  const [mode, setMode] = useState<Mode>('robots');
  const [robots, setRobots] = useState<RobotsFormState>(initialRobots);
  const [llms, setLlms] = useState<LlmsTxtScaffoldOptions>(EMPTY_LLMS);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const { value } = restored;
      if (value.mode === 'robots' || value.mode === 'llms') setMode(value.mode);
      if (value.robots) setRobots({ ...EMPTY_ROBOTS, ...value.robots });
      if (value.llms) setLlms({ ...EMPTY_LLMS, ...value.llms });
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const patchRobots = (patch: Partial<RobotsFormState>) => setRobots((current) => ({ ...current, ...patch }));
  const patchLlms = (patch: Partial<LlmsTxtScaffoldOptions>) => setLlms((current) => ({ ...current, ...patch }));

  const setPolicy = (id: string, choice: PolicyChoice) => {
    setRobots((current) => {
      const policies = { ...current.policies };
      if (choice === 'unlisted') delete policies[id];
      else policies[id] = choice;
      return { ...current, policies };
    });
  };

  const applyPreset = (id: string) => {
    const preset = presetById(id);
    if (preset === undefined) return;
    patchRobots({ defaultPolicy: preset.defaultPolicy, policies: policiesForPreset(preset) });
  };

  const robotsResult = useMemo(
    () =>
      buildRobotsTxt({
        defaultPolicy: robots.defaultPolicy,
        policies: robots.policies,
        custom: robots.custom,
        disallowPaths: toPaths(robots.disallowText),
        allowPaths: toPaths(robots.allowText),
        sitemapUrl: robots.sitemapUrl,
        crawlDelay: robots.crawlDelay.trim() === '' ? null : Number(robots.crawlDelay),
        comments: robots.comments,
      }),
    [robots]
  );

  const llmsResult = useMemo(() => buildLlmsTxtScaffold(llms), [llms]);

  /** Which preset, if any, the current settings add up to — so the row reads as state. */
  const activePreset = useMemo(
    () => activePresetId(robots.defaultPolicy, robots.policies),
    [robots.defaultPolicy, robots.policies]
  );

  const isRobots = mode === 'robots';
  const result = isRobots ? robotsResult : llmsResult;
  const output = isRobots
    ? robotsResult.ok
      ? robotsResult.value.text
      : ''
    : llmsResult.ok
      ? llmsResult.value
      : '';
  const warnings = isRobots && robotsResult.ok ? robotsResult.value.warnings : [];

  const loadExample = () => {
    if (isRobots) setRobots(EXAMPLE_ROBOTS);
    else setLlms(exampleLlms());
  };

  const clearAll = () => {
    if (isRobots) setRobots(EMPTY_ROBOTS);
    else setLlms(EMPTY_LLMS);
  };

  const shareState = (): ShareState => ({ mode, robots, llms });

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="File to generate">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={isRobots}
            onClick={() => setMode('robots')}
            title="Tell crawlers which parts of your site they may fetch"
          >
            robots.txt
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={!isRobots}
            onClick={() => setMode('llms')}
            title="Tell language models what your site is and where its key pages are"
          >
            llms.txt
          </button>
        </div>

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={shareState} describe="this crawler policy" />
        <button
          type="button"
          class="btn"
          onClick={loadExample}
          title={isRobots ? 'Fill in a worked example policy' : 'Fill in a worked example llms.txt'}
        >
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} title="Reset every field in this tab">
          Clear
        </button>
      </div>

      {isRobots ? (
        <>
          <div class="field">
            <span class="field__label">
              <span>Start from a common stance</span>
            </span>
            <p class="field__hint">
              One click sets every crawler below. Each of these <strong>replaces</strong> the whole policy rather than
              adding to it — to combine two stances (block AI training <em>and</em> scrapers, say), set each group’s own
              Allow/Block control further down instead. The highlighted button, if any, is what your current settings
              add up to.
            </p>
            <div class="robots-presets">
              {ROBOTS_PRESETS.map((preset) => (
                <button
                  type="button"
                  class="btn"
                  key={preset.id}
                  aria-pressed={activePreset === preset.id}
                  onClick={() => applyPreset(preset.id)}
                  title={`${preset.description} Replaces every crawler setting below.`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div class="robots-settings">
            <div class="field">
              <label class="field__label" for="robots-sitemap">
                <span>Sitemap URL</span>
              </label>
              <input
                id="robots-sitemap"
                type="url"
                class="input"
                placeholder="https://example.com/sitemap.xml"
                value={robots.sitemapUrl}
                onInput={(event) => patchRobots({ sitemapUrl: (event.target as HTMLInputElement).value })}
              />
              <span class="field__hint">Optional, but it is how search engines find pages nothing links to.</span>
            </div>

            <div class="field">
              <label class="field__label" for="robots-crawl-delay">
                <span>Crawl-delay</span>
              </label>
              <input
                id="robots-crawl-delay"
                type="number"
                class="input"
                min={0}
                max={MAX_CRAWL_DELAY}
                placeholder="none"
                value={robots.crawlDelay}
                title="Seconds a crawler should wait between requests. Google ignores it; Bing and Yandex honour it."
                onInput={(event) => patchRobots({ crawlDelay: (event.target as HTMLInputElement).value })}
              />
              <span class="field__hint">Seconds between requests. Google ignores this; Bing and Yandex honour it.</span>
            </div>

            <div class="field">
              <span class="field__label">
                <span>Every other crawler</span>
              </span>
              <div class="seg" role="group" aria-label="Policy for crawlers not named in the file">
                <button
                  type="button"
                  class="seg__btn"
                  aria-pressed={robots.defaultPolicy === 'allow'}
                  title="Anything not named in the file may crawl the whole site"
                  onClick={() => patchRobots({ defaultPolicy: 'allow' })}
                >
                  Allow
                </button>
                <button
                  type="button"
                  class="seg__btn"
                  aria-pressed={robots.defaultPolicy === 'block'}
                  title="Anything not named in the file is told to stay out entirely"
                  onClick={() => patchRobots({ defaultPolicy: 'block' })}
                >
                  Block
                </button>
              </div>
              <span class="field__hint">
                The <code>User-agent: *</code> rule — what any crawler left off the list below is told, including ones
                that do not exist yet.
              </span>
            </div>
          </div>

          <div class="field">
            <span class="field__label">
              <span>Crawlers, group by group</span>
            </span>
            <p class="field__hint">
              Each group has its own Allow / Block / Not listed control, and setting one group never disturbs another —
              that is how you say “block AI training <em>and</em> scrapers”. Open a group to override a single crawler
              inside it. <strong>Not listed</strong> writes no rule for that crawler at all, so it just follows the
              “Every other crawler” setting above.
            </p>

            {/* One <details> per group: the catalogue is 45 crawlers, and an always-open
                list would push the generated file several screens below the controls that
                change it. Native disclosure, so it works before hydration and with a
                keyboard. Only the group most visitors came for starts open.

                The group control lives in the <summary> so a collapsed group is still
                settable in one click; the buttons stop the click from reaching the
                disclosure, which would otherwise toggle open/closed on every change. */}
            {CRAWLER_GROUPS.map((group) => {
              const stance = groupStance(group.id, robots.policies);
              return (
                <details class="robots-group" key={group.id} open={group.id === 'ai-training'}>
                  <summary class="robots-group__summary">
                    <span class="robots-group__title">{group.label}</span>
                    <span class="robots-group__hint">{group.description}</span>
                    <span class="robots-group__count">{describeGroup(group.id, robots.policies)}</span>
                    <span
                      class="seg robots-group__seg"
                      role="group"
                      aria-label={`Set every crawler in ${group.label}`}
                    >
                      {GROUP_CHOICES.map(({ choice, label, hint }) => (
                        <button
                          type="button"
                          class="seg__btn"
                          key={choice}
                          aria-pressed={stance === choice}
                          title={hint}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setRobots((current) => ({
                              ...current,
                              policies: setGroupPolicy(current.policies, group.id, choice),
                            }));
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                  </summary>
                  <div class="robots-rows">
                    {crawlersInGroup(group.id).map((crawler) => (
                      <div class="robots-row" key={crawler.id}>
                        <div class="robots-row__name">
                          <code>{crawler.id}</code>
                          <span class="robots-row__vendor">{crawler.vendor}</span>
                        </div>
                        <p class="robots-row__purpose">
                          {crawler.purpose}
                          {crawler.ignoresRobots ? ' Known to ignore robots.txt.' : ''}
                        </p>
                        <select
                          class="select robots-row__policy"
                          aria-label={`Policy for ${crawler.id}`}
                          title="“Not listed” leaves this crawler out of the file, so it follows the “Every other crawler” rule"
                          value={robots.policies[crawler.id] ?? 'unlisted'}
                          onChange={(event) =>
                            setPolicy(crawler.id, (event.target as HTMLSelectElement).value as PolicyChoice)
                          }
                        >
                          <option value="unlisted">Not listed</option>
                          <option value="allow">Allow</option>
                          <option value="block">Block</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>

          <div class="robots-settings">
            <div class="field">
              <label class="field__label" for="robots-disallow">
                <span>Disallowed paths</span>
              </label>
              <textarea
                id="robots-disallow"
                class="textarea textarea--short"
                placeholder={'/admin/\n/cart/'}
                value={robots.disallowText}
                onInput={(event) => patchRobots({ disallowText: (event.target as HTMLTextAreaElement).value })}
              />
              <span class="field__hint">One path per line, each starting with /. Repeated into every allowed group.</span>
            </div>

            <div class="field">
              <label class="field__label" for="robots-allow">
                <span>Allowed paths</span>
              </label>
              <textarea
                id="robots-allow"
                class="textarea textarea--short"
                placeholder="/admin/public/"
                value={robots.allowText}
                onInput={(event) => patchRobots({ allowText: (event.target as HTMLTextAreaElement).value })}
              />
              <span class="field__hint">Exceptions carved back out of a disallowed path.</span>
            </div>
          </div>

          <div class="field">
            <span class="field__label">
              <span>Your own user-agents</span>
            </span>
            <p class="field__hint">
              For a bot that is not in the list above — use the first word of its <code>User-Agent</code> header.
            </p>
            {/* Keyed by position: a custom rule is only ever appended or removed, and every
                field it has is rendered straight from state, so a shifting index cannot
                strand a stale value the way it could in an uncontrolled row. */}
            {robots.custom.map((rule, index) => (
              <div class="robots-custom-row" key={`custom-${index}`}>
                <input
                  type="text"
                  class="input"
                  placeholder="SomeBot"
                  value={rule.userAgent}
                  aria-label={`Custom user-agent ${index + 1}`}
                  onInput={(event) => {
                    const userAgent = (event.target as HTMLInputElement).value;
                    setRobots((current) => ({
                      ...current,
                      custom: current.custom.map((row, i) => (i === index ? { ...row, userAgent } : row)),
                    }));
                  }}
                />
                <select
                  class="select"
                  value={rule.policy}
                  aria-label={`Policy for custom user-agent ${index + 1}`}
                  onChange={(event) => {
                    const policy = (event.target as HTMLSelectElement).value as CrawlerPolicy;
                    setRobots((current) => ({
                      ...current,
                      custom: current.custom.map((row, i) => (i === index ? { ...row, policy } : row)),
                    }));
                  }}
                >
                  <option value="allow">Allow</option>
                  <option value="block">Block</option>
                </select>
                <button
                  type="button"
                  class="btn"
                  title="Remove this user-agent"
                  onClick={() =>
                    setRobots((current) => ({ ...current, custom: current.custom.filter((_, i) => i !== index) }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <div class="tool-bar">
              <button
                type="button"
                class="btn"
                onClick={() => setRobots((current) => ({ ...current, custom: [...current.custom, { userAgent: '', policy: 'block' }] }))}
                title="Add a user-agent that is not in the list above"
              >
                + Add user-agent
              </button>
              <label class="checkbox" title="Explanatory # comments make the file easier to revisit; the rules are identical either way">
                <input
                  type="checkbox"
                  checked={robots.comments}
                  onChange={(event) => patchRobots({ comments: (event.target as HTMLInputElement).checked })}
                />
                Include explanatory comments
              </label>
            </div>
          </div>
        </>
      ) : (
        <>
          <div class="robots-settings">
            <div class="field">
              <label class="field__label" for="llms-name">
                <span>Site name</span>
              </label>
              <input
                id="llms-name"
                type="text"
                class="input"
                placeholder="Acme Widgets"
                value={llms.siteName}
                onInput={(event) => patchLlms({ siteName: (event.target as HTMLInputElement).value })}
              />
              <span class="field__hint">Becomes the file's single H1.</span>
            </div>

            <div class="field">
              <label class="field__label" for="llms-url">
                <span>Site URL</span>
              </label>
              <input
                id="llms-url"
                type="url"
                class="input"
                placeholder="https://example.com"
                value={llms.siteUrl}
                onInput={(event) => patchLlms({ siteUrl: (event.target as HTMLInputElement).value })}
              />
              <span class="field__hint">Optional — used to turn the relative paths below into full URLs.</span>
            </div>
          </div>

          <div class="field">
            <label class="field__label" for="llms-summary">
              <span>One-line summary</span>
            </label>
            <input
              id="llms-summary"
              type="text"
              class="input"
              placeholder="Developer documentation for the Acme Widgets API."
              value={llms.summary}
              onInput={(event) => patchLlms({ summary: (event.target as HTMLInputElement).value })}
            />
            <span class="field__hint">The blockquote under the heading — the first thing a model reads.</span>
          </div>

          <div class="field">
            <label class="field__label" for="llms-notes">
              <span>Notes</span>
            </label>
            <textarea
              id="llms-notes"
              class="textarea textarea--short"
              placeholder="Anything a model should know before following the links — licensing, versioning, what to ignore."
              value={llms.notes}
              onInput={(event) => patchLlms({ notes: (event.target as HTMLTextAreaElement).value })}
            />
            <span class="field__hint">Optional. A blank line starts a new paragraph.</span>
          </div>

          <div class="field">
            <span class="field__label">
              <span>Links</span>
            </span>
            <p class="field__hint">
              The pages worth reading, grouped under a heading. Sections appear in the order you first use them.
            </p>
            <datalist id="llms-sections">
              {COMMON_SECTIONS.map((section) => (
                <option value={section} key={section} />
              ))}
            </datalist>

            {llms.links.map((link, index) => (
              <div class="llms-link-row" key={link.id}>
                <input
                  type="text"
                  class="input llms-link-section"
                  list="llms-sections"
                  placeholder="Section"
                  value={link.section}
                  aria-label={`Section for link ${index + 1}`}
                  onInput={(event) => {
                    const section = (event.target as HTMLInputElement).value;
                    patchLlms({ links: llms.links.map((row) => (row.id === link.id ? { ...row, section } : row)) });
                  }}
                />
                <input
                  type="text"
                  class="input"
                  placeholder="Title"
                  value={link.title}
                  aria-label={`Title for link ${index + 1}`}
                  onInput={(event) => {
                    const title = (event.target as HTMLInputElement).value;
                    patchLlms({ links: llms.links.map((row) => (row.id === link.id ? { ...row, title } : row)) });
                  }}
                />
                <input
                  type="text"
                  class="input"
                  placeholder="/docs/quickstart"
                  value={link.url}
                  aria-label={`URL for link ${index + 1}`}
                  onInput={(event) => {
                    const url = (event.target as HTMLInputElement).value;
                    patchLlms({ links: llms.links.map((row) => (row.id === link.id ? { ...row, url } : row)) });
                  }}
                />
                <input
                  type="text"
                  class="input llms-link-description"
                  placeholder="What this page covers"
                  value={link.description}
                  aria-label={`Description for link ${index + 1}`}
                  onInput={(event) => {
                    const description = (event.target as HTMLInputElement).value;
                    patchLlms({ links: llms.links.map((row) => (row.id === link.id ? { ...row, description } : row)) });
                  }}
                />
                <button
                  type="button"
                  class="btn"
                  title="Remove this link"
                  onClick={() => patchLlms({ links: llms.links.filter((row) => row.id !== link.id) })}
                >
                  Remove
                </button>
              </div>
            ))}

            <div class="tool-bar">
              <button
                type="button"
                class="btn"
                onClick={() => patchLlms({ links: [...llms.links, newLink()] })}
                title="Add another link row"
              >
                + Add link
              </button>
            </div>
          </div>
        </>
      )}

      <OutputPane
        label={isRobots ? 'robots.txt' : 'llms.txt'}
        value={output}
        placeholder={
          isRobots ? 'Your robots.txt appears here.' : 'Fill in a site name and summary to see your llms.txt.'
        }
        tall
        describe={isRobots ? 'this robots.txt' : 'this llms.txt'}
        actions={
          <DownloadButton
            value={output}
            filename={isRobots ? 'robots.txt' : 'llms.txt'}
            describe={isRobots ? 'this robots.txt' : 'this llms.txt'}
          />
        }
      />

      {warnings.length > 0 && (
        <div class="msg msg--warning">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <ul class="robots-warnings">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <ErrorMessage message={result.ok ? null : result.error} />

      <p class="field__hint">
        Save the file at the root of your domain — <code>{isRobots ? '/robots.txt' : '/llms.txt'}</code>. Neither file
        works in a subdirectory.
      </p>

      <style>{`
        /* A full policy runs well past sixty lines. Without a cap the result pane pushes
           the warnings and the "where does this file go" note off the bottom of the page;
           the shared .output keeps its own resize handle for anyone who wants it taller. */
        .tool .output { max-height: 30rem; }
        .robots-presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .robots-settings {
          display: grid;
          gap: var(--space-4);
          grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        }
        .robots-group {
          margin-top: var(--space-2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: var(--space-2) var(--space-3);
        }
        .robots-group[open] { padding-bottom: var(--space-3); }
        .robots-group__summary {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: var(--space-1) var(--space-3);
          align-items: center;
          cursor: pointer;
          list-style-position: outside;
          padding: var(--space-1) 0;
        }
        .robots-group__seg { grid-row: 1 / 3; grid-column: 2; align-self: center; }
        /* .seg is inline-flex, but a flex-column .field stretches it to full width, leaving
           dead space after the last button. Local, so no other tool's toggles move. */
        .robots-settings .seg { align-self: flex-start; }
        .robots-presets .btn[aria-pressed='true'] {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--accent-contrast);
        }
        .robots-group__summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        /* A summary laid out as a grid loses its native marker, so the chevron is drawn
           here instead — without one the section does not read as expandable. It is written
           as the literal glyph rather than a CSS backslash escape, because this stylesheet
           lives inside a JS template literal where JS consumes the escape before CSS ever
           sees it. */
        .robots-group__summary::marker,
        .robots-group__summary::-webkit-details-marker { content: ''; display: none; }
        .robots-group__title { grid-column: 1; font-size: var(--text-sm); font-weight: 650; }
        .robots-group__title::before {
          content: '▸';
          display: inline-block;
          width: 1.1em;
          color: var(--text-subtle);
          transition: transform 0.12s ease;
        }
        .robots-group[open] .robots-group__title::before { transform: rotate(90deg); }
        .robots-group__count { grid-column: 1; font-size: var(--text-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; padding-left: 1.1em; }
        .robots-group__hint { grid-column: 1; font-size: var(--text-xs); color: var(--text-subtle); padding-left: 1.1em; }
        .robots-rows { display: flex; flex-direction: column; gap: var(--space-1); }
        .robots-row {
          display: grid;
          grid-template-columns: minmax(9rem, 14rem) 1fr auto;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-2) 0;
          border-top: 1px solid var(--border);
        }
        .robots-row__name { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
        .robots-row__name code { font-size: var(--text-sm); word-break: break-word; }
        .robots-row__vendor { font-size: var(--text-xs); color: var(--text-subtle); }
        .robots-row__purpose { font-size: var(--text-xs); color: var(--text-muted); margin: 0; }
        .robots-row__policy { width: auto; }
        .robots-custom-row,
        .llms-link-row { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin-bottom: var(--space-2); }
        .llms-link-row .input { flex: 1; min-width: 8rem; }
        .llms-link-section { max-width: 9rem; }
        .llms-link-description { flex: 2; min-width: 12rem; }
        .robots-warnings { margin: 0; padding-left: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
        @media (max-width: 44rem) {
          .robots-row { grid-template-columns: 1fr auto; }
          .robots-row__purpose { grid-column: 1 / -1; }
        }
      `}</style>
    </div>
  );
}
