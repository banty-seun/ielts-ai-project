# Roadmap Item A: Domain Contracts and Architecture Baseline

This document expands **Roadmap Item A** from `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md` into detailed user stories and acceptance criteria.

It also maps current codebase capabilities so implementation reuses what exists and only adds what is missing.

## Label Legend

- `[EXISTS]` Already implemented and reusable.
- `[MODIFY]` Exists but needs adaptation.
- `[NEW]` Must be added.
- `[DEPRECATE]` Should be phased out from critical path.

---

## 0) Current-State Baseline (Codebase Assessment)

### Reusable foundation

1. `TaskProgress` content fields and listening metadata exist in `/Users/oluwaseunbantale/Documents/ielts-ai-project/shared/schema.ts` (`scriptText`, `audioUrl`, `questions`, `accent`, `ieltsPart`, etc.). `[EXISTS]`
2. Session state and timed listening flow endpoints exist in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` and hooks/components (`/api/session/start|pause|resume|finish`). `[EXISTS]`
3. Prefetch status model exists (`idle|queued|running|ready|ready_partial|error`) in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`. `[EXISTS]`
4. Script/question/audio generation primitives exist:
   - `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/openai.ts`
   - `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/audioService.ts` `[EXISTS]`
5. Retry helper exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/prefetchRetry.ts`. `[EXISTS]`

### Gaps vs target architecture

1. No canonical event envelope or event bus contracts in shared types. `[NEW]`
2. Orchestration logic is embedded in route handlers and `setImmediate` job kicks, not an explicit orchestration domain service. `[MODIFY]`
3. Question model is mostly MCQ-centric; no formal schema for config-driven multi-engine blocks. `[MODIFY]`
4. No formal publish manifest contract (`questions.json`, segment audio assets, anchors, answer keys). `[NEW]`
5. No ADR set documenting architecture decisions for listening pipeline evolution. `[NEW]`

### Candidates to phase out from critical path

1. Route-level 3-stage generation directly inside task content fetch and next-task endpoint in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` (pipeline stages embedded in API path). `[DEPRECATE]`
2. Implicit orchestration via `progressData.sessionPrefetch` as control-plane source of truth (retain as transitional compatibility only). `[MODIFY]`

---

## A1 - Finalize Canonical Event Envelope

### A1.1 Story - Shared Event Envelope Type

**User Story**  
As a backend engineer, I want a shared canonical event envelope so all listening producers/consumers can exchange events with consistent metadata and traceability.

**Acceptance Criteria**

1. A shared type/schema for event envelope is introduced in `shared/` and exported for server usage. `[NEW]`
2. Envelope includes at minimum: `event_id`, `event_type`, `event_version`, `occurred_at`, `producer`, `trace_id`, `correlation_id`, `idempotency_key`, `user_id`, `payload`. `[NEW]`
3. Existing request/trace logging in `server/routes.ts` is mapped to `trace_id/correlation_id` format for listening flows. `[MODIFY]`
4. Schema parsing uses runtime validation (zod equivalent) before publish/consume. `[NEW]`
5. Event schema versioning rule is documented (`major/minor/patch` semantics). `[NEW]`

### A1.2 Story - Event Publisher/Consumer Wrapper

**User Story**  
As a platform engineer, I want a publisher/consumer wrapper so listening services can emit and process events with idempotency checks.

**Acceptance Criteria**

1. A central event helper module is added under `server/services/` with publish and consume contract helpers. `[NEW]`
2. Existing retry helper (`server/services/prefetchRetry.ts`) is reused for transient processing errors where applicable. `[EXISTS]`
3. Idempotency key generation is deterministic per `session_id:section_no:step`. `[NEW]`
4. Duplicate event processing is ignored and logged with idempotency metadata. `[NEW]`

### A1.3 Story - Topic/Stream Naming Contract

**User Story**  
As a system integrator, I want stable topic names so agents and services are loosely coupled.

**Acceptance Criteria**

1. Listening topic constants are defined in shared config (`listening.plan.events`, `listening.section.commands`, `listening.section.events`, `listening.feedback.events`, etc.). `[NEW]`
2. Hardcoded prefetch-phase strings in route logic remain supported temporarily for backward compatibility. `[MODIFY]`
3. New event constants are referenced by orchestrator/sub-agent entry points only, not duplicated literals. `[NEW]`

---

## A2 - Define Section Lifecycle State Machine

### A2.1 Story - Domain State Machine for Section Build

**User Story**  
As an orchestration engineer, I want an explicit section lifecycle state machine so section processing is deterministic and auditable.

**Acceptance Criteria**

