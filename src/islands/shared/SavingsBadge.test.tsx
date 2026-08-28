import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { SavingsBadge } from './SavingsBadge';

const badge = () => document.querySelector('.savings-badge')!;

describe('<SavingsBadge />', () => {
  it('reports a reduction as a success-toned percentage', () => {
    render(<SavingsBadge beforeBytes={1000} afterBytes={250} />);

    expect(screen.getByText('75% smaller')).toBeInTheDocument();
    expect(badge().className).toContain('savings-badge--success');
  });

  it('warns when the result grew instead of shrinking', () => {
    // Re-encoding an already-optimised file can genuinely produce a bigger one, and
    // presenting that in success green would be actively misleading.
    render(<SavingsBadge beforeBytes={100} afterBytes={150} />);

    expect(screen.getByText('50% larger')).toBeInTheDocument();
    expect(badge().className).toContain('savings-badge--warning');
  });

  it('reports an unchanged size neutrally, with no percentage', () => {
    render(<SavingsBadge beforeBytes={500} afterBytes={500} />);

    expect(screen.getByText('No change')).toBeInTheDocument();
    expect(badge().className).toContain('savings-badge--neutral');
  });

  it('treats a zero-byte original as no change rather than dividing by zero', () => {
    render(<SavingsBadge beforeBytes={0} afterBytes={0} />);
    expect(screen.getByText('No change')).toBeInTheDocument();
  });

  it('reports growth from a zero-byte original without an Infinity percentage', () => {
    render(<SavingsBadge beforeBytes={0} afterBytes={40} />);
    expect(screen.getByText('0% larger')).toBeInTheDocument();
  });

  it('rounds to whole percent', () => {
    render(<SavingsBadge beforeBytes={3} afterBytes={2} />);
    expect(screen.getByText('33% smaller')).toBeInTheDocument();
  });

  it('applies the large variant only when asked', () => {
    const { rerender } = render(<SavingsBadge beforeBytes={100} afterBytes={50} />);
    expect(badge().className).not.toContain('savings-badge--lg');

    rerender(<SavingsBadge beforeBytes={100} afterBytes={50} large />);
    expect(badge().className).toContain('savings-badge--lg');
  });

  it('handles a very large pair of sizes', () => {
    render(<SavingsBadge beforeBytes={5_000_000_000} afterBytes={1_000_000_000} />);
    expect(screen.getByText('80% smaller')).toBeInTheDocument();
  });
});
