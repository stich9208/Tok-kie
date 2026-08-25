import type { CollectorStatus, LegacyMappingOptions, Page, ScanResponse, SessionQuery, StepQuery } from '../../../shared/ipc';
import type { Session, Step } from '../../../shared/domain';
import { SnapshotAcquirer, SourceWatcher, discoverSources, type DiscoveryRoots } from '../acquisition';
import { parseSnapshot, parserSignature } from '../parsers';
import { CanonicalRepository, type OutboxEntry } from '../storage/repository';
import { LegacyImporter, type LegacyImportResult } from '../storage/legacy-importer';
import { newScanId } from '../util';

export interface CollectorRuntimeOptions {
  readonly databasePath: string;
  readonly roots: DiscoveryRoots;
  readonly watch?: boolean;
  readonly legacy?: {
    readonly databasePath: string;
    readonly backupDirectory: string;
  };
}

export class CollectorRuntime {
  readonly repository: CanonicalRepository;
  private readonly acquirer = new SnapshotAcquirer();
  private readonly watcher: SourceWatcher;
  private statusValue: CollectorStatus = { state: 'idle', sources_seen: 0, diagnostics: 0 };
  private scanPromise?: Promise<ScanResponse>;
  private legacyImportPromise?: Promise<LegacyImportResult>;

  constructor(private readonly options: CollectorRuntimeOptions) {
    this.repository = new CanonicalRepository(options.databasePath);
    this.watcher = new SourceWatcher(async () => { await this.scan(); });
  }

  async start(): Promise<ScanResponse> {
    if (this.options.legacy) {
      this.legacyImportPromise ??= new LegacyImporter(this.repository, this.options.legacy.backupDirectory)
        .importOnce(this.options.legacy.databasePath);
      await this.legacyImportPromise;
    }
    return this.scan();
  }

  scan(): Promise<ScanResponse> {
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.performScan().finally(() => { this.scanPromise = undefined; });
    return this.scanPromise;
  }

  private async performScan(): Promise<ScanResponse> {
    this.statusValue = { ...this.statusValue, state: 'scanning' };
    let acceptedSources = 0;
    let rejectedSources = 0;
    let diagnostics = 0;
    try {
      const sources = await discoverSources(this.options.roots);
      if (this.options.watch !== false) this.watcher.watchSources(sources, [
        this.options.roots.codex,
        this.options.roots.antigravity,
        `${this.options.roots.claude}/projects`,
      ]);
      for (const source of sources) {
        this.repository.registerSource(source);
        const snapshot = await this.acquirer.read(source);
        if ('code' in snapshot) {
          rejectedSources += 1;
          diagnostics += 1;
          this.repository.recordSourceError(source.source_id, `${snapshot.code}: ${snapshot.message}`);
          continue;
        }
        const signature = parserSignature(source);
        const parserSettingKey = `parser_signature:${source.source_id}`;
        const parserChanged = Boolean(signature && this.repository.setting(parserSettingKey) !== signature);
        if (!parserChanged && this.repository.sourceRevision(source.source_id) === snapshot.revision.content_sha256) {
          // Mapping is an independent state transition; it must reconcile even
          // when the verified source bytes have not changed since the last scan.
          this.repository.reconcileLegacyRecords(source.source_id);
          this.repository.removeMappedLegacyRecords(source.source_id);
          acceptedSources += 1;
          continue;
        }
        const result = await parseSnapshot(snapshot);
        diagnostics += result.diagnostics.length;
        if (result.accepted) {
          this.repository.replaceSource(result.replacement, { force: parserChanged });
          if (signature) this.repository.setSetting(parserSettingKey, signature);
          this.repository.reconcileLegacyRecords(source.source_id);
          this.repository.removeMappedLegacyRecords(source.source_id);
          acceptedSources += 1;
        } else {
          rejectedSources += 1;
          this.repository.recordSourceError(source.source_id, result.diagnostics.map((item) => item.message).join('; '));
        }
      }
      this.statusValue = {
        state: 'idle',
        last_scan_at: new Date().toISOString(),
        sources_seen: sources.length,
        diagnostics,
      };
      return { scan_id: newScanId(), accepted_sources: acceptedSources, rejected_sources: rejectedSources };
    } catch (error) {
      this.statusValue = {
        ...this.statusValue,
        state: 'error',
        last_scan_at: new Date().toISOString(),
        diagnostics: diagnostics + 1,
      };
      throw error;
    }
  }

  status(): CollectorStatus {
    return { ...this.statusValue };
  }

  querySessions(query: SessionQuery): Page<Session> {
    return this.repository.querySessions(query);
  }

  querySteps(query: StepQuery): Page<Step> {
    return this.repository.querySteps(query);
  }

  outboxDue(limit?: number): OutboxEntry[] {
    return this.repository.outbox.due(limit);
  }

  acknowledgeOutbox(operationId: number, payloadHash: string): boolean {
    return this.repository.outbox.acknowledge(operationId, payloadHash);
  }

  failOutbox(operationId: number, message: string): void {
    this.repository.outbox.fail(operationId, message);
  }

  mapLegacyPayload(payloadHash: string, verifiedSourceId: string): boolean {
    return this.repository.mapLegacyPayload(payloadHash, verifiedSourceId);
  }

  listLegacyMappingOptions(): LegacyMappingOptions {
    return this.repository.listLegacyMappingOptions();
  }

  close(): void {
    this.watcher.close();
    this.repository.close();
  }
}
