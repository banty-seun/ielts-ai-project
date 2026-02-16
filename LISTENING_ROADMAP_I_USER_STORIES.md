# Roadmap Item I: Observability, Reliability, and Rollout

This document expands **Roadmap Item I** from `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md` into detailed user stories and acceptance criteria.

It is codebase-aware and marks what currently exists vs what must be added for production-grade observability, reliability, and staged rollout.

## Label Legend

- `[EXISTS]` Already implemented and reusable.
- `[MODIFY]` Exists but needs adaptation.
- `[NEW]` Must be added.
- `[DEPRECATE]` Should be phased out from critical path.

---

## 0) Current-State Baseline (Roadmap I Scope)

### Reusable foundation

1. API request logging middleware exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/index.ts` (method/path/status/duration). `[EXISTS]`
2. Prefetch lifecycle instrumentation exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` (queued/running/ready/error logs and timing). `[EXISTS]`
3. Central retry helper exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/prefetchRetry.ts` with backoff/jitter and retryability checks. `[EXISTS]`
4. Task/session prefetch status fields (`sessionPrefetch.status`, `retryCount`, `ready`, `batchId`) already exist in progress data flows in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`. `[EXISTS]`
5. Backfill script patterns already exist in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/scripts/backfillTaskDurations.ts` and `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/scripts/backfillWeeklyPlans.ts`. `[EXISTS]`
6. API smoke test script exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/scripts/api-smoke.test.mjs`. `[EXISTS]`

### Gaps vs target architecture

1. No standardized structured logging contract (request ID, trace ID, event name, error class, section/plan correlation). `[NEW]`
2. No distributed tracing spans from Tutor plan -> section orchestration -> script/question/TTS -> publish -> coach analysis. `[NEW]`
3. No metrics registry and dashboard artifacts for queue latency, publish SLA, failure rates, DLQ pressure. `[NEW]`
4. No automated SLO-based alerting policy (publish failures, retry storms, TTS/provider spikes). `[NEW]`
5. No cohort-based canary controls and rollback switch for the new listening pipeline. `[NEW]`
6. No explicit runbook for on-call diagnosis across orchestrator/sub-agent/TTS stages. `[NEW]`

### Candidates to phase out

1. Heavy reliance on ad-hoc `console.log` for production incident triage without structured fields. `[DEPRECATE]`
2. Route-embedded instrumentation logic that is not shared across orchestration workers/services. `[DEPRECATE]`
3. Manual release verification with no checklist gate for canary-to-full rollout promotion. `[DEPRECATE]`

---

## I1 - End-to-End Tracing and Dashboards

### I1.1 Story - Canonical Telemetry Context Contract

**User Story**  
As a platform engineer, I want a shared telemetry context contract so all events/logs/metrics are correlated from onboarding plan generation to final coaching output.

**Acceptance Criteria**

1. Telemetry context includes `trace_id`, `request_id`, `user_id`, `weekly_plan_id`, `session_id`, `section_id`, `part_id`, and `agent_name`. `[NEW]`
2. Existing prefetch `batchId` in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` is mapped into the new correlation model (or aliased). `[MODIFY]`
3. Shared types for telemetry context are added to shared contracts package (`/Users/oluwaseunbantale/Documents/ielts-ai-project/shared`). `[NEW]`
4. Missing context on critical events is rejected or patched with explicit `context_missing=true` flag. `[NEW]`

### I1.2 Story - Stage-Level Span Emission

**User Story**  
As an SRE, I want span-level traces for each generation stage so we can isolate latency and failure bottlenecks quickly.

**Acceptance Criteria**

1. Spans are emitted for: `plan_selected`, `section_scheduled`, `script_generated`, `question_generated`, `audio_rendered`, `validated`, `published`, `result_computed`, `coach_analyzed`. `[NEW]`
2. Existing timing measurements in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` are preserved and migrated to span duration fields. `[MODIFY]`
3. Trace links survive retries and include attempt number metadata from retry subsystem. `[MODIFY]`
4. Trace capture supports sequential section ordering (S1->S2->S3->S4) with child spans per section part (1..3). `[NEW]`

### I1.3 Story - Operational Dashboard Pack

**User Story**  
As an engineering manager, I want production dashboards so health of the listening pipeline is visible without raw log digging.

**Acceptance Criteria**

1. Dashboard includes queue depth, queue delay, stage latency p50/p95/p99, success ratio, retry ratio, and terminal failure rate by stage. `[NEW]`
2. Dashboard includes section readiness metrics (first section warm-start success, per-section publish completeness). `[NEW]`
3. Existing sessionPrefetch status distribution in progress data is surfaced as a dashboard panel source. `[MODIFY]`
4. Dashboard links to trace/log query using shared correlation IDs. `[NEW]`

