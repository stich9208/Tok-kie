import type { Session, Step, TokenUsage } from '../../../shared/domain';
import { AGENT_TYPES, DOMAIN_SCHEMA_VERSION, SESSION_STATUSES, STEP_SOURCES } from '../../../shared/domain';
import { makeSessionId, makeStepId } from '../../../shared/ids';
import type { SourceReplacement } from '../../../shared/parser';
import { MAX_DETAIL_LENGTH, MAX_METADATA_BYTES } from '../util';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid source replacement: ${message}`);
}

function validTimestamp(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(new Date(value).valueOf());
}

function validateUsage(tokens: TokenUsage, context: string): void {
  for (const key of ['prompt', 'completion', 'total'] as const) {
    assert(Number.isSafeInteger(tokens[key]) && tokens[key] >= 0, `${context}.tokens.${key}`);
  }
  assert(tokens.total === tokens.prompt + tokens.completion, `${context}.tokens.total does not add up`);
}

function validateProvenance(record: Session | Step, replacement: SourceReplacement): void {
  assert(record.provenance.source_id === replacement.source_id, `${record.id} provenance source mismatch`);
  assert(record.provenance.source_revision.content_sha256 === replacement.source_revision_sha256, `${record.id} provenance revision mismatch`);
  assert(record.provenance.native_id.length > 0, `${record.id} missing provenance native ID`);
  assert(validTimestamp(record.provenance.observed_at), `${record.id} invalid observed_at`);
  assert(record.legacy_unverified === (record.provenance.verification === 'legacy_unverified'), `${record.id} legacy flag mismatch`);
}

function validateJson(value: unknown, context: string): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error(`Invalid source replacement: ${context} is not JSON`);
  }
  assert(Buffer.byteLength(encoded, 'utf8') <= MAX_METADATA_BYTES, `${context} is too large`);
}

export function validateReplacement(replacement: SourceReplacement): void {
  assert(replacement.mode === 'replace_source', 'unsupported replacement mode');
  assert(/^src:v1:/.test(replacement.source_id), 'invalid source ID');
  assert(/^[a-f0-9]{64}$/.test(replacement.source_revision_sha256), 'invalid revision hash');
  const sessions = new Map<string, Session>();
  const nativeSessions = new Set<string>();
  for (const session of replacement.sessions) {
    assert(session.schema_version === DOMAIN_SCHEMA_VERSION, `${session.id} schema version`);
    assert(session.source_id === replacement.source_id, `${session.id} source mismatch`);
    assert(session.id === makeSessionId(replacement.source_id, session.native_session_id), `${session.id} is not deterministic`);
    assert(!sessions.has(session.id), `duplicate session ${session.id}`);
    assert(!nativeSessions.has(session.native_session_id), `duplicate native session ${session.native_session_id}`);
    assert((AGENT_TYPES as readonly string[]).includes(session.agent_type), `${session.id} agent type`);
    assert((SESSION_STATUSES as readonly string[]).includes(session.status), `${session.id} status`);
    assert(session.is_interrupted === (session.status === 'interrupted'), `${session.id} interruption mismatch`);
    assert(validTimestamp(session.started_at) && validTimestamp(session.updated_at), `${session.id} timestamp`);
    if (session.cost_estimate.status === 'estimated') {
      assert(typeof session.estimated_cost_usd === 'number' && Number.isFinite(session.estimated_cost_usd) && session.estimated_cost_usd >= 0, `${session.id} cost`);
      assert(typeof session.cost_estimate.input_usd_per_million === 'number' && session.cost_estimate.input_usd_per_million >= 0, `${session.id} input price`);
      assert(typeof session.cost_estimate.output_usd_per_million === 'number' && session.cost_estimate.output_usd_per_million >= 0, `${session.id} output price`);
    } else if (session.cost_estimate.status === 'reported') {
      assert(typeof session.estimated_cost_usd === 'number' && Number.isFinite(session.estimated_cost_usd) && session.estimated_cost_usd >= 0, `${session.id} reported cost`);
    } else {
      assert(session.estimated_cost_usd === null, `${session.id} unavailable cost must be null`);
      assert(Boolean(session.cost_estimate.reason), `${session.id} unavailable cost reason`);
    }
    validateUsage(session.tokens, session.id);
    validateJson(session.metadata, `${session.id}.metadata`);
    validateJson(session.provenance, `${session.id}.provenance`);
    validateProvenance(session, replacement);
    sessions.set(session.id, session);
    nativeSessions.add(session.native_session_id);
  }
  const steps = new Set<string>();
  const nativeSteps = new Set<string>();
  for (const step of replacement.steps) {
    assert(step.schema_version === DOMAIN_SCHEMA_VERSION, `${step.id} schema version`);
    assert(step.source_id === replacement.source_id, `${step.id} source mismatch`);
    assert(sessions.has(step.session_id), `${step.id} missing session`);
    assert(step.id === makeStepId(step.session_id, step.native_step_id), `${step.id} is not deterministic`);
    assert(!steps.has(step.id), `duplicate step ${step.id}`);
    const nativeKey = `${step.session_id}\0${step.native_step_id}`;
    assert(!nativeSteps.has(nativeKey), `duplicate native step ${step.native_step_id}`);
    assert(Number.isSafeInteger(step.step_index) && step.step_index >= 0, `${step.id} step index`);
    assert((STEP_SOURCES as readonly string[]).includes(step.source), `${step.id} source type`);
    assert((SESSION_STATUSES as readonly string[]).includes(step.status), `${step.id} status`);
    assert(step.is_interrupted === (step.status === 'interrupted'), `${step.id} interruption mismatch`);
    assert(validTimestamp(step.timestamp), `${step.id} timestamp`);
    assert(step.preview_text.length <= MAX_DETAIL_LENGTH, `${step.id} preview too large`);
    validateUsage(step.tokens, step.id);
    validateJson(step.metadata, `${step.id}.metadata`);
    validateJson(step.provenance, `${step.id}.provenance`);
    validateProvenance(step, replacement);
    steps.add(step.id);
    nativeSteps.add(nativeKey);
  }
}
