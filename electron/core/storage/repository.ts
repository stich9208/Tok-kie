import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { JsonObject, Session, Step } from '../../../shared/domain';
import { DOMAIN_SCHEMA_VERSION } from '../../../shared/domain';
import type { LegacyMappingOptions, Page, SessionQuery, StepQuery } from '../../../shared/ipc';
import type { SourceReplacement } from '../../../shared/parser';
import type { SourceDescriptor } from '../../../shared/source';
import { validateReplacement } from './validation';

const SCHEMA_VERSION = 3;
const MIGRATION_ID = '0001_local_v3';
const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sources (
    source_id TEXT PRIMARY KEY, agent_type TEXT NOT NULL, kind TEXT NOT NULL, locator TEXT NOT NULL,
    display_name TEXT NOT NULL, identity_sha256 TEXT NOT NULL, last_content_sha256 TEXT,
    last_observed_at TEXT, enabled INTEGER NOT NULL, last_error TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
    native_session_id TEXT NOT NULL, agent_type TEXT NOT NULL, model_name TEXT NOT NULL, title TEXT NOT NULL,
    status TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL, estimated_cost_microusd INTEGER NOT NULL,
    cost_estimate_json TEXT NOT NULL, is_archived INTEGER NOT NULL, is_interrupted INTEGER NOT NULL,
    legacy_unverified INTEGER NOT NULL, metadata_json TEXT NOT NULL, provenance_json TEXT NOT NULL,
    UNIQUE(source_id, native_session_id)
  );
  CREATE INDEX IF NOT EXISTS sessions_page_idx ON sessions(started_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS steps (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE, native_step_id TEXT NOT NULL,
    step_index INTEGER NOT NULL, step_source TEXT NOT NULL, action_type TEXT NOT NULL, status TEXT NOT NULL,
    timestamp TEXT NOT NULL, prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL, preview_text TEXT NOT NULL, is_interrupted INTEGER NOT NULL,
    legacy_unverified INTEGER NOT NULL, metadata_json TEXT NOT NULL, provenance_json TEXT NOT NULL,
    UNIQUE(session_id, native_step_id)
  );
  CREATE INDEX IF NOT EXISTS steps_page_idx ON steps(session_id, step_index ASC, id ASC);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sync_queue (
    operation_id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL CHECK(entity_type IN ('session','step')),
    entity_id TEXT NOT NULL, payload_version INTEGER NOT NULL, payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
    attempt_count INTEGER NOT NULL, next_attempt_at TEXT NOT NULL, last_error TEXT, UNIQUE(entity_type, entity_id)
  );
  CREATE TABLE IF NOT EXISTS sync_entity_versions (
    entity_type TEXT NOT NULL CHECK(entity_type IN ('session','step')), entity_id TEXT NOT NULL,
    last_payload_version INTEGER NOT NULL, last_payload_hash TEXT NOT NULL, PRIMARY KEY(entity_type, entity_id)
  );
  CREATE TABLE IF NOT EXISTS legacy_imports (
    payload_hash TEXT PRIMARY KEY, source_database TEXT NOT NULL, imported_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS legacy_payloads (
    payload_hash TEXT PRIMARY KEY, entity_type TEXT NOT NULL, legacy_id TEXT NOT NULL,
    canonical_id TEXT NOT NULL, payload_json TEXT NOT NULL, mapped_source_id TEXT
  );
`;
const V2_COST_REPAIR_SQL = `
  ALTER TABLE sessions ADD COLUMN cost_estimate_json TEXT NOT NULL DEFAULT '{"status":"unavailable","pricing_version":"pre-pricing-v1","reason":"unknown_model"}';
  UPDATE sessions SET estimated_cost_microusd=-1;
`;
const MIGRATION_CHECKSUM = createHash('sha256').update(`${MIGRATION_SQL}\n${V2_COST_REPAIR_SQL}`).digest('hex');

const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  schema_migrations: ['migration_id', 'checksum', 'applied_at'],
  sources: ['source_id', 'agent_type', 'kind', 'locator', 'display_name', 'identity_sha256', 'last_content_sha256', 'last_observed_at', 'enabled', 'last_error'],
  sessions: ['id', 'source_id', 'native_session_id', 'agent_type', 'model_name', 'title', 'status', 'started_at', 'updated_at', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'estimated_cost_microusd', 'cost_estimate_json', 'is_archived', 'is_interrupted', 'legacy_unverified', 'metadata_json', 'provenance_json'],
  steps: ['id', 'session_id', 'source_id', 'native_step_id', 'step_index', 'step_source', 'action_type', 'status', 'timestamp', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'preview_text', 'is_interrupted', 'legacy_unverified', 'metadata_json', 'provenance_json'],
  settings: ['key', 'value'],
  sync_queue: ['operation_id', 'entity_type', 'entity_id', 'payload_version', 'payload_hash', 'payload_json', 'attempt_count', 'next_attempt_at', 'last_error'],
  sync_entity_versions: ['entity_type', 'entity_id', 'last_payload_version', 'last_payload_hash'],
  legacy_imports: ['payload_hash', 'source_database', 'imported_at'],
  legacy_payloads: ['payload_hash', 'entity_type', 'legacy_id', 'canonical_id', 'payload_json', 'mapped_source_id'],
};

export interface OutboxEntry {
  readonly operation_id: number;
  readonly entity_type: 'session' | 'step';
  readonly entity_id: string;
  readonly payload_version: number;
  readonly payload_hash: string;
  readonly payload: JsonObject;
  readonly attempt_count: number;
}

function parseJson<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

function encodeCursor(values: readonly unknown[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): unknown[] | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function bool(value: unknown): boolean {
  return Number(value) === 1;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function legacyIdentityMetadata(payload: Record<string, unknown>): JsonObject {
  return {
    ...(typeof payload.device_name === 'string' && payload.device_name.trim()
      ? { device_name: payload.device_name.trim().slice(0, 120) }
      : {}),
    ...(typeof payload.user_email === 'string' && payload.user_email.trim()
      ? { user_email: payload.user_email.trim().slice(0, 320) }
      : {}),
    ...(typeof payload.account_type === 'string'
      ? { account_type: payload.account_type.slice(0, 32) }
      : {}),
  };
}

function sessionFromRow(row: Record<string, unknown>): Session {
  return {
    schema_version: DOMAIN_SCHEMA_VERSION,
    id: String(row.id),
    source_id: String(row.source_id),
    native_session_id: String(row.native_session_id),
    agent_type: row.agent_type as Session['agent_type'],
    model_name: String(row.model_name),
    title: String(row.title),
    status: row.status as Session['status'],
    is_interrupted: bool(row.is_interrupted),
    started_at: String(row.started_at),
    updated_at: String(row.updated_at),
    tokens: { prompt: Number(row.prompt_tokens), completion: Number(row.completion_tokens), total: Number(row.total_tokens) },
    estimated_cost_usd: row.estimated_cost_microusd === null || Number(row.estimated_cost_microusd) < 0
      ? null
      : Number(row.estimated_cost_microusd) / 1_000_000,
    cost_estimate: parseJson(row.cost_estimate_json),
    is_archived: bool(row.is_archived),
    legacy_unverified: bool(row.legacy_unverified),
    metadata: parseJson(row.metadata_json),
    provenance: parseJson(row.provenance_json),
  };
}

function stepFromRow(row: Record<string, unknown>): Step {
  return {
    schema_version: DOMAIN_SCHEMA_VERSION,
    id: String(row.id),
    session_id: String(row.session_id),
    source_id: String(row.source_id),
    native_step_id: String(row.native_step_id),
    step_index: Number(row.step_index),
    source: row.step_source as Step['source'],
    action_type: String(row.action_type),
    status: row.status as Step['status'],
    is_interrupted: bool(row.is_interrupted),
    tokens: { prompt: Number(row.prompt_tokens), completion: Number(row.completion_tokens), total: Number(row.total_tokens) },
    preview_text: String(row.preview_text),
    timestamp: String(row.timestamp),
    legacy_unverified: bool(row.legacy_unverified),
    metadata: parseJson(row.metadata_json),
    provenance: parseJson(row.provenance_json),
  };
}

export class SyncOutbox {
  constructor(private readonly db: DatabaseSync) {}

  enqueue(entityType: 'session' | 'step', entityId: string, payload: JsonObject): void {
    const payloadJson = stableJson(payload);
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
    this.db.exec('SAVEPOINT sync_enqueue');
    try {
      const prior = this.db.prepare(`SELECT last_payload_version, last_payload_hash FROM sync_entity_versions WHERE entity_type=? AND entity_id=?`)
        .get(entityType, entityId);
      if (prior?.last_payload_hash === payloadHash) {
        this.db.exec('RELEASE sync_enqueue');
        return;
      }
      const payloadVersion = Number(prior?.last_payload_version ?? 0) + 1;
      this.db.prepare(`
        INSERT INTO sync_entity_versions VALUES (?, ?, ?, ?)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
          last_payload_version=excluded.last_payload_version, last_payload_hash=excluded.last_payload_hash
      `).run(entityType, entityId, payloadVersion, payloadHash);
      // Replacing an older pending operation assigns a new monotonic operation id;
      // durable sync_entity_versions retains the version after acknowledgement.
      this.db.prepare('DELETE FROM sync_queue WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
      this.db.prepare(`
        INSERT INTO sync_queue(entity_type, entity_id, payload_version, payload_hash, payload_json, attempt_count, next_attempt_at, last_error)
        VALUES (?, ?, ?, ?, ?, 0, datetime('now'), NULL)
      `).run(entityType, entityId, payloadVersion, payloadHash, payloadJson);
      this.db.exec('RELEASE sync_enqueue');
    } catch (error) {
      this.db.exec('ROLLBACK TO sync_enqueue; RELEASE sync_enqueue');
      throw error;
    }
  }

  due(limit = 100): OutboxEntry[] {
    return this.db.prepare(`
      SELECT operation_id, entity_type, entity_id, payload_version, payload_hash, payload_json, attempt_count
        FROM sync_queue
       WHERE next_attempt_at <= datetime('now')
       ORDER BY operation_id ASC
       LIMIT ?
    `).all(Math.max(1, Math.min(500, Math.trunc(limit)))).map((row) => ({
      operation_id: Number(row.operation_id),
      entity_type: row.entity_type as OutboxEntry['entity_type'],
      entity_id: String(row.entity_id),
      payload_version: Number(row.payload_version),
      payload_hash: String(row.payload_hash),
      payload: parseJson(row.payload_json),
      attempt_count: Number(row.attempt_count),
    }));
  }

  acknowledge(operationId: number, payloadHash: string): boolean {
    // Successful sync removes only the operation; canonical rows remain local.
    const result = this.db.prepare('DELETE FROM sync_queue WHERE operation_id = ? AND payload_hash = ?').run(operationId, payloadHash);
    return Number(result.changes) === 1;
  }

  fail(operationId: number, message: string): void {
    const current = this.db.prepare('SELECT attempt_count FROM sync_queue WHERE operation_id = ?').get(operationId);
    if (!current) return;
    const attempts = Number(current.attempt_count) + 1;
    const delaySeconds = Math.min(6 * 60 * 60, 5 * 2 ** Math.min(attempts, 12));
    this.db.prepare(`
      UPDATE sync_queue
         SET attempt_count = ?, next_attempt_at = datetime('now', ?), last_error = ?
       WHERE operation_id = ?
    `).run(attempts, `+${delaySeconds} seconds`, message.slice(0, 1000), operationId);
  }
}

export class CanonicalRepository {
  readonly outbox: SyncOutbox;
  private readonly db: DatabaseSync;

  constructor(readonly databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    try {
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.outbox = new SyncOutbox(this.db);
  }

  private migrate(): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previousVersion = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
      if (previousVersion > SCHEMA_VERSION) throw new Error(`Database schema version ${previousVersion} is newer than supported version ${SCHEMA_VERSION}`);
      this.db.exec(MIGRATION_SQL);
      const sessionColumns = new Set(this.db.prepare('PRAGMA table_info(sessions)').all().map((row) => String(row.name)));
      if (!sessionColumns.has('cost_estimate_json')) {
        const v2Columns = REQUIRED_COLUMNS.sessions.filter((column) => column !== 'cost_estimate_json');
        if (v2Columns.every((column) => sessionColumns.has(column))) this.db.exec(V2_COST_REPAIR_SQL);
      }
      for (const [table, expected] of Object.entries(REQUIRED_COLUMNS)) {
        const actual = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)));
        const missing = expected.filter((column) => !actual.has(column));
        if (missing.length) throw new Error(`Incompatible partial schema: ${table} is missing ${missing.join(', ')}`);
      }
      const applied = this.db.prepare('SELECT checksum FROM schema_migrations WHERE migration_id = ?').get(MIGRATION_ID);
      if (applied && applied.checksum !== MIGRATION_CHECKSUM) throw new Error(`Migration checksum mismatch for ${MIGRATION_ID}`);
      this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (?, ?, ?)').run(MIGRATION_ID, MIGRATION_CHECKSUM, new Date().toISOString());
      this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  registerSource(source: SourceDescriptor): void {
    const identitySha256 = source.source_id.split(':').at(-1) ?? '';
    this.db.prepare(`
      INSERT INTO sources(source_id, agent_type, kind, locator, display_name, identity_sha256, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        agent_type=excluded.agent_type, kind=excluded.kind, locator=excluded.locator,
        display_name=excluded.display_name, enabled=excluded.enabled
    `).run(source.source_id, source.agent_type, source.kind, source.locator, source.display_name, identitySha256, source.enabled ? 1 : 0);
  }

  sourceRevision(sourceId: string): string | undefined {
    const row = this.db.prepare('SELECT last_content_sha256 FROM sources WHERE source_id = ?').get(sourceId);
    return typeof row?.last_content_sha256 === 'string' ? row.last_content_sha256 : undefined;
  }

  recordSourceError(sourceId: string, message: string): void {
    this.db.prepare('UPDATE sources SET last_error = ? WHERE source_id = ?').run(message.slice(0, 2000), sourceId);
  }

  replaceSource(replacement: SourceReplacement, options: { readonly force?: boolean } = {}): boolean {
    validateReplacement(replacement);
    if (!options.force && this.sourceRevision(replacement.source_id) === replacement.source_revision_sha256) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const source = this.db.prepare('SELECT source_id, agent_type FROM sources WHERE source_id = ?').get(replacement.source_id);
      if (!source) throw new Error(`Source ${replacement.source_id} is not registered`);
      if (source.agent_type !== 'unknown' && replacement.sessions.some((session) => session.agent_type !== source.agent_type)) {
        throw new Error(`Replacement agent type does not match source ${replacement.source_id}`);
      }
      const existingSteps = this.db.prepare('SELECT id FROM steps WHERE source_id = ?').all(replacement.source_id).map((row) => String(row.id));
      const existingSessions = this.db.prepare('SELECT id FROM sessions WHERE source_id = ?').all(replacement.source_id).map((row) => String(row.id));
      const desiredSteps = new Set(replacement.steps.map((step) => step.id));
      const desiredSessions = new Set(replacement.sessions.map((session) => session.id));

      const upsertSession = this.db.prepare(`
        INSERT INTO sessions(
          id, source_id, native_session_id, agent_type, model_name, title, status, started_at, updated_at,
          prompt_tokens, completion_tokens, total_tokens, estimated_cost_microusd, cost_estimate_json,
          is_archived, is_interrupted, legacy_unverified, metadata_json, provenance_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          native_session_id=excluded.native_session_id, agent_type=excluded.agent_type, model_name=excluded.model_name,
          title=excluded.title, status=excluded.status, started_at=excluded.started_at, updated_at=excluded.updated_at,
          prompt_tokens=excluded.prompt_tokens, completion_tokens=excluded.completion_tokens, total_tokens=excluded.total_tokens,
          estimated_cost_microusd=excluded.estimated_cost_microusd, cost_estimate_json=excluded.cost_estimate_json,
          is_archived=excluded.is_archived,
          is_interrupted=excluded.is_interrupted, legacy_unverified=excluded.legacy_unverified,
          metadata_json=excluded.metadata_json, provenance_json=excluded.provenance_json
      `);
      for (const session of replacement.sessions) {
        upsertSession.run(
          session.id, session.source_id, session.native_session_id, session.agent_type, session.model_name, session.title,
          session.status, session.started_at, session.updated_at, session.tokens.prompt, session.tokens.completion, session.tokens.total,
          session.estimated_cost_usd === null ? -1 : Math.round(session.estimated_cost_usd * 1_000_000),
          JSON.stringify(session.cost_estimate), session.is_archived ? 1 : 0, session.is_interrupted ? 1 : 0,
          session.legacy_unverified ? 1 : 0, JSON.stringify(session.metadata), JSON.stringify(session.provenance),
        );
        this.outbox.enqueue('session', session.id, { operation: 'upsert', record: session as unknown as JsonObject });
      }
      const upsertStep = this.db.prepare(`
        INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          session_id=excluded.session_id, native_step_id=excluded.native_step_id, step_index=excluded.step_index,
          step_source=excluded.step_source, action_type=excluded.action_type, status=excluded.status,
          timestamp=excluded.timestamp, prompt_tokens=excluded.prompt_tokens, completion_tokens=excluded.completion_tokens,
          total_tokens=excluded.total_tokens, preview_text=excluded.preview_text, is_interrupted=excluded.is_interrupted,
          legacy_unverified=excluded.legacy_unverified, metadata_json=excluded.metadata_json, provenance_json=excluded.provenance_json
      `);
      for (const step of replacement.steps) {
        upsertStep.run(
          step.id, step.session_id, step.source_id, step.native_step_id, step.step_index, step.source, step.action_type,
          step.status, step.timestamp, step.tokens.prompt, step.tokens.completion, step.tokens.total, step.preview_text,
          step.is_interrupted ? 1 : 0, step.legacy_unverified ? 1 : 0, JSON.stringify(step.metadata), JSON.stringify(step.provenance),
        );
        this.outbox.enqueue('step', step.id, { operation: 'upsert', record: step as unknown as JsonObject });
      }
      for (const id of existingSteps) {
        if (!desiredSteps.has(id)) {
          this.outbox.enqueue('step', id, { operation: 'delete', id });
          this.db.prepare('DELETE FROM steps WHERE id = ? AND source_id = ?').run(id, replacement.source_id);
        }
      }
      for (const id of existingSessions) {
        if (!desiredSessions.has(id)) {
          this.outbox.enqueue('session', id, { operation: 'delete', id });
          this.db.prepare('DELETE FROM sessions WHERE id = ? AND source_id = ?').run(id, replacement.source_id);
        }
      }
      this.db.prepare(`UPDATE sources SET last_content_sha256=?, last_observed_at=datetime('now'), last_error=NULL WHERE source_id=?`)
        .run(replacement.source_revision_sha256, replacement.source_id);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  querySessions(query: SessionQuery = {}): Page<Session> {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];
    // Codex approval reviews are internal evaluator subagents, not user conversations.
    conditions.push("NOT (agent_type = 'codex' AND model_name = 'codex-auto-review')");
    if (query.agent_types?.length) {
      conditions.push(`agent_type IN (${query.agent_types.map(() => '?').join(',')})`);
      params.push(...query.agent_types);
    }
    if (query.statuses?.length) {
      conditions.push(`status IN (${query.statuses.map(() => '?').join(',')})`);
      params.push(...query.statuses);
    }
    if (query.started_after) { conditions.push('started_at > ?'); params.push(query.started_after); }
    if (query.started_before) { conditions.push('started_at < ?'); params.push(query.started_before); }
    if (!query.include_archived) conditions.push('is_archived = 0');
    const cursor = decodeCursor(query.cursor);
    if (cursor && typeof cursor[0] === 'string' && typeof cursor[1] === 'string') {
      conditions.push('(started_at < ? OR (started_at = ? AND id < ?))');
      params.push(cursor[0], cursor[0], cursor[1]);
    }
    const limit = Math.max(1, Math.min(500, query.limit ?? 100));
    const rows = this.db.prepare(`SELECT * FROM sessions ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY started_at DESC, id DESC LIMIT ?`)
      .all(...params, limit + 1);
    const hasMore = rows.length > limit;
    const deviceName = this.deviceMetadata().device_name;
    const configuredEmail = (() => {
      const value = this.setting('legacy.default_user_email');
      if (!value) return undefined;
      try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : undefined;
      } catch {
        return undefined;
      }
    })();
    const legacyPayload = this.db.prepare(`
      SELECT payload_json FROM legacy_payloads
      WHERE entity_type = 'session' AND canonical_id = ?
      LIMIT 1
    `);
    const items = rows.slice(0, limit).map(sessionFromRow).map((session) => {
      const payloadRow = legacyPayload.get(session.id);
      let importedIdentity: JsonObject = {};
      if (typeof payloadRow?.payload_json === 'string') {
        try {
          importedIdentity = legacyIdentityMetadata(parseJson<Record<string, unknown>>(payloadRow.payload_json));
        } catch {
          importedIdentity = {};
        }
      }
      return {
        ...session,
        metadata: {
          device_name: deviceName,
          ...(configuredEmail ? { user_email: configuredEmail } : {}),
          ...importedIdentity,
          ...session.metadata,
        },
      };
    });
    const last = items.at(-1);
    return { items, ...(hasMore && last ? { next_cursor: encodeCursor([last.started_at, last.id]) } : {}) };
  }

  querySteps(query: StepQuery): Page<Step> {
    const conditions = ['session_id = ?'];
    const params: SQLInputValue[] = [query.session_id];
    const cursor = decodeCursor(query.cursor);
    if (cursor && Number.isInteger(cursor[0]) && typeof cursor[1] === 'string') {
      conditions.push('(step_index > ? OR (step_index = ? AND id > ?))');
      params.push(Number(cursor[0]), Number(cursor[0]), cursor[1]);
    }
    const limit = Math.max(1, Math.min(1000, query.limit ?? 200));
    const rows = this.db.prepare(`SELECT * FROM steps WHERE ${conditions.join(' AND ')} ORDER BY step_index ASC, id ASC LIMIT ?`)
      .all(...params, limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(stepFromRow);
    const last = items.at(-1);
    return { items, ...(hasMore && last ? { next_cursor: encodeCursor([last.step_index, last.id]) } : {}) };
  }

  setting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return typeof row?.value === 'string' ? row.value : undefined;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }

  deviceMetadata(defaultName = 'Tok-kie device'): { readonly installation_id: string; readonly device_name: string } {
    let installationId = this.setting('installation_id');
    if (!installationId) {
      installationId = randomUUID();
      this.setSetting('installation_id', installationId);
    }
    let deviceName = this.setting('device_name');
    if (!deviceName) {
      deviceName = defaultName.slice(0, 120);
      this.setSetting('device_name', deviceName);
    }
    return { installation_id: installationId, device_name: deviceName };
  }

  hasLegacyImport(payloadHash?: string): boolean {
    return Boolean(payloadHash
      ? this.db.prepare('SELECT 1 AS present FROM legacy_imports WHERE payload_hash = ?').get(payloadHash)
      : this.db.prepare('SELECT 1 AS present FROM legacy_imports LIMIT 1').get());
  }

  hasLegacyPayload(payloadHash: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 AS present FROM legacy_payloads WHERE payload_hash = ?').get(payloadHash));
  }

  legacyRecords(sourceId: string): { readonly sessions: Session[]; readonly steps: Step[] } {
    return {
      sessions: this.db.prepare('SELECT * FROM sessions WHERE source_id = ? AND legacy_unverified = 1').all(sourceId).map(sessionFromRow),
      steps: this.db.prepare('SELECT * FROM steps WHERE source_id = ? AND legacy_unverified = 1').all(sourceId).map(stepFromRow),
    };
  }

  recordLegacyImport(payloadHash: string, sourceDatabase: string): void {
    this.db.prepare('INSERT OR IGNORE INTO legacy_imports VALUES (?, ?, ?)')
      .run(payloadHash, sourceDatabase, new Date().toISOString());
  }

  preserveLegacyPayload(
    payloadHash: string,
    entityType: 'session' | 'step',
    legacyId: string,
    canonicalId: string,
    payloadJson: string,
  ): void {
    this.db.prepare('INSERT OR IGNORE INTO legacy_payloads(payload_hash, entity_type, legacy_id, canonical_id, payload_json) VALUES (?, ?, ?, ?, ?)')
      .run(payloadHash, entityType, legacyId, canonicalId, payloadJson);
  }

  mapLegacyPayload(payloadHash: string, verifiedSourceId: string): boolean {
    const source = this.db.prepare('SELECT 1 AS present FROM sources WHERE source_id = ?').get(verifiedSourceId);
    if (!source) throw new Error(`Cannot map legacy payload to unknown source ${verifiedSourceId}`);
    const result = this.db.prepare('UPDATE legacy_payloads SET mapped_source_id = ? WHERE payload_hash = ?').run(verifiedSourceId, payloadHash);
    return Number(result.changes) === 1;
  }

  listLegacyMappingOptions(): LegacyMappingOptions {
    const payloads = this.db.prepare(`
      SELECT payload_hash, entity_type, legacy_id, canonical_id, mapped_source_id
      FROM legacy_payloads
      ORDER BY entity_type ASC, legacy_id ASC, payload_hash ASC
    `).all().map((row) => ({
      payload_hash: String(row.payload_hash),
      entity_type: row.entity_type as 'session' | 'step',
      legacy_id: String(row.legacy_id),
      canonical_id: String(row.canonical_id),
      ...(typeof row.mapped_source_id === 'string' ? { mapped_source_id: row.mapped_source_id } : {}),
    }));
    const sources = this.db.prepare(`
      SELECT source_id, agent_type, display_name
      FROM sources
      WHERE enabled = 1 AND last_content_sha256 IS NOT NULL
      ORDER BY agent_type ASC, display_name ASC, source_id ASC
    `).all().map((row) => ({
      source_id: String(row.source_id),
      agent_type: row.agent_type as LegacyMappingOptions['sources'][number]['agent_type'],
      display_name: String(row.display_name),
    }));
    return { payloads, sources };
  }

  /**
   * Automatically deduplicate imported Python queue rows when one verified local
   * source has a unique, deterministic match. Unmatched historical rows remain
   * available; no user mapping step is required.
   */
  reconcileLegacyRecords(sourceId: string): number {
    const verified = this.db.prepare(`
      SELECT * FROM sessions
      WHERE source_id = ? AND legacy_unverified = 0
    `).all(sourceId).map(sessionFromRow);
    if (!verified.length) return 0;

    const legacyRows = this.db.prepare(`
      SELECT payload_hash, legacy_id, payload_json
      FROM legacy_payloads
      WHERE entity_type = 'session' AND mapped_source_id IS NULL
    `).all();

    for (const row of legacyRows) {
      let payload: Record<string, unknown>;
      try {
        payload = parseJson<Record<string, unknown>>(row.payload_json);
      } catch {
        continue;
      }
      const legacyId = String(row.legacy_id);
      const direct = verified.filter((session) =>
        payload.id === session.id || payload.id === session.native_session_id,
      );
      const signature = verified.filter((session) =>
        payload.agent_type === session.agent_type
        && payload.title === session.title
        && Number(payload.total_tokens) === session.tokens.total,
      );
      const matches = direct.length === 1 ? direct : signature.length === 1 ? signature : [];
      if (matches.length !== 1) continue;

      const target = matches[0];
      const metadata = { ...target.metadata, ...legacyIdentityMetadata(payload) };
      this.db.prepare('UPDATE sessions SET metadata_json = ? WHERE id = ? AND legacy_unverified = 0')
        .run(JSON.stringify(metadata), target.id);
      const updated = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(target.id);
      if (updated) {
        const session = sessionFromRow(updated);
        this.outbox.enqueue('session', session.id, { operation: 'upsert', record: session as unknown as JsonObject });
      }
      this.db.prepare('UPDATE legacy_payloads SET mapped_source_id = ? WHERE payload_hash = ?')
        .run(sourceId, String(row.payload_hash));
      this.db.prepare(`
        UPDATE legacy_payloads
        SET mapped_source_id = ?
        WHERE entity_type = 'step'
          AND mapped_source_id IS NULL
          AND json_extract(payload_json, '$.session_id') = ?
      `).run(sourceId, legacyId);
    }
    return this.removeMappedLegacyRecords(sourceId);
  }

  /** Call only after a verified replacement for sourceId commits successfully. */
  removeMappedLegacyRecords(sourceId: string): number {
    const rows = this.db.prepare('SELECT entity_type, canonical_id FROM legacy_payloads WHERE mapped_source_id = ?').all(sourceId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let removed = 0;
      for (const row of rows.filter((item) => item.entity_type === 'step')) {
        const id = String(row.canonical_id);
        const result = this.db.prepare('DELETE FROM steps WHERE id = ? AND legacy_unverified = 1').run(id);
        if (Number(result.changes)) {
          this.outbox.enqueue('step', id, { operation: 'delete', id });
          removed += Number(result.changes);
        }
      }
      for (const row of rows.filter((item) => item.entity_type === 'session')) {
        const id = String(row.canonical_id);
        const result = this.db.prepare('DELETE FROM sessions WHERE id = ? AND legacy_unverified = 1').run(id);
        if (Number(result.changes)) {
          this.outbox.enqueue('session', id, { operation: 'delete', id });
          removed += Number(result.changes);
        }
      }
      this.db.prepare('DELETE FROM legacy_payloads WHERE mapped_source_id = ?').run(sourceId);
      this.db.exec('COMMIT');
      return removed;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
