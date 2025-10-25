#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <numeric_id_like_0002> <name_like_add_constraints>"
  exit 1
fi

ID="$1"      # e.g., 0002
NAME="$2"    # e.g., add_constraints
FILE="drizzle/${ID}_${NAME}.sql"

if [ -f "$FILE" ]; then
  echo "File already exists: $FILE"
  exit 0
fi

echo "-- ${ID}_${NAME}.sql" > "$FILE"
echo "Created $FILE"
echo
echo "Next steps:"
echo "  1) Edit $FILE and add your SQL."
echo "  2) Apply it:"
echo "       psql \"\$DATABASE_URL\" -f $FILE"
echo "  3) Record it in the journal:"
echo "       HASH=\$(node -e \"const fs=require('fs'),crypto=require('crypto');"
echo "       const c=fs.readFileSync('$FILE');"
echo "       console.log(crypto.createHash('sha256').update(c).digest('hex'))\")"
echo "       psql \"\$DATABASE_URL\" -c \"INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (${ID#0}, '\$HASH', (EXTRACT(EPOCH FROM now())*1000)::bigint);\""
