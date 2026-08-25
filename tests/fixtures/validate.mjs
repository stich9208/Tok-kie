import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const agents = new Set(['claude_code', 'codex', 'antigravity', 'aider', 'unknown']);
const kinds = new Set(['jsonl_file', 'sqlite_database', 'json_document']);
const seen = new Set();

function invariant(value, message) {
  if (!value) throw new Error(message);
}

invariant(manifest.schema_version === 1, 'manifest schema_version must be 1');
invariant(Array.isArray(manifest.cases) && manifest.cases.length >= 7, 'fixture coverage is incomplete');

for (const fixture of manifest.cases) {
  invariant(typeof fixture.id === 'string' && !seen.has(fixture.id), `duplicate/invalid case id: ${fixture.id}`);
  seen.add(fixture.id);
  invariant(agents.has(fixture.agent_type), `unsupported agent: ${fixture.agent_type}`);
  invariant(kinds.has(fixture.source_kind), `unsupported source kind: ${fixture.source_kind}`);
  invariant(Array.isArray(fixture.snapshots) && fixture.snapshots.length > 0, `${fixture.id}: no snapshots`);

  for (const relative of fixture.snapshots) {
    const text = await readFile(resolve(root, relative), 'utf8');
    invariant(text.length > 0, `${fixture.id}: empty snapshot`);
    if (relative.endsWith('.jsonl') && fixture.id !== 'claude-malformed') {
      for (const [index, line] of text.trimEnd().split('\n').entries()) {
        try { JSON.parse(line); } catch { throw new Error(`${fixture.id}: invalid JSONL line ${index + 1}`); }
      }
    }
    if (relative.endsWith('.sql')) invariant(/CREATE TABLE threads/.test(text), `${fixture.id}: missing threads schema`);
  }

  const expected = JSON.parse(await readFile(resolve(root, fixture.expected), 'utf8'));
  invariant(expected.accepted === true, `${fixture.id}: golden must be accepted`);
  invariant(/^[a-f0-9]{64}$/.test(expected.source_identity_sha256), `${fixture.id}: invalid identity fingerprint`);
}

for (const required of ['malformed', 'append', 'prepend', 'truncate', 'subagent', 'interruption']) {
  invariant([...seen].some((id) => id.includes(required)), `missing ${required} coverage`);
}

console.log(`validated ${seen.size} fixture cases`);
