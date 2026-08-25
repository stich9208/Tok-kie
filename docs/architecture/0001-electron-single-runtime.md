# ADR 0001: Electron single-runtime architecture

- Status: Accepted
- Date: 2026-08-24
- Decision owners: Tok-kie maintainers

## Context

The current desktop path launches a Python collector, depends on a Next development/server process at `localhost:3030`, shells out to SQLite, and uses public-all Supabase policies. Incremental offsets do not match parsers that reread entire sources, so retries can inflate totals and truncation cannot reliably remove stale records. OAuth and pairing also cross a localhost HTTP boundary and expose durable credentials more broadly than necessary.

## Decision

Tok-kie becomes one packaged Electron runtime:

```text
agent logs -> Electron main: discovery/snapshot/parsers -> local SQLite
                                                    |-> bounded sync worker -> Supabase
static Next export <- typed preload IPC <- Electron main
```

Electron main is the sole authority for filesystem access, SQLite, network sync, OAuth, secure storage, source replacement, and external navigation. Preload exposes only `TokkieApi`; context isolation stays enabled and Node integration stays disabled. The renderer is a static Next export with no route handlers, server actions, runtime SSR, localhost fetches, or secrets.

### Static UI and protocol

Production registers a privileged custom scheme such as `app://tokkie/` before `app.ready`, serves files from the packaged static export, resolves `/` to `index.html`, and applies SPA/static-export fallbacks without allowing path traversal. The protocol is standard/secure/supportsFetch, has a restrictive CSP, and denies unexpected navigation/window creation. Development may load an explicitly configured dev URL, but packaged builds must not bind or connect to localhost. `tokkie://` remains a narrow deep-link scheme for OAuth callbacks; `app://` is only the renderer origin.

### Source snapshots and parsing

The contracts in `shared/` are normative. Watch events are hints to schedule a debounced rescan, not data. Acquisition reads a stable absolute snapshot (stat/read/stat retry for files; SQLite backup/read transaction for databases). Parsers are pure with respect to external state and return a complete source replacement. Accepted replacements commit atomically; rejected revisions retain the previous records. IDs follow `shared/ids.ts`. A content-unchanged revision is a no-op.

### Local SQLite schema (v2)

The application database lives under Electron `app.getPath("userData")`, uses WAL, foreign keys, a busy timeout, migrations in transactions, and `PRAGMA user_version`. Monetary values are integer micro-US-dollars locally; JSON is validated before insert.

| Table | Required shape |
| --- | --- |
| `sources` | `source_id PK`, `agent_type`, `kind`, encrypted/local-only `locator`, `display_name`, `identity_sha256`, `last_content_sha256`, `last_observed_at`, `enabled`, `last_error` |
| `sessions` | contract fields flattened: `id PK`, `source_id FK`, `native_session_id`, agent/model/title/status/timestamps, prompt/completion/total tokens, `estimated_cost_microusd`, archive/interruption/legacy flags, `metadata_json`, `provenance_json`; unique `(source_id,native_session_id)` |
| `steps` | `id PK`, `session_id FK ON DELETE CASCADE`, `source_id FK`, `native_step_id`, index/source/action/status/timestamp/token fields, preview/interruption/legacy flags, metadata/provenance JSON; unique `(session_id,native_step_id)` |
| `settings` | non-secret key/value settings only |
| `sync_queue` | monotonic operation id, entity type/id, payload version/hash, attempt count, next attempt, last error; unique latest operation per entity |
| `schema_migrations` | migration id/checksum/applied timestamp |

Source replacement uses one `BEGIN IMMEDIATE` transaction. It validates the full graph, upserts records, deletes absent records scoped by `source_id`, updates `sources.last_content_sha256`, enqueues resulting cloud changes, then commits. Readers get stable pagination ordered by `(started_at,id)` or `(step_index,id)`.

### Legacy migration

On first v2 launch, main makes a read-only backup of `~/.agent-token-tracker/offline_events.db` and reads `pending_sessions`, `pending_steps`, and cumulative totals without trusting offsets. It also imports parseable non-secret settings from the prior `config.json`. The released v1 API kept its session/step response cache in process memory only; its durable cached payloads are the `pending_*` SQLite rows covered above. Legacy rows receive deterministic IDs when a native/source identity can be recovered; otherwise they receive a deterministic `legacy` source scoped to the device installation. Every imported record has `legacy_unverified=true`, provenance verification `legacy_unverified`, and `migrated_from="python_sqlite_v1"`; it is never silently merged into verified parser output.

