import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { makeSessionId, makeSourceId, makeStepId } from '../../../shared/ids';
import type { ParseResult } from '../../../shared/parser';
import type { SourceSnapshot } from '../../../shared/source';
import { AntigravityParser, ClaudeParser, CodexParser } from '../parsers';
import { sha256 } from '../util';

const fixtures = path.resolve(process.cwd(), 'tests', 'fixtures');
const observedAt = '2026-01-31T00:00:00.000Z';

async function jsonFixture(
  relative: string,
  agent: 'claude_code' | 'antigravity',
  identity: string,
  locator: string,
): Promise<SourceSnapshot> {
  const bytes = await readFile(path.join(fixtures, relative));
  return {
    contract: 'absolute_snapshot_v1',
    complete: true,
    source: {
      source_id: makeSourceId(agent, identity),
      agent_type: agent,
      kind: 'jsonl_file',
      locator,
      display_name: path.basename(locator),
      enabled: true,
      discovered_at: observedAt,
    },
    observed_at: observedAt,
    revision: { size_bytes: bytes.byteLength, content_sha256: sha256(bytes) },
    encoding: 'utf8',
    bytes,
  };
}

function accepted(result: Awaited<ReturnType<ClaudeParser['parse']>>) {
  assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
  if (!result.accepted) throw new Error('unreachable');
  return result.replacement;
}

function projectToExpected(actual: unknown, expected: unknown, location = 'golden'): unknown {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${location} must be an array`);
    assert.equal(actual.length, expected.length, `${location} array length`);
    return expected.map((item, index) => projectToExpected(actual[index], item, `${location}[${index}]`));
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object' && !Array.isArray(actual), `${location} must be an object`);
    return Object.fromEntries(Object.keys(expected).map((key) => {
      assert.ok(key in (actual as Record<string, unknown>), `${location}.${key} is missing from actual projection`);
      return [key, projectToExpected((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${location}.${key}`)];
    }));
  }
  return actual;
}

async function assertGolden(relative: string, result: ParseResult, identity: string): Promise<void> {
  const expected = JSON.parse(await readFile(path.join(fixtures, relative), 'utf8')) as Record<string, unknown>;
  const comparableExpected = Object.fromEntries(Object.entries(expected).filter(([key]) => key !== 'invariant'));
  const actual = result.accepted ? {
    accepted: true,
    source_identity_sha256: identity,
    sessions: result.replacement.sessions,
    steps: result.replacement.steps,
    diagnostic_codes: result.diagnostics.map((item) => item.code),
  } : { accepted: false, source_identity_sha256: identity, diagnostic_codes: result.diagnostics.map((item) => item.code) };
  assert.deepEqual(projectToExpected(actual, comparableExpected), comparableExpected);
  if (result.accepted) {
    for (const session of result.replacement.sessions) assert.equal(session.id, makeSessionId(session.source_id, session.native_session_id));
    for (const step of result.replacement.steps) assert.equal(step.id, makeStepId(step.session_id, step.native_step_id));
    assert.equal(new Set(result.replacement.steps.map((step) => step.id)).size, result.replacement.steps.length);
  }
}

