import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import CronGenerator from './CronGenerator';

describe('<CronGenerator />', () => {
  it('starts with a sensible default schedule', () => {
    render(<CronGenerator />);

    expect(screen.getByText('0 9 * * *')).toBeInTheDocument();
    expect(screen.getByText('At 09:00.')).toBeInTheDocument();
  });

  it('switches the minute field to "every N" and updates the expression', () => {
    render(<CronGenerator />);
    const minuteField = screen.getByRole('group', { name: /^minute mode$/i }).closest<HTMLElement>('.field')!;

    fireEvent.click(within(minuteField).getByRole('button', { name: /every n minutes/i }));
    fireEvent.input(within(minuteField).getByLabelText(/step for minute/i), { target: { value: '15' } });

    expect(screen.getByText('*/15 9 * * *')).toBeInTheDocument();
  });

  it('switches the day-of-month field to specific values and toggles a chip', () => {
    render(<CronGenerator />);
    const domField = screen.getByRole('group', { name: /^day of month mode$/i }).closest<HTMLElement>('.field')!;

    fireEvent.click(within(domField).getByRole('button', { name: /^specific$/i }));
    fireEvent.click(within(domField).getByRole('button', { name: '15' }));

    expect(screen.getByText('0 9 15 * *')).toBeInTheDocument();
  });

  it('applies a preset', () => {
    render(<CronGenerator />);

    fireEvent.click(screen.getByRole('button', { name: /every weekday at 9am/i }));

    expect(screen.getByText('0 9 * * 1,2,3,4,5')).toBeInTheDocument();
  });

  it('clears every field to a wildcard', () => {
    render(<CronGenerator />);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByText('* * * * *')).toBeInTheDocument();
  });

  it('shows the next scheduled runs', () => {
    render(<CronGenerator />);

    const list = document.querySelector('.next-runs');
    expect(list).toBeInTheDocument();
    expect(list!.children.length).toBe(5);
  });
});
