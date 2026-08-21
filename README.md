# 🔍 Agent Token Lens (Unified AI Coding Agent Tracker)

> **Zero-overhead, real-time token & cost analytics for local AI coding agents: Claude Code, OpenAI Codex, and Google Antigravity.**

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.9+-yellow?logo=python)](https://python.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38bdf8?logo=tailwind-css)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ecf8e?logo=supabase)](https://supabase.com/)
[![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-blue?logo=apple)](#)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 🌟 Why Agent Token Lens?

As developers increasingly rely on autonomous AI coding agents like **Claude Code**, **OpenAI Codex**, and **Google Antigravity**, tracking actual token usage, model pricing, and productivity across multiple projects and machines becomes critical.

**Agent Token Lens** automatically monitors local agent log directories in real-time, extracts genuine human conversation threads, separates subagents, detects interrupted sessions, and presents them in an elegant, interactive dashboard.

---

## ✨ Key Features

### 1. 🤖 Multi-Agent Native Support
* **Claude Code**: Extracts clean `aiTitle` headers, parses multi-turn interactive CLI sessions, separates `tool_result` events from user inputs, and ignores `<synthetic>` artifacts.
* **OpenAI Codex**: Parses `~/.codex/state_5.sqlite` and rollout archives, hierarchically links spawned subagents to root human tasks, and smart-extracts natural language intents from code blocks.
* **Google Antigravity**: Parses `transcript.jsonl` files, capturing full task chains and subagent execution trees.

### 2. ⚡ Zero-Overhead Background Daemon
* Uses macOS kernel file system events (`FSEvents` / `watchdog`) + periodic 10s scans to capture token changes with near-zero CPU and memory usage (< 15MB RAM).
* Auto-reconnects and syncs offline events seamlessly.

### 3. 🎯 Multi-Account & Workspace Auto-Detection
* Automatically detects user email and git repository configurations to categorize usage into **Company/Work** vs. **Personal** accounts without manual labeling.
* Filter by **Device**, **Account**, and **Agent** simultaneously.

### 4. 🧵 Vertical Timeline & Interruption Detection
* **Visual Task Chain**: Inspect multi-step conversations with vertical gradient threads and node badges.
* **Interruption Tracking**: Detects user-aborted sessions (`[Request interrupted by user]`, `CANCELLED`) and highlights them with distinct `🛑 Interrupted` status badges.

### 5. 🔒 Offline-First or Cloud-Synced (100% Free)
* **Local Offline Mode**: Works out-of-the-box with a lightweight local SQLite database.
* **Supabase Cloud Sync (Optional)**: Free-tier PostgreSQL sync with real-time WebSockets to monitor token usage from your phone or any browser via Vercel.

---

## 📁 Repository Structure

```text
agent-token-tracker/
├── collector/                 # Python background log collector daemon
│   ├── main.py                # CLI commands (start, scan, status, config)
│   ├── watcher.py             # FSEvents background file system monitor
│   ├── tokenizer.py           # Model pricing and token counter
│   ├── db_client.py           # Supabase sync & offline SQLite buffer
│   ├── account_detector.py    # Auto-detection of email & work domains
│   └── parsers/               # Agent parsers (Claude Code, Codex, Antigravity)
├── dashboard/                 # Next.js 14 Web Dashboard
│   ├── app/                   # App Router pages & local data API
│   ├── components/            # KPI cards, charts, session table, timeline modal
│   └── lib/                   # Supabase client, types, formatters
├── supabase/
│   └── schema.sql             # One-click PostgreSQL schema & analytics views
├── install.sh                 # macOS one-click installer & launchd service setup
├── start_dashboard.sh         # Local dashboard starter script
└── uninstall.sh               # Service uninstaller
```

---

## 🚀 Quick Start (Local Setup)

### Step 1. Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/agent-token-tracker.git
cd agent-token-tracker
chmod +x install.sh start_dashboard.sh uninstall.sh
./install.sh
```
* The installer sets up the Python virtual environment and registers a background daemon (`launchd`) that auto-starts on login.

### Step 2. Launch the Dashboard
```bash
./start_dashboard.sh
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## ☁️ Cloud Deployment (Supabase + Vercel)

Deploy your dashboard to the cloud for $0/month:

### 1. Set up Free Supabase Database
1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and click **Run**.
3. Copy `Project URL` and `anon key` from **Project Settings > API**.

### 2. Configure Local Collector
```bash
python3 collector/main.py config --supabase-url "https://your-id.supabase.co" --supabase-key "your-anon-key"
python3 collector/main.py scan
```

### 3. Deploy Dashboard to Vercel
1. Import your GitHub repository on [Vercel](https://vercel.com).
2. Set Root Directory to `dashboard`.
3. Add Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://your-id.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: `your-anon-key`
4. Click **Deploy** — your live dashboard is now accessible anywhere!

---

## 🛠️ CLI Utilities

```bash
# Check watcher status and monitored paths
python3 collector/main.py status

# Run an immediate full scan of existing agent logs
python3 collector/main.py scan

# Update device name or Supabase credentials
python3 collector/main.py config --device "MacBook Pro 16"
```

---

## 📊 Supported Agents & Pricing Models

| Agent | Supported Logs | Pricing Engine |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude/projects/*/*.jsonl` | Claude 3.7 Sonnet, Claude 3.5 Haiku, Claude 3 Opus |
| **OpenAI Codex** | `~/.codex/state_5.sqlite`, `archived_sessions/*.jsonl` | GPT-4o, GPT-4o-mini, o1, o3-mini |
| **Google Antigravity** | `~/.gemini/antigravity/brain/*` | Gemini 2.0 Flash, Gemini 2.0 Pro, Gemini 1.5 Pro |

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!  
Feel free to check the [issues page](https://github.com/YOUR_USERNAME/agent-token-tracker/issues).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
