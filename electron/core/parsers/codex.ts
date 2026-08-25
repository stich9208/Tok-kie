import { randomUUID } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { JsonObject, SessionStatus } from '../../../shared/domain';
import type { AgentParser, ParseResult, ParserDiagnostic } from '../../../shared/parser';
import type { SourceSnapshot } from '../../../shared/source';
import { cleanText, iso, nonNegativeInteger, usage } from '../util';
import { records, transcriptPreview, type StepInput, type TranscriptBlock } from './base';

interface ThreadRow {
  readonly id: string;
  readonly title: string;
  readonly firstMessage: string;
  readonly sourceRaw: string;
  readonly tokens: number;
  readonly model: string;
  readonly createdAt: string;
  readonly nickname?: string;
  readonly role?: string;
  readonly rolloutPath?: string;
  readonly parentId?: string;
  readonly path?: string;
  readonly depth: number;
  readonly status: SessionStatus;
}

interface RolloutSummary {
  readonly previewText: string;
  readonly tools: readonly string[];
  readonly status?: SessionStatus;
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return cleanText(value);
  if (!Array.isArray(value)) return '';
  return value.map((item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    const record = item as Record<string, unknown>;
    return typeof record.text === 'string'
      ? record.text
      : typeof record.content === 'string' ? record.content : '';
  }).map(cleanText).filter(Boolean).join('\n');
}

async function readRolloutSummary(locator: string | undefined, codexRoot: string): Promise<RolloutSummary> {
  if (!locator) return { previewText: '', tools: [] };
  const resolved = path.resolve(locator);
  const relative = path.relative(codexRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { previewText: '', tools: [] };
  try {
    if ((await stat(resolved)).size > 32 * 1024 * 1024) return { previewText: '', tools: [] };
    const rows = (await readFile(resolved, 'utf8')).split('\n').filter(Boolean);
    const transcript: TranscriptBlock[] = [];
    const toolCounts = new Map<string, number>();
    let status: SessionStatus | undefined;
    for (const line of rows) {
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const payload = row.payload && typeof row.payload === 'object'
        ? row.payload as Record<string, unknown>
        : {};
      const payloadType = typeof payload.type === 'string' ? payload.type : '';
      if (row.type === 'event_msg' && payloadType === 'task_started') status = 'running';
      if (row.type === 'event_msg' && payloadType === 'task_complete') status = 'completed';
      if (row.type !== 'response_item') continue;

      if (payloadType === 'message') {
        const text = contentText(payload.content);
        if (payload.role === 'user' && text) transcript.push({ role: 'user', text });
        if (payload.role === 'assistant' && text) transcript.push({ role: 'assistant', text });
      }
      if (payloadType === 'custom_tool_call' || payloadType === 'function_call') {
        const name = typeof payload.name === 'string' ? payload.name : 'tool';
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
        transcript.push({ role: 'tool', text: name });
      }
    }
    const tools = [...toolCounts.entries()].map(([name, count]) => count > 1 ? `${name} ×${count}` : name);
    const deduplicated = transcript.filter((block, index) => {
      const previous = transcript[index - 1];
      return !previous || previous.role !== block.role || previous.text !== block.text;
    });
    return { previewText: transcriptPreview(deduplicated.slice(-24)), tools, status };
  } catch {
    return { previewText: '', tools: [] };
  }
}

function normalizedStatus(value: unknown): SessionStatus | undefined {
  const status = String(value ?? '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled' || status === 'interrupted') return 'interrupted';
  if (status === 'running' || status === 'completed' || status === 'failed') return status;
  return undefined;
}

function parseSource(raw: string): { parentId?: string; nickname?: string; path?: string; depth: number; status?: SessionStatus } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const subagent = (parsed.subagent ?? {}) as Record<string, unknown>;
    const spawn = (subagent.thread_spawn ?? {}) as Record<string, unknown>;
    return {
      parentId: typeof spawn.parent_thread_id === 'string' ? spawn.parent_thread_id : undefined,
      nickname: typeof spawn.agent_nickname === 'string' ? spawn.agent_nickname : undefined,
      path: typeof spawn.agent_path === 'string' ? spawn.agent_path : undefined,
      depth: nonNegativeInteger(spawn.depth) || (spawn.parent_thread_id ? 1 : 0),
      status: normalizedStatus(parsed.status),
    };
  } catch {
    return { depth: 0 };
  }
}

