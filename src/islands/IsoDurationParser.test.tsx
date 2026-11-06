import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import IsoDurationParser from './IsoDurationParser';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

/** The displayed value beside a result label, without the copy button's text. */
const rowValue = (label: string | RegExp): string => {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.nextElementSibling!.querySelector('.result-rows__value')!.textContent ?? '';
};

const durationInput = () => screen.getByLabelText(/iso 8601 duration/i);
const goToBuild = () => fireEvent.click(screen.getByRole('button', { name: /build a duration/i }));

afterEach(() => {
  window.location.hash = '';
});

describe('<IsoDurationParser /> parse', () => {
  it('shows a breakdown of the pre-filled example on load', () => {
    render(<IsoDurationParser />);
    expect(rowValue('ISO 8601')).toBe('P3Y6M4DT12H30M5S');
    expect(rowValue('In words')).toBe('3 years, 6 months, 4 days, 12 hours, 30 minutes, 5 seconds');
  });

  it('parses typed input into words and totals', () => {
    render(<IsoDurationParser />);
    typeInto(durationInput(), 'PT1H30M');

    expect(rowValue('In words')).toBe('1 hour, 30 minutes');
    expect(rowValue('Total seconds')).toContain('5,400');
    expect(rowValue('Total minutes')).toContain('90');
    expect(rowValue('Total hours')).toContain('1.5');
  });

  it('marks totals involving years or months as approximate', () => {
    render(<IsoDurationParser />);
    typeInto(durationInput(), 'P1Y');
    expect(rowValue('Total days')).toMatch(/^≈ /);
    expect(screen.getByText(/approximate/i)).toBeInTheDocument();

    typeInto(durationInput(), 'P1W');
    expect(rowValue('Total days')).toBe('7');
  });

  it('normalises sloppy input', () => {
    render(<IsoDurationParser />);
    typeInto(durationInput(), 'pt0030m');
    // Leading zeros and lower case are fine; the canonical form is shown.
    expect(rowValue('ISO 8601')).toBe('PT30M');
  });

  it('rejects malformed input with a helpful message and no result', async () => {
    render(<IsoDurationParser />);
    typeInto(durationInput(), '1 hour');
    expect(await screen.findByRole('alert')).toHaveTextContent(/starts with "P"/);
    expect(screen.queryByLabelText('Duration breakdown')).not.toBeInTheDocument();
  });

  it('explains out-of-order units', async () => {
    render(<IsoDurationParser />);
    typeInto(durationInput(), 'P1H');
    expect(await screen.findByRole('alert')).toHaveTextContent(/in order/i);
  });

  it('warns — without erroring — about weeks mixed with other units', async () => {
    render(<IsoDurationParser />);
    typeInto(durationInput(), 'P1W2D');
    expect(await screen.findByText(/weeks are combined/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('applies the duration to a start date and time in UTC', () => {
    render(<IsoDurationParser />);
    typeInto(durationInput(), 'P1M');
    typeInto(screen.getByLabelText(/apply to a date and time/i), '2026-01-31T10:00');
    expect(screen.getByText('2026-02-28T10:00:00.000Z')).toBeInTheDocument();
  });

  it('subtracts for a negative duration', () => {
    render(<IsoDurationParser />);
    typeInto(durationInput(), '-PT1H');
    typeInto(screen.getByLabelText(/apply to a date and time/i), '2026-03-14T10:00');
    expect(screen.getByText('2026-03-14T09:00:00.000Z')).toBeInTheDocument();
  });

  it('reports a fractional month when applying to a date', async () => {
    render(<IsoDurationParser />);
    typeInto(durationInput(), 'P0.5M');
    typeInto(screen.getByLabelText(/apply to a date and time/i), '2026-01-31T10:00');
    expect(await screen.findByRole('alert')).toHaveTextContent(/fractional/i);
  });

  it('fills the input from a preset chip', () => {
    render(<IsoDurationParser />);
    fireEvent.click(screen.getByRole('button', { name: '2 weeks' }));
    expect((durationInput() as HTMLInputElement).value).toBe('P2W');
  });

  it('clears the input and the result', () => {
    render(<IsoDurationParser />);
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect((durationInput() as HTMLInputElement).value).toBe('');
    expect(screen.queryByLabelText('Duration breakdown')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has a copy button on each result row', () => {
    render(<IsoDurationParser />);
    expect(screen.getByTitle('Copy ISO 8601 to clipboard')).toBeInTheDocument();
  });
});

describe('<IsoDurationParser /> build', () => {
  it('builds an ISO string from the fields', () => {
    render(<IsoDurationParser />);
    goToBuild();
    typeInto(screen.getByLabelText(/^days/i), '3');
    typeInto(screen.getByLabelText(/^hours/i), '4');
    expect(rowValue('ISO 8601')).toBe('P3DT4H');
  });

  it('shows nothing until a field is filled in', () => {
    render(<IsoDurationParser />);
    goToBuild();
    expect(screen.queryByLabelText('Duration breakdown')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('adds a leading minus for a negative duration', () => {
    render(<IsoDurationParser />);
    goToBuild();
    typeInto(screen.getByLabelText(/^minutes/i), '5');
    fireEvent.click(screen.getByLabelText(/negative duration/i));
    expect(rowValue('ISO 8601')).toBe('-PT5M');
  });

  it('fills the fields from a number of seconds', async () => {
    render(<IsoDurationParser />);
    goToBuild();
    typeInto(screen.getByLabelText(/start from a number of seconds/i), '93784');
    fireEvent.click(screen.getByRole('button', { name: /fill fields/i }));
    await waitFor(() => expect(rowValue('ISO 8601')).toBe('P1DT2H3M4S'));
    expect((screen.getByLabelText(/^hours/i) as HTMLInputElement).value).toBe('2');
  });

  it('rejects a seconds value that is not a number', async () => {
    render(<IsoDurationParser />);
    goToBuild();
    typeInto(screen.getByLabelText(/start from a number of seconds/i), 'soon');
    fireEvent.click(screen.getByRole('button', { name: /fill fields/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/number of seconds/i);
  });

  it('applies the same fraction rule as typed input', async () => {
    render(<IsoDurationParser />);
    goToBuild();
    typeInto(screen.getByLabelText(/^days/i), '1.5');
    typeInto(screen.getByLabelText(/^hours/i), '2');
    expect(await screen.findByRole('alert')).toHaveTextContent(/smallest unit/i);
  });
});

describe('<IsoDurationParser /> share link', () => {
  it('restores the mode and input from a shared link on load', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({
      mode: 'parse',
      input: 'PT45M',
      fields: {},
      negative: false,
      start: '2026-03-14T10:00',
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<IsoDurationParser />);

    await waitFor(() => expect(rowValue('ISO 8601')).toBe('PT45M'));
    expect(screen.getByText('2026-03-14T10:45:00.000Z')).toBeInTheDocument();
  });
});
