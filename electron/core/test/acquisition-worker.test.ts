import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SnapshotAcquirer } from '../acquisition';
import { CollectorWorkerFacade } from '../facade';
import { CodexParser } from '../parsers';
import { describeSource } from '../util';

test('SQLite acquisition snapshots committed WAL pages before Codex parsing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tokkie-wal-'));
  const codexDirectory = path.join(directory, '.codex');
  const databasePath = path.join(codexDirectory, 'state_5.sqlite');
  let writer: DatabaseSync | undefined;
  try {
    await mkdir(codexDirectory);
    writer = new DatabaseSync(databasePath);
    writer.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA wal_autocheckpoint=0;
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, title TEXT, first_user_message TEXT, source TEXT NOT NULL,
        tokens_used INTEGER NOT NULL, model TEXT, created_at INTEGER,
        agent_nickname TEXT, agent_role TEXT, rollout_path TEXT
      );
      INSERT INTO threads VALUES ('wal-root', 'WAL root', 'Read committed WAL data.', '{}', 10, 'gpt-test', 1767225600, NULL, NULL, NULL);
    `);
    const source = await describeSource('codex', 'sqlite_database', databasePath);
    const snapshot = await new SnapshotAcquirer().read(source);
    assert.equal('code' in snapshot, false);
    if ('code' in snapshot) return;
    const result = await new CodexParser().parse(snapshot);
    assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
    if (result.accepted) assert.equal(result.replacement.sessions[0].native_session_id, 'wal-root');
  } finally {
    writer?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('worker facade exposes scan, status, query and clean shutdown off the caller thread', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tokkie-worker-'));
  const roots = {
    claude: path.join(directory, '.claude'),
    codex: path.join(directory, '.codex'),
    antigravity: path.join(directory, 'brain'),
  };
  const facade = new CollectorWorkerFacade({ databasePath: path.join(directory, 'tokkie.sqlite'), roots, watch: false });
  try {
    const scan = await facade.start();
    assert.equal(scan.accepted_sources, 0);
    assert.equal((await facade.status()).state, 'idle');
    assert.deepEqual((await facade.querySessions({})).items, []);
    assert.deepEqual(await facade.outboxDue(), []);
  } finally {
    await facade.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('worker facade maps a legacy hash and unchanged verified sources still reconcile it', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tokkie-worker-legacy-map-'));
  const roots = {
    claude: path.join(directory, '.claude'),
    codex: path.join(directory, '.codex'),
    antigravity: path.join(directory, 'brain'),
  };
  const legacyPath = path.join(directory, '.agent-token-tracker', 'offline_events.db');
  const projectDirectory = path.join(roots.claude, 'projects', 'fixture');
  await mkdir(projectDirectory, { recursive: true });
  await mkdir(path.dirname(legacyPath), { recursive: true });
  await writeFile(path.join(projectDirectory, 'session.jsonl'), await readFile(path.resolve(process.cwd(), 'tests/fixtures/claude/minimal/session.jsonl')));
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec('CREATE TABLE pending_sessions(id TEXT PRIMARY KEY, payload TEXT); CREATE TABLE pending_steps(id TEXT PRIMARY KEY, session_id TEXT, payload TEXT);');
  legacy.prepare('INSERT INTO pending_sessions VALUES (?, ?)').run('mapped-old', JSON.stringify({ id: 'mapped-old', title: 'Mapped legacy', started_at: '2026-01-01T00:00:00.000Z' }));
  legacy.close();
  const facade = new CollectorWorkerFacade({
    databasePath: path.join(directory, 'tokkie.sqlite'), roots, watch: false,
    legacy: { databasePath: legacyPath, backupDirectory: path.join(directory, 'legacy-backups') },
  });
  try {
    await facade.start();
    const before = (await facade.querySessions({})).items;
    const legacySession = before.find((session) => session.legacy_unverified);
    const verifiedSession = before.find((session) => !session.legacy_unverified);
    assert.ok(legacySession && verifiedSession);
    const payloadHash = legacySession.metadata.extra?.legacy_payload_hash;
    assert.equal(typeof payloadHash, 'string');
    const mappingOptions = await facade.listLegacyMappingOptions();
    assert.deepEqual(mappingOptions.payloads.map((payload) => payload.payload_hash), [payloadHash]);
    assert.equal(mappingOptions.sources.some((source) => source.source_id === verifiedSession.source_id), true);
    assert.equal('payload_json' in mappingOptions.payloads[0], false);
    assert.equal(await facade.mapLegacyPayload(String(payloadHash), verifiedSession.source_id), true);
    await facade.scan();
    const after = (await facade.querySessions({})).items;
    assert.equal(after.some((session) => session.legacy_unverified), false);
    assert.equal(after.length, 1);
  } finally {
    await facade.close();
    await rm(directory, { recursive: true, force: true });
  }
});
