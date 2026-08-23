import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { ShareLinkButton } from './ShareLinkButton';

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  window.history.replaceState(null, '', '/some-tool/');
});

describe('<ShareLinkButton />', () => {
  it('copies a link that encodes the current state', async () => {
    render(<ShareLinkButton getState={() => ({ input: 'hello' })} />);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
    const [url] = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain('/some-tool/#s=');
  });

  it('shows confirmation after copying', async () => {
    render(<ShareLinkButton getState={() => ({ input: 'hello' })} />);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
  });

  it('shows an error instead of a broken link when the state is too large', async () => {
    const huge = Array.from({ length: 20_000 }, () => Math.random().toString(36)).join('');
    render(<ShareLinkButton getState={() => ({ input: huge })} />);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too large to share/i);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('reads state at click time rather than at render time', async () => {
    let current = 'first';
    render(<ShareLinkButton getState={() => ({ input: current })} />);
    current = 'second';
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  });
});