1. States are defined as a domain enum/type: `PLANNED`, `SCRIPT_READY`, `QUESTIONS_READY`, `AUDIO_READY`, `VALIDATED`, `PUBLISHED`, `FAILED`. `[NEW]`
2. Existing prefetch statuses (`idle`, `queued`, `running`, `ready`, `ready_partial`, `error`) are mapped to the new states in a compatibility adapter. `[MODIFY]`
3. Invalid transitions are blocked and logged with `section_id`, `from_state`, `to_state`, `event_id`. `[NEW]`
4. Transition function is pure/testable (unit tests for allowed/blocked transitions). `[NEW]`

### A2.2 Story - Section State Persistence

**User Story**  
As a backend developer, I want section state persisted independently from route-local logic so generation can recover from worker restarts.

**Acceptance Criteria**

1. State persistence is implemented in durable storage (existing `progressData` may be used first, but structured section state must be introduced). `[MODIFY]`
2. Existing `taskProgress.progressData` remains readable to avoid breaking current sessions. `[EXISTS]`
3. State record includes `attempt`, `last_error_code`, `updated_at`, `idempotency_key`. `[NEW]`
4. Recovery test proves worker resumes from last valid state after simulated crash. `[NEW]`

### A2.3 Story - Sequential Section Policy

**User Story**  
As a product owner, I want sections generated sequentially so provider load remains controlled while users see low latency.

**Acceptance Criteria**

1. Orchestrator enforces strict order: section 1 must be `PUBLISHED` before section 2 starts, etc. `[NEW]`
2. Existing `sessionOrder` values in `progressData` are reused as migration hints where present. `[EXISTS]`
3. Any concurrent attempt to start a later section is rejected with a structured domain error. `[NEW]`
4. Observability logs include blocked-order violations. `[NEW]`

### A2.4 Story - Route Decoupling from Pipeline State

**User Story**  
As a backend maintainer, I want route handlers to read state rather than orchestrate generation so API latency and complexity are reduced.

**Acceptance Criteria**

1. Route handlers stop executing full generation stages inline (script->questions->audio) as primary behavior. `[DEPRECATE]`
2. Existing route endpoints continue to function by querying orchestrator state and returning warming/ready responses. `[MODIFY]`
3. `setImmediate` route-triggered orchestration is replaced with explicit command/event dispatch. `[DEPRECATE]`

---

## A3 - Define Renderer JSON Schema for Supported Question Engines

### A3.1 Story - Renderer Root Schema

**User Story**  
As a frontend engineer, I want one renderer root schema so the listening UI can render all question blocks from JSON without hardcoded flows.

**Acceptance Criteria**

1. Root schema defines section payload with blocks, question number ranges, instructions, and rendering hints. `[NEW]`
2. Existing question structure in `taskContentUpdateSchema.questions` remains supported via compatibility transform. `[MODIFY]`
3. Schema includes explicit version field (e.g., `renderer_schema_version`). `[NEW]`
4. Validation failures return actionable error path information for debugging. `[NEW]`

### A3.2 Story - Engine-Specific Schemas

**User Story**  
As a content engineer, I want strict engine schemas so each question type is validated consistently before publish.

**Acceptance Criteria**

1. Schemas are defined for at least:
   - form/table completion
   - sentence/note/summary completion
   - MCQ single-select
   - multi-select
   - map/diagram labeling
   - matching/letter mapping `[NEW]`
2. Existing MCQ shape (`id`, `question`, `options`, `correctAnswer`) is treated as supported legacy engine contract. `[EXISTS]`
3. Existing scoring tag conventions in `/server/services/scoring.ts` are integrated into new schema tag field constraints. `[EXISTS]`
4. Schema disallows ambiguous/partial engine configs (required keys enforced). `[NEW]`

### A3.3 Story - Block-to-Segment Mapping Contract

**User Story**  
As an orchestrator developer, I want a formal mapping from 3 script segments to 2-3 question blocks so section assembly is deterministic.

**Acceptance Criteria**

1. Contract supports section-internal block splits (e.g., `3+3+4`) and stores `segment_no` linkage. `[NEW]`
2. Existing assignment/order helpers in `/server/services/segmentOrder.ts` are reused where possible for mapping and order normalization. `[EXISTS]`
3. Any question without a block/segment mapping fails validation. `[NEW]`
4. Mapping contract is tested with at least 3 representative section templates from screenshot-inspired layouts. `[NEW]`

### A3.4 Story - Frontend Schema Harness

**User Story**  
As a QA engineer, I want fixture-based renderer tests so schema changes do not break runtime rendering.

**Acceptance Criteria**

