import { runRegex, applyReplace, testLines, type RegexRun, type LineTestResult } from '../lib/tools/regex';
import { listenForRequests, type WorkerScope } from './workerGlue';

export type RegexWorkerRequest =
  | { kind: 'run'; pattern: string; flags: string; subject: string }
  | { kind: 'replace'; pattern: string; flags: string; subject: string; replacement: string }
  | { kind: 'testLines'; pattern: string; flags: string; subject: string };

export type RegexWorkerResult =
  | { kind: 'run'; value: RegexRun }
  | { kind: 'replace'; value: string }
  | { kind: 'testLines'; value: LineTestResult[] };

/**
 * `runRegex`/`applyReplace`/`testLines` already refuse the textbook catastrophic-backtracking
 * shape up front via `regex.ts`'s own static guard (see its `hasCatastrophicBacktrackingRisk`
 * comment) — that guard is deliberately narrow and doesn't catch every pathological pattern
 * (its own doc names ambiguous alternation like `(a|a)*` as a known miss). Those synchronous
 * `RegExp.exec` calls can't be interrupted once started on whatever thread runs them; moving
 * them here doesn't change that, but it does mean a pattern the static guard misses hangs
 * *this* worker instead of the tab — recoverable by `useWorkerTask`'s `timeoutMs` terminating
 * and replacing the worker, which is not possible for code stuck on the main thread.
 */
export async function handleRegexRequest(request: RegexWorkerRequest): Promise<RegexWorkerResult> {
  if (request.kind === 'run') {
    const result = runRegex(request.pattern, request.flags, request.subject);
    if (!result.ok) throw new Error(result.error);
    return { kind: 'run', value: result.value };
  }
  if (request.kind === 'replace') {
    const result = applyReplace(request.pattern, request.flags, request.subject, request.replacement);
    if (!result.ok) throw new Error(result.error);
    return { kind: 'replace', value: result.value };
  }
  const result = testLines(request.pattern, request.flags, request.subject);
  if (!result.ok) throw new Error(result.error);
  return { kind: 'testLines', value: result.value };
}

declare const self: WorkerScope<RegexWorkerRequest, RegexWorkerResult>;
listenForRequests(self, handleRegexRequest);
