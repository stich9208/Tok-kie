import type { AgentType, Session, Step } from './domain';
import type { SourceDescriptor, SourceSnapshot } from './source';

export type ParserDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ParserDiagnostic {
  readonly severity: ParserDiagnosticSeverity;
  readonly code:
    | 'malformed_record'
    | 'unsupported_schema'
    | 'unstable_trailing_record'
    | 'missing_identity'
    | 'invalid_timestamp'
    | 'invalid_usage'
    | 'internal_error';
  readonly message: string;
  readonly record_index?: number;
}

export interface SourceReplacement {
  readonly mode: 'replace_source';
  readonly source_id: string;
  readonly source_revision_sha256: string;
  /** Complete desired records for source_id, including the intentionally empty case. */
  readonly sessions: readonly Session[];
  readonly steps: readonly Step[];
}

export type ParseResult =
  | {
      readonly accepted: true;
      readonly replacement: SourceReplacement;
      readonly diagnostics: readonly ParserDiagnostic[];
    }
  | {
      /** Rejected results MUST NOT mutate persisted records for the source. */
      readonly accepted: false;
      readonly source_id: string;
      readonly source_revision_sha256: string;
      readonly diagnostics: readonly ParserDiagnostic[];
    };

export interface AgentParser {
  readonly name: string;
  readonly version: string;
  readonly agent_type: AgentType;
  canHandle(source: SourceDescriptor): boolean;
  parse(snapshot: SourceSnapshot): Promise<ParseResult>;
}

/** Persistence boundary used after parser/runtime validation succeeds. */
export interface SourceReplacementStore {
  replaceSource(replacement: SourceReplacement): Promise<void>;
}
