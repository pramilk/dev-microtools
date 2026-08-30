import { useEffect, useRef } from 'preact/hooks';

/** The wire format every worker in `src/workers/` speaks: a request tagged with an id the
 *  response echoes back, so a caller can match an out-of-order reply to the call that
 *  produced it. */
export interface WorkerRequestMessage<TPayload> {
  id: number;
  payload: TPayload;
}

export type WorkerResponseMessage<TResult> =
  | { id: number; ok: true; result: TResult }
  | { id: number; ok: false; error: string };

/** Thrown by `run()` when a call's `timeoutMs` elapses with no response. Distinct from a
 *  normal `Error` so a caller that cares (the Regex Tester's hard ReDoS backstop) can tell
 *  "the worker never answered and was killed" apart from "the worker answered with an
 *  error" — the two need very different messages. */
export class WorkerTimeoutError extends Error {
  constructor() {
    super('The background worker did not respond in time.');
    this.name = 'WorkerTimeoutError';
  }
}

interface PendingRequest<TResult> {
  resolve: (result: TResult) => void;
  reject: (error: Error) => void;
  timeoutHandle: number | null;
}

/**
 * Runs request/response calls against a single lazily-created Worker, matching each
 * response back to the call that produced it by id.
 *
 * Deliberately does not decide when to discard a *resolved* result that's since been
 * superseded by newer input — same division of labour as `useImageJobBatch` (see its own
 * doc comment): every existing tool effect already tracks that itself, via a `requestId`
 * ref (SVG Optimizer, Minifier) or an effect-cleanup `cancelled` flag (Hash Generator,
 * Diff Checker), and moving to a worker doesn't change who owns that.
 *
 * What this hook *does* own is the one thing a worker adds that a plain async function
 * call never needed: a hard timeout. A worker thread synchronously stuck inside, say, a
 * catastrophic-backtracking regex can't be asked to stop — no message it's sent will be
 * processed until it finishes on its own, which for a genuinely pathological pattern is
 * never. `terminate()` is the only way to stop it, so a timed-out call kills the worker,
 * fails every request in flight on it (none of them can ever get an answer either), and
 * lets the next `run()` lazily spin up a fresh one.
 */
export function useWorkerTask<TPayload, TResult>(createWorker: () => Worker) {
  const workerRef = useRef<Worker | null>(null);
  const nextIdRef = useRef(0);
  const pendingRef = useRef(new Map<number, PendingRequest<TResult>>());

  const failAllPending = (error: Error): void => {
    const stale = pendingRef.current;
    pendingRef.current = new Map();
    for (const pending of stale.values()) {
      if (pending.timeoutHandle !== null) window.clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
  };

  const destroyWorker = (): void => {
    workerRef.current?.terminate();
    workerRef.current = null;
  };

  const getWorker = (): Worker => {
    if (workerRef.current) return workerRef.current;

    const worker = createWorker();
    worker.onmessage = (event: MessageEvent<WorkerResponseMessage<TResult>>) => {
      const { id } = event.data;
      const pending = pendingRef.current.get(id);
      if (!pending) return; // Already timed out, or a stale message from a worker we've since replaced.
      pendingRef.current.delete(id);
      if (pending.timeoutHandle !== null) window.clearTimeout(pending.timeoutHandle);
      if (event.data.ok) pending.resolve(event.data.result);
      else pending.reject(new Error(event.data.error));
    };
    worker.onerror = (event: ErrorEvent) => {
      // An uncaught exception in worker setup (e.g. a dynamically-imported module failing
      // to load) can happen outside any single request's own try/catch — fail everything
      // in flight rather than leaving those calls hanging forever.
      destroyWorker();
      failAllPending(new Error(event.message || 'The background worker crashed.'));
    };
    workerRef.current = worker;
    return worker;
  };

  const run = (payload: TPayload, options: { timeoutMs?: number; transfer?: Transferable[] } = {}): Promise<TResult> => {
    const id = (nextIdRef.current += 1);
    const worker = getWorker();

    return new Promise<TResult>((resolve, reject) => {
      const pending: PendingRequest<TResult> = { resolve, reject, timeoutHandle: null };

      if (options.timeoutMs !== undefined) {
        pending.timeoutHandle = window.setTimeout(() => {
          destroyWorker();
          failAllPending(new WorkerTimeoutError());
        }, options.timeoutMs);
      }

      pendingRef.current.set(id, pending);
      worker.postMessage({ id, payload } satisfies WorkerRequestMessage<TPayload>, options.transfer ?? []);
    });
  };

  // Unmounting mid-request should not resolve/reject into a component that's gone, but it
  // must still release the worker thread — otherwise every tool visit leaks one.
  useEffect(() => {
    return () => {
      destroyWorker();
      pendingRef.current.clear();
    };
  }, []);

  return { run };
}
