import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { FindingList } from './FindingList';

describe('<FindingList />', () => {
  it('renders each finding with its severity label, title and detail', () => {
    render(
      <FindingList
        items={[
          { id: 'a', severity: 'danger', title: 'Bad thing', detail: 'It is bad.' },
          { id: 'b', severity: 'ok', title: 'Good thing', detail: 'It is fine.' },
        ]}
      />
    );
    expect(screen.getByText('Danger')).toBeInTheDocument();
    expect(screen.getByText('Bad thing')).toBeInTheDocument();
    expect(screen.getByText('It is bad.')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the suggested fix only when there is one', () => {
    render(
      <FindingList
        items={[
          { id: 'a', severity: 'warning', title: 'Missing', detail: 'd', fix: 'X-Frame-Options: DENY' },
          { id: 'b', severity: 'info', title: 'Noted', detail: 'd' },
        ]}
      />
    );
    expect(screen.getByText('X-Frame-Options: DENY')).toBeInTheDocument();
    expect(document.querySelectorAll('.finding__fix')).toHaveLength(1);
  });

  it('renders an empty list without error', () => {
    render(<FindingList items={[]} />);
    expect(screen.getByRole('list')).toBeEmptyDOMElement();
  });
});
