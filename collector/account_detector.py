import json
import base64
import re
import subprocess
from pathlib import Path
from typing import Optional, Tuple, Dict, Any
from collector.config import config

COMMON_PERSONAL_DOMAINS = {
    "gmail.com", "googlemail.com", "naver.com", "daum.net", "hanmail.net",
    "kakao.com", "icloud.com", "me.com", "mac.com", "outlook.com",
    "hotmail.com", "live.com", "yahoo.com", "proton.me", "protonmail.com"
}

def extract_git_email_from_path(file_path: str) -> Optional[str]:
    """주어진 파일 경로 또는 그 상위 디렉토리에서 .git/config의 user.email을 탐색합니다."""
    try:
        p = Path(file_path).resolve()
        # file_path가 파일이면 부모 디렉토리부터 시작
        curr = p.parent if p.is_file() else p

        # 루트까지 올라가며 .git 확인
        for _ in range(8):
            git_config = curr / ".git" / "config"
            if git_config.exists() and git_config.is_file():
                try:
                    content = git_config.read_text(encoding="utf-8", errors="ignore")
                    match = re.search(r'email\s*=\s*([^\r\n#;]+)', content)
                    if match:
                        email = match.group(1).strip()
                        if email and "@" in email:
                            return email
                except Exception:
                    pass
            if curr.parent == curr:
                break
            curr = curr.parent
    except Exception:
        pass
    return None

def extract_agent_auth_email(agent_type: str) -> Optional[str]:
    """각 에이전트 도구의 로컬 설정/인증 파일에서 활성 이메일을 추출합니다."""
    try:
        if agent_type == "antigravity":
            gemini_paths = [
                Path.home() / ".gemini" / "google_accounts.json",
                Path.home() / ".gemini" / "oauth_credentials.json",
                Path.home() / ".gemini" / "antigravity" / "auth.json"
            ]
            for p in gemini_paths:
                if p.exists():
                    try:
                        data = json.loads(p.read_text(encoding="utf-8", errors="ignore"))
                        email = data.get("active") or data.get("email") or data.get("account") or data.get("user")
                        if not email and "accounts" in data and isinstance(data["accounts"], list) and len(data["accounts"]) > 0:
                            first_acc = data["accounts"][0]
                            email = first_acc.get("email") if isinstance(first_acc, dict) else str(first_acc)
                        if email and "@" in str(email):
                            return str(email).strip()
                    except Exception:
                        pass

        elif agent_type == "claude_code":
            claude_json = Path.home() / ".claude.json"
            if claude_json.exists():
                data = json.loads(claude_json.read_text(encoding="utf-8", errors="ignore"))
                oauth = data.get("oauthAccount", {})
                email = oauth.get("emailAddress")
                if email and "@" in email:
                    return email.strip()

        elif agent_type == "codex":
            codex_auth = Path.home() / ".codex" / "auth.json"
            if codex_auth.exists():
                data = json.loads(codex_auth.read_text(encoding="utf-8", errors="ignore"))
                tokens = data.get("tokens", {})
                id_token = tokens.get("id_token") or tokens.get("access_token")
                if id_token and isinstance(id_token, str) and "." in id_token:
                    # Parse JWT Payload without signature verification
                    parts = id_token.split(".")
                    if len(parts) >= 2:
                        payload_b64 = parts[1]
                        # Pad base64
                        payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
                        payload_str = base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8", errors="ignore")
                        payload_json = json.loads(payload_str)
                        email = payload_json.get("email") or payload_json.get("https://api.openai.com/profile", {}).get("email")
                        if email and "@" in email:
                            return email.strip()
    except Exception:
        pass
    return None

def classify_account_type(email: str) -> str:
    """이메일 주소를 분석하여 work / personal을 분류합니다."""
    if not email or "@" not in email:
        return "personal"

    domain = email.split("@")[-1].lower().strip()

    # 1. Config에 등록된 회사 도메인 목록 확인
    if config.work_domains and domain in [d.lower().strip() for d in config.work_domains]:
        return "work"

    # 2. 일반 개인용 이메일 도메인인지 확인
    if domain in COMMON_PERSONAL_DOMAINS:
        return "personal"

    # 3. 그 외 독자적 회사/조직 도메인이면 work로 스마트 분류
    return "work"

def detect_account_info(file_path: str, agent_type: str, workspace_path: Optional[str] = None) -> Tuple[str, str]:
    """
    파일 경로, 에이전트 종류, 워크스페이스 경로를 바탕으로 (user_email, account_type)을 반환합니다.
    우선순위:
    1. 에이전트 도구 자체 로그인/인증 계정 (Antigravity, Claude Code, Codex 등)
    2. Workspace 또는 file_path 기반 Git 설정 이메일 (Fallback)
    3. 수집기 기본 설정 이메일 (config.default_user_email)
    """
    email = None

    # 1. 에이전트 도구 자체의 로그인/인증 계정 탐색 (1순위)
    email = extract_agent_auth_email(agent_type)

    # 2. Workspace 경로 또는 file_path 기반 Git 이메일 탐색 (2순위 Fallback)
    if not email and workspace_path:
        email = extract_git_email_from_path(workspace_path)
    
    if not email:
        email = extract_git_email_from_path(file_path)

    # 3. Default Config Fallback (3순위)
    if not email and config.default_user_email:
        email = config.default_user_email.strip()

    if not email:
        email = "unknown"

    account_type = classify_account_type(email)
    return email, account_type
