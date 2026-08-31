/**
 * Thin wrapper around the native `CompressionStream`/`DecompressionStream` APIs, shared by
 * anything that needs gzip in the browser with no server involved — link-sharing
 * (`shareLink.ts`) and measuring a bundle's gzipped size (`npmRegistry.ts`).
 */

export const supportsCompression = (): boolean =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

const toStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

// `CompressionStream`/`DecompressionStream`'s DOM types declare `.writable` as
// `WritableStream<BufferSource>`, which TypeScript won't line up against a plain
// `ReadableStream<Uint8Array>` for `pipeThrough` without a cast — a known gap in the
// lib.dom stream typings, not a real type mismatch at runtime.
type BytesTransform = ReadableWritablePair<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>;

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = toStream(bytes).pipeThrough(new CompressionStream('gzip') as unknown as BytesTransform);
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = toStream(bytes).pipeThrough(new DecompressionStream('gzip') as unknown as BytesTransform);
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}
