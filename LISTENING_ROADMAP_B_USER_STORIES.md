# Roadmap Item B: Sequential Orchestration and Eventing

This document expands **Roadmap Item B** from `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md` into detailed user stories and acceptance criteria.

It is codebase-aware and identifies what can be reused vs what must be added for orchestration/eventing.

## Label Legend

- `[EXISTS]` Already implemented and reusable.
- `[MODIFY]` Exists but needs adaptation.
- `[NEW]` Must be added.
- `[DEPRECATE]` Should be phased out from critical path.

---

## 0) Current-State Baseline (Roadmap B Scope)

### Reusable foundation

1. Listening prefetch lifecycle and readiness states are implemented in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` (`idle|queued|running|ready|ready_partial|error`). `[EXISTS]`
2. Retry policy with backoff + jitter exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/prefetchRetry.ts`. `[EXISTS]`
3. Storage methods for task progress and content updates already support orchestration persistence (`updateTaskStatus`, `updateTaskContent`, `getTaskProgressByWeeklyPlan`) in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/storage.ts`. `[EXISTS]`
4. Segment ordering and assignment helpers exist in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/segmentOrder.ts`. `[EXISTS]`

### Gaps vs target architecture

1. Orchestration is route-driven (`setImmediate` + inline worker logic in `/server/routes.ts`), not a dedicated orchestrator service. `[MODIFY]`
2. No formal event bus contract handlers in a dedicated module (publish/consume wrappers). `[NEW]`
3. No explicit global queue priority policy for session imminence across weekly sessions. `[NEW]`
4. No first-class DLQ persistence/inspection path beyond retry attempts and error status fields. `[NEW]`
5. State transition events are not formalized as versioned domain events. `[NEW]`

### Candidates to phase out

1. Route-triggered asynchronous orchestration (`setImmediate`) as primary control plane. `[DEPRECATE]`
2. Route-side mixed responsibilities (read API + orchestration + generation) in single handlers. `[DEPRECATE]`

---

## B1 - Session Orchestration Worker

### B1.1 Story - Dedicated Orchestrator Worker Service

**User Story**  
As a backend engineer, I want a dedicated session orchestrator worker so section generation sequencing is independent of API request lifecycle.

**Acceptance Criteria**

1. A dedicated orchestrator module/service is introduced under `server/services/` (or equivalent worker entrypoint). `[NEW]`
2. Existing generation primitives in `server/openai.ts` and `server/audioService.ts` are invoked by orchestrator, not directly from request handlers for primary flow. `[MODIFY]`
3. Existing route behavior remains backward-compatible in transition mode by dispatching command events instead of executing full pipeline inline. `[MODIFY]`
4. `setImmediate` orchestration startup in routes is removed from primary path after worker activation. `[DEPRECATE]`

### B1.2 Story - Sequential Section Dispatcher

**User Story**  
As a product owner, I want strict section sequence execution so sections 1-4 are generated in order and load stays controlled.

**Acceptance Criteria**

1. Worker enforces ordering: section `N+1` cannot start unless section `N` is `PUBLISHED`. `[NEW]`
2. Existing `sessionOrder` metadata in `progressData` is used as migration hint only, not sole source of truth. `[MODIFY]`
3. Blocking attempts emit structured logs/events with reason `ORDER_GUARD_FAILED`. `[NEW]`
4. Unit tests cover both valid and invalid order execution cases. `[NEW]`

### B1.3 Story - Session Bootstrap from Plan Event

**User Story**  
As an orchestrator engineer, I want session generation to begin from plan-created events so the pipeline starts predictably after planning.

**Acceptance Criteria**

1. Worker consumes session plan creation event (as defined in event contracts file). `[NEW]`
2. Existing weekly-plan generation flow in `/server/routes.ts` remains as upstream producer of plan data. `[EXISTS]`
3. Bootstrap creates section records/states for all 4 sections before processing starts. `[NEW]`
4. Bootstrap failures are retryable and idempotent. `[NEW]`

