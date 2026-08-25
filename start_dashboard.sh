#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible entry point for older installations. Tok-kie now runs
# as an Electron desktop app; Windows users can run start_dashboard.ps1.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🐰 Tok-kie Electron 앱을 시작합니다..."
exec npm run dev
