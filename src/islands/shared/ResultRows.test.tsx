import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { ResultRows } from './ResultRows';

describe('<ResultRows />', () => {
  it('renders each label with its value and a copy button', () => {
    render(
      <ResultRows
        label="Facts"
        rows={[
          { label: 'Weekday', value: 'Saturday' },
          { label: 'Day of year', value: '73', hint: 'of 365' },
        ]}
      />
    );
    expect(screen.getByLabelText('Facts')).toBeInTheDocument();
    expect(screen.getByText('Saturday')).toBeInTheDocument();
    expect(screen.getByText('of 365')).toBeInTheDocument();
    expect(screen.getByTitle('Copy Weekday to clipboard')).toBeInTheDocument();
    expect(screen.getByTitle('Copy Day of year to clipboard')).toBeInTheDocument();
  });

  it('renders nothing but an empty list for no rows', () => {
    render(<ResultRows label="Empty" rows={[]} />);
    expect(screen.getByLabelText('Empty').children).toHaveLength(0);
  });
});
