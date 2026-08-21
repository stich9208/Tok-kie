from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Dict, Any, Optional

class BaseAgentParser(ABC):
    def __init__(self, agent_type: str):
        self.agent_type = agent_type

    @abstractmethod
    def can_handle(self, file_path: str) -> bool:
        """이 파서가 주어진 파일 경로를 처리할 수 있는지 검사합니다."""
        pass

    @abstractmethod
    def parse_incremental(self, file_path: str, start_offset: int) -> tuple[int, List[Dict[str, Any]], Optional[Dict[str, Any]]]:
        """
        파일의 start_offset부터 새로 추가된 내용을 파싱합니다.
        반환값: (새로운 end_offset, 생성된 steps 리스트, 갱신된 session 메타데이터)
        """
        pass
