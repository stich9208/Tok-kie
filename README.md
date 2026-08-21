# Agent Token Lens

A lightweight, local-first dashboard to track token usage and estimated API costs from local AI coding agents (**Claude Code**, **OpenAI Codex**, and **Google Antigravity**).

[English](README.md) | [한국어](README.ko.md)

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.9+-yellow?logo=python)](https://python.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Background

I built this tool because I use multiple AI coding agents daily across different MacBooks, and it was hard to answer basic questions:
- *How many tokens did I burn across Claude Code and Codex today?*
- *How much is this costing in API credits?*
- *Which specific subtask or loop consumed 80% of the session's tokens?*
- *Did my prompt finish properly, or did I interrupt it with `Ctrl+C`?*

Agent Token Lens runs a tiny background watcher on your Mac that parses local log files as you code and renders everything in a clean Next.js dashboard.

---

## Features

- **Multi-Agent Support**:
  - **Claude Code**: Parses `~/.claude/projects/*/*.jsonl` session files, extracts clean titles, separates tool outputs from human prompts, and filters out synthetic system messages.
  - **OpenAI Codex**: Parses `~/.codex/state_5.sqlite` and rollout jsonl files, groups subagents under their parent conversations, and detects natural language questions from code snippets.
  - **Google Antigravity**: Parses `transcript.jsonl` files and step hierarchies.
- **Interruption Detection**: Detects user cancellations (`[Request interrupted by user]`, `CANCELLED`) and marks sessions with an `Interrupted` badge so you can distinguish incomplete runs.
- **Task Timeline View**: Click any conversation to inspect prompt-by-prompt token consumption, tool executions, and step receipts.
- **Multi-Account / Workspace Auto-Detection**: Extracts git repository context and user emails to separate company work from personal projects without manual tagging.
- **Zero Config Offline Mode**: Uses a local SQLite database by default. No cloud setup required.
- **Optional Cloud Sync**: Can sync to a free Supabase instance so you can view your dashboard on mobile or other machines via Vercel.

---

## Quick Start (Local Setup)

### 1. Install and Start Background Collector
```bash
git clone https://github.com/YOUR_USERNAME/agent-token-tracker.git
cd agent-token-tracker

chmod +x install.sh start_dashboard.sh uninstall.sh
./install.sh
```

`install.sh` creates a Python virtual environment, installs dependencies, runs an initial scan of your existing logs, and registers a macOS `launchd` background service that starts automatically when you log in.

### 2. Open the Dashboard
```bash
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

2. **Configure your local collector**:
   ```bash
   python3 collector/main.py config --supabase-url "https://your-id.supabase.co" --supabase-key "your-anon-key"
   python3 collector/main.py scan
   ```

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

## Supported Agents & Pricing Models

Pricing is estimated based on standard API rates for input/output tokens:

| Agent | Log Path | Supported Models |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude/projects/*/*.jsonl` | Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus |
| **OpenAI Codex** | `~/.codex/state_5.sqlite` | GPT-4o, GPT-4o-mini, o1, o3-mini, GPT-5 series |
| **Google Antigravity** | `~/.gemini/antigravity/brain/*` | Gemini 2.0 Flash, Gemini 2.0 Pro, Gemini 1.5 Pro |

---

## License

[MIT](LICENSE)
