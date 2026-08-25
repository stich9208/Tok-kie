import path from 'node:path';
import type { AgentParser, ParseResult } from '../../../shared/parser';
import type { SourceSnapshot } from '../../../shared/source';
import { iso, preview, sha256, usage } from '../util';
import { records, transcriptPreview, type StepInput } from './base';
import { parseCompleteJsonl, recordArray, recordObject } from './jsonl';

interface Turn {
  readonly nativeStepId: string;
  readonly timestamp: string;
  readonly prompt: string;
  readonly tools: string[];
  readonly responses: string[];
  promptTokens: number;
  completionTokens: number;
  interrupted: boolean;
}

function textContent(value: unknown): { text: string; interrupted: boolean; toolResult: boolean } {
  if (typeof value === 'string') {
    return {
      text: value.replace('[Request interrupted by user]', '').trim(),
      interrupted: value.includes('[Request interrupted by user]'),
      toolResult: false,
    };
  }
  let text = '';
  let interrupted = false;
  let toolResult = false;
  for (const blockValue of recordArray(value)) {
    const block = recordObject(blockValue);
    if (block.type === 'tool_result') toolResult = true;
    if (block.type === 'text' && typeof block.text === 'string') {
      interrupted ||= block.text.includes('[Request interrupted by user]');
      text += ` ${block.text.replace('[Request interrupted by user]', '')}`;
    }
  }
  return { text: text.trim(), interrupted, toolResult };
}

function nativeSessionId(snapshot: SourceSnapshot): string {
  return path.basename(snapshot.source.locator, path.extname(snapshot.source.locator));
}

function nativeRecordId(record: Record<string, unknown>, kind: 'user' | 'assistant'): string {
  for (const candidate of [record.uuid, record.id, record.message_id]) {
    if (typeof candidate === 'string' && candidate.trim()) return `turn:${kind}:${candidate.trim()}`;
  }
  // Hash only the source record that begins the turn. Later assistant output may
  // append or change without changing the turn's identity.
  return `turn:${kind}:fallback:${sha256(JSON.stringify(record))}`;
}

export class ClaudeParser implements AgentParser {
  readonly name = 'claude-jsonl';
  readonly version = '1.2.0';
  readonly agent_type = 'claude_code' as const;

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
    let current: Turn | undefined;
    let startedAt: string | undefined;
    let updatedAt: string | undefined;
    let workspace: string | undefined;
    let explicitTitle: string | undefined;
    let modelName = 'unknown';
    let hasUsage = false;
    const processedAssistantIds = new Set<string>();

    for (const { record, recordIndex } of parsed.records) {
      const timestampSource = record.timestamp;
      if (!((typeof timestampSource === 'string' || typeof timestampSource === 'number') && Number.isFinite(new Date(timestampSource).valueOf()))) {
        inferredTimestamp = true;
        diagnostics.push({ severity: 'warning', code: 'invalid_timestamp', message: 'Used snapshot observed_at for a record with no valid timestamp.', record_index: recordIndex });
      }
      const timestamp = iso(timestampSource, snapshot.observed_at);
      startedAt ??= timestamp;
      updatedAt = timestamp;
      if (!workspace && typeof record.cwd === 'string') workspace = path.basename(record.cwd);
      if (typeof record.aiTitle === 'string') explicitTitle = record.aiTitle;
      const serialized = JSON.stringify(record);
      const interrupted = serialized.includes('[Request interrupted by user]') || record.error === 'interrupted';

      if (record.type === 'user') {
        const message = recordObject(record.message);
        const content = textContent(message.content ?? record.content);
        if (content.text && !content.toolResult) {
          if (current) turns.push(current);
          current = {
            nativeStepId: nativeRecordId(record, 'user'),
            timestamp,
            prompt: content.text,
            tools: [],
            responses: [],
            promptTokens: 0,
            completionTokens: 0,
            interrupted: content.interrupted || interrupted,
          };
        } else if (current && (content.interrupted || interrupted)) {
          current.interrupted = true;
        }
      } else if (record.type === 'assistant') {
        current ??= {
          nativeStepId: nativeRecordId(record, 'assistant'),
          timestamp,
          prompt: '',
          tools: [],
          responses: [],
          promptTokens: 0,
          completionTokens: 0,
          interrupted: false,
        };
        current.interrupted ||= interrupted;
        const message = recordObject(record.message);
        if (typeof message.model === 'string' && !message.model.startsWith('<')) modelName = message.model;
        const assistantId = typeof record.uuid === 'string' ? record.uuid : `assistant-record:${recordIndex}`;
        const rawUsage = recordObject(message.usage);
        hasUsage ||= Object.keys(rawUsage).length > 0;
        if (!processedAssistantIds.has(assistantId)) {
          processedAssistantIds.add(assistantId);
          current.promptTokens += usage(
            Number(rawUsage.input_tokens ?? 0)
              + Number(rawUsage.cache_creation_input_tokens ?? 0)
              + Number(rawUsage.cache_read_input_tokens ?? 0),
            0,
          ).prompt;
          current.completionTokens += usage(0, rawUsage.output_tokens).completion;
        }
        if (typeof message.content === 'string') current.responses.push(message.content);
        for (const blockValue of recordArray(message.content)) {
          const block = recordObject(blockValue);
          if (block.type === 'text' && typeof block.text === 'string') current.responses.push(block.text);
          if (block.type === 'tool_use' && typeof block.name === 'string') current.tools.push(block.name);
        }
      }
    }
    if (current) turns.push(current);

