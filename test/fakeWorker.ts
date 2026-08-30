/**
 * jsdom (this project's Vitest environment) has no real `Worker` — `new Worker(...)`
 * throws. Every island that runs heavy work in a worker mocks its `?worker` import with
 * the class this factory returns, so component tests exercise the same request/response
 * flow the real worker uses without any actual threading.
 *
 * `handler` is the same exported function the real `*.worker.ts` file wires up via
 * `listenForRequests` — passing it in here (rather than re-implementing the dispatch)
 * means a component test still exercises the real logic, just synchronously, and a bug
 * in the handler itself still fails the island's test the same way it always did before
 * this tool moved to a worker.
 *
 * Usage in an island's `*.test.tsx`:
 *   vi.mock('../workers/x.worker?worker', () => ({
 *     default: createFakeWorkerClass(handleXRequest),
 *   }));
 */
export function createFakeWorkerClass<TRequest, TResult>(handler: (payload: TRequest) => Promise<TResult>) {
  return class FakeWorker {
    onmessage: ((event: MessageEvent<{ id: number; ok: boolean; result?: TResult; error?: string }>) => void) | null = null;

    postMessage(message: { id: number; payload: TRequest }): void {
      const { id, payload } = message;
      handler(payload).then(
        (result) => this.onmessage?.({ data: { id, ok: true, result } } as MessageEvent),
        (error: unknown) =>
          this.onmessage?.({
            data: { id, ok: false, error: error instanceof Error ? error.message : String(error) },
          } as MessageEvent)
      );
    }

    terminate(): void {
      // No real thread to stop.
    }
  };
}

/** Convenience for the common case: mock a worker module whose default export is the
 *  `?worker` constructor, backed by `handler`. Call inside `vi.mock(specifier, factory)`. */
export const mockWorkerModule = <TRequest, TResult>(handler: (payload: TRequest) => Promise<TResult>) => ({
  default: createFakeWorkerClass(handler),
});
