import json
import re
import sqlite3
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from collector.parsers.base import BaseAgentParser
from collector.tokenizer import count_tokens, estimate_cost
from collector.db_client import db_client
from collector.account_detector import detect_account_info

class CodexParser(BaseAgentParser):
    def __init__(self):
        super().__init__(agent_type="codex")

    def can_handle(self, file_path: str) -> bool:
        p = Path(file_path)
        return p.name == "state_5.sqlite" and ".codex" in file_path

    def _clean_text(self, text: str) -> str:
        if not text:
            return ""
        cleaned = re.sub(r'<multi_agent_mode>.*?</multi_agent_mode>', '', text, flags=re.DOTALL)
        cleaned = re.sub(r'<[^>]+>', '', cleaned).strip()
        return cleaned

    def _is_internal_system_message(self, text: str, source_raw: str) -> bool:
        if "guardian" in source_raw:
            return True
        if "APPROVAL REQUEST" in text or "TRANSCRIPT END" in text or "tool exec call" in text:
            return True
        if text.startswith("# AGENTS.md") or text.startswith("Here is a list of plugins") or text.startswith("# Files mentioned"):
            return True
    def _extract_smart_title(self, raw_title: str, clean_msg: str) -> str:
        text = clean_msg or raw_title or ""
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        if not lines:
            return "Codex 대화"

        # 1. Prioritize Korean natural language instructions (since user asks in Korean)
        korean_lines = [l for l in lines if re.search(r'[가-힣]', l) and len(l) >= 2]
        if korean_lines:
            for kl in korean_lines:
                if any(kw in kl for kw in ["해줘", "설명", "수정", "추가", "작성", "어떻게", "?", "확인", "검토", "리팩토링", "만들어", "알려줘"]):
                    return kl[:70]
            return korean_lines[-1][:70]

        # 2. Search for English questions/instructions
        english_qa_lines = [l for l in lines if re.search(r'\b(how|what|why|explain|please|fix|refactor|create|generate|show|can you)\b', l, re.IGNORECASE)]
        if english_qa_lines:
            return english_qa_lines[0][:70]

        # 3. Fallback for pure code
        clean_first = re.sub(r'[^\w\s]', ' ', lines[0]).strip()
        clean_first = " ".join(clean_first.split())
        return f"코드 작업: {clean_first[:50]}"

    def parse_incremental(self, file_path: str, start_offset: int) -> Tuple[int, List[Dict[str, Any]], Optional[Dict[str, Any]]]:
        p = Path(file_path)
        if not p.exists():
            return start_offset, [], None

        try:
            conn = sqlite3.connect(f"file:{file_path}?mode=ro", uri=True)
            cur = conn.cursor()

            # Fetch all threads including rollout_path
            cur.execute("""
                SELECT id, title, first_user_message, source, tokens_used, model, created_at, agent_nickname, agent_role, rollout_path
                FROM threads
                WHERE tokens_used > 0
                ORDER BY created_at ASC
            """)
            all_threads = cur.fetchall()
            conn.close()

            root_sessions: Dict[str, Dict[str, Any]] = {}
            child_tasks: Dict[str, List[Dict[str, Any]]] = {}

            # 1. First pass: Identify human root conversations
            for row in all_threads:
                t_id, title, first_msg, source_raw, tokens_used, model, created_at, agent_name, agent_role, rollout_path = row

                parent_id = None
                subagent_info = None
                try:
                    if "subagent" in source_raw:
                        src_obj = json.loads(source_raw)
                        spawn_info = src_obj.get("subagent", {}).get("thread_spawn", {})
                        parent_id = spawn_info.get("parent_thread_id")
                        subagent_info = {
                            "nickname": spawn_info.get("agent_nickname") or agent_name or "서브에이전트",
                            "path": spawn_info.get("agent_path", ""),
                            "depth": spawn_info.get("depth", 1)
                        }
                except Exception:
                    pass

                clean_msg = self._clean_text(first_msg)
                is_internal = self._is_internal_system_message(clean_msg, source_raw)

                if not parent_id and not is_internal and clean_msg and len(clean_msg) > 1:
                    # Real root human conversation
                    started_iso = datetime.fromtimestamp(created_at, timezone.utc).isoformat() if created_at else datetime.now(timezone.utc).isoformat()
                    model_name = model or "gpt-4o"
                    
                    # Extract smart title prioritizing human intent
                    clean_title = self._extract_smart_title(title, clean_msg)

                    # Check interruption from rollout file if available
                    is_interrupted = False
                    if rollout_path and Path(rollout_path).exists():
                        try:
                            with open(rollout_path, "r", encoding="utf-8", errors="ignore") as rfp:
                                r_lines = rfp.readlines()
                                if r_lines:
                                    last_str = "".join(r_lines[-4:]).lower()
                                    if "interrupt" in last_str or "cancel" in last_str or "abort" in last_str:
                                        is_interrupted = True
                        except Exception:
                            pass

                    root_sessions[t_id] = {
                        "id": f"codex_{t_id}",
                        "raw_id": t_id,
                        "agent_type": self.agent_type,
                        "model_name": model_name,
                        "title": clean_title,
                        "status": "interrupted" if is_interrupted else "completed",
                        "is_interrupted": is_interrupted,
                        "started_at": started_iso,
                        "first_message": clean_msg,
                        "total_tokens": tokens_used,
                        "prompt_tokens": int(tokens_used * 0.72),
                        "completion_tokens": int(tokens_used * 0.28),
                        "tasks": []
                    }
                    
                    task_res = "AI 작업 진행 중 사용자에 의해 취소/중단되었습니다." if is_interrupted else f"메인 에이전트 작업 수행 완료 ({tokens_used:,} 토큰 소모)"
                    preview_str = f"**[사용자 지시]**\n{clean_msg}\n\n**[작업 내용 및 결과]**\n{task_res}"

                    root_sessions[t_id]["tasks"].append({
                        "id": f"codex_{t_id}_task_1",
                        "session_id": f"codex_{t_id}",
                        "step_index": 1,
                        "source": "turn",
                        "action_type": "interrupted" if is_interrupted else "task_turn",
                        "prompt_tokens": int(tokens_used * 0.72),
                        "completion_tokens": int(tokens_used * 0.28),
                        "total_tokens": tokens_used,
                        "preview_text": preview_str,
                        "timestamp": started_iso,
                        "metadata": {"task_name": "메인 대화 작업", "is_interrupted": is_interrupted}
                    })
                elif parent_id:
                    child_tasks.setdefault(parent_id, []).append({
                        "id": t_id,
                        "tokens_used": tokens_used,
                        "prompt_tokens": int(tokens_used * 0.72),
                        "completion_tokens": int(tokens_used * 0.28),
                        "subagent_info": subagent_info or {"nickname": agent_name or "서브태스크", "path": ""},
                        "title": title or clean_msg.split("\n")[0][:60],
                        "message": clean_msg,
                        "created_at": created_at
                    })

            # 2. Second pass: Link child subagents to parent conversations
            all_steps: List[Dict[str, Any]] = []

            for root_id, sess in root_sessions.items():
                children = child_tasks.get(root_id, [])
                
                for idx, ch in enumerate(children, start=2):
                    ch_tokens = ch["tokens_used"]
                    ch_info = ch["subagent_info"]
                    ch_name = ch_info.get("nickname") or f"서브태스크 #{idx-1}"
                    ch_path = ch_info.get("path") or ""
                    
                    sess["total_tokens"] += ch_tokens
                    sess["prompt_tokens"] += ch["prompt_tokens"]
                    sess["completion_tokens"] += ch["completion_tokens"]
                    
                    task_preview = f"**[서브에이전트 작업: {ch_name}]** ({ch_path})\n"
                    if ch["title"] and not self._is_internal_system_message(ch["title"], ""):
                        task_preview += f"**[작업 지시]** {ch['title']}\n\n"
                    task_preview += f"**[작업 결과]** {ch_name} 에이전트 하위 작업 수행 완료 ({ch_tokens:,} 토큰)"

                    ch_time = datetime.fromtimestamp(ch["created_at"], timezone.utc).isoformat() if ch["created_at"] else sess["started_at"]

                    sess["tasks"].append({
                        "id": f"codex_{root_id}_task_{idx}",
                        "session_id": f"codex_{root_id}",
                        "step_index": idx,
                        "source": "turn",
                        "action_type": "task_turn",
                        "prompt_tokens": ch["prompt_tokens"],
                        "completion_tokens": ch["completion_tokens"],
                        "total_tokens": ch_tokens,
                        "preview_text": task_preview,
                        "timestamp": ch_time,
                        "metadata": {"subagent": ch_name, "path": ch_path}
                    })

                cost = estimate_cost(sess["prompt_tokens"], sess["completion_tokens"], sess["model_name"])
                user_email, account_type = detect_account_info(file_path, "codex")
                
                session_record = {
                    "id": sess["id"],
                    "agent_type": sess["agent_type"],
                    "model_name": sess["model_name"],
                    "title": sess["title"],
                    "status": sess.get("status", "completed"),
                    "is_interrupted": sess.get("is_interrupted", False),
                    "started_at": sess["started_at"],
                    "user_email": user_email,
                    "account_type": account_type,
                    "total_prompt_tokens": sess["prompt_tokens"],
                    "total_completion_tokens": sess["completion_tokens"],
                    "total_tokens": sess["total_tokens"],
                    "estimated_cost_usd": cost,
                    "metadata": {
                        "status": sess.get("status", "completed"),
                        "is_interrupted": sess.get("is_interrupted", False)
                    }
                }
                db_client.upsert_session(session_record)

                for t in sess["tasks"]:
                    t["user_email"] = user_email
                    t["account_type"] = account_type
                    db_client.insert_step(t)
                    all_steps.append(t)

            print(f"[CodexParser] Successfully imported {len(root_sessions)} pure human conversations with {len(all_steps)} total subtasks!")
            return p.stat().st_size, all_steps, None

        except Exception as e:
            print(f"[Codex SQLite Parser Error] {e}")
            return start_offset, [], None
