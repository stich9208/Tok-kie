from collector.parsers.antigravity import AntigravityParser
from collector.parsers.claude_code import ClaudeCodeParser
from collector.parsers.codex import CodexParser

ALL_PARSERS = [
    AntigravityParser(),
    ClaudeCodeParser(),
    CodexParser(),
]

def get_parser_for_file(file_path: str):
    for parser in ALL_PARSERS:
        if parser.can_handle(file_path):
            return parser
    return None
