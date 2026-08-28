import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { OutputPane } from './OutputPane';

function stubClipboard(writeText: ((text: string) => Promise<void>) | null) {
  Object.assign(navigator, { clipboard: writeText === null ? undefined : { writeText } });
}

afterEach(() => stubClipboard(null));

const pane = () => document.querySelector('pre')!;

describe('<OutputPane />', () => {
  it('shows the placeholder and an empty-state class when there is no value', () => {
    render(<OutputPane label="Result" value="" placeholder="Output appears here." />);

    expect(screen.getByText('Output appears here.')).toBeInTheDocument();
    expect(pane().className).toContain('output--empty');
  });

  it('shows the value and drops the empty-state class once filled', () => {
    render(<OutputPane label="Result" value="formatted" placeholder="Output appears here." />);

    expect(screen.getByText('formatted')).toBeInTheDocument();
    expect(screen.queryByText('Output appears here.')).not.toBeInTheDocument();
    expect(pane().className).not.toContain('output--empty');
  });

  it('disables its copy button while empty and enables it once filled', () => {
    const { rerender } = render(<OutputPane label="Result" value="" placeholder="…" />);
    expect(screen.getByRole('button', { name: /copy/i })).toBeDisabled();

    rerender(<OutputPane label="Result" value="formatted" placeholder="…" />);
    expect(screen.getByRole('button', { name: /copy/i })).toBeEnabled();
  });

  it('copies the value, not the placeholder', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<OutputPane label="Result" value="formatted" placeholder="Output appears here." />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('formatted');
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));
  });

  it('shows its label', () => {
    render(<OutputPane label="Formatted JSON" value="{}" placeholder="…" />);
    expect(screen.getByText('Formatted JSON')).toBeInTheDocument();
  });

  it('renders extra actions alongside the copy button', () => {
    render(
      <OutputPane
        label="Result"
        value="formatted"
        placeholder="…"
        actions={<button type="button">Download</button>}
      />
    );

    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('passes its description through to the copy control', () => {
    render(<OutputPane label="Result" value="formatted" placeholder="…" describe="the minified CSS" />);
    expect(screen.getByRole('button', { name: /copy/i })).toHaveAttribute(
      'title',
      'Copy the minified CSS to clipboard'
    );
  });

  it('applies the tall variant only when asked', () => {
    const { rerender } = render(<OutputPane label="Result" value="x" placeholder="…" />);
    expect(pane().className).not.toContain('output--tall');

    rerender(<OutputPane label="Result" value="x" placeholder="…" tall />);
    expect(pane().className).toContain('output--tall');
  });

  it('is focusable so the output can be reached and scrolled by keyboard', () => {
    render(<OutputPane label="Result" value="x" placeholder="…" />);
    expect(pane()).toHaveAttribute('tabindex', '0');
  });

  it('renders large output in full', () => {
    const big = 'a'.repeat(100_000);
    render(<OutputPane label="Result" value={big} placeholder="…" />);
    expect(pane().textContent).toHaveLength(100_000);
  });

  it('renders markup-looking output literally', () => {
    render(<OutputPane label="Result" value={'<img src=x onerror=alert(1)>'} placeholder="…" />);
    expect(pane().textContent).toBe('<img src=x onerror=alert(1)>');
    expect(pane().querySelector('img')).toBeNull();
  });
});
