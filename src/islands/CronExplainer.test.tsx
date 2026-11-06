import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import CronExplainer from './CronExplainer';

/** The description paragraph — scoping here avoids ambiguity with preset buttons that repeat the same wording. */
const description = () => within(document.querySelector<HTMLElement>('.description')!);

describe('<CronExplainer />', () => {
  it('shows a description and next-run list for the default expression on load', async () => {
    render(<CronExplainer />);

    await screen.findByText('Every 15 minutes.');
    expect(description().getByText(/every 15 minutes/i)).toBeInTheDocument();
    const items = document.querySelectorAll('.next-runs li');
    expect(items.length).toBe(5);
  });

  it('updates the description as the expression changes', async () => {
    render(<CronExplainer />);
    fireEvent.input(screen.getByLabelText(/cron expression/i), { target: { value: '0 9 * * 1-5' } });

    expect(await screen.findByText('At 09:00, Monday through Friday.')).toBeInTheDocument();
  });

  it('shows a visible error for an invalid expression, not a blank result', async () => {
    render(<CronExplainer />);
    fireEvent.input(screen.getByLabelText(/cron expression/i), { target: { value: 'not a cron' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(document.querySelector('.next-runs')).not.toBeInTheDocument();
  });

  it('applies a preset when clicked', async () => {
    render(<CronExplainer />);
    fireEvent.click(screen.getByRole('button', { name: /every day at midnight/i }));

    expect(screen.getByLabelText(/cron expression/i)).toHaveValue('0 0 * * *');
    expect(await screen.findByText('At 00:00.')).toBeInTheDocument();
  });

  it('clears the input when Clear is pressed', async () => {
    render(<CronExplainer />);
    await screen.findByText('Every 15 minutes.');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/cron expression/i)).toHaveValue('');
    expect(document.querySelector('.description')).not.toBeInTheDocument();
  });

  it('copies the description to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CronExplainer />);
    await screen.findByText('Every 15 minutes.');

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('Every 15 minutes.');
  });
});

describe('<CronExplainer /> Quartz and AWS EventBridge', () => {
  const chooseSyntax = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
  const expression = () => screen.getByLabelText(/cron expression/i) as HTMLInputElement;

  it('switches to a sensible example in the new syntax', async () => {
    render(<CronExplainer />);
    chooseSyntax(/quartz/i);
    expect(expression().value).toBe('0 0/15 * * * ?');
    expect(await screen.findByText('Every 15 minutes.')).toBeInTheDocument();
    expect(document.querySelectorAll('.next-runs li')).toHaveLength(5);
  });

  it('keeps what the reader typed when it is also valid in the new syntax', () => {
    render(<CronExplainer />);
    fireEvent.input(expression(), { target: { value: '0 0 12 * * ?' } });
    chooseSyntax(/quartz/i);
    expect(expression().value).toBe('0 0 12 * * ?');
  });

  it('explains Quartz specials such as the last Friday of the month', async () => {
    render(<CronExplainer />);
    chooseSyntax(/quartz/i);
    fireEvent.input(expression(), { target: { value: '0 0 12 ? * 6L' } });
    expect(await screen.findByText('At 12:00, on the last Friday of the month.')).toBeInTheDocument();
  });

  it('shows seconds in the next-run list for Quartz', () => {
    render(<CronExplainer />);
    chooseSyntax(/quartz/i);
    fireEvent.input(expression(), { target: { value: '*/20 * * * * ?' } });
    const first = document.querySelector('.next-runs li')!.textContent!;
    expect(first).toMatch(/\d{1,2}:\d{2}:(00|20|40)/);
  });

  it('applies a Quartz preset', async () => {
    render(<CronExplainer />);
    chooseSyntax(/quartz/i);
    fireEvent.click(screen.getByRole('button', { name: 'Third Monday of the month' }));
    expect(expression().value).toBe('0 0 9 ? * 2#3');
    expect(await screen.findByText('At 09:00, on the 3rd Monday of the month.')).toBeInTheDocument();
  });

  it('reads an EventBridge cron() wrapper and defaults the zone to UTC', async () => {
    render(<CronExplainer />);
    chooseSyntax(/eventbridge/i);
    fireEvent.input(expression(), { target: { value: 'cron(0 12 * * ? *)' } });

    expect(await screen.findByText('At 12:00.')).toBeInTheDocument();
    expect((screen.getByLabelText(/time zone for next runs/i) as HTMLSelectElement).value).toBe('UTC');
    expect(screen.getByText(/evaluate cron expressions in UTC/i)).toBeInTheDocument();
    // 12:00 UTC, in a UTC list.
    expect(document.querySelector('.next-runs li')!.textContent).toMatch(/12:00/);
  });

  it('describes a rate expression and lists no runs', async () => {
    render(<CronExplainer />);
    chooseSyntax(/eventbridge/i);
    fireEvent.input(expression(), { target: { value: 'rate(5 minutes)' } });

    expect(await screen.findByText('Every 5 minutes.')).toBeInTheDocument();
    expect(screen.getByText(/fixed interval/i)).toBeInTheDocument();
    expect(document.querySelector('.next-runs')).not.toBeInTheDocument();
  });

  it('lists run times on the chosen time zone', () => {
    render(<CronExplainer />);
    fireEvent.input(expression(), { target: { value: '0 12 * * *' } });
    fireEvent.change(screen.getByLabelText(/time zone for next runs/i), { target: { value: 'Asia/Tokyo' } });

    expect(document.querySelector('.next-runs li')!.textContent).toMatch(/12:00/);
    expect(document.querySelector('.next-runs li')!.textContent).toMatch(/GMT\+9|JST/);
  });

  it('shows a visible, actionable error when both day fields are set in Quartz', async () => {
    render(<CronExplainer />);
    chooseSyntax(/quartz/i);
    fireEvent.input(expression(), { target: { value: '0 0 12 * * *' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/put "\?" in one of them/i);
    expect(document.querySelector('.next-runs')).not.toBeInTheDocument();
  });

  it('points a Quartz-shaped expression at the syntax selector when Unix is selected', async () => {
    render(<CronExplainer />);
    fireEvent.input(expression(), { target: { value: '0 0 12 * * ?' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/switch the syntax/i);
  });

  it('restores syntax, expression and time zone from a shared link, and still opens older links as Unix', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const shared = await encodeShareState({ input: '0 0 9 ? * 2#3', dialect: 'quartz', zone: 'Asia/Kolkata' });
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;

    window.location.hash = `#s=${shared.value}`;
    const { unmount } = render(<CronExplainer />);
    expect(await screen.findByText('At 09:00, on the 3rd Monday of the month.')).toBeInTheDocument();
    expect((screen.getByLabelText(/time zone for next runs/i) as HTMLSelectElement).value).toBe('Asia/Kolkata');
    unmount();

    const legacy = await encodeShareState({ input: '0 9 * * 1-5' });
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    window.location.hash = `#s=${legacy.value}`;
    render(<CronExplainer />);
    expect(await screen.findByText('At 09:00, Monday through Friday.')).toBeInTheDocument();
    window.location.hash = '';
  });
});
