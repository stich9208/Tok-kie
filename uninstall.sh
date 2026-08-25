#!/usr/bin/env bash
set -euo pipefail

# The packaged application is removed through Finder/Applications on macOS or
# the platform package manager. This helper removes user data only after an
# explicit confirmation. Tok-kie never installs a background service.
LEGACY_DATA_DIR="$HOME/.agent-token-tracker"
case "$(uname -s)" in
    Darwin) CURRENT_DATA_DIR="$HOME/Library/Application Support/Tok-kie" ;;
    Linux) CURRENT_DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Tok-kie" ;;
    *)
        echo "지원하지 않는 운영체제입니다. Windows에서는 uninstall.ps1을 사용하세요." >&2
        exit 1
        ;;
esac

echo "Tok-kie는 별도 백그라운드 서비스를 설치하지 않습니다."
echo "현재 Electron 데이터: $CURRENT_DATA_DIR"
echo "이전 버전 데이터: $LEGACY_DATA_DIR"
read -r -p "위 로컬 설정, 데이터베이스, 백업과 로그를 모두 삭제할까요? (y/N): " CONFIRM
if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    for TARGET in "$CURRENT_DATA_DIR" "$LEGACY_DATA_DIR"; do
        case "$TARGET" in
            "$HOME/Library/Application Support/Tok-kie"|"$HOME/.config/Tok-kie"|"${XDG_CONFIG_HOME:-$HOME/.config}/Tok-kie"|"$HOME/.agent-token-tracker")
                if [ -d "$TARGET" ]; then rm -rf -- "$TARGET"; fi
                ;;
            *)
                echo "안전하지 않은 삭제 경로를 거부했습니다: $TARGET" >&2
                exit 1
                ;;
        esac
    done
    echo "✅ Tok-kie 현재/이전 사용자 데이터가 삭제되었습니다. 복구할 수 없습니다."
else
    echo "사용자 데이터는 그대로 유지했습니다."
fi

echo "앱 자체는 macOS의 응용 프로그램 폴더나 사용한 패키지 관리 도구에서 제거하세요."
