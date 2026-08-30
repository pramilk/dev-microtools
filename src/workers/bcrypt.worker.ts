import { hashPassword, verifyPassword } from '../lib/tools/bcrypt';
import { listenForRequests, type WorkerScope } from './workerGlue';

export type BcryptWorkerRequest =
  | { kind: 'hash'; password: string; rounds: number }
  | { kind: 'verify'; password: string; hash: string };

export type BcryptWorkerResult = { kind: 'hash'; value: string } | { kind: 'verify'; value: boolean };

export async function handleBcryptRequest(request: BcryptWorkerRequest): Promise<BcryptWorkerResult> {
  if (request.kind === 'hash') {
    const result = await hashPassword(request.password, request.rounds);
    if (!result.ok) throw new Error(result.error);
    return { kind: 'hash', value: result.value };
  }
  const result = await verifyPassword(request.password, request.hash);
  if (!result.ok) throw new Error(result.error);
  return { kind: 'verify', value: result.value };
}

declare const self: WorkerScope<BcryptWorkerRequest, BcryptWorkerResult>;
listenForRequests(self, handleBcryptRequest);
