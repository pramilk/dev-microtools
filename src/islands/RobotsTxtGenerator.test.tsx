import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import RobotsTxtGenerator from './RobotsTxtGenerator';

const output = () => document.querySelector<HTMLElement>('.output');
const outputText = () => output()?.textContent ?? '';

const switchTo = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('<RobotsTxtGenerator />', () => {
  it('opens on a working policy rather than an empty file', () => {
    render(<RobotsTxtGenerator />);

    expect(outputText()).toContain('User-agent: *');
    expect(outputText()).toContain('User-agent: GPTBot');
    expect(document.querySelector('.output--empty')).toBeNull();
  });

  it('blocks a crawler when its dropdown is set to Block', () => {
    render(<RobotsTxtGenerator />);

    fireEvent.change(screen.getByLabelText('Policy for Googlebot'), { target: { value: 'block' } });

    expect(outputText()).toContain('User-agent: Googlebot');
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('drops a crawler back out of the file when it is set to "Not listed"', () => {
    render(<RobotsTxtGenerator />);
    expect(outputText()).toContain('User-agent: GPTBot');

    fireEvent.change(screen.getByLabelText('Policy for GPTBot'), { target: { value: 'unlisted' } });

    expect(outputText()).not.toContain('User-agent: GPTBot');
  });

  it('sets a whole group at once from its own control', () => {
    render(<RobotsTxtGenerator />);
    const seoGroup = screen.getByRole('group', { name: /set every crawler in seo/i });

    fireEvent.click(within(seoGroup).getByRole('button', { name: 'Block' }));

    expect(outputText()).toContain('User-agent: AhrefsBot');
    expect(outputText()).toContain('User-agent: SemrushBot');
  });

  it('keeps two group stances at once, which a preset alone cannot express', () => {
    // The composition complaint: "block AI training AND scrapers" has to be reachable.
    render(<RobotsTxtGenerator />);

    const scrapers = screen.getByRole('group', { name: /set every crawler in content resellers/i });
    fireEvent.click(within(scrapers).getByRole('button', { name: 'Block' }));

    expect(outputText()).toContain('User-agent: GPTBot');
    expect(outputText()).toContain('User-agent: ImagesiftBot');
  });

  it('shows no group selection while the crawlers inside disagree', () => {
    render(<RobotsTxtGenerator />);
    const training = screen.getByRole('group', { name: /set every crawler in ai training/i });
    expect(within(training).getByRole('button', { name: 'Block' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByLabelText('Policy for GPTBot'), { target: { value: 'allow' } });

    for (const label of ['Block', 'Allow', 'Not listed']) {
      expect(within(training).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('highlights the preset the current settings add up to, and drops it once they diverge', () => {
    render(<RobotsTxtGenerator />);
    const preset = screen.getByRole('button', { name: 'Block AI training' });
    expect(preset).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByLabelText('Policy for GPTBot'), { target: { value: 'unlisted' } });

    expect(preset).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies a preset to every crawler in its groups', () => {
    render(<RobotsTxtGenerator />);

    fireEvent.click(screen.getByRole('button', { name: 'Block scrapers & SEO bots' }));

    expect((screen.getByLabelText('Policy for AhrefsBot') as HTMLSelectElement).value).toBe('block');
    expect(outputText()).toContain('User-agent: AhrefsBot');
    // Untouched groups fall back to the catch-all instead of being named.
    expect(outputText()).not.toContain('User-agent: GPTBot');
  });

  it('repeats a disallowed path into every allowed named group', () => {
    render(<RobotsTxtGenerator />);

    fireEvent.input(screen.getByLabelText('Disallowed paths'), { target: { value: '/admin/' } });

    const allowedGroup = outputText().split(/\n\s*\n/).find((block) => block.includes('User-agent: OAI-SearchBot'));
    expect(allowedGroup).toContain('Disallow: /admin/');
  });

  it('shows a visible error for a path that does not start with a slash', () => {
    render(<RobotsTxtGenerator />);

    fireEvent.input(screen.getByLabelText('Disallowed paths'), { target: { value: 'admin/' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/must start with/i);
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('shows a visible error for a sitemap URL that is not absolute', () => {
    render(<RobotsTxtGenerator />);

    fireEvent.input(screen.getByLabelText(/sitemap url/i), { target: { value: '/sitemap.xml' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/absolute/i);
  });

  it('warns rather than fails when a rule is legal but cannot do anything', () => {
    render(<RobotsTxtGenerator />);

    fireEvent.input(screen.getByLabelText('Allowed paths'), { target: { value: '/public/' } });

    expect(document.querySelector('.msg--warning')?.textContent).toMatch(/no effect/i);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('adds a custom user-agent and writes it into the file', () => {
    render(<RobotsTxtGenerator />);

    fireEvent.click(screen.getByRole('button', { name: /add user-agent/i }));
    fireEvent.input(screen.getByLabelText('Custom user-agent 1'), { target: { value: 'NoisyBot' } });

    expect(outputText()).toContain('User-agent: NoisyBot');

    fireEvent.click(screen.getAllByRole('button', { name: /^remove$/i })[0]!);
    expect(outputText()).not.toContain('NoisyBot');
  });

  it('drops the comments without changing the rules', () => {
    render(<RobotsTxtGenerator />);
    const withComments = outputText();

    fireEvent.click(screen.getByLabelText(/include explanatory comments/i));

    expect(outputText()).not.toContain('#');
    expect(outputText().length).toBeLessThan(withComments.length);
  });

  it('loads the worked example from the content page', () => {
    render(<RobotsTxtGenerator />);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(outputText()).toContain('Sitemap: https://example.com/sitemap.xml');
    expect(outputText()).toContain('Disallow: /cart/');
    expect(outputText()).toContain('User-agent: OAI-SearchBot');
  });

  it('clears back to an allow-everything file', () => {
    render(<RobotsTxtGenerator />);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(outputText().replace(/^#.*$/gm, '').trim()).toBe('User-agent: *\nAllow: /');
  });

  it('switches to the llms.txt tab and starts from an explicit empty state', () => {
    render(<RobotsTxtGenerator />);

    switchTo(/^llms\.txt$/);

    expect(document.querySelector('.output--empty')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/site name/i);
  });

  it('builds an llms.txt from the fields', () => {
    render(<RobotsTxtGenerator />);
    switchTo(/^llms\.txt$/);

    fireEvent.input(screen.getByLabelText(/site name/i), { target: { value: 'Acme' } });
    fireEvent.input(screen.getByLabelText(/one-line summary/i), { target: { value: 'Docs for Acme.' } });

    expect(outputText()).toContain('# Acme');
    expect(outputText()).toContain('> Docs for Acme.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('adds a link row and renders it under its section', () => {
    render(<RobotsTxtGenerator />);
    switchTo(/^llms\.txt$/);

    fireEvent.input(screen.getByLabelText(/site name/i), { target: { value: 'Acme' } });
    fireEvent.input(screen.getByLabelText(/one-line summary/i), { target: { value: 'Docs for Acme.' } });
    fireEvent.click(screen.getByRole('button', { name: /add link/i }));
    fireEvent.input(screen.getByLabelText('Title for link 1'), { target: { value: 'Quickstart' } });
    fireEvent.input(screen.getByLabelText('URL for link 1'), { target: { value: '/docs/quickstart' } });

    expect(outputText()).toContain('## Docs');
    expect(outputText()).toContain('- [Quickstart](/docs/quickstart)');
  });

  it('loads a worked llms.txt example', () => {
    render(<RobotsTxtGenerator />);
    switchTo(/^llms\.txt$/);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(outputText()).toContain('# Acme Widgets');
    expect(outputText()).toContain('## API');
    expect(outputText()).toContain('https://example.com/docs/quickstart');
  });

  it('keeps each tab’s work when switching between them', () => {
    render(<RobotsTxtGenerator />);
    fireEvent.input(screen.getByLabelText(/sitemap url/i), { target: { value: 'https://example.com/sitemap.xml' } });

    switchTo(/^llms\.txt$/);
    fireEvent.input(screen.getByLabelText(/site name/i), { target: { value: 'Acme' } });
    switchTo(/^robots\.txt$/);

    expect((screen.getByLabelText(/sitemap url/i) as HTMLInputElement).value).toBe('https://example.com/sitemap.xml');

    switchTo(/^llms\.txt$/);
    expect((screen.getByLabelText(/site name/i) as HTMLInputElement).value).toBe('Acme');
  });
});