test('Claude golden fixtures, append, truncate, malformed interior and interruption', async () => {
  const parser = new ClaudeParser();
  const cases = [
    ['claude/minimal/session.jsonl', 'a'.repeat(64), 'claude-minimal', { prompt: 12, completion: 5, total: 17 }, 1, 'completed'],
    ['claude/malformed/session.jsonl', 'a1'.repeat(32), 'claude-malformed', { prompt: 3, completion: 2, total: 5 }, 1, 'completed'],
    ['claude/interruption/session.jsonl', 'a4'.repeat(32), 'claude-interruption', { prompt: 9, completion: 1, total: 10 }, 1, 'interrupted'],
  ] as const;
  for (const [relative, identity, nativeId, tokens, count, status] of cases) {
    const result = await parser.parse(await jsonFixture(relative, 'claude_code', identity, `/fixture/${nativeId}.jsonl`));
    const replacement = accepted(result);
    await assertGolden(relative.replace(/session\.jsonl$/, 'expected.json'), result, identity);
    assert.equal(replacement.sessions[0].native_session_id, nativeId);
    assert.deepEqual(replacement.sessions[0].tokens, tokens);
    assert.equal(replacement.sessions[0].status, status);
    assert.equal(replacement.sessions[0].is_interrupted, status === 'interrupted');
    assert.equal(replacement.steps.length, count);
    assert.deepEqual(replacement.steps.map((step) => step.native_step_id), ['turn:user:user-1']);
    assert.match(replacement.steps[0].preview_text, /^\*\*\[사용자 지시\]\*\*/);
    assert.match(replacement.steps[0].preview_text, /\*\*\[작업 내용 및 결과\]\*\*/);
    assert.equal(new Set(replacement.steps.map((step) => step.id)).size, replacement.steps.length);
    if (relative.includes('malformed')) assert.deepEqual(result.diagnostics.map((item) => item.code), ['malformed_record']);
  }

  for (const mutation of [
    { name: 'append', identity: 'a2'.repeat(32), counts: [1, 2], totals: [8, 19] },
    { name: 'truncate', identity: 'a3'.repeat(32), counts: [2, 1], totals: [19, 8] },
    { name: 'prepend', identity: 'a5'.repeat(32), counts: [2, 3], totals: [14, 18] },
  ]) {
    const results = [];
    for (const snapshotNumber of [1, 2]) {
      const snapshot = await jsonFixture(
        `claude/${mutation.name}/snapshot-${snapshotNumber}.jsonl`,
        'claude_code',
        mutation.identity,
        `/fixture/claude-${mutation.name}.jsonl`,
      );
      results.push(accepted(await parser.parse(snapshot)));
    }
    assert.equal(results[0].sessions[0].id, results[1].sessions[0].id);
    if (mutation.name !== 'prepend') assert.equal(results[0].steps[0].id, results[1].steps[0].id);
    assert.deepEqual(results.map((item) => item.steps.length), mutation.counts);
    assert.deepEqual(results.map((item) => item.sessions[0].tokens.total), mutation.totals);
    const expected = JSON.parse(await readFile(path.join(fixtures, `claude/${mutation.name}/expected.json`), 'utf8')) as Record<string, unknown>;
    const actual = {
      accepted: true,
      source_identity_sha256: mutation.identity,
      snapshots: results.map((item) => ({
        session_tokens: item.sessions[0].tokens,
        native_step_ids: item.steps.map((step) => step.native_step_id),
      })),
    };
    const comparable = Object.fromEntries(Object.entries(expected).filter(([key]) => key !== 'invariant'));
    assert.deepEqual(projectToExpected(actual, comparable), comparable);
    if (mutation.name === 'prepend') {
      assert.deepEqual(results[0].steps.map((step) => step.id), results[1].steps.slice(1).map((step) => step.id));
    }
  }
});

test('incomplete trailing JSONL rejects the complete replacement', async () => {
  const bytes = Buffer.from('{"type":"user","uuid":"u","timestamp":"2026-01-01T00:00:00Z","message":{"content":"ok"}}\n{"type":');
  const snapshot: SourceSnapshot = {
    contract: 'absolute_snapshot_v1', complete: true, observed_at: observedAt, encoding: 'utf8', bytes,
    source: { source_id: makeSourceId('claude_code', 'd'.repeat(64)), agent_type: 'claude_code', kind: 'jsonl_file', locator: '/fixture/partial.jsonl', display_name: 'partial', enabled: true, discovered_at: observedAt },
    revision: { size_bytes: bytes.byteLength, content_sha256: sha256(bytes) },
  };
  const result = await new ClaudeParser().parse(snapshot);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ['unstable_trailing_record']);
});

