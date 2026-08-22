import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import TimestampConverter from './TimestampConverter';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<TimestampConverter />', () => {
  it('shows the current Unix time on load', () => {
    render(<TimestampConverter />);
    expect(screen.getByText(/current unix time/i)).toBeInTheDocument();
  });

  it('converts a seconds timestamp to an ISO date', async () => {
    render(<TimestampConverter />);
    typeInto(screen.getByLabelText(/unix timestamp/i), '1700000000');

    expect(await screen.findByText('2023-11-14T22:13:20.000Z')).toBeInTheDocument();
  });

  it('auto-detects milliseconds', async () => {
    render(<TimestampConverter />);
    typeInto(screen.getByLabelText(/unix timestamp/i), '1700000000123');

    expect(await screen.findByText('2023-11-14T22:13:20.123Z')).toBeInTheDocument();
  });

  it('rejects non-numeric input with a clear message', async () => {
    render(<TimestampConverter />);
    typeInto(screen.getByLabelText(/unix timestamp/i), 'abc');

    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number/i);
  });

  it('converts a date string back to a timestamp', async () => {
    render(<TimestampConverter />);
    fireEvent.click(screen.getByRole('button', { name: /date → timestamp/i }));
    typeInto(screen.getByPlaceholderText('2026-03-14T09:26:53Z'), '2023-11-14T22:13:20Z');

    expect(await screen.findByText('1700000000')).toBeInTheDocument();
  });

  it('rejects an unparseable date', async () => {
    render(<TimestampConverter />);
    fireEvent.click(screen.getByRole('button', { name: /date → timestamp/i }));
    typeInto(screen.getByPlaceholderText('2026-03-14T09:26:53Z'), 'next tuesday');

    expect(await screen.findByRole('alert')).toHaveTextContent(/ISO 8601/);
  });

  it('shows the day of the week', async () => {
    render(<TimestampConverter />);
    typeInto(screen.getByLabelText(/unix timestamp/i), '1700000000');

    expect(await screen.findByText('Tuesday')).toBeInTheDocument();
  });

  it('shows a conversion result immediately on load, with no click required', () => {
    render(<TimestampConverter />);
    // The input is pre-seeded with the current time, so a result row is already visible.
    expect(screen.getByText(/ISO 8601 \(UTC\)/i)).toBeInTheDocument();
  });

  it('carries a valid value across when switching direction, instead of erroring', async () => {
    render(<TimestampConverter />);
    typeInto(screen.getByLabelText(/unix timestamp/i), '1700000000');
    await screen.findByText('2023-11-14T22:13:20.000Z');

    fireEvent.click(screen.getByRole('button', { name: /date → timestamp/i }));

    const dateInput = screen.getByPlaceholderText('2026-03-14T09:26:53Z') as HTMLInputElement;
    expect(dateInput.value).toBe('2023-11-14T22:13:20.000Z');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('1700000000')).toBeInTheDocument();
  });

  it('replaces an invalid value with "now" when switching direction', async () => {
    render(<TimestampConverter />);
    typeInto(screen.getByLabelText(/unix timestamp/i), 'not a timestamp');
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: /date → timestamp/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByText(/ISO 8601 \(UTC\)/i)).toBeInTheDocument();
  });

  it('switching direction and back again keeps a valid, roughly-consistent result', async () => {
    render(<TimestampConverter />);
    typeInto(screen.getByLabelText(/unix timestamp/i), '1700000000');
    await screen.findByText('2023-11-14T22:13:20.000Z');

    fireEvent.click(screen.getByRole('button', { name: /date → timestamp/i }));
    await screen.findByText('1700000000');

    fireEvent.click(screen.getByRole('button', { name: /timestamp → date/i }));
    expect(await screen.findByText('2023-11-14T22:13:20.000Z')).toBeInTheDocument();
  });
});
