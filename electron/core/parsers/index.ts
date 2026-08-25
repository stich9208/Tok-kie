import type { AgentParser, ParseResult } from '../../../shared/parser';
import type { SourceDescriptor, SourceSnapshot } from '../../../shared/source';
import { AntigravityParser } from './antigravity';
import { ClaudeParser } from './claude';
import { CodexParser } from './codex';
import { sha256 } from '../util';

export const defaultParsers: readonly AgentParser[] = [
  new ClaudeParser(),
  new CodexParser(),
  new AntigravityParser(),
];

export function parserSignature(
  source: SourceDescriptor,
  parsers: readonly AgentParser[] = defaultParsers,
): string | undefined {
  const parser = parsers.find((candidate) => candidate.canHandle(source));
  return parser ? `${parser.name}@${parser.version}` : undefined;
}

export async function parseSnapshot(
  snapshot: SourceSnapshot,
  parsers: readonly AgentParser[] = defaultParsers,
): Promise<ParseResult> {
  if (snapshot.contract !== 'absolute_snapshot_v1' || snapshot.complete !== true
    || snapshot.revision.size_bytes !== snapshot.bytes.byteLength
    || snapshot.revision.content_sha256 !== sha256(snapshot.bytes)) {
    return {
      accepted: false,
      source_id: snapshot.source.source_id,
      source_revision_sha256: snapshot.revision.content_sha256,
      diagnostics: [{ severity: 'error', code: 'internal_error', message: 'Snapshot contract or revision does not match its bytes.' }],
    };
  }
  const parser = parsers.find((candidate) => candidate.canHandle(snapshot.source));
  if (!parser) {
    return {
      accepted: false,
      source_id: snapshot.source.source_id,
      source_revision_sha256: snapshot.revision.content_sha256,
      diagnostics: [{ severity: 'error', code: 'unsupported_schema', message: `No parser for ${snapshot.source.agent_type}/${snapshot.source.kind}.` }],
    };
  }
  const result = await parser.parse(snapshot);
  const sourceId = result.accepted ? result.replacement.source_id : result.source_id;
  const revision = result.accepted ? result.replacement.source_revision_sha256 : result.source_revision_sha256;
  if (sourceId !== snapshot.source.source_id || revision !== snapshot.revision.content_sha256) {
    return {
      accepted: false,
      source_id: snapshot.source.source_id,
      source_revision_sha256: snapshot.revision.content_sha256,
      diagnostics: [{ severity: 'error', code: 'internal_error', message: 'Parser result escaped its source snapshot boundary.' }],
    };
  }
  return result;
}

export { AntigravityParser, ClaudeParser, CodexParser };
