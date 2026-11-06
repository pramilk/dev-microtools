import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { CollapsibleHelp } from './CollapsibleHelp';

describe('<CollapsibleHelp />', () => {
  it('is collapsed by default', () => {
    render(
      <CollapsibleHelp summary="How do I get this?">
        <p>Step one</p>
      </CollapsibleHelp>
    );
    const details = screen.getByText('How do I get this?').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });

  it('shows its content and can be opened from the summary', () => {
    render(
      <CollapsibleHelp summary="How do I get this?">
        <p>Step one</p>
      </CollapsibleHelp>
    );
    const details = screen.getByText('How do I get this?').closest('details') as HTMLDetailsElement;
    fireEvent.click(screen.getByText('How do I get this?'));
    details.open = true;
    expect(screen.getByText('Step one')).toBeInTheDocument();
    expect(details.open).toBe(true);
  });
});
