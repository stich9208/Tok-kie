import re
from typing import Optional

try:
    import tiktoken
    _CL100K_ENC = tiktoken.get_encoding("cl100k_base")
    _O200K_ENC = tiktoken.get_encoding("o200k_base")
except Exception:
    _CL100K_ENC = None
    _O200K_ENC = None

# Model pricing approximations ($ per 1M tokens) - for estimated value display
MODEL_PRICING = {
    "claude-3-7-sonnet": {"prompt": 3.0, "completion": 15.0},
    "claude-3-5-sonnet": {"prompt": 3.0, "completion": 15.0},
    "claude-3-5-haiku": {"prompt": 0.8, "completion": 4.0},
    "gpt-4o": {"prompt": 2.5, "completion": 10.0},
    "gpt-4o-mini": {"prompt": 0.15, "completion": 0.60},
    "o1": {"prompt": 15.0, "completion": 60.0},
    "o3-mini": {"prompt": 1.10, "completion": 4.40},
    "gemini-3-flash": {"prompt": 0.10, "completion": 0.40},
    "gemini-2.5-flash": {"prompt": 0.10, "completion": 0.40},
    "gemini-2.0-flash": {"prompt": 0.10, "completion": 0.40},
    "gemini-1.5-flash": {"prompt": 0.075, "completion": 0.30},
    "gemini-1.5-pro": {"prompt": 1.25, "completion": 5.00},
    "gemini": {"prompt": 0.10, "completion": 0.40},
}

def count_tokens(text: str, model_name: str = "default") -> int:
    """텍스트의 토큰 수를 계산합니다 (tiktoken 및 BPE 추정)."""
    if not text:
        return 0
    
    # 1. tiktoken 사용 가능한 경우
    if _CL100K_ENC is not None:
        try:
            if "o1" in model_name or "4o" in model_name or "o3" in model_name:
                if _O200K_ENC:
                    return len(_O200K_ENC.encode(text, disallowed_special=()))
            return len(_CL100K_ENC.encode(text, disallowed_special=()))
        except Exception:
            pass

    # 2. Fallback: 다국어(한국어/영어/코드) 가중치 추정
    # 영문/코드: ~4자당 1토큰, 한글: ~1.5자당 1토큰
    korean_chars = len(re.findall(r'[\uac00-\ud7a3]', text))
    other_chars = len(text) - korean_chars
    estimated = int((korean_chars / 1.5) + (other_chars / 3.8))
    return max(1, estimated)

def estimate_cost(prompt_tokens: int, completion_tokens: int, model_name: str) -> float:
    """소모된 토큰의 대략적인 시장 가치(USD)를 계산합니다."""
    matched = None
    for k, v in MODEL_PRICING.items():
        if k in model_name.lower():
            matched = v
            break
    if not matched:
        # Default mid-tier pricing ($2.5 / $10)
        matched = {"prompt": 2.5, "completion": 10.0}

    cost = (prompt_tokens / 1_000_000.0 * matched["prompt"]) + \
           (completion_tokens / 1_000_000.0 * matched["completion"])
    return round(cost, 6)
