/**
 * Minimal shape of a dedicated worker's global scope, declared locally rather than by
 * adding the `webworker` lib to tsconfig — that lib redeclares `self`/`postMessage`
 * incompatibly with the `dom` lib every island already needs, and TypeScript has no way
 * to scope a different `lib` to just the files in this directory without a second
 * project. `MessageEvent` and `Transferable` come from `dom`, which already has them.
 */
export interface WorkerScope<TRequest, TResult> {
  onmessage: ((event: MessageEvent<{ id: number; payload: TRequest }>) => void) | null;
  postMessage: (
    message: { id: number; ok: true; result: TResult } | { id: number; ok: false; error: string },
    transfer?: Transferable[]
  ) => void;
}

/**
 * Wires a worker's `onmessage` to `handler`, converting a thrown error or rejected
 * promise into a normal `{ ok: false, error }` response instead of an uncaught worker
 * exception. Every `src/workers/*.worker.ts` file uses this as its only glue code — the
 * actual logic stays in `handler`, which is also what that worker's own unit test calls
 * directly (no real thread involved) and what a test double for the island's component
 * test wraps (see `test/fakeWorker.ts`).
 */
export function listenForRequests<TRequest, TResult>(
  scope: WorkerScope<TRequest, TResult>,
  handler: (payload: TRequest) => Promise<TResult>
): void {
  scope.onmessage = (event) => {
    const { id, payload } = event.data;
    handler(payload).then(
      (result) => scope.postMessage({ id, ok: true, result }),
      (error: unknown) => scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
    );
  };
}
