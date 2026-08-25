import { parentPort, workerData } from 'node:worker_threads';
import { CollectorRuntime } from './collector-runtime';
import type { CollectorWorkerData, WorkerRequest, WorkerResponse } from './worker-protocol';

if (!parentPort) throw new Error('Collector worker must run in a worker_thread');
const runtime = new CollectorRuntime((workerData as CollectorWorkerData).options);

parentPort.on('message', async (request: WorkerRequest) => {
  let response: WorkerResponse;
  try {
    let value;
    switch (request.method) {
      case 'start': value = await runtime.start(); break;
      case 'scan': value = await runtime.scan(); break;
      case 'status': value = runtime.status(); break;
      case 'querySessions': value = runtime.querySessions(request.argument as never); break;
      case 'querySteps': value = runtime.querySteps(request.argument as never); break;
      case 'outboxDue': value = runtime.outboxDue(request.argument as number | undefined); break;
      case 'acknowledgeOutbox': {
        const argument = request.argument as { operationId: number; payloadHash: string };
        value = runtime.acknowledgeOutbox(argument.operationId, argument.payloadHash);
        break;
      }
      case 'failOutbox': {
        const argument = request.argument as { operationId: number; message: string };
        runtime.failOutbox(argument.operationId, argument.message);
        value = undefined;
        break;
      }
      case 'listLegacyMappingOptions': value = runtime.listLegacyMappingOptions(); break;
      case 'mapLegacyPayload': {
        const argument = request.argument as { payloadHash: string; verifiedSourceId: string };
        value = runtime.mapLegacyPayload(argument.payloadHash, argument.verifiedSourceId);
        break;
      }
      case 'close': runtime.close(); value = { closed: true as const }; break;
      default: throw new Error(`Unsupported collector method: ${String(request.method)}`);
    }
    response = { id: request.id, ok: true, value };
  } catch (error) {
    response = { id: request.id, ok: false, error: error instanceof Error ? error.message : 'Collector worker failed' };
  }
  parentPort!.postMessage(response);
  if (request.method === 'close') parentPort!.close();
});
