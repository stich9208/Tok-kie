import type { AgentType, IsoTimestamp, SourceRevision } from './domain';

export const SOURCE_KINDS = ['jsonl_file', 'sqlite_database', 'json_document'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface SourceDescriptor {
  /** Stable fingerprint-derived ID. It is safe to persist and sync. */
  readonly source_id: string;
  readonly agent_type: AgentType;
  readonly kind: SourceKind;
  /** Absolute local path. Local process only: never persist in cloud or expose to renderer. */
  readonly locator: string;
  readonly display_name: string;
  readonly enabled: boolean;
  readonly discovered_at: IsoTimestamp;
}

/**
 * A self-contained point-in-time source. Parsers never receive append chunks,
 * offsets, mutable file handles, or permission to read outside this value.
 */
export interface SourceSnapshot {
  readonly contract: 'absolute_snapshot_v1';
  readonly complete: true;
  readonly source: SourceDescriptor;
  readonly observed_at: IsoTimestamp;
  readonly revision: SourceRevision;
  readonly encoding: 'utf8' | 'binary';
  readonly bytes: Uint8Array;
}

export interface SnapshotReadFailure {
  readonly source: SourceDescriptor;
  readonly code: 'not_found' | 'permission_denied' | 'unstable' | 'too_large' | 'io_error';
  readonly message: string;
  readonly retryable: boolean;
}
