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
