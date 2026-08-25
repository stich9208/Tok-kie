import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { AgentType, JsonObject, Session, Step } from '../../../shared/domain';
import { AGENT_TYPES, DOMAIN_SCHEMA_VERSION } from '../../../shared/domain';
import { makeSessionId, makeSourceId, makeStepId } from '../../../shared/ids';
import type { SourceReplacement } from '../../../shared/parser';
import { nonNegativeInteger, sha256, usage } from '../util';
import type { CanonicalRepository } from './repository';

export interface LegacyImportResult {
  readonly imported: boolean;
  readonly backup_path?: string;
  readonly sessions: number;
  readonly steps: number;
  readonly config_imported?: boolean;
}

interface PendingRow {
  readonly id: string;
  readonly sessionId?: string;
  readonly payloadJson: string;
  readonly payload: Record<string, unknown>;
  readonly payloadHash: string;
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function pendingRows(db: DatabaseSync, table: 'pending_sessions' | 'pending_steps'): PendingRow[] {
  if (!tableExists(db, table)) return [];
  const sessionColumn = table === 'pending_steps' ? ', session_id' : '';
  return db.prepare(`SELECT id, payload${sessionColumn} FROM ${table}`).all().flatMap((row) => {
    if (typeof row.id !== 'string' || typeof row.payload !== 'string') return [];
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      return [{
        id: row.id,
        ...(typeof row.session_id === 'string' ? { sessionId: row.session_id } : {}),
        payloadJson: row.payload,
        payload,
        payloadHash: sha256(row.payload),
      }];
    } catch {
      return [];
    }
  });
}

function agent(value: unknown): AgentType {
  return typeof value === 'string' && (AGENT_TYPES as readonly string[]).includes(value) ? value as AgentType : 'unknown';
}

function timestamp(value: unknown, fallback: string): string {
  const date = new Date(typeof value === 'string' || typeof value === 'number' ? value : fallback);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : fallback;
}

function sessionTokens(payload: Record<string, unknown>) {
  // Pending payload values are preserved but deliberately remain legacy_unverified.
  const prompt = payload.total_prompt_tokens ?? payload.prompt_tokens ?? payload.delta_prompt_tokens;
  const completion = payload.total_completion_tokens ?? payload.completion_tokens ?? payload.delta_completion_tokens;
  return usage(prompt, completion);
}

export class LegacyImporter {
  constructor(
    private readonly repository: CanonicalRepository,
    private readonly backupDirectory: string,
  ) {}

