import type { ParserDiagnostic } from '../../../shared/parser';

export interface JsonlRecord {
  readonly record: Record<string, unknown>;
  readonly recordIndex: number;
}

export type JsonlReadResult =
  | { readonly accepted: true; readonly records: readonly JsonlRecord[]; readonly diagnostics: readonly ParserDiagnostic[] }
  | { readonly accepted: false; readonly diagnostics: readonly ParserDiagnostic[] };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCompleteJsonl(bytes: Uint8Array): JsonlReadResult {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const hasTerminalNewline = /(?:\r?\n)$/.test(text);
  const lines = text.split(/\r?\n/);
  if (hasTerminalNewline) lines.pop();
  const records: JsonlRecord[] = [];
  const diagnostics: ParserDiagnostic[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!object(parsed)) throw new Error('JSONL record must be an object');
      records.push({ record: parsed, recordIndex: index });
    } catch (error) {
      const isTrailing = index === lines.length - 1 && !hasTerminalNewline;
      if (isTrailing) {
        return {
          accepted: false,
          diagnostics: [{
            severity: 'warning',
            code: 'unstable_trailing_record',
            message: 'The trailing JSONL record is incomplete; retaining the previous source revision.',
            record_index: index,
          }],
        };
      }
      diagnostics.push({
        severity: 'warning',
        code: 'malformed_record',
        message: error instanceof Error ? error.message : 'Malformed JSONL record',
        record_index: index,
      });
    }
  }
  return { accepted: true, records, diagnostics };
}

export function recordObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function recordArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

