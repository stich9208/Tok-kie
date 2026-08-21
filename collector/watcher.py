import time
import threading
from pathlib import Path
from typing import List, Set
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
        self._pending_files: Set[str] = set()

    def on_modified(self, event):
        if not event.is_directory:
            self._handle_path(event.src_path)

    def on_created(self, event):
        if not event.is_directory:
            self._handle_path(event.src_path)

    def _handle_path(self, file_path: str):
        parser = get_parser_for_file(file_path)
        if not parser:
            return

        with self._debounce_lock:
            self._pending_files.add(file_path)

    def process_pending(self):
        with self._debounce_lock:
            if not self._pending_files:
                return
            to_process = list(self._pending_files)
            self._pending_files.clear()

        for file_path in to_process:
            self.process_single_file(file_path)

    def process_single_file(self, file_path: str):
        parser = get_parser_for_file(file_path)
        if not parser:
            return

        last_offset = db_client.get_file_offset(file_path)
        try:
            new_offset, steps, session_data = parser.parse_incremental(file_path, last_offset)

            # 실시간 계정 정보 감지 (Git config -> Agent Auth -> Config default)
            workspace_hint = None
            if session_data and "metadata" in session_data:
                workspace_hint = session_data["metadata"].get("workspace")
            user_email, account_type = detect_account_info(file_path, parser.agent_type, workspace_hint)
            
            if steps:
                print(f"[Watcher] Captured {len(steps)} new steps from {Path(file_path).name} (Account: {user_email} [{account_type}])")
                for step in steps:
                    step.setdefault("user_email", user_email)
                    step.setdefault("account_type", account_type)
                    db_client.insert_step(step)

            if session_data:
                session_data.setdefault("user_email", user_email)
                session_data.setdefault("account_type", account_type)

                # Delta tokens in this parse chunk
                delta_prompt = session_data.get("delta_prompt_tokens", session_data.get("total_prompt_tokens", 0))
                delta_completion = session_data.get("delta_completion_tokens", session_data.get("total_completion_tokens", 0))
                delta_cost = session_data.get("delta_cost_usd", session_data.get("estimated_cost_usd", 0.0))

                # Update cumulative totals in DB
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

        except Exception as e:
            print(f"[Error] Failed to process {file_path}: {e}")

class LogWatcherService:
    def __init__(self):
        self.observer = Observer()
        self.handler = LogFileHandler()
        self._running = False

    def scan_all_existing(self):
        """기존 디렉터리 내 모든 로그 파일을 1회 전체 스캔"""
        print("[Scanner] Performing initial scan of agent log directories...")
        for agent_name, dir_path in config.log_paths.items():
            p = Path(dir_path).expanduser()
            if not p.exists():
                continue
            
            for file_path in p.rglob("*"):
                if file_path.is_file():
                    self.handler.process_single_file(str(file_path))
        
        # 오프라인 큐 재시도
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
        print(f"[Watcher] Service started on device: '{config.device_name}' (Active watchers: {watched_count})")

        try:
            while self._running:
                time.sleep(1)
                self.handler.process_pending()
                # 주기적으로 오프라인 대기 큐 동기화 재시도
                db_client.retry_pending_sync()
        except KeyboardInterrupt:
            self.stop()

    def stop(self):
        self._running = False
        self.observer.stop()
        self.observer.join()
        print("[Watcher] Service stopped.")
