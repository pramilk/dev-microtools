import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { CopyButton } from './CopyButton';

function stubClipboard(writeText: ((text: string) => Promise<void>) | null) {
  Object.assign(navigator, { clipboard: writeText === null ? undefined : { writeText } });
}

afterEach(() => stubClipboard(null));

/** The polite live region that announces the result to a screen reader. */
const status = () => screen.getByRole('status');

describe('<CopyButton />', () => {
  it('is disabled with an explanatory tooltip when there is nothing to copy', () => {
    render(<CopyButton value="" />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Nothing to copy yet');
  });

  it('copies the value and shows the confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<CopyButton value="payload" />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('payload');
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));
  });

  it('announces success to screen readers rather than only showing it', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    render(<CopyButton value="payload" describe="the JSON output" />);
    expect(status()).toHaveTextContent('');

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(status()).toHaveTextContent('the JSON output copied to clipboard'));
  });

  it('shows a failure state with recovery advice when the clipboard is unavailable', async () => {
    stubClipboard(null);

    render(<CopyButton value="payload" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copy failed'));
    expect(status()).toHaveTextContent('Select the text and copy manually');
  });

  it('shows a failure state when the write is rejected', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));

    render(<CopyButton value="payload" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copy failed'));
  });

  it('uses a custom label while idle but the shared wording once copied', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    render(<CopyButton value="payload" label="Copy matches" />);
    const button = screen.getByRole('button', { name: /copy matches/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    // The confirmation is deliberately the same word on every tool, custom label or not.
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));
  });

  it('describes what it copies in its tooltip', () => {
    render(<CopyButton value="payload" describe="the match list" />);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Copy the match list to clipboard');
  });

  it('copies whitespace-only text, treating only the empty string as nothing', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<CopyButton value="   " />);
    const button = screen.getByRole('button');
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('   ');
  });

  it('returns to the idle label after the confirmation window', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    render(<CopyButton value="payload" />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));

    // "Copy" is a substring of "Copied", so the absence of the confirmation is what
    // actually proves the reset happened.
    await waitFor(() => expect(screen.getByRole('button')).not.toHaveTextContent('Copied'), { timeout: 3000 });
    expect(screen.getByRole('button')).toHaveTextContent('Copy');
  });
});
