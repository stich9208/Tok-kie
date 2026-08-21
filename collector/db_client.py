import json
import sqlite3
import requests
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from collector.config import config

class DatabaseClient:
    def __init__(self):
        self._init_local_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(config.offline_db_path, timeout=10.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")
        return conn

    def _init_local_db(self):
        """오프라인 백업용 로컬 SQLite 초기화 및 누적 세션 토큰 테이블 생성"""
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pending_sessions (
                id TEXT PRIMARY KEY,
                payload TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pending_steps (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                payload TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS file_offsets (
                file_path TEXT PRIMARY KEY,
                last_offset INTEGER,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS session_cumulative_totals (
                session_id TEXT PRIMARY KEY,
                prompt_tokens INTEGER DEFAULT 0,
                completion_tokens INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0,
                estimated_cost REAL DEFAULT 0.0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        conn.close()

    def get_file_offset(self, file_path: str) -> int:
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("SELECT last_offset FROM file_offsets WHERE file_path = ?", (file_path,))
        row = cur.fetchone()
        conn.close()
        return row[0] if row else 0

    def set_file_offset(self, file_path: str, offset: int):
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO file_offsets (file_path, last_offset, updated_at) 
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(file_path) DO UPDATE SET 
                last_offset = excluded.last_offset, 
                updated_at = datetime('now')
        """, (file_path, offset))
        conn.commit()
        conn.close()

    def update_cumulative_tokens(self, session_id: str, delta_prompt: int, delta_completion: int, delta_cost: float) -> Dict[str, Any]:
        """세션의 누적 토큰을 원자적으로 업데이트하고 총합을 반환합니다."""
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO session_cumulative_totals (session_id, prompt_tokens, completion_tokens, total_tokens, estimated_cost, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(session_id) DO UPDATE SET
                prompt_tokens = prompt_tokens + excluded.prompt_tokens,
                completion_tokens = completion_tokens + excluded.completion_tokens,
                total_tokens = total_tokens + excluded.total_tokens,
                estimated_cost = estimated_cost + excluded.estimated_cost,
                updated_at = datetime('now')
        """, (session_id, delta_prompt, delta_completion, delta_prompt + delta_completion, delta_cost))
        
        cur.execute("SELECT prompt_tokens, completion_tokens, total_tokens, estimated_cost FROM session_cumulative_totals WHERE session_id = ?", (session_id,))
        row = cur.fetchone()
        conn.commit()
        conn.close()

        return {
            "total_prompt_tokens": row[0],
            "total_completion_tokens": row[1],
            "total_tokens": row[2],
            "estimated_cost_usd": round(row[3], 6)
        }

    def _push_session_to_supabase(self, session_data: Dict[str, Any]) -> bool:
        """Supabase에 세션 직접 전송 (큐 조작 없음)"""
        if not config.is_supabase_configured:
            return False
        headers = {
            "apikey": config.supabase_key,
            "Authorization": f"Bearer {config.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }
        url = f"{config.supabase_url.rstrip('/')}/rest/v1/sessions"
        try:
            resp = requests.post(url, headers=headers, json=session_data, timeout=5)
            return resp.status_code in (200, 201, 204)
        except Exception:
            return False

    def _push_step_to_supabase(self, step_data: Dict[str, Any]) -> bool:
        """Supabase에 스텝 직접 전송 (큐 조작 없음)"""
        if not config.is_supabase_configured:
            return False
        headers = {
            "apikey": config.supabase_key,
            "Authorization": f"Bearer {config.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }
        url = f"{config.supabase_url.rstrip('/')}/rest/v1/steps"
        try:
            resp = requests.post(url, headers=headers, json=step_data, timeout=5)
            return resp.status_code in (200, 201, 204)
        except Exception:
            return False

    def upsert_session(self, session_data: Dict[str, Any]) -> bool:
        """세션 메타데이터 및 누적 토큰 총량 업데이트"""
        session_data["device_name"] = config.device_name
        session_data.setdefault("user_email", "unknown")
        session_data.setdefault("account_type", "personal")
        session_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        # 1. Supabase 전송
        if self._push_session_to_supabase(session_data):
            return True

        # 2. 오프라인 큐 보관
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO pending_sessions (id, payload) VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
        """, (session_data["id"], json.dumps(session_data)))
        conn.commit()
        conn.close()
        return False

    def insert_step(self, step_data: Dict[str, Any]) -> bool:
        """세부 스텝(작업) 기록 추가"""
        step_data["device_name"] = config.device_name
        step_data.setdefault("user_email", "unknown")
        step_data.setdefault("account_type", "personal")
        if "timestamp" not in step_data:
            step_data["timestamp"] = datetime.now(timezone.utc).isoformat()

        # 1. Supabase 전송
        if self._push_step_to_supabase(step_data):
            return True

        # 2. 오프라인 큐 보관
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO pending_steps (id, session_id, payload) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
        """, (step_data["id"], step_data["session_id"], json.dumps(step_data)))
        conn.commit()
        conn.close()
        return False

    def retry_pending_sync(self):
        """오프라인에 쌓인 데이터가 있으면 재전송 시도"""
        if not config.is_supabase_configured:
            return

        conn = self._get_connection()
        cur = conn.cursor()
        
        # 1. Pending Sessions
        cur.execute("SELECT id, payload FROM pending_sessions LIMIT 50")
        session_rows = cur.fetchall()
        for session_id, payload in session_rows:
            try:
                data = json.loads(payload)
                if self._push_session_to_supabase(data):
                    cur.execute("DELETE FROM pending_sessions WHERE id = ?", (session_id,))
            except Exception:
                pass

        # 2. Pending Steps
        cur.execute("SELECT id, payload FROM pending_steps LIMIT 100")
        step_rows = cur.fetchall()
        for step_id, payload in step_rows:
            try:
                data = json.loads(payload)
                if self._push_step_to_supabase(data):
                    cur.execute("DELETE FROM pending_steps WHERE id = ?", (step_id,))
            except Exception:
                pass

        conn.commit()
        conn.close()

db_client = DatabaseClient()
