import json
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from collector.parsers.base import BaseAgentParser
from collector.tokenizer import count_tokens, estimate_cost

class AntigravityParser(BaseAgentParser):
    def __init__(self):
        super().__init__(agent_type="antigravity")

    def can_handle(self, file_path: str) -> bool:
        p = Path(file_path)
        return "antigravity" in file_path and p.name in ("transcript.jsonl", "transcript_full.jsonl")

    def _extract_conversation_id(self, file_path: str) -> str:
        parts = Path(file_path).parts
        if "brain" in parts:
            idx = parts.index("brain")
            if idx + 1 < len(parts):
                return parts[idx + 1]
        return Path(file_path).parent.parent.name

    def _clean_user_content(self, text: str) -> str:
        if not text:
            return ""
        req_match = re.search(r'<USER_REQUEST>(.*?)</USER_REQUEST>', text, flags=re.DOTALL)
        if req_match:
            text = req_match.group(1)
        text = re.sub(r'<ADDITIONAL_METADATA>.*?</ADDITIONAL_METADATA>', '', text, flags=re.DOTALL)
        text = re.sub(r'<USER_SETTINGS_CHANGE>.*?</USER_SETTINGS_CHANGE>', '', text, flags=re.DOTALL)
        text = re.sub(r'<SYSTEM_MESSAGE>.*?</SYSTEM_MESSAGE>', '', text, flags=re.DOTALL)
        text = re.sub(r'<[^>]+>', '', text)
        return text.strip()

    def _extract_tools_summary(self, tool_calls: list) -> List[str]:
        tools = []
        for tc in tool_calls:
            fn = tc.get("name") or tc.get("function", {}).get("name", "tool")
            args = tc.get("args") or tc.get("parameters") or tc.get("function", {}).get("arguments", {})
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    pass
            summary = ""
            if isinstance(args, dict):
                summary = args.get("toolSummary") or args.get("toolAction") or args.get("CommandLine", "")[:30]
            tools.append(f"{fn} ({summary})" if summary else fn)
        return tools

    def parse_incremental(self, file_path: str, start_offset: int) -> Tuple[int, List[Dict[str, Any]], Optional[Dict[str, Any]]]:
        session_id = self._extract_conversation_id(file_path)
        p = Path(file_path)
        if not p.exists():
            return start_offset, [], None

        # Read all entries to form coherent Turn-Level Tasks
        raw_entries = []
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line_str = line.strip()
                if not line_str:
                    continue
                try:
                    raw_entries.append(json.loads(line_str))
                except Exception:
                    continue

        if not raw_entries:
            return p.stat().st_size, [], None

        # Group raw entries into Turns (1 Turn = 1 User Request + AI Tools/Responses)
        turns = []
        current_turn = None
        session_title = None
        started_at = None

        for entry in raw_entries:
            source = entry.get("source", "system").lower()
            content = entry.get("content", "")
            tool_calls = entry.get("tool_calls", [])
            ts = entry.get("timestamp") or datetime.now(timezone.utc).isoformat()
            if not started_at:
                started_at = ts

            if source in ("user", "user_explicit"):
                clean_prompt = self._clean_user_content(content)
                if not clean_prompt:
                    continue
                
                if not session_title:
                    session_title = clean_prompt.split("\n")[0][:70]

                # Start new turn
                if current_turn:
                    turns.append(current_turn)

                p_tok = count_tokens(content, "gemini-2.0-flash")
                current_turn = {
                    "turn_index": len(turns) + 1,
                    "user_prompt": clean_prompt,
                    "tools": [],
                    "assistant_responses": [],
                    "prompt_tokens": p_tok,
                    "completion_tokens": 0,
                    "timestamp": ts
                }
            else:
                # Assistant / Tool step
                if not current_turn:
                    current_turn = {
                        "turn_index": 1,
                        "user_prompt": "초기 지시 및 환경 설정",
                        "tools": [],
                        "assistant_responses": [],
                        "prompt_tokens": 500,
                        "completion_tokens": 0,
                        "timestamp": ts
                    }

                if tool_calls:
                    current_turn["tools"].extend(self._extract_tools_summary(tool_calls))
                
                if content and len(content.strip()) > 0:
                    current_turn["assistant_responses"].append(content.strip())

                # Add completion tokens
                comp_tok = count_tokens(content + " " + json.dumps(tool_calls, ensure_ascii=False), "gemini-2.0-flash")
                current_turn["completion_tokens"] += comp_tok

        if current_turn:
            turns.append(current_turn)

        # Convert turns to DB Steps
        steps: List[Dict[str, Any]] = []
        total_p = 0
        total_c = 0

        for t in turns:
            t_prompt = t["prompt_tokens"]
            t_comp = t["completion_tokens"]
            t_total = t_prompt + t_comp
            total_p += t_prompt
            total_c += t_comp

            # Build a clear human-readable task description
            tool_text = f"🛠️ 실행된 도구: {', '.join(t['tools'][:4])}" if t["tools"] else ""
            resp_summary = "\n\n".join(t["assistant_responses"][:2]) if t["assistant_responses"] else "작업 완료"

            full_preview = f"**[사용자 지시]**\n{t['user_prompt']}\n\n"
            if tool_text:
                full_preview += f"{tool_text}\n\n"
            full_preview += f"**[작업 결과 및 요약]**\n{resp_summary}"

            steps.append({
                "id": f"{session_id}_turn_{t['turn_index']}",
                "session_id": session_id,
                "step_index": t["turn_index"],
                "source": "turn",
                "action_type": "task_turn",
                "prompt_tokens": t_prompt,
                "completion_tokens": t_comp,
                "total_tokens": t_total,
                "preview_text": full_preview,
                "timestamp": t["timestamp"],
                "metadata": {
                    "user_prompt": t["user_prompt"][:200],
                    "tool_count": len(t["tools"]),
                    "tools": t["tools"][:5]
                }
            })

        workspace_path = None
        for entry in raw_entries:
            c = str(entry.get("content", ""))
            ws_match = re.search(r'\[URI\] -> \[CorpusName\]:\s*([^\s\n]+)', c)
            if ws_match:
                workspace_path = ws_match.group(1).strip()
                break
            for tc in entry.get("tool_calls", []):
                args = tc.get("args") or tc.get("parameters") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        pass
                if isinstance(args, dict) and "Cwd" in args:
                    workspace_path = args["Cwd"].strip('"')
                    break
            if workspace_path:
                break

        # Check interruption from last entries
        is_interrupted = False
        for entry in raw_entries[-3:]:
            st = str(entry.get("status", "")).upper()
            typ = str(entry.get("type", "")).upper()
            if st in ("CANCELLED", "INTERRUPTED") or typ in ("INTERRUPT", "CANCEL", "USER_CANCEL"):
                is_interrupted = True
                break

        cost = estimate_cost(total_p, total_c, "gemini-2.0-flash")
        session_update = {
            "id": session_id,
            "agent_type": self.agent_type,
            "model_name": "gemini-3-flash",
            "title": session_title or f"Antigravity 작업 ({session_id[:8]})",
            "status": "interrupted" if is_interrupted else "completed",
            "is_interrupted": is_interrupted,
            "started_at": started_at or datetime.now(timezone.utc).isoformat(),
            "delta_prompt_tokens": total_p,
            "delta_completion_tokens": total_c,
            "delta_cost_usd": cost,
            "total_prompt_tokens": total_p,
            "total_completion_tokens": total_c,
            "total_tokens": total_p + total_c,
            "estimated_cost_usd": cost,
            "metadata": {
                "workspace": workspace_path,
                "status": "interrupted" if is_interrupted else "completed",
                "is_interrupted": is_interrupted
            }
        }

        return p.stat().st_size, steps, session_update
