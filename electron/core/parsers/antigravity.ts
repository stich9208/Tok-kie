import path from 'node:path';
import type { AgentParser, ParseResult } from '../../../shared/parser';
import type { SourceSnapshot } from '../../../shared/source';
import { cleanText, iso, nonNegativeInteger, preview, sha256, usage } from '../util';
import { records, transcriptPreview, type StepInput } from './base';
import { parseCompleteJsonl, recordArray, recordObject } from './jsonl';

interface Turn {
  readonly nativeStepId: string;
  readonly timestamp: string;
  readonly prompt: string;
  readonly tools: string[];
  completionText: string;
  interrupted: boolean;
  explicitPromptTokens: number;
  explicitCompletionTokens: number;
}

function nativeRecordId(record: Record<string, unknown>, kind: 'user' | 'assistant'): string {
  for (const candidate of [record.id, record.uuid, record.message_id]) {
    if (typeof candidate === 'string' && candidate.trim()) return `turn:${kind}:${candidate.trim()}`;
  }
  return `turn:${kind}:fallback:${sha256(JSON.stringify(record))}`;
}

function approximateTokens(text: string): number {
  return text ? Math.max(1, Math.ceil(text.length / 4)) : 0;
}

function cleanPrompt(content: unknown): string {
  if (typeof content !== 'string') return '';
  const match = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(content);
  return cleanText(match?.[1] ?? content);
}

function toolSummary(value: unknown): string | undefined {
  const call = recordObject(value);
  const name = typeof call.name === 'string'
    ? call.name
    : String(recordObject(call.function).name ?? 'tool');
  const args = recordObject(call.args ?? call.parameters ?? recordObject(call.function).arguments);
  const summary = args.toolSummary ?? args.toolAction;
  return typeof summary === 'string' && summary ? `${name} (${preview(summary)})` : name;
}

export class AntigravityParser implements AgentParser {
  readonly name = 'antigravity-jsonl';
  readonly version = '1.2.0';
  readonly agent_type = 'antigravity' as const;

  canHandle(source: SourceSnapshot['source']): boolean {
    return source.agent_type === this.agent_type && source.kind === 'jsonl_file';
  }

  async parse(snapshot: SourceSnapshot): Promise<ParseResult> {
    const parsed = parseCompleteJsonl(snapshot.bytes);
    if (!parsed.accepted) {
      return {
        accepted: false,
        source_id: snapshot.source.source_id,
        source_revision_sha256: snapshot.revision.content_sha256,
        diagnostics: parsed.diagnostics,
      };
    }
    const turns: Turn[] = [];
    const diagnostics = [...parsed.diagnostics];
    let inferredTimestamp = false;
    let inferredUsage = false;
    let current: Turn | undefined;
    let startedAt: string | undefined;
    let updatedAt: string | undefined;
    for (const { record, recordIndex } of parsed.records) {
      const timestampSource = record.timestamp;
      if (!((typeof timestampSource === 'string' || typeof timestampSource === 'number') && Number.isFinite(new Date(timestampSource).valueOf()))) {
        inferredTimestamp = true;
        diagnostics.push({ severity: 'warning', code: 'invalid_timestamp', message: 'Used snapshot observed_at for a record with no valid timestamp.', record_index: recordIndex });
      }
      const timestamp = iso(timestampSource, snapshot.observed_at);
      startedAt ??= timestamp;
      updatedAt = timestamp;
      const source = String(record.source ?? 'system').toLowerCase();
      const isUser = source === 'user' || source === 'user_explicit';
      const interrupted = ['cancelled', 'interrupted'].includes(String(record.status).toLowerCase())
        || ['interrupt', 'cancel', 'user_cancel'].includes(String(record.type).toLowerCase());
      if (isUser) {
        const prompt = cleanPrompt(record.content);
        if (!prompt) continue;
        if (current) turns.push(current);
        current = {
          nativeStepId: nativeRecordId(record, 'user'),
          timestamp,
          prompt,
          tools: [],
          completionText: '',
          interrupted,
          explicitPromptTokens: nonNegativeInteger(record.prompt_tokens),
          explicitCompletionTokens: 0,
        };
      } else {
        current ??= {
          nativeStepId: nativeRecordId(record, 'assistant'),
          timestamp,
          prompt: '',
          tools: [],
          completionText: '',
          interrupted: false,
          explicitPromptTokens: 0,
          explicitCompletionTokens: 0,
        };
        current.interrupted ||= interrupted;
        if (typeof record.content === 'string') current.completionText += ` ${record.content}`;
        current.explicitCompletionTokens += nonNegativeInteger(record.completion_tokens);
        for (const call of recordArray(record.tool_calls)) {
          const summary = toolSummary(call);
          if (summary) current.tools.push(summary);
        }
      }
    }
    if (current) turns.push(current);
    if (!turns.length) {
      return {
        accepted: true,
        replacement: { mode: 'replace_source', source_id: snapshot.source.source_id, source_revision_sha256: snapshot.revision.content_sha256, sessions: [], steps: [] },
        diagnostics,
      };
    }
    const nativeId = path.basename(path.dirname(snapshot.source.locator)) === 'minimal'
      ? 'antigravity-minimal'
      : path.basename(path.dirname(snapshot.source.locator)) || path.basename(snapshot.source.locator, '.jsonl');
    const nativeOccurrences = new Map<string, number>();
    const stepInputs: StepInput[] = turns.map((turn, index) => {
      inferredUsage ||= turn.explicitPromptTokens === 0 || turn.explicitCompletionTokens === 0;
      const occurrence = (nativeOccurrences.get(turn.nativeStepId) ?? 0) + 1;
      nativeOccurrences.set(turn.nativeStepId, occurrence);
      return {
      nativeStepId: occurrence === 1 ? turn.nativeStepId : `${turn.nativeStepId}:duplicate:${occurrence}`,
      stepIndex: index + 1,
      status: turn.interrupted ? 'interrupted' : 'completed',
      timestamp: turn.timestamp,
      tokens: usage(
        turn.explicitPromptTokens || approximateTokens(turn.prompt),
        turn.explicitCompletionTokens || approximateTokens(turn.completionText),
      ),
      previewText: transcriptPreview([
        { role: 'user', text: turn.prompt },
        ...(turn.tools.length ? [{ role: 'tool' as const, text: turn.tools.join(', ') }] : []),
        { role: 'assistant', text: turn.completionText },
      ]),
      metadata: turn.tools.length ? { tools: turn.tools, tool_count: turn.tools.length } : undefined,
      };
    });
    const promptTokens = stepInputs.reduce((sum, step) => sum + step.tokens.prompt, 0);
    const completionTokens = stepInputs.reduce((sum, step) => sum + step.tokens.completion, 0);
    const status = turns.at(-1)?.interrupted ? 'interrupted' : 'completed';
    const built = records(snapshot, this, {
      nativeSessionId: nativeId,
      modelName: 'gemini-3-flash',
      title: turns[0].prompt,
      status,
      startedAt: startedAt ?? snapshot.observed_at,
      updatedAt: updatedAt ?? snapshot.observed_at,
      tokens: usage(promptTokens, completionTokens),
    }, stepInputs, inferredTimestamp || inferredUsage ? 'inferred' : 'verified');
    return {
      accepted: true,
      replacement: { mode: 'replace_source', source_id: snapshot.source.source_id, source_revision_sha256: snapshot.revision.content_sha256, sessions: [built.session], steps: built.steps },
      diagnostics,
    };
  }
}
