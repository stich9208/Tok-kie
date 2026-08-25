import type { CollectorStatus, LegacyMappingOptions, Page, ScanResponse, SessionQuery, StepQuery } from '../../../shared/ipc';
import type { Session, Step } from '../../../shared/domain';
import type { CollectorRuntimeOptions } from './collector-runtime';
import type { OutboxEntry } from '../storage/repository';

export type WorkerMethod = 'start' | 'scan' | 'status' | 'querySessions' | 'querySteps' | 'outboxDue' | 'acknowledgeOutbox' | 'failOutbox' | 'listLegacyMappingOptions' | 'mapLegacyPayload' | 'close';

export interface WorkerRequest {
  readonly id: number;
  readonly method: WorkerMethod;
  readonly argument?: unknown;
}

export type WorkerResultMap = {
  readonly start: ScanResponse;
  readonly scan: ScanResponse;
  readonly status: CollectorStatus;
  readonly querySessions: Page<Session>;
  readonly querySteps: Page<Step>;
  readonly outboxDue: OutboxEntry[];
  readonly acknowledgeOutbox: boolean;
  readonly failOutbox: undefined;
  readonly listLegacyMappingOptions: LegacyMappingOptions;
  readonly mapLegacyPayload: boolean;
  readonly close: { readonly closed: true };
};

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly value: WorkerResultMap[WorkerMethod] }
  | { readonly id: number; readonly ok: false; readonly error: string };

export interface CollectorWorkerData {
  readonly options: CollectorRuntimeOptions;
}

export type WorkerArgumentMap = {
  readonly start: undefined;
  readonly scan: undefined;
  readonly status: undefined;
  readonly querySessions: SessionQuery;
  readonly querySteps: StepQuery;
  readonly outboxDue: number | undefined;
  readonly acknowledgeOutbox: { readonly operationId: number; readonly payloadHash: string };
  readonly failOutbox: { readonly operationId: number; readonly message: string };
  readonly listLegacyMappingOptions: undefined;
  readonly mapLegacyPayload: { readonly payloadHash: string; readonly verifiedSourceId: string };
  readonly close: undefined;
};
