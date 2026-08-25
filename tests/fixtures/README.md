# Parser fixture corpus

All values are synthetic and sanitized. Paths use `/fixture/...`; emails, keys, prompts, repository names, and IDs do not identify a real person or project.

`manifest.json` is the inventory. Each case has immutable input snapshots and an `expected.json` golden projection. A parser test must construct a `SourceSnapshot`, parse it, project its accepted result to the keys present in the golden, and deep-compare. The projection intentionally excludes parse time, content hash, full deterministic ID strings, cost (pricing changes independently), and redacted display formatting. Tests must additionally calculate IDs with `shared/ids.ts` from the declared fingerprint and native IDs, then assert every ID is stable and unique.

For JSONL, malformed interior lines yield `malformed_record` while valid surrounding records remain accepted. An incomplete trailing JSON fragment is not represented here because acquisition/parser must reject it as `unstable_trailing_record`, not accept a replacement.

Codex's production input is SQLite. `state.sql` is the source fixture recipe: create a temporary database, execute the SQL, close it, then snapshot its bytes. It is SQL rather than a committed platform-dependent binary so the corpus stays auditable. Its `source_kind` remains `sqlite_database`.

Mutation cases are ordered snapshots of the same source identity:

- append: snapshot 2 must retain all IDs from snapshot 1 and add one turn;
- truncate: snapshot 2 is a genuine stable smaller file and must replace away turn 2;
- interruption: status and interruption flags agree;
- subagent: the child remains provenance metadata on a parent-session step, not an unrelated human session.

Run `node tests/fixtures/validate.mjs` for corpus integrity. This validator is dependency-free and does not replace parser golden tests.