1. Frontend test fixtures for all supported engines are added and validated against schema before render tests run. `[NEW]`
2. Existing listening session UI components remain functional for legacy MCQ payloads during migration. `[EXISTS]`
3. CI fails if a fixture passes TypeScript but fails runtime schema validation. `[NEW]`

---

## A4 - Content Package Manifest Spec

### A4.1 Story - Publish Manifest Domain Model

**User Story**  
As an app client engineer, I want a section manifest so the app can fetch all assets by one contract.

**Acceptance Criteria**

1. Manifest model includes:
   - `question_json_url`
   - `audio_assets[]` (segment/accent/url/duration)
   - `anchors_url`
   - `answer_key_url`
   - `build/version metadata` `[NEW]`
2. Existing single `audioUrl` and `questions` fields remain readable for backward compatibility during migration. `[EXISTS]`
3. Manifest is immutable once section is `PUBLISHED` (new version required for changes). `[NEW]`

### A4.2 Story - Manifest Producer in Pipeline

**User Story**  
As an orchestrator engineer, I want manifest generation after validation so published sections are complete and traceable.

**Acceptance Criteria**

1. Manifest is generated only after schema, timing, and answer-key validation passes. `[NEW]`
2. Existing audio generation result (`audioUrl`, `duration`) from `/server/audioService.ts` is reused as source for manifest asset entries. `[EXISTS]`
3. Existing transcript completeness check in `/server/services/content.ts` is reused before publish. `[EXISTS]`
4. Publish event includes manifest reference and section metadata. `[NEW]`

### A4.3 Story - Manifest Consumer Integration

**User Story**  
As an API developer, I want API responses to expose manifest-based readiness so clients can start sessions without guessing readiness.

**Acceptance Criteria**

1. Task/session fetch endpoints return manifest status and `part_ready` flags sourced from orchestrator state. `[MODIFY]`
2. Existing prefetch response shape (`phase`, `etaSecs`, `session.status`) remains temporarily available for old clients. `[EXISTS]`
3. New clients use manifest fields and no longer depend on route-embedded generation side effects. `[NEW]`

---

## A5 - ADRs (Architecture Decision Records)

### A5.1 Story - ADR: Orchestration Strategy

**User Story**  
As an engineering lead, I want an ADR for orchestration strategy so implementation aligns on sequential section processing and failure semantics.

**Acceptance Criteria**

1. ADR captures rationale for sequential per-session processing with user-imminent prioritization. `[NEW]`
2. ADR documents migration path from route-driven prefetch to orchestrator-driven commands/events. `[NEW]`
3. ADR references current behavior in `/server/routes.ts` and `sessionPrefetch` so deltas are explicit. `[EXISTS]`

### A5.2 Story - ADR: Contract and Versioning Policy

**User Story**  
As a platform architect, I want an ADR for contract/versioning so event and schema changes remain backward compatible.

**Acceptance Criteria**

1. ADR defines event/schema versioning rules and deprecation windows. `[NEW]`
2. ADR includes compatibility requirements for current `TaskProgress` content shape. `[EXISTS]`
3. ADR documents how old MCQ-only payloads are transformed to renderer schema. `[MODIFY]`

### A5.3 Story - ADR: Validation and Quality Gates

**User Story**  
As a quality owner, I want an ADR for validation gates so no invalid section package reaches production.

**Acceptance Criteria**

1. ADR defines publish gates: transcript completeness, question schema validity, answer key completeness, audio duration/anchor checks. `[NEW]`
2. ADR explicitly reuses current transcript validator (`server/services/content.ts`) and scoring/tag patterns (`server/services/scoring.ts`). `[EXISTS]`
3. ADR defines failure handling (retry, dead-letter, manual review entry points). `[NEW]`

---

## Implementation Notes for Roadmap Item A

1. Build contracts first in `shared/` so both backend workers and API routes compile against the same types.
2. Keep compatibility adapters during rollout:
- old route statuses -> new domain states
- old question payload -> renderer blocks
- old task content fields -> manifest link resolution
3. Remove route-embedded generation only after orchestrator and manifest readers are stable in staging.

## Suggested Deliverables Checklist (A Complete)

1. Shared event envelope type + runtime validator.
2. Section state machine module + transition tests.
3. Renderer JSON schemas (root + engines + mapping) + fixture tests.
4. Section publish manifest contract + producer/consumer wiring.
5. 3 ADR docs merged and linked from roadmap.

### ADR Links

1. `docs/adr/ADR-001-listening-orchestration-strategy.md`
2. `docs/adr/ADR-002-listening-contract-versioning-policy.md`
3. `docs/adr/ADR-003-listening-validation-quality-gates.md`
