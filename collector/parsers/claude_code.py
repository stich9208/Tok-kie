import json
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from collector.parsers.base import BaseAgentParser
from collector.tokenizer import count_tokens, estimate_cost

class ClaudeCodeParser(BaseAgentParser):
    def __init__(self):
        super().__init__(agent_type="claude_code")

    def can_handle(self, file_path: str) -> bool:
        p = Path(file_path)
        ignored_patterns = [
            "node_modules", "package.json", "package-lock.json", "tsconfig.json",
            "plugin.json", ".tmp", ".git", "telemetry", "backups", "skills",
            "settings.json", "stats-cache.json", "policy-limits.json", "history.jsonl",
            "subagents"
        ]
        if any(pat in file_path for pat in ignored_patterns):
            return False
        return (".claude" in file_path or "claude" in file_path.lower()) and p.suffix == ".jsonl" and "projects" in file_path

    def _extract_session_id(self, file_path: str) -> str:
        return Path(file_path).stem

    def parse_incremental(self, file_path: str, start_offset: int) -> Tuple[int, List[Dict[str, Any]], Optional[Dict[str, Any]]]:
        session_id = self._extract_session_id(file_path)
        p = Path(file_path)
        if not p.exists():
            return start_offset, [], None

        raw_entries = []
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line_str = line.strip()
                if line_str:
                    try:
                        raw_entries.append(json.loads(line_str))
                    except Exception:
                        pass

        if not raw_entries:
            return p.stat().st_size, [], None

        ai_title = None
        workspace = None
        started_at = None
        model_name = "claude-3-7-sonnet"

        turns: List[Dict[str, Any]] = []
        current_turn: Optional[Dict[str, Any]] = None
        processed_msg_ids = set()

        for entry in raw_entries:
            entry_type = entry.get("type")
            ts = entry.get("timestamp") or datetime.now(timezone.utc).isoformat()
            if not started_at and entry.get("timestamp"):
                started_at = entry.get("timestamp")
            if not workspace and entry.get("cwd"):
                workspace = entry.get("cwd")
            if entry.get("aiTitle"):
                ai_title = entry.get("aiTitle")

            entry_str = json.dumps(entry, ensure_ascii=False)
            has_interrupt = ("[Request interrupted by user]" in entry_str or '"error": "interrupted"' in entry_str or entry.get("error") == "interrupted")

            # 1. User Prompt (exclude tool results)
            if entry_type == "user":
                msg = entry.get("message", {})
                content = msg.get("content", "") if isinstance(msg, dict) else entry.get("content", "")
                user_text = ""
                is_tool_result = False

                if isinstance(content, str):
                    if "[Request interrupted by user]" in content:
                        has_interrupt = True
                        content = content.replace("[Request interrupted by user]", "").strip()
                    user_text = content.strip()
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict):
                            if block.get("type") == "tool_result":
                                is_tool_result = True
                            elif block.get("type") == "text":
                                txt = block.get("text", "")
                                if "[Request interrupted by user]" in txt:
                                    has_interrupt = True
                                else:
                                    user_text += " " + txt
                    user_text = user_text.strip()

                if user_text and not is_tool_result:
                    if current_turn:
                        turns.append(current_turn)
                    current_turn = {
                        "turn_index": len(turns) + 1,
                        "user_prompt": user_text,
                        "tools": [],
                        "assistant_responses": [],
                        "is_interrupted": has_interrupt,
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "timestamp": ts
                    }
                elif has_interrupt and current_turn:
                    current_turn["is_interrupted"] = True

            # 2. Assistant Response & Tools & Usage
            elif entry_type == "assistant":
                if not current_turn:
                    current_turn = {
                        "turn_index": 1,
                        "user_prompt": "초기 작업 지시",
                        "tools": [],
                        "assistant_responses": [],
                        "is_interrupted": False,
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "timestamp": ts
                    }

                if has_interrupt:
                    current_turn["is_interrupted"] = True

                msg = entry.get("message", {})
                if isinstance(msg, dict):
                    raw_model = msg.get("model")
                    if raw_model and raw_model != "<synthetic>" and not raw_model.startswith("<"):
                        model_name = raw_model

                    # Usage handling with deduplication
                    msg_uuid = entry.get("uuid") or f"{ts}_{len(current_turn['assistant_responses'])}"
                    usage = msg.get("usage", {})
                    if usage and msg_uuid not in processed_msg_ids:
                        processed_msg_ids.add(msg_uuid)
                        p_tok = usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) + usage.get("cache_read_input_tokens", 0)
                        c_tok = usage.get("output_tokens", 0)
                        current_turn["prompt_tokens"] += p_tok
                        current_turn["completion_tokens"] += c_tok

                    content = msg.get("content", [])
                    if isinstance(content, str) and content.strip():
                        current_turn["assistant_responses"].append(content.strip())
                    elif isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict):
                                b_type = block.get("type")
                                if b_type == "text" and block.get("text", "").strip():
                                    current_turn["assistant_responses"].append(block.get("text").strip())
                                elif b_type == "tool_use":
                                    tool_name = block.get("name", "Tool")
                                    inp = block.get("input", {})
                                    desc = inp.get("command") or inp.get("path") or inp.get("description") or ""
                                    current_turn["tools"].append(f"{tool_name} ({desc[:30]})" if desc else tool_name)

        if current_turn:
            turns.append(current_turn)

        if not turns:
            return p.stat().st_size, [], None

        # Check session-level interruption: only if the last turn was interrupted or the session ended with interrupt
        last_entries_str = " ".join([json.dumps(e, ensure_ascii=False) for e in raw_entries[-4:]])
        session_is_interrupted = ("[Request interrupted by user]" in last_entries_str or turns[-1].get("is_interrupted", False))

        first_prompt_title = turns[0]["user_prompt"].split("\n")[0][:60] if turns else ""
        session_title = ai_title or first_prompt_title or f"Claude Code 세션 ({session_id[:8]})"

        steps: List[Dict[str, Any]] = []
        total_p = 0
        total_c = 0

        for idx, t in enumerate(turns):
            t_prompt = t["prompt_tokens"]
            t_comp = t["completion_tokens"]
            total_p += t_prompt
            total_c += t_comp

            t_interrupted = t.get("is_interrupted", False)
            tool_text = f"🛠️ 실행된 도구: {', '.join(t['tools'][:4])}" if t["tools"] else ""
            resp_summary = "\n\n".join(t["assistant_responses"][:2]) if t["assistant_responses"] else "작업 완료"

            full_preview = f"**[사용자 지시]**\n{t['user_prompt']}\n\n"
            if tool_text:
                full_preview += f"{tool_text}\n\n"
            full_preview += f"**[작업 내용 및 결과]**\n{resp_summary}"

            steps.append({
                "id": f"{session_id}_turn_{t['turn_index']}",
                "session_id": session_id,
                "step_index": t["turn_index"],
                "source": "turn",
                "action_type": "interrupted" if t_interrupted else "task_turn",
                "prompt_tokens": t_prompt,
                "completion_tokens": t_comp,
                "total_tokens": t_prompt + t_comp,
                "preview_text": full_preview,
                "timestamp": t["timestamp"],
                "metadata": {
                    "model": model_name,
                    "tool_count": len(t["tools"]),
                    "tools": t["tools"][:5],
                    "is_interrupted": t_interrupted
                }
            })

        cost = estimate_cost(total_p, total_c, model_name)
        session_update = {
            "id": session_id,
            "agent_type": self.agent_type,
            "model_name": model_name,
            "title": session_title,
            "status": "interrupted" if session_is_interrupted else "completed",
            "is_interrupted": session_is_interrupted,
            "started_at": started_at or datetime.now(timezone.utc).isoformat(),
            "delta_prompt_tokens": total_p,
            "delta_completion_tokens": total_c,
            "delta_cost_usd": cost,
            "total_prompt_tokens": total_p,
            "total_completion_tokens": total_c,
            "total_tokens": total_p + total_c,
            "estimated_cost_usd": cost,
            "metadata": {
                "workspace": workspace,
                "status": "interrupted" if session_is_interrupted else "completed",
                "is_interrupted": session_is_interrupted
            }
        }

        return p.stat().st_size, steps, session_update
