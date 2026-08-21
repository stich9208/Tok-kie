#!/usr/bin/env bash
set -e

PLIST_PATH="$HOME/Library/LaunchAgents/com.user.agent-token-tracker.plist"
CONFIG_DIR="$HOME/.agent-token-tracker"

echo "🛑 Agent Token Tracker 백그라운드 서비스를 중지하고 삭제합니다..."

if [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "✅ launchd 서비스가 등록 해제되었습니다."
fi

read -p "로컬 설정 및 로그 파일($CONFIG_DIR)도 모두 삭제할까요? (y/N): " CONFIRM
if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    rm -rf "$CONFIG_DIR"
    echo "✅ 로컬 캐시 및 로그가 삭제되었습니다."
fi

echo "완료되었습니다."
