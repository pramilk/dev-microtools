import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import DateCalculator from './DateCalculator';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

/** The displayed value beside a result label, without the copy button's text. */
const rowValue = (label: string): string => {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.nextElementSibling!.querySelector('.result-rows__value')!.textContent ?? '';
};

const startInput = () => screen.getByLabelText('Start date');
const endInput = () => screen.getByLabelText('End date');
const goToAddMode = () => fireEvent.click(screen.getByRole('button', { name: /add \/ subtract/i }));

afterEach(() => {
  window.location.hash = '';
});

describe('<DateCalculator /> days between dates', () => {
  it('shows a result on load, with no click required', () => {
    render(<DateCalculator />);
    expect(screen.getByLabelText('Date difference')).toBeInTheDocument();
    expect(rowValue('Total days')).toBe('30');
  });

  it('breaks a span into years, months and days', () => {
    render(<DateCalculator />);
    typeInto(startInput(), '2000-01-15');
    typeInto(endInput(), '2026-03-14');

    expect(rowValue('Difference')).toBe('26 years, 1 month, 27 days');
    expect(rowValue('Total days')).toBe('9,555');
    expect(rowValue('Start weekday')).toBe('Saturday');
  });

  it('loads the example', () => {
    render(<DateCalculator />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect((startInput() as HTMLInputElement).value).toBe('2000-01-15');
    expect(rowValue('Difference')).toBe('26 years, 1 month, 27 days');
  });

  it('counts the end date when asked', () => {
    render(<DateCalculator />);
    typeInto(startInput(), '2026-03-02');
    typeInto(endInput(), '2026-03-06');
    expect(rowValue('Total days')).toBe('4');

    fireEvent.click(screen.getByLabelText(/include the end date/i));
    expect(rowValue('Total days')).toBe('5');
    expect(rowValue('Business days')).toContain('5');
  });

  it('says so when the end date is before the start date', () => {
    render(<DateCalculator />);
    typeInto(startInput(), '2026-03-14');
    typeInto(endInput(), '2026-03-01');
    expect(rowValue('Difference')).toContain('13 days');
    expect(screen.getByText(/end date is before the start date/i)).toBeInTheDocument();
  });

  it('shows nothing, and no error, when a date is still empty', () => {
    render(<DateCalculator />);
    typeInto(endInput(), '');
    expect(screen.queryByLabelText('Date difference')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fills a date with "Today"', () => {
    render(<DateCalculator />);
    typeInto(startInput(), '2000-01-01');
    fireEvent.click(screen.getAllByRole('button', { name: /^today$/i })[0]!);
    expect((startInput() as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((startInput() as HTMLInputElement).value).not.toBe('2000-01-01');
  });
});

describe('<DateCalculator /> add / subtract', () => {
  it('adds months with end-of-month clamping', () => {
    render(<DateCalculator />);
    goToAddMode();
    typeInto(startInput(), '2026-01-31');
    typeInto(screen.getByLabelText('Days'), '');
    typeInto(screen.getByLabelText('Months'), '1');

    expect(rowValue('Resulting date')).toBe('2026-02-28');
    // 28 February 2026 is a Saturday; the weekday is shown beneath the date.
    expect(screen.getByText('Saturday')).toBeInTheDocument();
  });

  it('subtracts', () => {
    render(<DateCalculator />);
    goToAddMode();
    typeInto(startInput(), '2026-03-14');
    fireEvent.click(screen.getByRole('button', { name: 'Subtract' }));
    typeInto(screen.getByLabelText('Days'), '14');
    expect(rowValue('Resulting date')).toContain('2026-02-28');
  });

  it('skips weekends when adding business days', () => {
    render(<DateCalculator />);
    goToAddMode();
    typeInto(startInput(), '2026-03-06'); // a Friday
    typeInto(screen.getByLabelText('Days'), '');
    typeInto(screen.getByLabelText('Business days'), '1');
    expect(rowValue('Resulting date')).toContain('2026-03-09');
  });

  it('loads the add example', () => {
    render(<DateCalculator />);
    goToAddMode();
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect((startInput() as HTMLInputElement).value).toBe('2026-01-31');
    expect(rowValue('Resulting date')).toContain('2026-02-28');
  });

  it('rejects a fractional amount with a message', async () => {
    render(<DateCalculator />);
    goToAddMode();
    typeInto(screen.getByLabelText('Days'), '1.5');
    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number/i);
    expect(screen.queryByLabelText('Resulting date')).not.toBeInTheDocument();
  });

  it('rejects a negative amount with a message', async () => {
    render(<DateCalculator />);
    goToAddMode();
    typeInto(screen.getByLabelText('Weeks'), '-2');
    expect(await screen.findByRole('alert')).toHaveTextContent(/weeks/i);
  });

  it('reports a result that leaves the supported years', async () => {
    render(<DateCalculator />);
    goToAddMode();
    typeInto(startInput(), '9999-06-01');
    typeInto(screen.getByLabelText('Years'), '5');
    expect(await screen.findByRole('alert')).toHaveTextContent(/outside the supported years/i);
  });
});

describe('<DateCalculator /> controls', () => {
  it('clears every field', () => {
    render(<DateCalculator />);
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect((startInput() as HTMLInputElement).value).toBe('');
    expect((endInput() as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });

  it('offers a copy button on each result row', () => {
    render(<DateCalculator />);
    expect(screen.getByTitle('Copy Total days to clipboard')).toBeInTheDocument();
  });

  it('restores the mode and inputs from a shared link on load', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({
      mode: 'add',
      start: '2026-01-31',
      end: '',
      includeEnd: false,
      direction: 'add',
      years: '',
      months: '1',
      weeks: '',
      days: '',
      businessDays: '',
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<DateCalculator />);

    await waitFor(() => expect(rowValue('Resulting date')).toContain('2026-02-28'));
  });
});
