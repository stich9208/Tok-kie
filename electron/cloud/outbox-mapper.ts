import { createHash } from 'node:crypto';
import type { SyncEnvelope } from './outbox';

/** Structural subset of electron/core/storage/repository.OutboxEntry. */
export interface CoreOutboxEntryLike {
  readonly entity_type: 'session' | 'step';
  readonly entity_id: string;
  readonly payload_version: number;
  readonly payload_hash: string;
  readonly payload: unknown;
}

export interface OutboxMappingContext {
  readonly ownerId: string;
  readonly memberId: string;
  /** Supply a stable value for retries. Defaults to the current instant. */
  readonly mappedAt?: string;
}

type UnknownRecord = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as UnknownRecord;
}

function string(value: unknown, label: string, max = 10_000): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new Error(`${label} must be a bounded string`);
  return value;
}

function iso(value: unknown, label: string): string {
  const raw = string(value, label, 64);
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(time).toISOString();
}

function integer(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${label} is unsupported`);
  }
  return value as T;
}

function category(value: unknown, label: string): string {
  const result = string(value, label, 120);
  if (!/^[A-Za-z0-9_.:-]+$/.test(result)) throw new Error(`${label} must be a category, not arguments`);
  return result;
}

function mapTokens(value: unknown): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  const tokens = object(value, 'tokens');
  return {
    prompt_tokens: integer(tokens.prompt, 'tokens.prompt'),
    completion_tokens: integer(tokens.completion, 'tokens.completion'),
    total_tokens: integer(tokens.total, 'tokens.total'),
  };
}

function mapProvenance(value: unknown): UnknownRecord {
  const provenance = object(value, 'provenance');
  const revision = object(provenance.source_revision, 'provenance.source_revision');
  const parser = object(provenance.parser, 'provenance.parser');
  const mapped: UnknownRecord = {
    source_id: string(provenance.source_id, 'provenance.source_id', 512),
    source_revision: {
      size_bytes: integer(revision.size_bytes, 'provenance.source_revision.size_bytes'),
      content_sha256: oneOfHash(revision.content_sha256, 'provenance.source_revision.content_sha256'),
      ...(revision.modified_at === undefined ? {} : { modified_at: iso(revision.modified_at, 'provenance.source_revision.modified_at') }),
    },
    native_id: string(provenance.native_id, 'provenance.native_id', 1024),
    observed_at: iso(provenance.observed_at, 'provenance.observed_at'),
    parser: {
      name: string(parser.name, 'provenance.parser.name', 120),
      version: string(parser.version, 'provenance.parser.version', 120),
    },
    verification: oneOf(provenance.verification, ['verified','inferred','legacy_unverified'] as const, 'provenance.verification'),
  };
  if (provenance.migrated_from !== undefined) {
    mapped.migrated_from = oneOf(provenance.migrated_from, ['python_sqlite_v1','supabase_v1'] as const, 'provenance.migrated_from');
  }
  return mapped;
}

function oneOfHash(value: unknown, label: string): string {
  const hash = string(value, label, 64);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${label} must be lowercase SHA-256`);
  return hash;
}

