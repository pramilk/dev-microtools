import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Clipboard hook with a visible confirmation state.
 *
 * `navigator.clipboard` is unavailable on insecure origins and can be denied by
 * permission policy, so the failure path is handled rather than assumed away.
 */
export function useCopy(resetAfterMs = 1600): {
  state: CopyState;
  copy: (text: string) => Promise<void>;
} {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(
    async (text: string) => {
      if (timer.current !== null) clearTimeout(timer.current);

      try {
        if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(text);
        setState('copied');
      } catch {
        setState('failed');
      }

      timer.current = setTimeout(() => setState('idle'), resetAfterMs);
    },
    [resetAfterMs]
  );

  return { state, copy };
}
