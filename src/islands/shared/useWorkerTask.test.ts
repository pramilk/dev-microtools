import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useWorkerTask, WorkerTimeoutError, type WorkerResponseMessage } from './useWorkerTask';

/** A controllable stand-in for a real `Worker`: `respond` and `hang` decide what
 *  `postMessage` does instead of relying on jsdom (which has no real `Worker` at all). */
class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponseMessage<unknown>>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useWorkerTask', () => {
  it('resolves run() with the worker response matching that call\'s id', async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation((message: { id: number }) => {
      worker.onmessage?.({ data: { id: message.id, ok: true, result: 'hello' } } as MessageEvent);
    });
    const { result } = renderHook(() => useWorkerTask<string, string>(() => worker as unknown as Worker));

    await expect(result.current.run('ping')).resolves.toBe('hello');
  });

  it('rejects with an Error when the worker reports ok: false', async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation((message: { id: number }) => {
      worker.onmessage?.({ data: { id: message.id, ok: false, error: 'boom' } } as MessageEvent);
    });
    const { result } = renderHook(() => useWorkerTask<string, string>(() => worker as unknown as Worker));

    await expect(result.current.run('ping')).rejects.toThrow('boom');
  });

  it('ignores a response whose id does not match any pending request', async () => {
    const worker = new FakeWorker();
    let capturedId = -1;
    worker.postMessage.mockImplementation((message: { id: number }) => {
      capturedId = message.id;
    });
    const { result } = renderHook(() => useWorkerTask<string, string>(() => worker as unknown as Worker));

    const pending = result.current.run('ping');
    // A message for a different id — must not resolve or throw.
    worker.onmessage?.({ data: { id: capturedId + 999, ok: true, result: 'wrong call' } } as MessageEvent);
    worker.onmessage?.({ data: { id: capturedId, ok: true, result: 'right call' } } as MessageEvent);

    await expect(pending).resolves.toBe('right call');
  });

  it('terminates and replaces the worker, rejecting with WorkerTimeoutError, when timeoutMs elapses with no response', async () => {
    vi.useFakeTimers();
    const hungWorker = new FakeWorker(); // Never calls onmessage — simulates a synchronously stuck worker.
    const freshWorker = new FakeWorker();
    const createWorker = vi.fn().mockReturnValueOnce(hungWorker).mockReturnValueOnce(freshWorker);
    const { result } = renderHook(() => useWorkerTask<string, string>(() => createWorker() as unknown as Worker));

    const pending = result.current.run('ping', { timeoutMs: 100 });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    await expect(pending).rejects.toBeInstanceOf(WorkerTimeoutError);
    expect(hungWorker.terminate).toHaveBeenCalledTimes(1);

    // The next call must not reuse the terminated worker.
    freshWorker.postMessage.mockImplementation((message: { id: number }) => {
      freshWorker.onmessage?.({ data: { id: message.id, ok: true, result: 'recovered' } } as MessageEvent);
    });
    await expect(result.current.run('ping again')).resolves.toBe('recovered');
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('terminates the worker on unmount', () => {
    const worker = new FakeWorker();
    const { result, unmount } = renderHook(() => useWorkerTask<string, string>(() => worker as unknown as Worker));

    void result.current.run('ping'); // Creates the worker lazily.
    unmount();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
