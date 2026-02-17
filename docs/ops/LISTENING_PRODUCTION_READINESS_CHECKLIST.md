# Listening Production Readiness Checklist

Implements Roadmap I (`I5.2`) release gate.

## Contract + Validation

1. Event/schema compatibility validated.
2. Validation gates active and failing payloads blocked.
3. Manifest integrity verification passing.

## Observability + Alerts

1. Dashboard pack configured and receiving data.
2. SLO catalog baselines verified.
3. Alert rules enabled (publish/DLQ/retry/TTS/coach).

## Canary + Rollback

1. Cohort rollout configured and deterministic.
2. Canary scorecard healthy for promotion window.
3. Rollback switch tested (`LISTENING_ROLLOUT_FORCE_ROLLBACK`).

## Migration + Backfill

1. Migration inventory reviewed and versioned.
2. Backfill dry-run evidence captured.
3. Reconciliation mismatch rate within threshold.

## Story E Schema Gate (Release Blocker)

1. Migration apply log attached (`artifacts/listening-release/migration-apply.log`).
2. Schema gate pass output attached (`artifacts/listening-release/schema-gate.log`).
3. CI check `listening-schema-gate` passed against deployment/pre-prod mirror DB using secured secret `PREDEPLOY_DATABASE_URL`.
4. Branch/release approval policy includes `listening-schema-gate` as a required check before release approval.

## Story E Release Evidence (Required for Every Release)

1. Schema gate output captured and attached.
2. Migration application log captured and attached.
3. One successful readiness probe captured (`npm run verify:listening-readiness`, `buildManifestReadiness` path).
4. One successful `/api/firebase/task-content/:id` probe captured for a valid listening task (`npm run verify:listening-runtime`).

## QA + Drill

1. `npm run check` passed.
2. `npm run smoke:api` passed.
3. Incident drill executed for at least one critical scenario.

## Sign-offs (Required)

1. Backend
2. Frontend
3. QA
4. Ops

Release must not proceed with unresolved P0 items.
