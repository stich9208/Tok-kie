#!/usr/bin/env bash
set -euo pipefail

# Tok-kie installer for macOS and Linux. Windows users can run install.ps1.
# This script installs locked Node dependencies and verifies a production build.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Node.js 22.12+와 npm 10+이 필요합니다." >&2
    exit 1
fi

node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error('Node.js 22.12+ is required (found ' + process.version + ')'); process.exit(1); }"

echo "🐰 Tok-kie Electron 의존성을 설치합니다..."
npm ci
(cd dashboard && npm ci)

echo "🔨 정적 렌더러와 Electron 메인 프로세스를 빌드합니다..."
npm run build

echo "✅ 설치가 완료되었습니다."
echo "   개발 실행: npm run dev"
echo "   배포 패키지(mac universal): npm run dist"
