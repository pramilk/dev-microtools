import { hashAll, hashFile, hmacAll, type HashAlgorithm } from '../lib/tools/hash';
import { listenForRequests, type WorkerScope } from './workerGlue';

export type HashWorkerRequest =
  | { kind: 'text'; input: string; useHmac: boolean; hmacKey: string }
  | { kind: 'file'; file: File };

export interface HashDigest {
  algorithm: HashAlgorithm;
  digest: string;
}

/**
 * Every hashing path — text, HMAC, and whole-file (the one this tool's 500MB size cap
 * exists for, per `hash.ts`'s own comment on why: "hashing on the main thread would
 * freeze the tab for too long") — routes through here so the tool has one worker rather
 * than branching between worker and main-thread paths depending on mode.
 */
export async function handleHashRequest(request: HashWorkerRequest): Promise<HashDigest[]> {
  const result =
    request.kind === 'file'
      ? await hashFile(request.file)
      : request.useHmac
        ? await hmacAll(request.input, request.hmacKey)
        : await hashAll(request.input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

declare const self: WorkerScope<HashWorkerRequest, HashDigest[]>;
listenForRequests(self, handleHashRequest);
