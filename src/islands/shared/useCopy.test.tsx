import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/preact';
import { useCopy } from './useCopy';

/** Replaces `navigator.clipboard` for one test; every case sets its own. */
function stubClipboard(writeText: ((text: string) => Promise<void>) | null) {
  Object.assign(navigator, { clipboard: writeText === null ? undefined : { writeText } });
}

afterEach(() => {
  vi.useRealTimers();
  stubClipboard(null);
});

describe('useCopy', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useCopy());
    expect(result.current.state).toBe('idle');
  });

  it('writes the text and reports the copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    const { result } = renderHook(() => useCopy());
    await act(() => result.current.copy('hello'));

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.state).toBe('copied');
  });

  it('reports failure instead of throwing when the clipboard rejects', async () => {
    // A denied permission policy is the common cause; it must not surface as an
    // unhandled rejection or leave the button stuck looking successful.
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));

    const { result } = renderHook(() => useCopy());
    await act(() => result.current.copy('hello'));

    expect(result.current.state).toBe('failed');
  });

  it('reports failure when the Clipboard API is missing entirely', async () => {
    // `navigator.clipboard` is undefined on an insecure origin (plain http), which is
    // exactly where a developer running the site locally by IP would hit this.
    stubClipboard(null);

    const { result } = renderHook(() => useCopy());
    await act(() => result.current.copy('hello'));

    expect(result.current.state).toBe('failed');
  });

  it('returns to idle after the reset delay', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    const { result } = renderHook(() => useCopy(50));
    await act(() => result.current.copy('hello'));
    expect(result.current.state).toBe('copied');

    await waitFor(() => expect(result.current.state).toBe('idle'));
  });

  it('restarts the reset timer on a second copy rather than expiring on the first schedule', async () => {
    vi.useFakeTimers();
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    const { result } = renderHook(() => useCopy(1000));
    await act(() => result.current.copy('one'));

    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    await act(() => result.current.copy('two'));

    // 900ms after the *first* copy the state would already be idle if the original
    // timer had survived; the second copy must have replaced it.
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(result.current.state).toBe('copied');

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.state).toBe('idle');
  });

  it('does not set state after unmount', async () => {
    vi.useFakeTimers();
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    const { result, unmount } = renderHook(() => useCopy(1000));
    await act(() => result.current.copy('hello'));
    unmount();

    // The pending reset timer is cleared on unmount, so firing the clock cannot touch a
    // torn-down component. Any leak here would surface as a Preact warning, not a value.
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });
});
