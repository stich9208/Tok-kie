# Shared contracts

Import public contracts from `shared/index.ts`. This directory is dependency-free and must compile in Electron main/preload and the static renderer.

## Parser contract

`AgentParser.parse` accepts only `SourceSnapshot` with `contract: "absolute_snapshot_v1"` and `complete: true`. A snapshot contains all bytes visible for one source at one stable revision. It is never an append chunk. JSONL parsers therefore re-read all records; SQLite acquisition must make a consistent read-only copy/snapshot before parsing.

An accepted parse returns `mode: "replace_source"` and the complete desired `Session[]` and `Step[]` for that `source_id`. The store applies it in one transaction:

1. validate IDs, referential integrity, totals, timestamps, provenance, and source ownership;
2. upsert returned sessions and steps;
3. delete persisted steps and sessions for that `source_id` absent from the result;
4. record the source revision and commit.

This makes append idempotent and makes genuine truncation/removal converge. A rejected parse changes no domain rows. An empty accepted replacement intentionally clears a source. A stable malformed interior JSONL record can be skipped with a diagnostic; an incomplete trailing record from a possibly active write rejects the snapshot so it cannot transiently delete the last turn.

## Deterministic identity

The scanner canonicalizes a local locator (absolute, realpath-resolved, Unicode NFC, platform case rules), then calculates:

```text
identity_sha256 = sha256(agent_type + NUL + source_kind + NUL + canonical_locator)
source_id       = makeSourceId(agent_type, identity_sha256)
session.id      = makeSessionId(source_id, stable_native_session_id)
step.id         = makeStepId(session.id, stable_native_step_id)
```

Native IDs come from agent records when available. Otherwise parsers use a documented semantic key (for example message UUID or `turn:<ordinal>`), never content hashes, titles, timestamps generated at parse time, or mutable array positions. The local locator itself is not synced.

## Domain invariants

- `tokens.total === tokens.prompt + tokens.completion`; all values are finite non-negative integers.
- A step has the same `source_id` as its session and an existing `session_id` in the same replacement.
- All records in one replacement have provenance matching its source and revision.
- `legacy_unverified === (provenance.verification === "legacy_unverified")`.
- `is_interrupted` agrees with `status === "interrupted"`.
- ISO timestamps are source-derived. Parsing may use `snapshot.observed_at` only as an explicitly `inferred` fallback.
- Metadata is JSON, bounded before persistence, and contains no raw prompts, credentials, home paths, environment dumps, or tool arguments. `preview_text` is redacted and length-limited by the parser policy.

## IPC trust boundary

Renderer code sees only the frozen `TokkieApi` exposed by preload. It does not receive filesystem/database primitives or cloud secrets. Every `ipcMain.handle` validates its input with `validateIpcRequest`, applies authorization/allowlists in main, and returns `IpcReply<T>`. Runtime validation of parser output and persisted rows is required at the main-process boundary before a source-replacement transaction; the lightweight validator here covers request ingress and can be extended without changing the public map.