    const nativeId = nativeSessionId(snapshot);
    if (turns.length === 0) {
      return {
        accepted: true,
        replacement: {
          mode: 'replace_source',
          source_id: snapshot.source.source_id,
          source_revision_sha256: snapshot.revision.content_sha256,
          sessions: [],
          steps: [],
        },
        diagnostics,
      };
    }
    const sessionInterrupted = turns.at(-1)?.interrupted === true;
    const nativeOccurrences = new Map<string, number>();
    const steps: StepInput[] = turns.map((turn, index) => {
      const occurrence = (nativeOccurrences.get(turn.nativeStepId) ?? 0) + 1;
      nativeOccurrences.set(turn.nativeStepId, occurrence);
      const nativeStepId = occurrence === 1 ? turn.nativeStepId : `${turn.nativeStepId}:duplicate:${occurrence}`;
      return {
        nativeStepId,
        stepIndex: index + 1,
        status: turn.interrupted ? 'interrupted' : 'completed',
        timestamp: turn.timestamp,
        tokens: usage(turn.promptTokens, turn.completionTokens),
        previewText: transcriptPreview([
          { role: 'user', text: turn.prompt },
          ...(turn.tools.length ? [{ role: 'tool' as const, text: turn.tools.slice(0, 20).join(', ') }] : []),
          ...turn.responses.slice(0, 2).map((text) => ({ role: 'assistant' as const, text })),
        ]),
        metadata: {
          ...(turn.tools.length ? { tools: turn.tools.slice(0, 20), tool_count: turn.tools.length } : {}),
          native_user_id: nativeStepId,
        },
      };
    });
    const promptTokens = steps.reduce((sum, step) => sum + step.tokens.prompt, 0);
    const completionTokens = steps.reduce((sum, step) => sum + step.tokens.completion, 0);
    const built = records(snapshot, this, {
      nativeSessionId: nativeId,
      modelName,
      title: explicitTitle ?? preview(turns[0].prompt) ?? `Claude session ${nativeId}`,
      status: sessionInterrupted ? 'interrupted' : 'completed',
      startedAt: startedAt ?? snapshot.observed_at,
      updatedAt: updatedAt ?? snapshot.observed_at,
      tokens: usage(promptTokens, completionTokens),
      metadata: workspace ? { workspace_label: workspace } : {},
    }, steps, inferredTimestamp || !hasUsage ? 'inferred' : 'verified');
    return {
      accepted: true,
      replacement: {
        mode: 'replace_source',
        source_id: snapshot.source.source_id,
        source_revision_sha256: snapshot.revision.content_sha256,
        sessions: [built.session],
        steps: built.steps,
      },
      diagnostics,
    };
  }
}