  private async importCachedConfig(legacyDatabasePath: string): Promise<boolean> {
    const configPath = path.join(path.dirname(legacyDatabasePath), 'config.json');
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    } catch {
      return false;
    }
    let imported = false;
    if (!this.repository.setting('device_name') && typeof config.device_name === 'string' && config.device_name.trim()) {
      this.repository.setSetting('device_name', config.device_name.trim().slice(0, 120));
      imported = true;
    }
    for (const [legacyKey, settingKey] of [
      ['default_user_email', 'legacy.default_user_email'],
      ['work_domains', 'legacy.work_domains'],
      ['log_paths', 'legacy.log_paths'],
      ['supabase_url', 'legacy.supabase_url'],
    ] as const) {
      if (config[legacyKey] === undefined || this.repository.setting(settingKey)) continue;
      this.repository.setSetting(settingKey, JSON.stringify(config[legacyKey]));
      imported = true;
    }
    // Legacy API keys are deliberately not copied into the canonical database.
    return imported;
  }

  async importOnce(legacyDatabasePath: string): Promise<LegacyImportResult> {
    const configImported = await this.importCachedConfig(legacyDatabasePath);
    try {
      await stat(legacyDatabasePath);
    } catch {
      return { imported: false, sessions: 0, steps: 0, config_imported: configImported };
    }
    await mkdir(this.backupDirectory, { recursive: true, mode: 0o700 });
    const source = new DatabaseSync(legacyDatabasePath, { readOnly: true });
    const provisionalPath = path.join(this.backupDirectory, `offline_events.pending.${randomUUID()}.sqlite`);
    try {
      await backup(source, provisionalPath);
    } finally {
      source.close();
    }
    const bytes = await readFile(provisionalPath);
    const databaseHash = sha256(bytes);
    const backupPath = path.join(this.backupDirectory, `offline_events.${databaseHash.slice(0, 16)}.sqlite`);
    if (this.repository.hasLegacyImport(databaseHash)) {
      await rm(provisionalPath, { force: true });
      return { imported: false, backup_path: backupPath, sessions: 0, steps: 0, config_imported: configImported };
    }
    const backupDb = new DatabaseSync(provisionalPath, { readOnly: true });
    const allSessionRows = pendingRows(backupDb, 'pending_sessions');
    const allStepRows = pendingRows(backupDb, 'pending_steps');
    backupDb.close();

    const installation = this.repository.deviceMetadata();
    const identity = sha256(`legacy\0${installation.installation_id}`);
    const sourceId = makeSourceId('unknown', identity);
    const observedAt = new Date().toISOString();
    this.repository.registerSource({
      source_id: sourceId,
      agent_type: 'unknown',
      kind: 'sqlite_database',
      locator: backupPath,
      display_name: 'Legacy Python offline queue',
      enabled: false,
      discovered_at: observedAt,
    });

    const existing = this.repository.legacyRecords(sourceId);
    const sessionRows = allSessionRows.filter((row) => !this.repository.hasLegacyPayload(row.payloadHash));
    const stepRows = allStepRows.filter((row) => !this.repository.hasLegacyPayload(row.payloadHash));
    if (!sessionRows.length && !stepRows.length) {
      this.repository.recordLegacyImport(databaseHash, legacyDatabasePath);
      try {
        await stat(backupPath);
        await rm(provisionalPath, { force: true });
      } catch {
        await rename(provisionalPath, backupPath);
      }
      return { imported: false, backup_path: backupPath, sessions: 0, steps: 0, config_imported: configImported };
    }

    const sessionByLegacyId = new Map<string, Session>(existing.sessions.map((session) => [session.native_session_id.replace(/^legacy-session:/, ''), session]));
    const provenance = (nativeId: string) => ({
      source_id: sourceId,
      source_revision: { size_bytes: bytes.byteLength, content_sha256: databaseHash },
      native_id: nativeId,
      observed_at: observedAt,
      parser: { name: 'python-sqlite-v1-importer', version: '1.0.0' },
      verification: 'legacy_unverified' as const,
      migrated_from: 'python_sqlite_v1' as const,
    });
    const createSession = (legacyId: string, payload: Record<string, unknown>): Session => {
      const nativeId = `legacy-session:${legacyId}`;
      const tokens = sessionTokens(payload);
      const interrupted = payload.status === 'interrupted' || payload.is_interrupted === true;
      const reportedCost = typeof payload.estimated_cost_usd === 'number' && Number.isFinite(payload.estimated_cost_usd) && payload.estimated_cost_usd >= 0
        ? payload.estimated_cost_usd
        : null;
      return {
        schema_version: DOMAIN_SCHEMA_VERSION,
        id: makeSessionId(sourceId, nativeId),
        source_id: sourceId,
        native_session_id: nativeId,
        agent_type: agent(payload.agent_type),
        model_name: typeof payload.model_name === 'string' ? payload.model_name : 'unknown',
        title: typeof payload.title === 'string' ? payload.title.slice(0, 500) : `Legacy session ${legacyId.slice(0, 12)}`,
        status: interrupted ? 'interrupted' : 'completed',
        is_interrupted: interrupted,
        started_at: timestamp(payload.started_at, observedAt),
        updated_at: timestamp(payload.updated_at ?? payload.started_at, observedAt),
        tokens,
        estimated_cost_usd: reportedCost,
        cost_estimate: reportedCost === null
          ? { status: 'unavailable', pricing_version: 'legacy-payload-v1', reason: 'unknown_model' }
          : { status: 'reported', pricing_version: 'legacy-payload-v1' },
        is_archived: false,
        legacy_unverified: true,
        metadata: {
          ...(typeof payload.device_name === 'string' && payload.device_name.trim()
            ? { device_name: payload.device_name.trim().slice(0, 120) }
            : {}),
          ...(typeof payload.user_email === 'string' && payload.user_email.trim()
            ? { user_email: payload.user_email.trim().slice(0, 320) }
            : {}),
          ...(typeof payload.account_type === 'string'
            ? { account_type: payload.account_type as 'personal' | 'work' | 'team' | 'unknown' }
            : {}),
          extra: { legacy_payload_hash: sha256(JSON.stringify(payload)) },
        },
        provenance: provenance(nativeId),
      };
    };
    for (const row of sessionRows) sessionByLegacyId.set(row.id, createSession(row.id, row.payload));
    for (const row of stepRows) {
      const legacySessionId = row.sessionId ?? String(row.payload.session_id ?? 'orphan');
      if (!sessionByLegacyId.has(legacySessionId)) sessionByLegacyId.set(legacySessionId, createSession(legacySessionId, {}));
    }
    const newSteps: Step[] = stepRows.map((row, index) => {
      const legacySessionId = row.sessionId ?? String(row.payload.session_id ?? 'orphan');
      const session = sessionByLegacyId.get(legacySessionId)!;
      const nativeId = `legacy-step:${row.id}`;
      const tokens = usage(
        row.payload.prompt_tokens ?? row.payload.delta_prompt_tokens,
        row.payload.completion_tokens ?? row.payload.delta_completion_tokens,
      );
      const status = row.payload.status === 'interrupted' || row.payload.is_interrupted === true ? 'interrupted' : 'completed';
      return {
        schema_version: DOMAIN_SCHEMA_VERSION,
        id: makeStepId(session.id, nativeId),
        session_id: session.id,
        source_id: sourceId,
        native_step_id: nativeId,
        step_index: nonNegativeInteger(row.payload.step_index) || index + 1,
        source: 'turn',
        action_type: typeof row.payload.action_type === 'string' ? row.payload.action_type : 'legacy_import',
        status,
        is_interrupted: status === 'interrupted',
        tokens,
        preview_text: '',
        timestamp: timestamp(row.payload.timestamp, session.started_at),
        legacy_unverified: true,
        metadata: { extra: { legacy_payload_hash: row.payloadHash } },
        provenance: provenance(nativeId),
      };
    });
    const stepById = new Map(existing.steps.map((step) => [step.id, step]));
    for (const step of newSteps) stepById.set(step.id, step);
    const steps = [...stepById.values()].sort((left, right) => left.step_index - right.step_index || left.id.localeCompare(right.id));
    const replacement: SourceReplacement = {
      mode: 'replace_source',
      source_id: sourceId,
      source_revision_sha256: databaseHash,
      sessions: [...sessionByLegacyId.values()].map((session) => ({
        ...session,
        provenance: {
          ...session.provenance,
          source_revision: { size_bytes: bytes.byteLength, content_sha256: databaseHash },
          observed_at: observedAt,
        },
      })),
      steps: steps.map((step) => ({
        ...step,
        provenance: {
          ...step.provenance,
          source_revision: { size_bytes: bytes.byteLength, content_sha256: databaseHash },
          observed_at: observedAt,
        },
      })),
    };
    this.repository.replaceSource(replacement);
    for (const row of sessionRows) {
      const record = sessionByLegacyId.get(row.id)!;
      this.repository.preserveLegacyPayload(row.payloadHash, 'session', row.id, record.id, row.payloadJson);
    }
    for (const [index, row] of stepRows.entries()) {
      this.repository.preserveLegacyPayload(row.payloadHash, 'step', row.id, newSteps[index].id, row.payloadJson);
    }
    this.repository.recordLegacyImport(databaseHash, legacyDatabasePath);

    // The online-backup output is renamed; the original legacy DB remains untouched.
    if (backupPath !== provisionalPath) {
      try {
        await stat(backupPath);
        await rm(provisionalPath, { force: true });
      } catch {
        await rename(provisionalPath, backupPath);
      }
    }
    return { imported: true, backup_path: backupPath, sessions: sessionRows.length, steps: stepRows.length, config_imported: configImported };
  }
}
