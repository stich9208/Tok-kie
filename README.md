# Tok-kie 🐰

A friendly, local-first dashboard to track token usage and estimated API costs from local AI coding agents (**Claude Code**, **OpenAI Codex**, and **Google Antigravity**).

[English](README.md) | [한국어](README.ko.md)

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.9+-yellow?logo=python)](https://python.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Background

I built **Tok-kie** because I use multiple AI coding agents daily across different MacBooks, and it was hard to answer basic questions:
- *How many tokens did I burn across Claude Code and Codex today?*
- *How much is this costing in API credits?*
- *Which specific subtask or loop consumed 80% of the session's tokens?*
- *Did my prompt finish properly, or did I interrupt it with `Ctrl+C`?*

Tok-kie runs a tiny background watcher on your Mac that parses local log files as you code and renders everything in a clean Next.js dashboard.

---

## Features

- **Multi-Agent Log Parsing**:
  - **Claude Code**: Parses `~/.claude/projects/*/*.jsonl` session files, extracts clean titles, separates tool outputs from human prompts, and filters out synthetic system messages.
  - **OpenAI Codex**: Parses `~/.codex/state_5.sqlite` and rollout jsonl files, groups subagents under their parent conversations, and detects natural language questions from code snippets.
  - **Google Antigravity**: Parses `transcript.jsonl` files and step hierarchies.
- **macOS Menu Bar Desktop App**: Runs natively in your Mac menu bar tray (`🐰 Tok-kie`) with global hotkey (`Cmd+Shift+T`) and auto-managed collector daemon.
- **Zero-Knowledge Mobile QR Pairing**: Instant 1-second pairing with your iPhone via QR code — no signups, $0 server cost, and direct client-to-DB sync.
- **Interruption Detection**: Detects user cancellations (`[Request interrupted by user]`, `CANCELLED`) and marks sessions with an `Interrupted` badge so you can distinguish incomplete runs.
- **Task Timeline View**: Click any conversation to inspect prompt-by-prompt token consumption, tool executions, and step receipts.
- **Multi-Account Auto-Detection**: Automatically detects git repository configurations and user emails to separate and aggregate usage across multiple accounts without manual tagging.
- **Zero Config Offline Mode**: Uses a local SQLite database by default. No cloud setup required.
- **Optional Cloud Sync**: Can sync to a free Supabase instance so you can view your dashboard on mobile or other machines via Vercel.

---

## Quick Start (Local Setup)

### 1. Run as Native macOS Desktop App (Electron)
```bash
git clone https://github.com/stich9208/Tok-kie.git
cd Tok-kie

npm install
npm run dev
```
* The persistent **Tok-kie 🐰** menu bar icon will appear in the macOS top bar, and the collector daemon will start automatically!
* Press **`Cmd + Shift + T`** anywhere to toggle the dashboard window.

---

### 2. Run in Terminal & Web Browser
```bash
chmod +x install.sh start_dashboard.sh uninstall.sh
./install.sh
./start_dashboard.sh
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## Optional: Free Cloud Deployment (Supabase + Vercel)

If you want to view your token usage on your phone or from another laptop:

1. **Create a free Supabase project**:
   - Create a project on [supabase.com](https://supabase.com).
   - In Supabase SQL Editor, run the script in `supabase/schema.sql`.
   - Copy your `Project URL` and `anon key` from **Project Settings > API**.

2. **Connect Supabase to Tok-kie**:
   Run the interactive setup script:
   ```bash
   ./setup_supabase.sh
   ```
   *(Or simply click the **"Supabase 연동"** button inside the web dashboard to configure via UI)*

3. **Deploy the dashboard to Vercel**:
   - Push your repo to GitHub and import it on [Vercel](https://vercel.com).
   - Set **Root Directory** to `dashboard`.
   - Add environment variables:
     - `NEXT_PUBLIC_SUPABASE_URL`: `https://your-id.supabase.co`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: `your-anon-key`
   - Deploy.

---

## CLI Commands

You can interact with the background collector directly:

```bash
# Check collector status and active log paths
python3 collector/main.py status

# Force an immediate rescan of all agent logs
python3 collector/main.py scan

# Update device name
python3 collector/main.py config --device "MacBook Pro 16"
```

---

## Supported Agents & Log Sources

The collector extracts input/output tokens from local log files and calculates estimated costs based on standard API pricing for each model (Claude, GPT, Gemini, etc.):

| Agent | Log Path | Notes |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude/projects/*/*.jsonl` | Captures prompts, tool results, tokens, and user interruptions |
| **OpenAI Codex** | `~/.codex/state_5.sqlite`, `~/.codex/archived_sessions/*.jsonl` | Tracks conversation threads and spawned subagents |
| **Google Antigravity** | `~/.gemini/antigravity/brain/*` | Captures full task execution trees and multi-step turns |

---

## License

[MIT](LICENSE)