test('Antigravity golden fixture preserves tool summaries without arguments', async () => {
  const snapshot = await jsonFixture('antigravity/minimal/transcript.jsonl', 'antigravity', 'c'.repeat(64), '/fixture/antigravity-minimal/transcript.jsonl');
  const result = await new AntigravityParser().parse(snapshot);
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  await assertGolden('antigravity/minimal/expected.json', result, 'c'.repeat(64));
  assert.equal(result.replacement.sessions[0].native_session_id, 'antigravity-minimal');
  assert.equal(result.replacement.sessions[0].title, 'Create a status card.');
  assert.deepEqual(result.replacement.steps[0].metadata, { tools: ['write_file (Create component)'], tool_count: 1 });
  assert.match(result.replacement.steps[0].preview_text, /^\*\*\[사용자 지시\]\*\*/);
  assert.match(result.replacement.steps[0].preview_text, /\*\*\[도구 실행\]\*\*/);
  assert.match(result.replacement.steps[0].preview_text, /\*\*\[작업 내용 및 결과\]\*\*/);
});

test('Antigravity fallback IDs survive prepended records', async () => {
  const parser = new AntigravityParser();
  const identity = 'c1'.repeat(32);
  const replacements = [];
  for (const number of [1, 2]) {
    const result = await parser.parse(await jsonFixture(`antigravity/prepend/snapshot-${number}.jsonl`, 'antigravity', identity, '/fixture/antigravity/prepend/transcript.jsonl'));
    assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
    if (!result.accepted) return;
    replacements.push(result.replacement);
  }
  assert.equal(replacements[0].steps[0].id, replacements[1].steps[1].id);
  const expected = JSON.parse(await readFile(path.join(fixtures, 'antigravity/prepend/expected.json'), 'utf8')) as Record<string, unknown>;
  const actual = {
    accepted: true,
    source_identity_sha256: identity,
    snapshots: replacements.map((item) => ({ session_tokens: item.sessions[0].tokens, native_step_ids: item.steps.map((step) => step.native_step_id) })),
  };
  const comparable = Object.fromEntries(Object.entries(expected).filter(([key]) => key !== 'invariant'));
  assert.deepEqual(projectToExpected(actual, comparable), comparable);
});

test('Codex SQLite golden fixture attaches subagent to its root session', async () => {
  const databasePath = path.join(os.tmpdir(), `tokkie-codex-fixture-${randomUUID()}.sqlite`);
  try {
    const db = new DatabaseSync(databasePath);
    db.exec(await readFile(path.join(fixtures, 'codex/minimal-subagent/state.sql'), 'utf8'));
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'internal-review', 'Approval review', 'Assess this requested action.', '{}', 99,
      'codex-auto-review', 1767225700, null, null, null,
    );
    db.close();
    const bytes = await readFile(databasePath);
    const snapshot: SourceSnapshot = {
      contract: 'absolute_snapshot_v1', complete: true, observed_at: observedAt, encoding: 'binary', bytes,
      source: { source_id: makeSourceId('codex', 'b'.repeat(64)), agent_type: 'codex', kind: 'sqlite_database', locator: '/fixture/.codex/state_5.sqlite', display_name: 'state_5.sqlite', enabled: true, discovered_at: observedAt },
      revision: { size_bytes: bytes.byteLength, content_sha256: sha256(bytes) },
    };
    const result = await new CodexParser().parse(snapshot);
    assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
    if (!result.accepted) return;
    await assertGolden('codex/minimal-subagent/expected.json', result, 'b'.repeat(64));
    assert.equal(result.replacement.sessions.length, 1);
    assert.deepEqual(result.replacement.sessions[0].tokens, { prompt: 108, completion: 42, total: 150 });
    assert.equal(result.replacement.sessions[0].metadata.subagent_count, 1);
    assert.deepEqual(result.replacement.steps.map((step) => step.native_step_id), ['thread:codex-root-1', 'thread:codex-child-1']);
    assert.equal(result.replacement.steps[1].source, 'subagent');
    assert.deepEqual(result.replacement.steps[1].metadata.subagent, {
      parent_native_session_id: 'codex-root-1', nickname: 'reviewer', role: 'review', path: '/root/reviewer', depth: 1,
    });
  } finally {
    await rm(databasePath, { force: true });
  }
});

