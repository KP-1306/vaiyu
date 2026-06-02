#!/usr/bin/env bash
# web/scripts/dev-seed.sh
#
# One-command setup for dev-only auth bypass testing.
# Seeds a deterministic owner user + hotel into the LOCAL Supabase so
# tryDevAutoLogin() (web/src/lib/devAuth.ts) can sign in automatically.
#
# Usage:
#   ./web/scripts/dev-seed.sh
#
# Requires:
#   - supabase CLI on PATH
#   - psql on PATH
#   - local Supabase running (`supabase start` is invoked if it isn't)
#
# NEVER run this against a production database. The seed SQL refuses to
# execute unless invoked with -v vaiyu.dev_seed_allow=1 (set below).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SEED_SQL="${REPO_ROOT}/supabase/seed-dev-auth.sql"

if ! command -v supabase >/dev/null 2>&1; then
  echo "error: 'supabase' CLI not found on PATH. Install: https://supabase.com/docs/guides/cli" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "error: 'psql' not found on PATH." >&2
  exit 1
fi
if [[ ! -f "$SEED_SQL" ]]; then
  echo "error: seed file missing at $SEED_SQL" >&2
  exit 1
fi

cd "$REPO_ROOT"

# Boot local Supabase if it isn't already running.
if ! supabase status >/dev/null 2>&1; then
  echo "[dev-seed] local Supabase not running — starting it..."
  supabase start
fi

# Pull the local DB URL from `supabase status`. Format example:
#   "DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres"
DB_URL="$(supabase status -o env 2>/dev/null | awk -F= '/^DB_URL=/{print $2}' | tr -d '"')"

if [[ -z "$DB_URL" ]]; then
  # Older CLI versions: grep the text output.
  DB_URL="$(supabase status 2>/dev/null | awk -F': ' '/DB URL/{print $2}' | tr -d ' ')"
fi

if [[ -z "$DB_URL" ]]; then
  echo "error: could not determine local Supabase DB URL from 'supabase status'." >&2
  exit 1
fi

case "$DB_URL" in
  *127.0.0.1*|*localhost*)
    ;;
  *)
    echo "error: DB URL ($DB_URL) is not localhost. Refusing to seed." >&2
    exit 1
    ;;
esac

echo "[dev-seed] applying $SEED_SQL to $DB_URL"
PGOPTIONS="-c vaiyu.dev_seed_allow=1" psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SEED_SQL"

echo
echo "[dev-seed] done."
echo "Next steps:"
echo "  1. In web/.env.local set:"
echo "       VITE_DEV_AUTH_BYPASS=true"
echo "       VITE_DEV_AUTH_EMAIL=dev-owner@vaiyu.test"
echo "       VITE_DEV_AUTH_PASSWORD=devpassword-change-me"
echo "       VITE_DEV_AUTH_HOTEL_SLUG=dev-hotel"
echo "       (and point VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at local Supabase)"
echo "  2. cd web && npm run dev"
echo "  3. Open http://localhost:8080 — you should land on /owner/dev-hotel automatically."
