import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { makeSourceId } from '../../../shared/ids';
import type { SourceDescriptor } from '../../../shared/source';
import { ClaudeParser } from '../parsers';
import { CanonicalRepository } from '../storage/repository';
import { LegacyImporter } from '../storage/legacy-importer';
import { sha256 } from '../util';

const observedAt = '2026-01-31T00:00:00.000Z';
const fixtures = path.resolve(process.cwd(), 'tests', 'fixtures');

async function parsed(relative: string, source: SourceDescriptor) {
  const bytes = await readFile(path.join(fixtures, relative));
  const result = await new ClaudeParser().parse({
    contract: 'absolute_snapshot_v1', complete: true, source, observed_at: observedAt, encoding: 'utf8', bytes,
    revision: { size_bytes: bytes.byteLength, content_sha256: sha256(bytes) },
  });
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error('unreachable');
  return result.replacement;
}

test('source replacement is atomic, truncates absent rows, persists across restart, and sync ack keeps local data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tokkie-repository-'));
  const databasePath = path.join(directory, 'tokkie.sqlite');
  const source: SourceDescriptor = {
    source_id: makeSourceId('claude_code', 'a3'.repeat(32)), agent_type: 'claude_code', kind: 'jsonl_file',
    locator: '/fixture/claude-truncate.jsonl', display_name: 'truncate', enabled: true, discovered_at: observedAt,
  };
  try {
    let repository = new CanonicalRepository(databasePath);
    repository.registerSource(source);
    assert.equal(repository.replaceSource(await parsed('claude/truncate/snapshot-1.jsonl', source)), true);
    assert.equal(repository.querySessions({}).items[0].tokens.total, 19);
    assert.equal(repository.querySteps({ session_id: repository.querySessions({}).items[0].id }).items.length, 2);
    const partialBytes = Buffer.from('{"type":"user","uuid":"u","timestamp":"2026-01-01T00:00:00Z","message":{"content":"partial"}}\n{"type":');
    const rejected = await new ClaudeParser().parse({
      contract: 'absolute_snapshot_v1', complete: true, source, observed_at: observedAt, encoding: 'utf8', bytes: partialBytes,
      revision: { size_bytes: partialBytes.byteLength, content_sha256: sha256(partialBytes) },
    });
    assert.equal(rejected.accepted, false);
    assert.equal(repository.querySessions({}).items[0].tokens.total, 19, 'rejected snapshot does not mutate canonical rows');
    const firstOutbox = repository.outbox.due(20);
    assert.ok(firstOutbox.length >= 3);
    assert.equal(repository.outbox.acknowledge(firstOutbox[0].operation_id, firstOutbox[0].payload_hash), true);
    assert.equal(repository.querySessions({}).items.length, 1, 'sync success must not delete canonical data');

    assert.equal(repository.replaceSource(await parsed('claude/truncate/snapshot-2.jsonl', source)), true);
    const session = repository.querySessions({}).items[0];
    assert.equal(session.tokens.total, 8);
    assert.deepEqual(repository.querySteps({ session_id: session.id }).items.map((step) => step.native_step_id), ['turn:user:user-1']);
    assert.ok(repository.outbox.due(20).some((entry) => entry.entity_type === 'step' && entry.payload.operation === 'delete'));
    assert.equal(repository.replaceSource(await parsed('claude/truncate/snapshot-2.jsonl', source)), false, 'same revision is a no-op');
    assert.equal(repository.replaceSource(await parsed('claude/truncate/snapshot-2.jsonl', source), { force: true }), true, 'parser upgrades can refresh unchanged source bytes');
    repository.close();

    repository = new CanonicalRepository(databasePath);
    assert.equal(repository.querySessions({}).items[0].tokens.total, 8);
    assert.deepEqual(repository.deviceMetadata(), repository.deviceMetadata());
    repository.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy import backs up once, ignores cumulative authority, and labels every canonical row unverified', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tokkie-legacy-'));
  const legacyPath = path.join(directory, 'offline_events.db');
  const canonicalPath = path.join(directory, 'v2.sqlite');
  try {
    await writeFile(path.join(directory, 'config.json'), JSON.stringify({
      device_name: 'Legacy workstation', default_user_email: 'legacy@example.test',
      work_domains: ['example.test'], log_paths: { claude_code: '/fixture/.claude' },
      supabase_url: 'https://example.invalid', supabase_key: 'must-not-be-copied',
    }));
    let legacy = new DatabaseSync(legacyPath);
    legacy.exec(`
      CREATE TABLE pending_sessions(id TEXT PRIMARY KEY, payload TEXT);
      CREATE TABLE pending_steps(id TEXT PRIMARY KEY, session_id TEXT, payload TEXT);
      CREATE TABLE session_cumulative_totals(session_id TEXT PRIMARY KEY, prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER);
    `);
    legacy.prepare('INSERT INTO pending_sessions VALUES (?, ?)').run('old-session', JSON.stringify({ id: 'old-session', agent_type: 'claude_code', title: 'Legacy', total_prompt_tokens: 3, total_completion_tokens: 2, started_at: observedAt }));
    legacy.prepare('INSERT INTO pending_steps VALUES (?, ?, ?)').run('old-step', 'old-session', JSON.stringify({ id: 'old-step', session_id: 'old-session', prompt_tokens: 3, completion_tokens: 2, step_index: 1, timestamp: observedAt }));
    legacy.prepare('INSERT INTO session_cumulative_totals VALUES (?, ?, ?, ?)').run('old-session', 9999, 9999, 19998);
    legacy.close();

    const repository = new CanonicalRepository(canonicalPath);
    const importer = new LegacyImporter(repository, path.join(directory, 'backups'));
    const first = await importer.importOnce(legacyPath);
    assert.equal(first.imported, true);
    assert.ok(first.backup_path);
    const session = repository.querySessions({}).items[0];
    assert.equal(session.tokens.total, 5, 'cumulative totals table is not authoritative');
    assert.equal(session.legacy_unverified, true);
    assert.equal(session.provenance.verification, 'legacy_unverified');
    assert.equal(session.provenance.migrated_from, 'python_sqlite_v1');
    const step = repository.querySteps({ session_id: session.id }).items[0];
    assert.equal(step.legacy_unverified, true);
    assert.equal(repository.deviceMetadata().device_name, 'Legacy workstation');
    assert.equal(repository.setting('legacy.default_user_email'), '"legacy@example.test"');
    assert.equal(repository.setting('legacy.supabase_key'), undefined);
    assert.equal((await importer.importOnce(legacyPath)).imported, false);

    legacy = new DatabaseSync(legacyPath);
    legacy.prepare('INSERT INTO pending_sessions VALUES (?, ?)').run('new-session', JSON.stringify({ id: 'new-session', agent_type: 'codex', title: 'Later payload', started_at: observedAt }));
    legacy.prepare('INSERT INTO pending_steps VALUES (?, ?, ?)').run('new-step', 'new-session', JSON.stringify({ id: 'new-step', session_id: 'new-session', prompt_tokens: 1, completion_tokens: 1, step_index: 1, timestamp: observedAt }));
    legacy.close();
    const resumed = await importer.importOnce(legacyPath);
    assert.equal(resumed.imported, true);
    assert.deepEqual({ sessions: resumed.sessions, steps: resumed.steps }, { sessions: 1, steps: 1 });
    assert.equal(repository.querySessions({}).items.length, 2, 'previous hashes remain canonical while only new hashes import');
    repository.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('verified scans automatically deduplicate matching legacy sessions and carry account identity forward', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tokkie-legacy-auto-'));
  const legacyPath = path.join(directory, 'offline_events.db');
  const canonicalPath = path.join(directory, 'v2.sqlite');
  const source: SourceDescriptor = {
    source_id: makeSourceId('claude_code', 'd3'.repeat(32)), agent_type: 'claude_code', kind: 'jsonl_file',
    locator: '/fixture/claude-minimal.jsonl', display_name: 'minimal', enabled: true, discovered_at: observedAt,
  };
  try {
    const replacement = await parsed('claude/minimal/session.jsonl', source);
    const verified = replacement.sessions[0];
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec('CREATE TABLE pending_sessions(id TEXT PRIMARY KEY, payload TEXT); CREATE TABLE pending_steps(id TEXT PRIMARY KEY, session_id TEXT, payload TEXT);');
    legacy.prepare('INSERT INTO pending_sessions VALUES (?, ?)').run('historical-copy', JSON.stringify({
      id: 'historical-copy', agent_type: verified.agent_type, title: verified.title,
      total_tokens: verified.tokens.total, device_name: 'Studio Mac', user_email: 'owner@example.test',
      started_at: verified.started_at,
    }));
    legacy.close();

    const repository = new CanonicalRepository(canonicalPath);
    await new LegacyImporter(repository, path.join(directory, 'backups')).importOnce(legacyPath);
    repository.registerSource(source);
    repository.replaceSource(replacement);
    assert.equal(repository.querySessions({}).items.length, 2);
    assert.equal(repository.reconcileLegacyRecords(source.source_id), 1);
    const sessions = repository.querySessions({}).items;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].legacy_unverified, false);
    assert.equal(sessions[0].metadata.device_name, 'Studio Mac');
    assert.equal(sessions[0].metadata.user_email, 'owner@example.test');
    repository.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration checksum covers SQL and incompatible partial schemas roll back without advancing user_version', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tokkie-migration-'));
  try {
    const validPath = path.join(directory, 'valid.sqlite');
    const repository = new CanonicalRepository(validPath);
    repository.close();
    const valid = new DatabaseSync(validPath);
    const migration = valid.prepare('SELECT migration_id, checksum FROM schema_migrations').get();
    if (!migration) throw new Error('migration row missing');
    assert.match(String(migration.checksum), /^[a-f0-9]{64}$/);
    assert.notEqual(String(migration.checksum), sha256(String(migration.migration_id)), 'checksum must cover migration SQL, not only its ID');
    assert.equal(Number(valid.prepare('PRAGMA user_version').get()!.user_version), 3);
    valid.exec('DELETE FROM schema_migrations; ALTER TABLE sessions DROP COLUMN cost_estimate_json; PRAGMA user_version=2;');
    valid.close();
    const repaired = new CanonicalRepository(validPath);
    repaired.close();
    const repairedDb = new DatabaseSync(validPath);
    assert.ok(repairedDb.prepare('PRAGMA table_info(sessions)').all().some((row) => row.name === 'cost_estimate_json'));
    assert.equal(Number(repairedDb.prepare('PRAGMA user_version').get()!.user_version), 3);
    repairedDb.close();

    const tamperedPath = path.join(directory, 'tampered.sqlite');
    const tamperedRepository = new CanonicalRepository(tamperedPath);
    tamperedRepository.close();
    const tampered = new DatabaseSync(tamperedPath);
    tampered.prepare('UPDATE schema_migrations SET checksum=?').run('0'.repeat(64));
    tampered.close();
    assert.throws(() => new CanonicalRepository(tamperedPath), /Migration checksum mismatch/);

    const partialPath = path.join(directory, 'partial.sqlite');
    const partial = new DatabaseSync(partialPath);
    partial.exec('PRAGMA user_version=1; CREATE TABLE sources(source_id TEXT PRIMARY KEY);');
    partial.close();
    assert.throws(() => new CanonicalRepository(partialPath), /Incompatible partial schema/);
    const after = new DatabaseSync(partialPath);
    assert.equal(Number(after.prepare('PRAGMA user_version').get()!.user_version), 1);
    assert.equal(after.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get(), undefined, 'transaction rolls back tables created before validation failure');
    after.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('outbox payload versions are semantic, monotonic after ACK, and durable across restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tokkie-outbox-version-'));
  const databasePath = path.join(directory, 'tokkie.sqlite');
  try {
    let repository = new CanonicalRepository(databasePath);
    repository.outbox.enqueue('session', 'entity-1', { operation: 'upsert', record: { b: 2, a: 1 } });
    repository.outbox.enqueue('session', 'entity-1', { record: { a: 1, b: 2 }, operation: 'upsert' });
    let due = repository.outbox.due();
    assert.equal(due.length, 1);
    assert.equal(due[0].payload_version, 1, 'key order is not a semantic change');
    assert.equal(repository.outbox.acknowledge(due[0].operation_id, due[0].payload_hash), true);
    repository.close();

    repository = new CanonicalRepository(databasePath);
    repository.outbox.enqueue('session', 'entity-1', { operation: 'upsert', record: { a: 2, b: 2 } });
    due = repository.outbox.due();
    assert.equal(due[0].payload_version, 2, 'version ledger survives ACK and restart');
    assert.equal(repository.outbox.acknowledge(due[0].operation_id, due[0].payload_hash), true);
    repository.outbox.enqueue('session', 'entity-1', { operation: 'delete', id: 'entity-1' });
    assert.equal(repository.outbox.due()[0].payload_version, 3, 'delete is a semantic entity change');
    repository.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
