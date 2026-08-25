/** Shared, persistence-shaped domain model for main, preload, renderer, and parsers. */

export const DOMAIN_SCHEMA_VERSION = 1 as const;

export const AGENT_TYPES = [
  'claude_code',
  'codex',
  'antigravity',
  'aider',
  'unknown',
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];
export type IsoTimestamp = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const SESSION_STATUSES = ['running', 'completed', 'interrupted', 'failed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const VERIFICATION_LEVELS = ['verified', 'inferred', 'legacy_unverified'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export interface TokenUsage {
  readonly prompt: number;
  readonly completion: number;
  readonly total: number;
}

export interface CostEstimate {
  readonly status: 'estimated' | 'reported' | 'unavailable';
  /** Immutable identifier for the bundled price table used by the estimate. */
  readonly pricing_version: string;
  readonly input_usd_per_million?: number;
  readonly output_usd_per_million?: number;
  readonly reason?: 'unknown_model' | 'token_breakdown_unavailable';
}

export interface SourceRevision {
  /** Byte length of the complete source snapshot. */
  readonly size_bytes: number;
  /** Source mtime when one exists. */
  readonly modified_at?: IsoTimestamp;
  /** Lowercase SHA-256 of the exact snapshot bytes. */
  readonly content_sha256: string;
}

export interface Provenance {
  readonly source_id: string;
  readonly source_revision: SourceRevision;
  /** Stable source-native identity, never a display title or array offset. */
  readonly native_id: string;
  readonly observed_at: IsoTimestamp;
  readonly parser: {
    readonly name: string;
    readonly version: string;
  };
  readonly verification: VerificationLevel;
  readonly migrated_from?: 'python_sqlite_v1' | 'supabase_v1';
}

export interface SubagentMetadata {
  readonly parent_native_session_id: string;
  readonly nickname?: string;
  readonly role?: string;
  readonly path?: string;
  readonly depth: number;
}

export interface SessionMetadata {
  readonly device_name?: string;
  readonly user_email?: string;
  readonly workspace_label?: string;
  readonly account_type?: 'personal' | 'work' | 'team' | 'unknown';
  readonly subagent_count?: number;
  readonly extra?: JsonObject;
}

export interface StepMetadata {
  readonly tools?: string[];
  readonly tool_count?: number;
  readonly subagent?: SubagentMetadata;
  readonly extra?: JsonObject;
}

/**
 * Canonical local record. snake_case intentionally matches SQLite/Postgres and
 * removes translation layers at IPC and persistence boundaries.
 */
export interface Session {
  readonly schema_version: typeof DOMAIN_SCHEMA_VERSION;
  readonly id: string;
  readonly source_id: string;
  readonly native_session_id: string;
  readonly agent_type: AgentType;
  readonly model_name: string;
  readonly title: string;
  readonly status: SessionStatus;
  readonly is_interrupted: boolean;
  readonly started_at: IsoTimestamp;
  readonly updated_at: IsoTimestamp;
  readonly tokens: TokenUsage;
  /** Null means no defensible estimate is available; it must not be presented as free usage. */
  readonly estimated_cost_usd: number | null;
  readonly cost_estimate: CostEstimate;
  readonly is_archived: boolean;
  readonly legacy_unverified: boolean;
  readonly metadata: SessionMetadata;
  readonly provenance: Provenance;
}

export const STEP_SOURCES = [
  'turn',
  'user',
  'assistant',
  'tool',
  'system',
  'subagent',
] as const;
export type StepSource = (typeof STEP_SOURCES)[number];

export interface Step {
  readonly schema_version: typeof DOMAIN_SCHEMA_VERSION;
  readonly id: string;
  readonly session_id: string;
  readonly source_id: string;
  readonly native_step_id: string;
  readonly step_index: number;
  readonly source: StepSource;
  readonly action_type: string;
  readonly status: SessionStatus;
  readonly is_interrupted: boolean;
  readonly tokens: TokenUsage;
  readonly preview_text: string;
  readonly timestamp: IsoTimestamp;
  readonly legacy_unverified: boolean;
  readonly metadata: StepMetadata;
  readonly provenance: Provenance;
}

export function zeroTokenUsage(): TokenUsage {
  return { prompt: 0, completion: 0, total: 0 };
}

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === 'string' && (AGENT_TYPES as readonly string[]).includes(value);
}

export function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === 'string' && (SESSION_STATUSES as readonly string[]).includes(value);
}
