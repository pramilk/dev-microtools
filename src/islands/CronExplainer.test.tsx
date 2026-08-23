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
