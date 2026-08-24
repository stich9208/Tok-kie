import time
import threading
from pathlib import Path
from typing import List, Set, Dict
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from collector.config import config
from collector.db_client import db_client
from collector.parsers import get_parser_for_file
from collector.account_detector import detect_account_info

class LogFileHandler(FileSystemEventHandler):
    def __init__(self):
        super().__init__()
        self._debounce_lock = threading.Lock()
        self._pending_files: Dict[str, float] = {}
        self._last_processed_mtime: Dict[str, float] = {}

    def on_modified(self, event):
        if not event.is_directory:
            self._handle_path(event.src_path)

    def on_created(self, event):
        if not event.is_directory:
            self._handle_path(event.src_path)

    def _handle_path(self, file_path: str):
        # Ignore non-target / heavy system files
        p_name = Path(file_path).name
        if p_name.endswith((".log", ".tmp", ".err", "-journal", "-wal", "-shm", ".DS_Store")):
            return
        if "transcript_full.jsonl" in p_name:
            return

        parser = get_parser_for_file(file_path)
        if not parser:
            return

        with self._debounce_lock:
            # Debounce by recording event timestamp
            self._pending_files[file_path] = time.time()

    def process_pending(self):
        now = time.time()
        to_process = []

        with self._debounce_lock:
            if not self._pending_files:
                return
            
            # Only process files that haven't changed in the last 1.5 seconds (cool-down debounce)
            ready_files = [f for f, t in self._pending_files.items() if now - t >= 1.5]
            for f in ready_files:
                del self._pending_files[f]
                to_process.append(f)

        for file_path in to_process:
            self.process_single_file(file_path)

    def process_single_file(self, file_path: str):
        p = Path(file_path)
        if not p.exists():
            return

        # Skip if file mtime hasn't changed since last successful parse
        try:
            mtime = p.stat().st_mtime
            if self._last_processed_mtime.get(file_path) == mtime:
                return
        except Exception:
            pass

        parser = get_parser_for_file(file_path)
        if not parser:
            return

        last_offset = db_client.get_file_offset(file_path)
        try:
            new_offset, steps, session_data = parser.parse_incremental(file_path, last_offset)

            # Detect user account info
            workspace_hint = None
            if session_data and "metadata" in session_data:
                workspace_hint = session_data["metadata"].get("workspace")
            user_email, account_type = detect_account_info(file_path, parser.agent_type, workspace_hint)
            
            if steps:
                for step in steps:
                    step.setdefault("user_email", user_email)
                    step.setdefault("account_type", account_type)
                    db_client.insert_step(step)

            if session_data:
                session_data.setdefault("user_email", user_email)
                session_data.setdefault("account_type", account_type)

                delta_prompt = session_data.get("delta_prompt_tokens", session_data.get("total_prompt_tokens", 0))
                delta_completion = session_data.get("delta_completion_tokens", session_data.get("total_completion_tokens", 0))
                delta_cost = session_data.get("delta_cost_usd", session_data.get("estimated_cost_usd", 0.0))

                cumulative = db_client.update_cumulative_tokens(
                    session_id=session_data["id"],
                    delta_prompt=delta_prompt,
                    delta_completion=delta_completion,
                    delta_cost=delta_cost
                )
                session_data.update(cumulative)
                db_client.upsert_session(session_data)

            if new_offset != last_offset:
                db_client.set_file_offset(file_path, new_offset)

            # Record successfully processed mtime
            try:
                self._last_processed_mtime[file_path] = p.stat().st_mtime
            except Exception:
                pass

        except Exception as e:
            print(f"[Error] Failed to process {file_path}: {e}")

class LogWatcherService:
    def __init__(self):
        self.observer = Observer()
        self.handler = LogFileHandler()
        self._running = False

    def scan_all_existing(self):
        """1회 경량 전체 스캔 (불필요한 파일/디렉터리 제외)"""
        print("[Scanner] Performing lightweight initial scan of agent logs...")
        ignored_names = {"node_modules", ".git", ".venv", "subagents", "telemetry", "backups", "skills", ".system_generated"}

        for agent_name, dir_path in config.log_paths.items():
            p = Path(dir_path).expanduser()
            if not p.exists():
                continue
            
            try:
                for file_path in p.rglob("*"):
                    if not file_path.is_file():
                        continue
                    # Fast skip ignored directories & heavy full transcripts
                    if any(ign in file_path.parts for ign in ignored_names):
                        continue
                    if "transcript_full.jsonl" in file_path.name:
                        continue
                    
                    self.handler.process_single_file(str(file_path))
            except Exception as e:
                print(f"[Scanner] Warning scanning {dir_path}: {e}")
        
        # 1회 동기화 재시도
        if config.is_supabase_configured:
            db_client.retry_pending_sync()
        print("[Scanner] Initial scan complete.")

    def start(self):
        self._running = True
        self.scan_all_existing()

        watched_count = 0
        for agent_name, dir_path in config.log_paths.items():
            p = Path(dir_path).expanduser()
            if p.exists():
                self.observer.schedule(self.handler, str(p), recursive=True)
                watched_count += 1
                print(f"[Watcher] Monitoring [{agent_name}] -> {p}")
            else:
                print(f"[Watcher] Directory not yet created: {p} (will scan when available)")

        self.observer.start()
        print(f"[Watcher] Low-power background service started (Active watchers: {watched_count})")

        sync_counter = 0
        try:
            while self._running:
                time.sleep(1)
                self.handler.process_pending()

                # Retry offline sync only every 30 seconds to minimize CPU & SQLite I/O
                sync_counter += 1
                if sync_counter >= 30:
                    sync_counter = 0
                    if config.is_supabase_configured:
                        db_client.retry_pending_sync()
        except KeyboardInterrupt:
            self.stop()

    def stop(self):
        self._running = False
        self.observer.stop()
        self.observer.join()
        print("[Watcher] Service stopped.")
