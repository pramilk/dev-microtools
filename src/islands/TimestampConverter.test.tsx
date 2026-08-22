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
});
