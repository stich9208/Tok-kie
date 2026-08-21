#!/usr/bin/env bash
set -e

# ==========================================================
# Tok-kie 🐰 - One-Click Supabase Cloud Setup Script
# ==========================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
COLLECTOR_DIR="$SCRIPT_DIR/collector"
VENV_DIR="$SCRIPT_DIR/.venv"
CONFIG_DIR="$HOME/.agent-token-tracker"
DASHBOARD_DIR="$SCRIPT_DIR/dashboard"

echo "=========================================================="
echo " 🐰 Tok-kie - Supabase 클라우드 동기화 간편 설정"
echo "=========================================================="
echo ""
echo "💡 시작하기 전에 확인해주세요:"
echo " 1. https://supabase.com 에서 무료 프로젝트를 생성하셨나요?"
echo " 2. Supabase의 [SQL Editor]에서 'supabase/schema.sql' 스크립트를 1회 실행하셨나요?"
echo ""
echo "이제 Supabase [Project Settings > Data API] 에서 키를 복사해 입력해주세요:"
echo ""

read -p "🔗 Supabase Project URL (예: https://xxxx.supabase.co): " SB_URL
read -p "🔑 Supabase Anon/Service Key: " SB_KEY

if [ -z "$SB_URL" ] || [ -z "$SB_KEY" ]; then
    echo "❌ URL 또는 Key가 입력되지 않았습니다. 설정을 취소합니다."
    exit 1
fi

echo ""
echo "⚙️ [1/3] 로컬 수집기(Daemon) 설정 저장 중..."
mkdir -p "$CONFIG_DIR"

if [ -d "$VENV_DIR" ]; then
    "$VENV_DIR/bin/python" "$COLLECTOR_DIR/main.py" config --supabase-url "$SB_URL" --supabase-key "$SB_KEY"
else
    python3 "$COLLECTOR_DIR/main.py" config --supabase-url "$SB_URL" --supabase-key "$SB_KEY"
fi

echo "🌐 [2/3] 웹 대시보드 환경변수(dashboard/.env.local) 생성 중..."
cat <<EOF > "$DASHBOARD_DIR/.env.local"
# Tok-kie Supabase Cloud Configuration
NEXT_PUBLIC_SUPABASE_URL=$SB_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SB_KEY
EOF

echo "🔍 [3/3] 기존 에이전트 로그를 Supabase 클라우드로 즉시 동기화 중..."
if [ -d "$VENV_DIR" ]; then
    "$VENV_DIR/bin/python" "$COLLECTOR_DIR/main.py" scan || true
else
    python3 "$COLLECTOR_DIR/main.py" scan || true
fi

echo ""
echo "=========================================================="
echo " 🎉 Supabase 클라우드 연동이 완벽하게 완료되었습니다!"
echo "=========================================================="
echo " - 맥북에서 발생하는 모든 토큰이 Supabase로 실시간 동기화됩니다."
echo " - 대시보드 실행: ./start_dashboard.sh"
echo "=========================================================="
