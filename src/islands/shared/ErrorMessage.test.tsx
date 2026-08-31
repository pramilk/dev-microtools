import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { ErrorMessage } from './ErrorMessage';

describe('<ErrorMessage />', () => {
  it('renders nothing for null, so callers can pass state straight through', () => {
    const { container } = render(<ErrorMessage message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an empty string', () => {
    // "No error" is expressed as '' by several tools; an empty red box would be a bug.
    const { container } = render(<ErrorMessage message="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the message in an alert region so it is announced, not only seen', () => {
    render(<ErrorMessage message="Unexpected token } at position 12" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Unexpected token } at position 12');
  });

  it('keeps its decorative icon out of the accessible name', () => {
    render(<ErrorMessage message="Broken" />);
    // The "!" glyph is presentation; a screen reader should read "Broken", not "! Broken".
    expect(screen.getByText('!')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a long message in full rather than truncating it', () => {
    const long = `Line ${'x'.repeat(2000)}`;
    render(<ErrorMessage message={long} />);
    expect(screen.getByRole('alert')).toHaveTextContent(long);
  });

  it('renders markup-looking text literally', () => {
    // Parser errors routinely quote the offending input; it must never become markup.
    render(<ErrorMessage message={'Unexpected <script>alert(1)</script>'} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unexpected <script>alert(1)</script>');
    expect(screen.getByRole('alert').querySelector('script')).toBeNull();
  });

  it('replaces the previous message when it changes', () => {
    const { rerender } = render(<ErrorMessage message="First problem" />);
    rerender(<ErrorMessage message="Second problem" />);

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Second problem');
  });

  it('shows no retry control when onRetry is not passed', () => {
    render(<ErrorMessage message="Network request failed" />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('shows a retry control that calls onRetry when clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorMessage message="Network request failed" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