---

## B2 - Idempotency and Lock Manager

### B2.1 Story - Step-Level Idempotency Keys

**User Story**  
As a platform engineer, I want deterministic idempotency keys per section-step so duplicate events do not duplicate expensive generation calls.

**Acceptance Criteria**

1. Idempotency key format is implemented (`session_id:section_no:step_name:v1`). `[NEW]`
2. Existing `taskProgress` persistence layer is reused to store idempotency/step metadata initially. `[MODIFY]`
3. Duplicate consume attempts with same key are skipped and logged as deduped. `[NEW]`
4. Integration test validates at-least-once delivery does not cause duplicated assets/content rows. `[NEW]`

### B2.2 Story - Distributed Lock Guard

**User Story**  
As an operations engineer, I want a lock guard on section-step execution so concurrent workers cannot run the same step simultaneously.

**Acceptance Criteria**

1. Lock acquisition per `session_id+section_no+step` is enforced before execution. `[NEW]`
2. Lock timeout/heartbeat prevents permanent deadlock from crashed workers. `[NEW]`
3. If lock exists, worker exits gracefully and emits informational event/metric. `[NEW]`
4. Existing retry mechanism is reused for transient lock contention where appropriate. `[EXISTS]`

### B2.3 Story - Safe Re-entrancy

**User Story**  
As a backend maintainer, I want orchestration jobs to be safely re-entrant so restarts can continue from last consistent step.

**Acceptance Criteria**

1. Re-entry detects current section state and resumes from next incomplete step. `[NEW]`
2. Existing prefetch status fields remain readable during migration but do not override orchestrator state. `[MODIFY]`
3. Crash-recovery test demonstrates no duplicated question/audio generation. `[NEW]`

---

## B3 - Retry Policy and Dead-Letter Routing

### B3.1 Story - Unified Retry Classifier

**User Story**  
As a reliability engineer, I want step-specific retry classification so transient failures are retried and permanent failures are stopped early.

**Acceptance Criteria**

1. Error classifier maps failures into `retryable/non-retryable` with canonical codes (`TTS_TIMEOUT`, `SCHEMA_INVALID`, `AUTH_ERROR`, etc.). `[NEW]`
2. Existing `shouldRetryError` utility in `server/services/prefetchRetry.ts` is reused/extended for centralized policy. `[MODIFY]`
3. Retry policies are configurable per step (script, questions, tts, validation, publish). `[NEW]`
4. Retry attempts and delays are persisted and observable. `[NEW]`

### B3.2 Story - Dead-Letter Queue (DLQ) Path

**User Story**  
As an SRE, I want terminal failures routed to a dead-letter stream so we can inspect and replay failed work safely.

**Acceptance Criteria**

1. Terminal failures produce `listening.deadletter` records with full context (`session`, `section`, `step`, `error_code`, `attempts`). `[NEW]`
2. Existing error markers in `progressData.sessionPrefetch` are retained during migration for compatibility. `[EXISTS]`
3. Replay command can requeue a DLQ item after remediation. `[NEW]`
4. DLQ metrics and alerts are published for operational visibility. `[NEW]`

### B3.3 Story - Partial Failure Handling

**User Story**  
As a product engineer, I want partial readiness semantics so user-facing flow can continue when possible while failed sections are handled in backend.

**Acceptance Criteria**

1. Section-level failures do not corrupt already published earlier sections. `[NEW]`
2. Existing `ready_partial` concept is mapped into orchestrator compatibility response where needed. `[MODIFY]`
3. User-facing API returns deterministic status and fallback messaging for not-ready next sections. `[MODIFY]`
4. Failed sections remain recoverable via retry/replay without restarting entire session. `[NEW]`

---

## B4 - Priority Queue for User-Imminent Sessions

### B4.1 Story - Priority Scoring Model

**User Story**  
As a product owner, I want user-imminent sessions prioritized so Part 1 is ready by session start without generating the entire weekly backlog at once.

