#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$ROOT_DIR/.devcontainer/dev.log"

if pgrep -f "pnpm dev -- --host" > /dev/null; then
  echo "Dev servers already running. Logs: $LOG_FILE"
  exit 0
fi

cd "$ROOT_DIR"
nohup pnpm dev -- --host > "$LOG_FILE" 2>&1 < /dev/null &
echo "Starting client and server with 'pnpm dev -- --host'. Logs: $LOG_FILE"
