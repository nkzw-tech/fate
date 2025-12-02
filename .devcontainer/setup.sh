#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_ENV="$ROOT_DIR/example/server/.env"
CLIENT_ENV="$ROOT_DIR/example/client/.env"

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-fate}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

if [[ -n "${CODESPACE_NAME:-}" ]]; then
  CLIENT_DOMAIN="https://${CODESPACE_NAME}-6001.app.github.dev"
  SERVER_URL="https://${CODESPACE_NAME}-9020.app.github.dev"
else
  CLIENT_DOMAIN="${CLIENT_DOMAIN:-http://localhost:6001}"
  SERVER_URL="${SERVER_URL:-http://localhost:9020}"
fi

BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-}"
if [[ -z "$BETTER_AUTH_SECRET" ]]; then
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
fi

DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}}"

if [[ ! -f "$SERVER_ENV" ]]; then
  cat > "$SERVER_ENV" <<EOF_ENV
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
CLIENT_DOMAIN=$CLIENT_DOMAIN
DATABASE_URL=$DATABASE_URL
VITE_SERVER_URL=$SERVER_URL
EOF_ENV
fi

if [[ ! -f "$CLIENT_ENV" ]]; then
  cat > "$CLIENT_ENV" <<EOF_ENV
VITE_SERVER_URL=$SERVER_URL
EOF_ENV
fi

cd "$ROOT_DIR"
pnpm install
pnpm dev:setup
pnpm prisma migrate deploy
pnpm prisma db seed
