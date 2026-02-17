# Listening Operational Runbook

Implements Roadmap I (`I5.1`) for incident triage.

## 1. Orchestration Stuck

Diagnosis:
1. Query `/api/listening/orchestrator/queue` for depth, queue age, and stuck items.
2. Inspect `span:section_scheduled` latency/failure trends in `/api/listening/ops/dashboard`.
3. Check unresolved DLQ entries for `ORDER_GUARD_FAILED` and lock contention.

Immediate mitigation:
1. Requeue blocked section (`REQUEUE_STEP`) after verifying idempotency key ownership.
2. Replay only affected DLQ items; do not mass-replay unresolved backlog blindly.

Escalation:
1. Page Backend on-call if queue does not drain within 15 minutes.
2. Page Infra if queue delay p95 remains above baseline for 2 consecutive windows.

## 2. Script Generation Failure

Diagnosis:
1. Inspect `span:script_generated` failures (`error_class`) and attempt metadata.
2. Check prompt assignment output and prompt version from prompt registry logs.
3. Review continuity/blueprint failures tied to same `trace_id` and `section_id`.

Immediate mitigation:
1. Requeue the failed section with stable prompt version.
2. If regression suspected, pin fallback prompt version for impacted cohort.

Escalation:
1. Escalate to Backend if failure ratio exceeds alert threshold.
2. Escalate to Prompt/LLM owner when regression is prompt-version-specific.

## 3. Question Schema Mismatch

Diagnosis:
1. Inspect validation report (`QUESTION_SCHEMA_INVALID`, adapter mismatch categories).
2. Compare question contract vs renderer payload references for the same section.
3. Check migration verification output categories for recurring mismatches.

Immediate mitigation:
1. Roll back to previous manifest version for affected section.
2. Requeue generation with stable adapter mode and prompt version.

Escalation:
1. Escalate to Backend and QA when renderability mismatch repeats across sections.

## 4. TTS Failure

Diagnosis:
1. Check `/api/listening/tts/health` and TTS provider metadata.
2. Inspect `span:audio_rendered` latency/failure spikes and retry error-code mix.
3. Verify asset delivery probe/segment verification failures.

Immediate mitigation:
1. Enable fallback provider/voice path for affected accents.
2. Re-render only failed segments to minimize recovery time.

Escalation:
1. Escalate to Infra/provider owner for sustained provider-specific failures.

## 5. Publish Gate Failure

Diagnosis:
1. Inspect validation gate verdict and top failing `error_code`.
2. Check publish audit trail and manifest integrity mismatch details.
3. Confirm whether queue item moved to manual review path.

Immediate mitigation:
1. Fix failing artifact and requeue the section publish path.
2. Use `APPROVE_WITH_OVERRIDE` only with explicit reason and reviewer traceability.

Escalation:
1. Escalate to release owner if publish success SLO is at risk.

## 6. Coach Timeout / Missing Output

Diagnosis:
1. Inspect `span:coach_analyzed` failures and timeout distribution.
2. Validate attempt payload integrity and required metadata fields.
3. Check completion-to-coach availability ratio against SLO.

Immediate mitigation:
1. Republish coach-analysis event for completed attempts.
2. Rebuild analytics artifacts for affected sessions.

Escalation:
1. Escalate to Backend if coach miss ratio breaches alert thresholds.

## Retry + Prefetch Semantics (Responder Reference)

1. `sessionPrefetch.status` lifecycle: `idle -> queued -> running -> ready` (or `error` on terminal/retry path).
2. `sessionPrefetch.retryCount` increments with centralized retry scheduling from `prefetchRetry`.
3. Retry metrics (`scheduled`, `executed`, `failed`, `exhausted`) are visible in `/api/listening/ops/dashboard` and `/api/listening/ops/alerts/snapshot`.
4. `retry.exhausted` and provider-specific error-code spikes are primary signals for early intervention.

## Rollback / Canary Freeze

1. Trigger rollback switch:
   - `POST /api/listening/rollout/rollback-switch` with `enabled=true`, `reason`, and `incidentTicket`.
2. Verify enforcement:
   - `GET /api/listening/rollout/status` must report `runtime_force_rollback=true` and user mode resolving to legacy.
3. Freeze promotion path:
   - disable/clear canary overrides when not needed (`POST /api/listening/rollout/canary/override`, `enabled=false`).
   - keep canary promotion blocked unless health gates pass (`GET /api/listening/rollout/canary/promotion-check`).
4. Run post-rollback verification:
   - `GET /api/listening/rollout/post-rollback-report` and execute listed recovery verification steps.

## Story E Release Guardrail (Pre-Deploy Schema Gate)

Required pre-deploy order (must not be changed):
1. Apply DB migrations.
2. Run listening schema gate.
3. Start/restart server.

Exact commands:
1. `export DATABASE_URL="<target-deploy-or-preprod-db-url>"`
2. `npm run db:migrate 2>&1 | tee artifacts/listening-release/migration-apply.log`
3. `npm run guard:listening-schema 2>&1 | tee artifacts/listening-release/schema-gate.log`
4. `LISTENING_DEPLOY_START_CMD="pm2 restart ielts-ai" npm run deploy:listening-guarded`

One-shot guarded deploy command (enforces migration -> gate -> start/restart):
1. `LISTENING_DEPLOY_START_CMD="pm2 restart ielts-ai" DATABASE_URL="<target-db-url>" npm run deploy:listening-guarded`

Expected schema gate failure example:
1. `[ListeningSchemaGate] FAIL missing required relation(s): listening_event_outbox (db=..., schema=public). Remediation: Apply migrations 0005_add_listening_section_state_table.sql, 0006_add_listening_orchestration_ops_tables.sql, and 0007_add_listening_event_outbox.sql, then rerun npm run guard:listening-schema.`

Recovery steps when schema gate fails:
1. Apply missing migrations in order:
   - `psql "$DATABASE_URL" -f drizzle/0005_add_listening_section_state_table.sql`
   - `psql "$DATABASE_URL" -f drizzle/0006_add_listening_orchestration_ops_tables.sql`
   - `psql "$DATABASE_URL" -f drizzle/0007_add_listening_event_outbox.sql`
2. Re-run:
   - `npm run guard:listening-schema`
3. Only after gate passes, continue with server start/restart.

## Release Evidence Capture (Mandatory)

For every listening release, attach all of the following artifacts:
1. Schema gate output:
   - `npm run guard:listening-schema 2>&1 | tee artifacts/listening-release/schema-gate.log`
2. Migration application log:
   - `npm run db:migrate 2>&1 | tee artifacts/listening-release/migration-apply.log`
3. One successful readiness probe (`buildManifestReadiness` path):
   - `npm run verify:listening-readiness 2>&1 | tee artifacts/listening-release/readiness-probe.log`
4. One successful `/api/firebase/task-content/:id` probe for a valid listening task:
   - `npm run verify:listening-runtime 2>&1 | tee artifacts/listening-release/task-content-probe.log`