function splitTokens(total: number): { prompt: number; completion: number } {
  const prompt = Math.floor(total * 0.72);
  return { prompt, completion: total - prompt };
}

function threadStatus(value: unknown, embedded?: SessionStatus): SessionStatus {
  return embedded ?? normalizedStatus(value) ?? 'completed';
}

function hasColumn(db: DatabaseSync, table: string, name: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === name);
}

export class CodexParser implements AgentParser {
  readonly name = 'codex-state-sqlite';
  readonly version = '1.3.0';
  readonly agent_type = 'codex' as const;

  canHandle(source: SourceSnapshot['source']): boolean {
    return source.agent_type === this.agent_type && source.kind === 'sqlite_database';
  }

  async parse(snapshot: SourceSnapshot): Promise<ParseResult> {
    const tempPath = path.join(os.tmpdir(), `tokkie-codex-${randomUUID()}.sqlite`);
    const diagnostics: ParserDiagnostic[] = [];
    let db: DatabaseSync | undefined;
    try {
      await writeFile(tempPath, snapshot.bytes, { mode: 0o600 });
      db = new DatabaseSync(tempPath, { readOnly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'").all();
      if (!tables.length) {
        return {
          accepted: false,
          source_id: snapshot.source.source_id,
          source_revision_sha256: snapshot.revision.content_sha256,
          diagnostics: [{ severity: 'error', code: 'unsupported_schema', message: 'Codex database has no threads table.' }],
        };
      }
      const optional = (name: string, fallback: string): string => hasColumn(db!, 'threads', name) ? name : `${fallback} AS ${name}`;
      const rows = db.prepare(`
        SELECT id, title, first_user_message, source, tokens_used, model, created_at,
               ${optional('agent_nickname', 'NULL')},
               ${optional('agent_role', 'NULL')},
               ${optional('rollout_path', 'NULL')},
               ${optional('status', "'completed'")}
          FROM threads
         WHERE tokens_used >= 0
         ORDER BY created_at ASC, id ASC
      `).all();
      let inferredTimestamp = false;
      const threads: ThreadRow[] = rows.flatMap((row) => {
        if (typeof row.id !== 'string' || !row.id) {
          diagnostics.push({ severity: 'warning', code: 'missing_identity', message: 'Skipped Codex thread without an ID.' });
          return [];
        }
        const sourceRaw = typeof row.source === 'string' ? row.source : '{}';
        const parsedSource = parseSource(sourceRaw);
        const created = typeof row.created_at === 'number' && row.created_at < 10_000_000_000
          ? row.created_at * 1000
          : row.created_at;
        if (!((typeof created === 'string' || typeof created === 'number') && Number.isFinite(new Date(created).valueOf()))) {
          inferredTimestamp = true;
          diagnostics.push({ severity: 'warning', code: 'invalid_timestamp', message: `Used snapshot observed_at for Codex thread ${row.id}.` });
        }
        return [{
          id: row.id,
          title: typeof row.title === 'string' ? row.title : '',
          firstMessage: cleanText(row.first_user_message),
          sourceRaw,
          tokens: nonNegativeInteger(row.tokens_used),
          model: typeof row.model === 'string' ? row.model : 'unknown',
          createdAt: iso(created, snapshot.observed_at),
          nickname: parsedSource.nickname ?? (typeof row.agent_nickname === 'string' ? row.agent_nickname : undefined),
          role: typeof row.agent_role === 'string' ? row.agent_role : undefined,
          rolloutPath: typeof row.rollout_path === 'string' ? row.rollout_path : undefined,
          parentId: parsedSource.parentId,
          path: parsedSource.path,
          depth: parsedSource.depth,
          status: threadStatus(row.status, parsedSource.status),
        }];
      });
      const byId = new Map(threads.map((thread) => [thread.id, thread]));
      const roots = threads.filter((thread) =>
        !thread.parentId
        && thread.firstMessage
        && thread.model !== 'codex-auto-review',
      );
      const rootFor = (thread: ThreadRow): ThreadRow | undefined => {
        let current = thread;
        const visited = new Set<string>();
        while (current.parentId) {
          if (visited.has(current.id)) return undefined;
          visited.add(current.id);
          const parent = byId.get(current.parentId);
          if (!parent) return undefined;
          current = parent;
        }
        return current;
      };
      const sessions = [];
      const allSteps = [];
      for (const root of roots) {
        const children = threads
          .filter((thread) => thread.parentId && rootFor(thread)?.id === root.id)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
        const members = [root, ...children];
        const codexRoot = path.dirname(snapshot.source.locator);
        const rolloutSummaries = await Promise.all(members.map((thread) =>
          readRolloutSummary(thread.rolloutPath, codexRoot),
        ));
        const stepInputs: StepInput[] = members.map((thread, index) => {
          const split = splitTokens(thread.tokens);
          const rollout = rolloutSummaries[index];
          const effectiveStatus = rollout.status ?? thread.status;
          const metadata: JsonObject = thread.parentId ? {
            subagent: {
              parent_native_session_id: thread.parentId,
              ...(thread.nickname ? { nickname: thread.nickname } : {}),
              ...(thread.role ? { role: thread.role } : {}),
              ...(thread.path ? { path: thread.path } : {}),
              depth: thread.depth || 1,
            },
          } : {};
          return {
            nativeStepId: `thread:${thread.id}`,
            stepIndex: index + 1,
            source: thread.parentId ? 'subagent' : 'turn',
            status: effectiveStatus,
            timestamp: thread.createdAt,
            tokens: usage(split.prompt, split.completion),
            previewText: rollout.previewText || thread.firstMessage || thread.title,
            metadata: {
              ...metadata,
              ...(rollout.tools.length ? { tools: rollout.tools.slice(0, 20), tool_count: rollout.tools.length } : {}),
            },
          };
        });
        const promptTokens = stepInputs.reduce((sum, step) => sum + step.tokens.prompt, 0);
        const completionTokens = stepInputs.reduce((sum, step) => sum + step.tokens.completion, 0);
        const updatedAt = members.reduce((latest, thread) => thread.createdAt > latest ? thread.createdAt : latest, root.createdAt);
        const built = records(snapshot, this, {
          nativeSessionId: root.id,
          modelName: root.model,
          title: root.title || root.firstMessage,
          status: stepInputs.some((step) => step.status === 'interrupted')
            ? 'interrupted'
            : stepInputs.some((step) => step.status === 'running') ? 'running' : root.status,
          startedAt: root.createdAt,
          updatedAt,
          tokens: usage(promptTokens, completionTokens),
          metadata: children.length ? { subagent_count: children.length } : {},
        // Codex state_5 exposes only total tokens; prompt/completion is a stable
        // display allocation and is therefore explicitly inferred.
        }, stepInputs, 'inferred');
        sessions.push(built.session);
        allSteps.push(...built.steps);
      }
      return {
        accepted: true,
        replacement: {
          mode: 'replace_source',
          source_id: snapshot.source.source_id,
          source_revision_sha256: snapshot.revision.content_sha256,
          sessions,
          steps: allSteps,
        },
        diagnostics,
      };
    } catch (error) {
      return {
        accepted: false,
        source_id: snapshot.source.source_id,
        source_revision_sha256: snapshot.revision.content_sha256,
        diagnostics: [{
          severity: 'error',
          code: 'unsupported_schema',
          message: error instanceof Error ? error.message : 'Unable to read Codex SQLite snapshot.',
        }],
      };
    } finally {
      db?.close();
      await rm(tempPath, { force: true });
    }
  }
}