**Acceptance Criteria**

1. Priority score considers imminence (start window), user intent signals (dashboard open/start click), and readiness gaps. `[NEW]`
2. Existing request signals in session/task endpoints are reused as boost triggers. `[MODIFY]`
3. Sessions are queued by priority class (e.g., `P1 current`, `P2 next_24h`, `P3 later`). `[NEW]`
4. Priority decisions are logged with score components for debugging. `[NEW]`

### B4.2 Story - Prefetch Boost Trigger

**User Story**  
As a frontend/backend integrator, I want a prefetch boost command on user entry so section readiness improves before the user starts.

**Acceptance Criteria**

1. App/API emits a boost command when user lands on listening dashboard/session detail. `[NEW]`
2. Existing warmup behavior in `/api/task-content` and `/api/session/next-listening-task` is preserved during migration. `[EXISTS]`
3. Boost command increases queue priority but does not violate sequential section policy. `[NEW]`
4. Boost command is idempotent for repeated page refreshes. `[NEW]`

### B4.3 Story - Queue Delay Telemetry

**User Story**  
As an SRE, I want queue delay metrics by priority so we can detect starvation and latency regressions.

**Acceptance Criteria**

1. Metrics include `enqueue_to_start_ms` and `start_to_publish_ms` by priority and step. `[NEW]`
2. Existing prefetch logs (`[Prefetch][Start|End|Error]`) are retained and mapped to structured telemetry fields. `[MODIFY]`
3. Alert threshold is defined for prolonged `P1` delay breaches. `[NEW]`

---

## B5 - State Transition Event Publishing

### B5.1 Story - Emit Section Transition Events

**User Story**  
As an app/backend consumer, I want state transition events so clients and downstream services can react to section readiness changes.

**Acceptance Criteria**

1. Orchestrator emits versioned transition events for every state change (`listening.section.state.changed`). `[NEW]`
2. Events include previous/new state, section identifiers, attempt number, and timestamps. `[NEW]`
3. Existing API polling remains supported until subscribers are fully integrated. `[EXISTS]`
4. Event emission failures are retried and never block durable state write. `[NEW]`

### B5.2 Story - Emit Published Manifest Event

**User Story**  
As a frontend consumer, I want a section-published event with manifest metadata so the UI can prefetch exact assets.

**Acceptance Criteria**

1. On successful publish, orchestrator emits `listening.section.published` with manifest reference. `[NEW]`
2. Existing task content fields (`audioUrl`, `questions`) remain available during migration window. `[EXISTS]`
3. Event payload includes enough metadata for app to mark part readiness without extra generation checks. `[NEW]`

### B5.3 Story - App Read Model for Readiness

**User Story**  
As a frontend engineer, I want a readiness read model so the app can quickly render start/warming/ready states.

**Acceptance Criteria**

1. A read model/table/cache is updated from section events for low-latency readiness lookups. `[NEW]`
2. Existing route-based readiness response shape (`phase`, `etaSecs`, session status) remains backward-compatible. `[MODIFY]`
3. Read model is consistent with orchestrator durable state and recovers from replayed events. `[NEW]`

---

## Implementation Notes for Roadmap Item B

1. Start by extracting orchestration from route handlers into a worker service while preserving endpoint contracts.
2. Introduce event publishing/consumption wrappers early to keep migration incremental.
3. Add idempotency + locking before enabling multi-worker scale-out.
4. Keep compatibility adapters for:
- route polling responses
- legacy prefetch statuses
- task-centric storage reads
5. Cut over route handlers from “generate inline” to “dispatch + read status.”

## Suggested Deliverables Checklist (B Complete)

1. Dedicated session orchestrator worker with strict sequential section policy.
2. Idempotency keys + lock manager + re-entrancy behavior.
3. Retry classifier + DLQ routing + replay utility.
4. Priority queueing for user-imminent sessions + telemetry.
5. Section transition/published events + app readiness read model.

