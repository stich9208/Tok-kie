import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { CollectorStatus, LegacyMappingOptions, Page, ScanResponse, SessionQuery, StepQuery } from '../../shared/ipc';
import type { Session, Step } from '../../shared/domain';
import { CollectorRuntime, type CollectorRuntimeOptions } from './runtime/collector-runtime';
import type { WorkerArgumentMap, WorkerMethod, WorkerResponse, WorkerResultMap } from './runtime/worker-protocol';
import type { OutboxEntry } from './storage/repository';

export interface CollectorCoreFacade {
  start(): Promise<ScanResponse>;
  scan(): Promise<ScanResponse>;
  status(): Promise<CollectorStatus>;
  querySessions(query: SessionQuery): Promise<Page<Session>>;
  querySteps(query: StepQuery): Promise<Page<Step>>;
  outboxDue(limit?: number): Promise<OutboxEntry[]>;
  acknowledgeOutbox(operationId: number, payloadHash: string): Promise<boolean>;
  failOutbox(operationId: number, message: string): Promise<void>;
  listLegacyMappingOptions(): Promise<LegacyMappingOptions>;
  mapLegacyPayload(payloadHash: string, verifiedSourceId: string): Promise<boolean>;
  close(): Promise<void>;
}

/** Simple in-process facade, useful for tests and embedders that already own a worker. */
export class LocalCollectorFacade implements CollectorCoreFacade {
  private readonly runtime: CollectorRuntime;

  constructor(options: CollectorRuntimeOptions) {
    this.runtime = new CollectorRuntime(options);
  }

  start() { return this.runtime.start(); }
  scan() { return this.runtime.scan(); }
  async status() { return this.runtime.status(); }
  async querySessions(query: SessionQuery) { return this.runtime.querySessions(query); }
  async querySteps(query: StepQuery) { return this.runtime.querySteps(query); }
  async outboxDue(limit?: number) { return this.runtime.outboxDue(limit); }
  async acknowledgeOutbox(operationId: number, payloadHash: string) { return this.runtime.acknowledgeOutbox(operationId, payloadHash); }
  async failOutbox(operationId: number, message: string) { this.runtime.failOutbox(operationId, message); }
  async listLegacyMappingOptions() { return this.runtime.listLegacyMappingOptions(); }
  async mapLegacyPayload(payloadHash: string, verifiedSourceId: string) { return this.runtime.mapLegacyPayload(payloadHash, verifiedSourceId); }
  async close() { this.runtime.close(); }
}

/** Main-process facade: parsing and SQLite work stay off Electron's UI thread. */
export class CollectorWorkerFacade implements CollectorCoreFacade {
  private readonly worker: Worker;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  constructor(options: CollectorRuntimeOptions, workerEntry = path.join(__dirname, 'runtime', 'worker-entry.js')) {
    this.worker = new Worker(workerEntry, { workerData: { options } });
    this.worker.on('message', (response: WorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.value);
      else pending.reject(new Error(response.error));
    });
    this.worker.on('error', (error) => this.rejectAll(error));
    this.worker.on('exit', (code) => {
      if (code !== 0) this.rejectAll(new Error(`Collector worker exited with code ${code}`));
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private invoke<M extends WorkerMethod>(method: M, argument?: WorkerArgumentMap[M]): Promise<WorkerResultMap[M]> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, method, argument });
    });
  }

  start() { return this.invoke('start'); }
  scan() { return this.invoke('scan'); }
  status() { return this.invoke('status'); }
  querySessions(query: SessionQuery) { return this.invoke('querySessions', query); }
  querySteps(query: StepQuery) { return this.invoke('querySteps', query); }
  outboxDue(limit?: number) { return this.invoke('outboxDue', limit); }
  acknowledgeOutbox(operationId: number, payloadHash: string) { return this.invoke('acknowledgeOutbox', { operationId, payloadHash }); }
  async failOutbox(operationId: number, message: string) { await this.invoke('failOutbox', { operationId, message }); }
  listLegacyMappingOptions() { return this.invoke('listLegacyMappingOptions'); }
  mapLegacyPayload(payloadHash: string, verifiedSourceId: string) { return this.invoke('mapLegacyPayload', { payloadHash, verifiedSourceId }); }
  async close() {
    await this.invoke('close');
    await this.worker.terminate();
  }
}
