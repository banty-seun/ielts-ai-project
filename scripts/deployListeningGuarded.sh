#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "❌ [ListeningDeploy] Error on line $LINENO. Command: $BASH_COMMAND"; exit 1' ERR

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ [ListeningDeploy] DATABASE_URL is not set."
  exit 2
fi

START_CMD="${1:-${LISTENING_DEPLOY_START_CMD:-npm run start}}"

echo "— [ListeningDeploy] Step 1/3: Apply DB migrations"
npm run db:migrate

echo "— [ListeningDeploy] Step 2/3: Run listening schema gate"
npm run guard:listening-schema

echo "— [ListeningDeploy] Step 3/3: Start/restart server"
bash -lc "$START_CMD"

echo "✅ [ListeningDeploy] Completed guarded deploy sequence."