---

## I2 - Alerting for Critical SLO Breaches

### I2.1 Story - Listening SLO Catalog

**User Story**  
As an ops lead, I want an explicit SLO catalog for the listening pipeline so alerting thresholds are tied to product promises.

**Acceptance Criteria**

1. SLO document defines at minimum: publish success, section-1 readiness at start, average generation latency, and coach output availability. `[NEW]`
2. Baseline target in roadmap (`>=99% publish`, high section-1 readiness) is mapped to measurable queries and windows. `[MODIFY]`
3. Error budgets are defined per SLO with burn-rate thresholds. `[NEW]`
4. SLO ownership is assigned to Backend/Infra with escalation policy and response SLA. `[NEW]`

### I2.2 Story - Critical Alert Rules

**User Story**  
As on-call engineer, I want high-signal alerts so critical regressions trigger immediately with actionable context.

**Acceptance Criteria**

1. Alerts trigger on: publish failure spikes, DLQ growth, retry exhaustion spikes, TTS provider failure spikes, and coach-analysis misses. `[NEW]`
2. Existing retry exhaustion/error logging in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/prefetchRetry.ts` is wired to metric counters for alerting. `[MODIFY]`
3. Alerts include correlation IDs and top failing stage/provider in payload. `[NEW]`
4. Alert noise controls exist (dedupe, suppression windows, severity tiers). `[NEW]`

### I2.3 Story - Synthetic and Regression Probes

**User Story**  
As a reliability engineer, I want automated synthetic checks so latent breakages are detected before user-impact scales.

**Acceptance Criteria**

1. Existing API smoke script (`/Users/oluwaseunbantale/Documents/ielts-ai-project/scripts/api-smoke.test.mjs`) is extended for listening critical-path probes. `[MODIFY]`
2. Probes cover orchestration kickoff, script/question generation, TTS readiness, and section result retrieval. `[NEW]`
3. Failed probes produce alert events with failing stage and environment tags. `[NEW]`
4. Probe runs are scheduled and visible on reliability dashboard. `[NEW]`

---

## I3 - Canary Rollout by Cohort

### I3.1 Story - Cohort Gating and Feature Flags

**User Story**  
As a release manager, I want cohort gating so the new listening stack can be enabled gradually and safely.

**Acceptance Criteria**

1. Feature flag controls route users to legacy vs new listening pipeline by cohort (internal, beta %, full). `[NEW]`
2. Existing env-flag pattern in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` (e.g., `NORMALIZE_TASK_DURATION`, `ENABLE_PLAN_DEBUG`) is reused for initial flag wiring. `[EXISTS]`
3. Cohort assignment logic is deterministic and auditable (same user gets same pipeline in a rollout phase). `[NEW]`
4. Flag state is emitted in telemetry context for all generated artifacts and session attempts. `[NEW]`

### I3.2 Story - Canary Health Gates

**User Story**  
As a product owner, I want objective canary promotion gates so rollout decisions are evidence-based.

**Acceptance Criteria**

1. Promotion criteria include SLO compliance and no critical regression in completion rate, startup latency, and scoring integrity. `[NEW]`
2. Canary scorecard compares new vs baseline pipeline over same date window and similar cohorts. `[NEW]`
3. Promotion can be blocked automatically when thresholds fail. `[NEW]`
4. Manual override requires explicit reason and incident ticket linkage. `[NEW]`

### I3.3 Story - Fast Rollback Controls

**User Story**  
As on-call, I want one-step rollback controls so user impact is minimized during severe incidents.

**Acceptance Criteria**

1. Rollback switch routes new sessions back to stable pipeline within minutes. `[NEW]`
2. In-flight sessions keep consistency guarantees (no mixed schema/audio state mid-session). `[NEW]`
3. Rollback action is logged with actor, reason, timestamp, and affected cohorts. `[NEW]`
4. Post-rollback report includes estimated impacted users and recovery verification steps. `[NEW]`

---

## I4 - Migration and Backfill Tooling

### I4.1 Story - Contract Migration Inventory

**User Story**  
As a migration engineer, I want a source-of-truth inventory so we know exactly which records require migration to new listening contracts.

**Acceptance Criteria**

