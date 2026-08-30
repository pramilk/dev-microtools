import { optimizeSvg, type SvgOptimizeOptions } from '../lib/tools/svgOptimize';
import { listenForRequests, type WorkerScope } from './workerGlue';

export interface SvgOptimizeWorkerRequest {
  input: string;
  options: SvgOptimizeOptions;
}

export async function handleSvgOptimizeRequest(request: SvgOptimizeWorkerRequest): Promise<string> {
  const result = await optimizeSvg(request.input, request.options);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

declare const self: WorkerScope<SvgOptimizeWorkerRequest, string>;
listenForRequests(self, handleSvgOptimizeRequest);
