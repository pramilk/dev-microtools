import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { useSyncedBackdropHeight } from './useSyncedBackdropHeight';

/**
 * jsdom reports every element as 0px tall, so `offsetHeight` is stubbed per test to
 * whatever height the "textarea" is pretending to be.
 */
function stubTextareaHeight(height: number) {
  Object.defineProperty(HTMLTextAreaElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => height,
  });
}

/** The real shape: one textarea stacked over one or more backdrop layers. */
function Host({ backdrops = 1, missingRef = false }: { backdrops?: number; missingRef?: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const second = useRef<HTMLDivElement>(null);
  const empty = useRef<HTMLDivElement>(null);

  const refs: RefObject<HTMLElement>[] = [first];
  if (backdrops > 1) refs.push(second);
  if (missingRef) refs.push(empty);

  useSyncedBackdropHeight(textareaRef, refs);

  return (
    <div>
      <div data-testid="backdrop-1" ref={first} />
      {backdrops > 1 && <div data-testid="backdrop-2" ref={second} />}
      <textarea aria-label="Input" ref={textareaRef} />
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'offsetHeight');
});

describe('useSyncedBackdropHeight', () => {
  it('sizes the backdrop to the textarea on mount', () => {
    stubTextareaHeight(240);
    render(<Host />);

    expect(screen.getByTestId('backdrop-1').style.height).toBe('240px');
  });

  it('sizes every backdrop layer, not just the first', () => {
    stubTextareaHeight(180);
    render(<Host backdrops={2} />);

    expect(screen.getByTestId('backdrop-1').style.height).toBe('180px');
    expect(screen.getByTestId('backdrop-2').style.height).toBe('180px');
  });

  it('skips a ref that is not attached to anything', () => {
    // A backdrop rendered conditionally leaves a null ref behind; that must be stepped
    // over rather than throwing and taking the whole tool down with it.
    stubTextareaHeight(100);
    expect(() => render(<Host missingRef />)).not.toThrow();
    expect(screen.getByTestId('backdrop-1').style.height).toBe('100px');
  });

  it('re-applies the height when the textarea is resized', () => {
    stubTextareaHeight(120);
    const observe = vi.fn();
    // Held on an object rather than in a `let`: the compiler cannot see that the class
    // constructor runs, so a plain variable stays narrowed to its initial type.
    const captured: { notify?: () => void } = {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          captured.notify = callback;
        }
        observe = observe;
        disconnect = vi.fn();
      }
    );

    render(<Host />);
    expect(screen.getByTestId('backdrop-1').style.height).toBe('120px');
    expect(observe).toHaveBeenCalledWith(screen.getByLabelText('Input'));

    stubTextareaHeight(400);
    captured.notify?.();
    expect(screen.getByTestId('backdrop-1').style.height).toBe('400px');
  });

  it('disconnects its observer on unmount', () => {
    stubTextareaHeight(120);
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = disconnect;
      }
    );

    render(<Host />).unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('still performs the initial sync where ResizeObserver is unavailable', () => {
    // The guard in the hook exists for exactly this environment; without it the tool
    // would crash on a missing constructor instead of degrading to one static sync.
    stubTextareaHeight(150);
    vi.stubGlobal('ResizeObserver', undefined);

    expect(() => render(<Host />)).not.toThrow();
    expect(screen.getByTestId('backdrop-1').style.height).toBe('150px');
  });
});