1. Inventory identifies required transformations for session packages, question JSON blocks, result payloads, and coaching payload references. `[NEW]`
2. Existing data model and progressData structures from `/Users/oluwaseunbantale/Documents/ielts-ai-project/shared/schema.ts` are used to define migration scope. `[MODIFY]`
3. Inventory distinguishes no-op, auto-fix, and manual-review cases. `[NEW]`
4. Inventory output is versioned and attached to rollout readiness report. `[NEW]`

### I4.2 Story - Backfill Runner Framework

**User Story**  
As a backend operator, I want reusable backfill tooling so we can safely reprocess older plans/sessions for contract compatibility.

**Acceptance Criteria**

1. New backfill runners follow existing pattern used in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/scripts/backfillTaskDurations.ts` and `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/scripts/backfillWeeklyPlans.ts`. `[EXISTS]`
2. All backfills support `--dry-run`, scoping by user/plan/date, resumability, and idempotent writes. `[MODIFY]`
3. Backfill execution emits structured progress metrics (processed/skipped/failed) and correlation IDs. `[NEW]`
4. Failures are checkpointed for restart without reprocessing completed records. `[NEW]`

### I4.3 Story - Migration Verification and Reconciliation

**User Story**  
As a QA lead, I want migration verification checks so transformed data is trustworthy before we depend on it in production.

**Acceptance Criteria**

1. Verification compares pre/post invariants: section count (4), question count per section (10), part count per section (3), and renderable question blocks. `[NEW]`
2. Existing content validation patterns (e.g., transcript validation in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/content.ts`) are reused where applicable. `[EXISTS]`
3. Reconciliation report includes mismatch categories and sample record IDs. `[NEW]`
4. Migration run is marked complete only when mismatch rate is below predefined threshold. `[NEW]`

---

## I5 - Post-Launch QA Checklist and Runbook

### I5.1 Story - Operational Runbook

**User Story**  
As an on-call engineer, I want a concrete runbook so incidents can be triaged quickly across orchestration, generation, TTS, and coaching stages.

**Acceptance Criteria**

1. Runbook includes top failure scenarios: orchestration stuck, script generation failure, question schema mismatch, TTS failure, publish gate failure, coach timeout. `[NEW]`
2. Each scenario has diagnosis queries (logs/traces/metrics), immediate mitigation steps, and escalation path. `[NEW]`
3. Existing retry and prefetch status semantics in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/prefetchRetry.ts` and `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` are documented for responders. `[MODIFY]`
4. Runbook includes rollback and canary freeze procedures tied to roadmap I3 controls. `[NEW]`

### I5.2 Story - Production Readiness Checklist

**User Story**  
As a release owner, I want a release checklist so we do not promote without validating critical quality and reliability gates.

**Acceptance Criteria**

1. Checklist covers contract compatibility, dashboard/alert health, canary gate status, migration status, and incident drill completion. `[NEW]`
2. Existing test commands (`npm run check`, `npm run smoke:api`) are included as minimum gate steps. `[EXISTS]`
3. Checklist requires explicit sign-off from Backend, Frontend, QA, and Ops. `[NEW]`
4. Release is blocked if any P0 gate is unresolved. `[NEW]`

### I5.3 Story - Incident Review and Learning Loop

**User Story**  
As a platform team, I want a post-incident learning loop so reliability improves continuously after launch.

**Acceptance Criteria**

1. Incident template captures timeline, detection source, user impact, root cause, and preventive actions. `[NEW]`
2. Root-cause taxonomy distinguishes contract failure, orchestration failure, provider failure, data integrity failure, and UX runtime failure. `[NEW]`
3. Corrective actions map back to roadmap backlog items with owners and due dates. `[NEW]`
4. Recurring incidents trigger mandatory reliability backlog reprioritization. `[NEW]`

---

## Implementation Notes for Roadmap Item I

1. Start with structured logging + correlation IDs before introducing full tracing stack; this gives immediate debugging gains.
2. Lift existing retry/prefetch metrics out of route-level logs into reusable telemetry utilities to avoid fragmented instrumentation.
3. Define SLOs early and wire alerts in staging before canary; avoid launching blind and backfilling observability later.
4. Treat migration/backfill as first-class release workstream with dry-run evidence and reconciliation reports.
5. Make rollout controls reversible by design (canary gates + fast rollback) and include these in incident drills.

## Suggested Deliverables Checklist (I Complete)

1. Telemetry context contract + stage-level traces + operational dashboards.
2. SLO catalog, alert rules, and synthetic critical-path probes.
3. Cohort-based canary controls with promotion gates and one-step rollback.
4. Migration/backfill runner framework with verification and reconciliation reporting.
5. Post-launch runbook, production readiness checklist, and incident learning loop.
