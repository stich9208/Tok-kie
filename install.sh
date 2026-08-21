#!/usr/bin/env bash
set -e

# ==========================================================
# Tok-kie 🐰 - macOS One-Click Installer & Service Setup
# ==========================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
COLLECTOR_DIR="$SCRIPT_DIR/collector"
VENV_DIR="$SCRIPT_DIR/.venv"
CONFIG_DIR="$HOME/.agent-token-tracker"
PLIST_PATH="$HOME/Library/LaunchAgents/com.user.agent-token-tracker.plist"

echo "=========================================================="
echo " 🐰 Tok-kie - macOS Setup"
echo "=========================================================="

mkdir -p "$CONFIG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

# 1. Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3가 설치되어 있지 않습니다. Homebrew 또는 python.org에서 설치해 주세요."
    exit 1
fi

# 2. Setup Virtual Environment & Dashboard Packages
echo "📦 [1/4] Python 가상환경 및 대시보드 의존성 패키지 설치 중..."
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$COLLECTOR_DIR/requirements.txt"

if command -v npm &> /dev/null; then
    (cd "$SCRIPT_DIR/dashboard" && npm install --silent)
fi

# 3. Detect / Prompt for Device Name
DETECTED_NAME=$(scutil --get ComputerName 2>/dev/null || hostname)
echo ""
echo "💻 [2/4] Mac 디바이스 식별자 설정"
read -p "이 Mac의 표시 이름을 입력하세요 [기본값: $DETECTED_NAME]: " DEVICE_INPUT
DEVICE_NAME=${DEVICE_INPUT:-$DETECTED_NAME}

echo ""
echo "☁️ [3/4] Supabase 클라우드 동기화 설정 (선택 사항)"
echo "다수의 Mac을 통합 관리하려면 Supabase URL과 Key를 입력하세요."
echo "(엔터를 치면 나중에 설정하거나 로컬 오프라인 모드로 실행됩니다)"
read -p "Supabase Project URL: " SB_URL
read -p "Supabase Anon/Service Key: " SB_KEY

# Save config via CLI
"$VENV_DIR/bin/python" "$COLLECTOR_DIR/main.py" config --device "$DEVICE_NAME" \
  ${SB_URL:+--supabase-url "$SB_URL"} \
  ${SB_KEY:+--supabase-key "$SB_KEY"}

# Generate dashboard/.env.local if Supabase info provided
if [ -n "$SB_URL" ] && [ -n "$SB_KEY" ]; then
    cat <<EOF > "$SCRIPT_DIR/dashboard/.env.local"
NEXT_PUBLIC_SUPABASE_URL=$SB_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SB_KEY
EOF
fi

# 4. Perform Initial Log Scan
echo ""
echo "🔍 [4/4] 기존 코딩 에이전트 로그 초기 스캔 진행 중..."
"$VENV_DIR/bin/python" "$COLLECTOR_DIR/main.py" scan || true

# 5. Register macOS launchd Background Service
echo ""
echo "⚙️ macOS 백그라운드 자동 실행 서비스(launchd) 등록 중..."

# Stop previous service if running
launchctl unload "$PLIST_PATH" 2>/dev/null || true

cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.agent-token-tracker</string>
    <key>ProgramArguments</key>
    <array>
        <string>$VENV_DIR/bin/python</string>
        <string>$COLLECTOR_DIR/main.py</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$CONFIG_DIR/collector.log</string>
    <key>StandardErrorPath</key>
    <string>$CONFIG_DIR/collector.err.log</string>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
</dict>
</plist>
EOF

launchctl load "$PLIST_PATH"

echo "=========================================================="
echo " ✅ 설치 완료! 수집기 데몬이 백그라운드에서 실행 중입니다."
echo "   - 디바이스명 : $DEVICE_NAME"
echo "   - 로그 파일  : $CONFIG_DIR/collector.log"
echo ""
echo " 🌐 로컬 대시보드 실행 방법:"
echo "   cd $SCRIPT_DIR/dashboard && npm run dev"
echo "   (브라우저에서 http://localhost:3000 접속)"
echo "=========================================================="
