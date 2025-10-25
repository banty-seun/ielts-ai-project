#!/usr/bin/env bash
# Safe, verbose apply+record for Drizzle migrations
set -Eeuo pipefail

# Pretty error handler
trap 'echo "❌ Error on line $LINENO. Command: $BASH_COMMAND"; exit 1' ERR

if [ $# -lt 2 ]; then
  echo "Usage: $0 <numeric_id_like_0003> <name_like_add_more_indexes>"
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ psql not found in PATH."
  exit 3
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ node not found in PATH."
  exit 4
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL is not set. Example:"
  echo "   export DATABASE_URL=postgres://postgres:postgres@localhost:5432/ielts_ai"
  exit 5
fi

ID="$1"                 # e.g., 0003
NAME="$2"               # e.g., add_more_indexes
FILE="drizzle/${ID}_${NAME}.sql"
INT_ID="${ID#0}"; INT_ID="${INT_ID:-0}"

if [ ! -f "$FILE" ]; then
  echo "❌ Migration file not found: $FILE"
  exit 6
fi

echo "— Applying $FILE …"
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -f "$FILE"

echo "— Computing hash …"
HASH=$(node -e "const fs=require('fs'),crypto=require('crypto'); \
const c=fs.readFileSync('$FILE'); \
console.log(crypto.createHash('sha256').update(c).digest('hex'))")

echo "— Recording journal row: id=$INT_ID, hash=$HASH"
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -c \
"INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)
 VALUES ($INT_ID, '$HASH', (EXTRACT(EPOCH FROM now())*1000)::bigint)
 ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash;"

echo "✅ Done."