The importer is idempotent through a migration ledger and payload hash. It does not delete or rewrite the legacy DB/config. After import, an absolute rescan replaces recoverable legacy data only when an explicit legacy-to-source mapping proves identity; unmatched legacy rows remain visible and labeled unverified. `file_offsets` and cumulative delta totals are not migrated as authority because v2 recomputes absolute totals.

### Supabase tenancy and sync

Cloud tables add `owner_id uuid NOT NULL`, `created_by_member_id`, `schema_version`, and `updated_at`; primary/unique keys include owner scope where appropriate. `owners` represent a private data tenancy. `members` belong to one owner and have a role (`owner`, `viewer`, or `device`) plus revocation state. RLS derives owner membership from `auth.uid()`/server-verified membership; there are no anonymous `USING (true)` policies and clients cannot choose or overwrite another owner ID. Only an owner/device role may write usage, and only owner-approved members may read it.

Desktop cloud data-plane access uses a Supabase publishable key plus a signed-in user/device session; service-role keys and database passwords are never shipped. Sync is local-first, idempotent by record ID/version/hash, retryable with bounded exponential backoff, and preserves tombstones for cloud deletions. Raw source paths, raw prompts, tool arguments, OAuth tokens, and local configuration never sync.

### Pairing and OAuth security

Pairing creates a random, single-use, short-lived secret (at least 128 bits). The database stores only its hash, expiry, requested role, and owner; the QR carries no service-role key, database password, refresh token, or permanent publishable credential. Redemption is rate-limited and atomic, requires owner confirmation for the displayed device/member, issues a separately revocable member session, and consumes the secret. Pairing payloads are redacted from logs and clipboard/UI state is cleared after expiry.

OAuth uses Authorization Code with PKCE S256 and a cryptographically random `state`. Main stores the verifier/state ephemerally (or in OS secure storage if restart continuity is required), opens only an allowlisted HTTPS authorization origin, accepts only the exact `tokkie://oauth/callback` host/path, validates state before exchange, and never forwards authorization codes to the renderer. Access/refresh tokens live in Keychain/Credential Vault through Electron main; renderer IPC returns only `CloudSettingsView`. Management OAuth, if retained for project provisioning, is isolated from the data plane, requests minimum scopes, lets the user select the project, never auto-selects the first project, and discards its token after provisioning unless explicitly required.

## Completion gates

Migration is complete only when all gates pass:

1. Shared TypeScript contracts compile under strict mode, and parser golden fixtures cover Claude, Codex, Antigravity, malformed records, append, genuine truncation, subagents, and interruption.
2. Reprocessing identical bytes is idempotent; append preserves IDs and adds only new semantic records; truncation removes absent records; rejected unstable snapshots do not mutate storage.
3. The packaged app starts and displays data with Python absent, port 3030 occupied, and all network interfaces monitored to confirm no localhost server dependency.
4. No production code spawns Python or `sqlite3`; no renderer code accesses Node, filesystem paths, database handles, or cloud/OAuth secrets.
5. Legacy migration is idempotent, preserves a backup, labels uncertain data, and reconciles verified rescans without token inflation.
6. Offline collection/query and restart recovery pass; sync retry/tombstone/conflict tests pass.
7. Supabase RLS cross-tenant negative tests pass for owner/member/device/revoked identities; public-all policies are absent.
8. PKCE state/replay/wrong-callback tests and pairing expiry/replay/rate-limit/revocation tests pass; secrets are absent from logs and renderer state.
9. Static export assets, deep links, navigation allowlists, CSP, macOS/Windows packaging, and signed build smoke tests pass.

## Consequences

The desktop build no longer needs Python, a localhost Next server, or the `sqlite3` CLI. Parser and persistence work becomes testable with deterministic snapshots and atomic replacement. Electron main gains more responsibility, so runtime validation, backpressure, migration discipline, and security tests are mandatory. Cloud schema/RLS must be migrated before enabling member or pairing flows; the current public-all schema is not an acceptable production fallback.