function mapSessionMetadata(value: unknown): UnknownRecord {
  const metadata = object(value, 'metadata');
  const mapped: UnknownRecord = {};
  if (metadata.account_type !== undefined) {
    mapped.account_type = oneOf(metadata.account_type, ['personal','work','team','unknown'] as const, 'metadata.account_type');
  }
  if (metadata.subagent_count !== undefined) mapped.subagent_count = integer(metadata.subagent_count, 'metadata.subagent_count', 1_000_000);
  // workspace_label and extra are deliberately local-only; either may contain paths/prompts/secrets.
  return mapped;
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be non-negative`);
  }
  return value;
}

function mapCostEstimate(value: unknown): UnknownRecord {
  const estimate = object(value, 'cost_estimate');
  const status = oneOf(estimate.status, ['estimated','reported','unavailable'] as const, 'cost_estimate.status');
  const mapped: UnknownRecord = {
    status,
    pricing_version: string(estimate.pricing_version, 'cost_estimate.pricing_version', 160),
  };
  if (estimate.input_usd_per_million !== undefined) {
    mapped.input_usd_per_million = nonNegativeNumber(estimate.input_usd_per_million, 'cost_estimate.input_usd_per_million');
  }
  if (estimate.output_usd_per_million !== undefined) {
    mapped.output_usd_per_million = nonNegativeNumber(estimate.output_usd_per_million, 'cost_estimate.output_usd_per_million');
  }
  if (estimate.reason !== undefined) {
    mapped.reason = oneOf(
      estimate.reason, ['unknown_model','token_breakdown_unavailable'] as const, 'cost_estimate.reason',
    );
  }
  if (status === 'unavailable' && mapped.reason === undefined) throw new Error('Unavailable cost estimate requires a reason');
  return mapped;
}

function mapStepMetadata(value: unknown): UnknownRecord {
  const metadata = object(value, 'metadata');
  const mapped: UnknownRecord = {};
  if (metadata.tool_count !== undefined) mapped.tool_count = integer(metadata.tool_count, 'metadata.tool_count', 1_000_000);
  if (metadata.subagent !== undefined) {
    const subagent = object(metadata.subagent, 'metadata.subagent');
    mapped.subagent = { depth: integer(subagent.depth, 'metadata.subagent.depth', 1_000) };
  }
  // tools, extra, nickname, role and subagent.path are deliberately omitted.
  return mapped;
}

function mapSession(record: UnknownRecord, cloudUpdatedAt: string): UnknownRecord {
  if (string(record.id, 'session.id', 2048) === '') throw new Error('session.id is empty');
  const costUsd = record.estimated_cost_usd;
  const costEstimate = mapCostEstimate(record.cost_estimate);
  if (costUsd !== null && (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0)) {
    throw new Error('session.estimated_cost_usd must be null or non-negative');
  }
  if (costUsd === null && costEstimate.status !== 'unavailable') {
    throw new Error('A missing cost requires unavailable cost-estimate status');
  }
  if (costUsd !== null && costEstimate.status === 'unavailable') {
    throw new Error('An unavailable cost estimate cannot contain a numeric cost');
  }
  const costMicrousd = costUsd === null ? null : Math.round(costUsd * 1_000_000);
  if (costMicrousd !== null && !Number.isSafeInteger(costMicrousd)) throw new Error('session.estimated_cost_usd exceeds safe precision');
  return {
    schema_version: integer(record.schema_version, 'session.schema_version', 1_000_000),
    source_id: string(record.source_id, 'session.source_id', 512),
    native_session_id: string(record.native_session_id, 'session.native_session_id', 2048),
    agent_type: oneOf(record.agent_type, ['claude_code','codex','antigravity','aider','unknown'] as const, 'session.agent_type'),
    model_name: string(record.model_name, 'session.model_name', 240),
    // A local title can be a raw prompt. Cloud receives a non-sensitive constant.
    title: 'Untitled Session',
    status: oneOf(record.status, ['running','completed','interrupted','failed'] as const, 'session.status'),
    is_interrupted: bool(record.is_interrupted, 'session.is_interrupted'),
    started_at: iso(record.started_at, 'session.started_at'),
    updated_at: iso(record.updated_at, 'session.updated_at'),
    ...mapTokens(record.tokens),
    estimated_cost_microusd: costMicrousd,
    cost_estimate: costEstimate,
    is_archived: bool(record.is_archived, 'session.is_archived'),
    legacy_unverified: bool(record.legacy_unverified, 'session.legacy_unverified'),
    metadata: mapSessionMetadata(record.metadata),
    provenance: mapProvenance(record.provenance),
    cloud_updated_at: cloudUpdatedAt,
  };
}

function mapStep(record: UnknownRecord, cloudUpdatedAt: string): UnknownRecord {
  return {
    session_id: string(record.session_id, 'step.session_id', 2048),
    schema_version: integer(record.schema_version, 'step.schema_version', 1_000_000),
    source_id: string(record.source_id, 'step.source_id', 512),
    native_step_id: string(record.native_step_id, 'step.native_step_id', 2048),
    step_index: integer(record.step_index, 'step.step_index'),
    source: oneOf(record.source, ['turn','user','assistant','tool','system','subagent'] as const, 'step.source'),
    action_type: category(record.action_type, 'step.action_type'),
    status: oneOf(record.status, ['running','completed','interrupted','failed'] as const, 'step.status'),
    is_interrupted: bool(record.is_interrupted, 'step.is_interrupted'),
    ...mapTokens(record.tokens),
    occurred_at: iso(record.timestamp, 'step.timestamp'),
    legacy_unverified: bool(record.legacy_unverified, 'step.legacy_unverified'),
    metadata: mapStepMetadata(record.metadata),
    provenance: mapProvenance(record.provenance),
    cloud_updated_at: cloudUpdatedAt,
  };
}

function cloudHash(entity: 'sessions' | 'steps', id: string, fields: UnknownRecord, deletedAt?: string): string {
  // Transport observation times may change across retries; hash only semantic
  // content so the same outbox version remains idempotent.
  const { cloud_updated_at: _transportTime, ...semanticFields } = fields;
  return createHash('sha256').update(JSON.stringify({
    entity, id, fields: semanticFields, deleted: deletedAt !== undefined,
  })).digest('hex');
}

/** Converts core's local-domain outbox payload into the exact remote column allowlist. */
export function mapOutboxEntry(entry: CoreOutboxEntryLike, context: OutboxMappingContext): SyncEnvelope {
  if (!UUID.test(context.ownerId) || !UUID.test(context.memberId)) throw new Error('Cloud owner/member identity is unavailable');
  if (entry.entity_type !== 'session' && entry.entity_type !== 'step') throw new Error('Unsupported outbox entity');
  if (!Number.isSafeInteger(entry.payload_version) || entry.payload_version < 1) throw new Error('Invalid payload version');
  if (!/^[a-f0-9]{64}$/.test(entry.payload_hash)) throw new Error('Invalid local payload hash');
  const payload = object(entry.payload, 'outbox payload');
  const operation = oneOf(payload.operation, ['upsert','delete'] as const, 'outbox operation');
  const entity = entry.entity_type === 'session' ? 'sessions' : 'steps';
  const mappedAt = iso(context.mappedAt ?? new Date().toISOString(), 'mappedAt');

  if (operation === 'delete') {
    const payloadId = string(payload.id, 'delete.id', 2048);
    if (payloadId !== entry.entity_id) throw new Error('Delete identity does not match outbox entry');
    const fields = { cloud_updated_at: mappedAt };
    return {
      entity, owner_id: context.ownerId, id: entry.entity_id,
      created_by_member_id: context.memberId, payload_version: entry.payload_version,
      payload_hash: cloudHash(entity, entry.entity_id, fields, mappedAt), fields, deleted_at: mappedAt,
    };
  }

  const record = object(payload.record, 'outbox record');
  const recordId = string(record.id, 'record.id', 2048);
  if (recordId !== entry.entity_id) throw new Error('Record identity does not match outbox entry');
  const fields = entry.entity_type === 'session' ? mapSession(record, mappedAt) : mapStep(record, mappedAt);
  return {
    entity, owner_id: context.ownerId, id: entry.entity_id,
    created_by_member_id: context.memberId, payload_version: entry.payload_version,
    payload_hash: cloudHash(entity, entry.entity_id, fields),
    fields: fields as SyncEnvelope['fields'],
  };
}
