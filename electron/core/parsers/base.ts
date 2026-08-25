import type {
  AgentType,
  JsonObject,
  Session,
  SessionStatus,
  Step,
  StepSource,
  TokenUsage,
} from '../../../shared/domain';
import { DOMAIN_SCHEMA_VERSION } from '../../../shared/domain';
import { makeSessionId, makeStepId } from '../../../shared/ids';
import type { SourceSnapshot } from '../../../shared/source';
import { boundedMetadata, detailPreview, preview } from '../util';
import { estimateModelCost } from '../pricing';

export interface SessionInput {
  readonly nativeSessionId: string;
  readonly modelName: string;
  readonly title: string;
  readonly status: SessionStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly tokens: TokenUsage;
  readonly metadata?: JsonObject;
}

export interface StepInput {
  readonly nativeStepId: string;
  readonly stepIndex: number;
  readonly source?: StepSource;
  readonly actionType?: string;
  readonly status: SessionStatus;
  readonly timestamp: string;
  readonly tokens: TokenUsage;
  readonly previewText?: string;
  readonly metadata?: JsonObject;
}

export type TranscriptRole = 'user' | 'assistant' | 'tool';

export interface TranscriptBlock {
  readonly role: TranscriptRole;
  readonly text: string;
}

const TRANSCRIPT_LABELS: Record<TranscriptRole, string> = {
  user: '사용자 지시',
  assistant: '작업 내용 및 결과',
  tool: '도구 실행',
};

/** Persist explicit role boundaries so the renderer never has to guess who said what. */
export function transcriptPreview(blocks: readonly TranscriptBlock[]): string {
  return blocks
    .map((block) => ({ ...block, text: block.text.trim() }))
    .filter((block) => block.text.length > 0)
    .map((block) => `**[${TRANSCRIPT_LABELS[block.role]}]**\n${block.text}`)
    .join('\n\n');
}

export function records(
  snapshot: SourceSnapshot,
  parser: { readonly name: string; readonly version: string; readonly agent_type: AgentType },
  sessionInput: SessionInput,
  stepInputs: readonly StepInput[],
  verification: 'verified' | 'inferred' = 'verified',
): { readonly session: Session; readonly steps: readonly Step[] } {
  const id = makeSessionId(snapshot.source.source_id, sessionInput.nativeSessionId);
  const cost = estimateModelCost(sessionInput.modelName, sessionInput.tokens);
  const provenanceBase = {
    source_id: snapshot.source.source_id,
    source_revision: snapshot.revision,
    observed_at: snapshot.observed_at,
    parser: { name: parser.name, version: parser.version },
    verification,
  };
  const session: Session = {
    schema_version: DOMAIN_SCHEMA_VERSION,
    id,
    source_id: snapshot.source.source_id,
    native_session_id: sessionInput.nativeSessionId,
    agent_type: parser.agent_type,
    model_name: sessionInput.modelName || 'unknown',
    title: preview(sessionInput.title) || `${parser.agent_type} session`,
    status: sessionInput.status,
    is_interrupted: sessionInput.status === 'interrupted',
    started_at: sessionInput.startedAt,
    updated_at: sessionInput.updatedAt,
    tokens: sessionInput.tokens,
    estimated_cost_usd: cost.usd,
    cost_estimate: cost.estimate,
    is_archived: false,
    legacy_unverified: false,
    metadata: boundedMetadata(sessionInput.metadata ?? {}),
    provenance: { ...provenanceBase, native_id: sessionInput.nativeSessionId },
  };
  const steps = stepInputs.map((input): Step => ({
    schema_version: DOMAIN_SCHEMA_VERSION,
    id: makeStepId(id, input.nativeStepId),
    session_id: id,
    source_id: snapshot.source.source_id,
    native_step_id: input.nativeStepId,
    step_index: input.stepIndex,
    source: input.source ?? 'turn',
    action_type: input.actionType ?? (input.status === 'interrupted' ? 'interrupted' : 'task_turn'),
    status: input.status,
    is_interrupted: input.status === 'interrupted',
    tokens: input.tokens,
    preview_text: detailPreview(input.previewText),
    timestamp: input.timestamp,
    legacy_unverified: false,
    metadata: boundedMetadata(input.metadata ?? {}),
    provenance: { ...provenanceBase, native_id: input.nativeStepId },
  }));
  return { session, steps };
}
