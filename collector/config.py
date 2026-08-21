import os
import json
import socket
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, List

DEFAULT_CONFIG_DIR = Path.home() / ".agent-token-tracker"
DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_DIR / "config.json"
DEFAULT_OFFLINE_DB = DEFAULT_CONFIG_DIR / "offline_events.db"

def get_mac_computer_name() -> str:
    """Mac의 실제 컴퓨터 이름(예: My MacBook Pro)을 가져옵니다."""
    try:
        result = subprocess.run(
            ["scutil", "--get", "ComputerName"],
            capture_output=True,
            text=True,
            timeout=2
        )
        name = result.stdout.strip()
        if name:
            return name
    except Exception:
        pass
    return socket.gethostname() or "MacBook"

class Config:
    def __init__(self):
        DEFAULT_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self.config_path = DEFAULT_CONFIG_PATH
        self.device_name: str = get_mac_computer_name()
        self.default_user_email: str = os.getenv("DEFAULT_USER_EMAIL", "")
        self.work_domains: List[str] = []
        self.supabase_url: str = os.getenv("SUPABASE_URL", "")
        self.supabase_key: str = os.getenv("SUPABASE_KEY", "")
        self.offline_db_path: Path = DEFAULT_OFFLINE_DB
        self.log_paths: Dict[str, str] = {
            "antigravity": str(Path.home() / ".gemini" / "antigravity" / "brain"),
            "claude_code": str(Path.home() / ".claude"),
            "codex": str(Path.home() / ".codex"),
        }
        self.load()

    def load(self):
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.device_name = data.get("device_name", self.device_name)
                    self.default_user_email = data.get("default_user_email", self.default_user_email)
                    self.work_domains = data.get("work_domains", self.work_domains)
                    self.supabase_url = data.get("supabase_url", self.supabase_url)
                    self.supabase_key = data.get("supabase_key", self.supabase_key)
                    if "log_paths" in data:
                        self.log_paths.update(data["log_paths"])
            except Exception as e:
                print(f"[Warning] Failed to load config: {e}")

    def save(self):
        DEFAULT_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        data = {
            "device_name": self.device_name,
            "default_user_email": self.default_user_email,
            "work_domains": self.work_domains,
            "supabase_url": self.supabase_url,
            "supabase_key": self.supabase_key,
            "log_paths": self.log_paths
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    @property
    def is_supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_key)

config = Config()
