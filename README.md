# Tok-kie 🐰

Tok-kie is a local-first Electron desktop app for tracking token usage and estimated API costs from local AI coding agents: **Claude Code**, **OpenAI Codex**, and **Google Antigravity**.

[English](README.md) | [한국어](README.ko.md)

[![Electron](https://img.shields.io/badge/Electron-43-47848f?logo=electron)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## What it does

- **Multi-agent parsing**: Reads supported local agent logs and produces complete, repeatable source snapshots.
- **Local-first storage**: Electron main owns the local SQLite database, migrations, source replacement, and offline queries.
- **Desktop dashboard**: A static Next.js renderer is served inside the Electron app through a privileged application scheme.
- **Timeline and interruptions**: Inspect prompts, tool steps, token totals, estimated cost, and interrupted sessions.
- **Legacy migration**: Existing tracker data can be imported once with a read-only backup and an explicit unverified label.
- **Optional cloud sync**: Sync approved usage data to a tenant-scoped Supabase project from the app.

Electron main is the sole authority for filesystem access, SQLite, network sync, OAuth, secure storage, and external navigation. The renderer never receives local paths, database handles, or cloud secrets.

## Quick start

Requirements: Node.js 22.12 or newer and npm 10 or newer. The packaged Electron app carries its own runtime; these versions apply to source installs and builds.

```bash
git clone https://github.com/stich9208/Tok-kie.git
cd Tok-kie

# macOS/Linux
./install.sh
# Windows PowerShell: .\install.ps1
npm run dev
```

`install.sh` installs the Node dependencies and verifies a production build. The development command launches the Electron app and its development renderer together. There is no separate collector process or standalone web-server mode.

To create a distributable desktop package:

```bash
npm run build
npm run dist
```

`npm run dist` creates a universal macOS DMG/ZIP. Platform-specific commands are
`npm run dist:mac:arm64`, `npm run dist:mac:x64`, and `npm run dist:win`.
Windows packaging uses NSIS and ZIP targets. Release CI requires separate
`MAC_CSC_LINK`/`MAC_CSC_KEY_PASSWORD` and
`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` secrets, plus Apple notarization
credentials. It verifies codesign, Gatekeeper, notarization staples, and
Authenticode before publishing. Local packages remain unsigned.

The historical `start_dashboard.sh` entry point remains as a compatibility wrapper and starts the Electron development flow.

## Supabase cloud sync

Cloud sync is optional. Enable anonymous sign-ins in the target Supabase
project, open Tok-kie's cloud settings, and enter only the project URL and its
publishable (or legacy anon) key. Main generates a short-lived 256-bit proof
and returns one copyable SQL block containing the checked-in schema and only
the proof's SHA-256 digest. Run that block in Supabase SQL Editor, then confirm
once in the app before it expires.

The raw proof, Auth access/refresh tokens, service-role keys, PATs, database
passwords, and OAuth client secrets never cross renderer IPC. The refresh
session is encrypted through the operating-system secure store. A distributor
may additionally register the `tokkie://oauth/callback` management OAuth/PKCE
flow and provide `TOKKIE_SUPABASE_OAUTH_CLIENT_ID`; manual digest setup remains
the no-client-secret fallback.

Mobile pairing additionally needs a deployed HTTPS copy of the static web
viewer (`NEXT_PUBLIC_WEB_APP_URL`) configured with the exact same
`NEXT_PUBLIC_SUPABASE_URL` and publishable/anon key. The permanent project key
is never embedded in QR v2; the QR carries only routing data and a single-use
claim that expires in five minutes. A paired web session persists and refreshes
until the owner revokes it, and access still requires owner approval.

## Supported sources

| Agent | Local source | Notes |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude/projects/*/*.jsonl` | Prompts, tool results, tokens, and interruptions |
| **OpenAI Codex** | `~/.codex/state_5.sqlite` | Conversations and subagent relationships |
| **Google Antigravity** | `~/.gemini/antigravity/brain/*` | Transcript and task-step hierarchy |

## Development commands

```bash
./install.sh  # install both locked dependency trees and verify a build
npm run dev   # launch the Electron development app
npm run build # build the static renderer and Electron main process
npm run dist  # build a distributable package
npm run smoke # local: static package/build checks only (never launches the app)
```

The root and `dashboard` applications have separate lockfiles. A clean setup
installs both with `npm ci`; `install.sh` and `install.ps1` perform both steps.
`start_dashboard.sh` and `start_dashboard.ps1` are compatibility entry points
for `npm run dev`; there is no standalone web-server or Python collector.

Pull requests run type checking, linting, dashboard/Electron builds, unit tests,
and the Supabase PostgreSQL security contract in GitHub Actions.
Launching the packaged binary for port-independence, deep-link and restart
checks is explicitly opted in only on isolated CI/VM runners.

## License

[MIT](LICENSE)