test('Codex reads safe user, assistant, and tool summaries from rollout files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tokkie-codex-rollout-'));
  const codexDirectory = path.join(directory, '.codex');
  const databasePath = path.join(codexDirectory, 'state_5.sqlite');
  const rolloutPath = path.join(codexDirectory, 'sessions', 'rollout.jsonl');
  try {
    await mkdir(path.dirname(rolloutPath), { recursive: true });
    await writeFile(rolloutPath, [
      { type: 'event_msg', payload: { type: 'task_started' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the responsive layout.' }] } },
      { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec_command' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Updated the grid and verified it.' }] } },
    ].map((row) => JSON.stringify(row)).join('\n'));
    const db = new DatabaseSync(databasePath);
    db.exec(`CREATE TABLE threads (
      id TEXT PRIMARY KEY, title TEXT, first_user_message TEXT, source TEXT NOT NULL,
      tokens_used INTEGER NOT NULL, model TEXT, created_at INTEGER, rollout_path TEXT
    )`);
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'rollout-root', 'Responsive fix', 'Fix the responsive layout.', '{}', 100,
      'gpt-5.6-sol', 1767225600, rolloutPath,
    );
    db.close();
    const bytes = await readFile(databasePath);
    const result = await new CodexParser().parse({
      contract: 'absolute_snapshot_v1', complete: true, observed_at: observedAt, encoding: 'binary', bytes,
      source: { source_id: makeSourceId('codex', 'c'.repeat(64)), agent_type: 'codex', kind: 'sqlite_database', locator: databasePath, display_name: 'state_5.sqlite', enabled: true, discovered_at: observedAt },
      revision: { size_bytes: bytes.byteLength, content_sha256: sha256(bytes) },
    });
    assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
    if (!result.accepted) return;
    assert.equal(result.replacement.sessions[0].status, 'running');
    assert.match(result.replacement.steps[0].preview_text, /\*\*\[사용자 지시\]\*\*/);
    assert.match(result.replacement.steps[0].preview_text, /\*\*\[도구 실행\]\*\*/);
    assert.match(result.replacement.steps[0].preview_text, /\*\*\[작업 내용 및 결과\]\*\*/);
    assert.match(result.replacement.steps[0].preview_text, /Updated the grid/);
    assert.deepEqual(result.replacement.steps[0].metadata.tools, ['exec_command']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Codex preserves interrupted source status in the session and step', async () => {
  const databasePath = path.join(os.tmpdir(), `tokkie-codex-interrupted-${randomUUID()}.sqlite`);
  try {
    const db = new DatabaseSync(databasePath);
    db.exec(await readFile(path.join(fixtures, 'codex/interruption/state.sql'), 'utf8'));
    db.close();
    const bytes = await readFile(databasePath);
    const identity = 'b1'.repeat(32);
    const result = await new CodexParser().parse({
      contract: 'absolute_snapshot_v1', complete: true, observed_at: observedAt, encoding: 'binary', bytes,
      source: { source_id: makeSourceId('codex', identity), agent_type: 'codex', kind: 'sqlite_database', locator: '/fixture/.codex/interrupted.sqlite', display_name: 'interrupted.sqlite', enabled: true, discovered_at: observedAt },
      revision: { size_bytes: bytes.byteLength, content_sha256: sha256(bytes) },
    });
    await assertGolden('codex/interruption/expected.json', result, identity);
  } finally {
    await rm(databasePath, { force: true });
  }
});

test('pricing is versioned for known models and explicitly unavailable for unknown models', async () => {
  const known = accepted(await new ClaudeParser().parse(await jsonFixture('claude/prepend/snapshot-2.jsonl', 'claude_code', 'e1'.repeat(32), '/fixture/known.jsonl'))).sessions[0];
  assert.equal(known.estimated_cost_usd, 0.000126);
  assert.deepEqual(known.cost_estimate, {
    status: 'estimated', pricing_version: 'standard-usd-per-mtok-2026-08-24-v1', input_usd_per_million: 3, output_usd_per_million: 15,
  });
  const unknown = accepted(await new ClaudeParser().parse(await jsonFixture('claude/minimal/session.jsonl', 'claude_code', 'e2'.repeat(32), '/fixture/unknown.jsonl'))).sessions[0];
  assert.equal(unknown.estimated_cost_usd, null);
  assert.equal(unknown.cost_estimate.status, 'unavailable');
  assert.equal(unknown.cost_estimate.reason, 'unknown_model');
});
