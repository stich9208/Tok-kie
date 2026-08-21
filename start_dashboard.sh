#!/usr/bin/env bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "🐰 Starting Tok-kie Web Dashboard..."
cd "$SCRIPT_DIR/dashboard"

if [ ! -d "node_modules" ]; then
    echo "📦 Installing npm dependencies..."
    npm install
fi

echo "🌐 Opening dashboard at http://localhost:3000..."
npm run dev
