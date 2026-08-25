import type { JsonObject } from '../../shared/domain';
import type { SyncOutbox, OutboxEntry } from './storage/repository';

export interface SyncTransport {
  send(operation: {
    readonly entity_type: OutboxEntry['entity_type'];
    readonly entity_id: string;
    readonly payload_version: number;
    readonly payload_hash: string;
    readonly payload: JsonObject;
  }): Promise<void>;
}

export class OutboxSyncWorker {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly outbox: SyncOutbox,
    private readonly transport: SyncTransport,
    private readonly intervalMs = 30_000,
    private readonly batchSize = 50,
  ) {}

  async runOnce(): Promise<{ sent: number; failed: number }> {
    if (this.running) return { sent: 0, failed: 0 };
    this.running = true;
    let sent = 0;
    let failed = 0;
    try {
      for (const entry of this.outbox.due(this.batchSize)) {
        try {
          await this.transport.send({
            entity_type: entry.entity_type,
            entity_id: entry.entity_id,
            payload_version: entry.payload_version,
            payload_hash: entry.payload_hash,
            payload: entry.payload,
          });
          if (this.outbox.acknowledge(entry.operation_id, entry.payload_hash)) sent += 1;
        } catch (error) {
          failed += 1;
          this.outbox.fail(entry.operation_id, error instanceof Error ? error.message : 'Sync failed');
        }
      }
      return { sent, failed };
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref?.();
    void this.runOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

