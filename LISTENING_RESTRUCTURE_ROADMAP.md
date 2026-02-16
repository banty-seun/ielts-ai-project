# Listening Module Restructuring Roadmap and Product Backlog

This document defines the implementation roadmap and product backlog for the listening module redesign.

## 1) Goals and Success Criteria

### Goals

- Deliver a robust 4-section listening flow (`32 minutes`, `10 questions/section`).
- Support mixed question-type engines (2-3 blocks per section, config-driven JSON renderer).
- Implement sequential backend generation with low perceived user latency.
- Add accent-based TTS generation and reliable content publishing.
- Deliver per-section result pages and a final personalized coaching report.

### Success Criteria

- `>= 99%` successful section publish rate.
- `Section 1` ready before session start for `>= 95%` of attempts.
- Full session generation completion within defined async SLA.
- Personalized recommendation generation for `>= 98%` completed attempts.
- Zero schema-breaking payloads to renderer in production.

---

## 2) Delivery Timeline (Proposed)

Assume kickoff week starts **February 9, 2026**.

- **Phase 0 (Week 1):** Architecture and contracts finalization
- **Phase 1 (Weeks 2-3):** Orchestration and event backbone
- **Phase 2 (Weeks 4-5):** Script + question generation pipeline
- **Phase 3 (Weeks 6-7):** TTS/accent pipeline + validation gates
- **Phase 4 (Weeks 8-9):** Listening runtime UI integration + section results
- **Phase 5 (Weeks 10-11):** Performance Coach + personalized recommendations
- **Phase 6 (Week 12):** Stabilization, observability + governance hardening, rollout

---

## 3) Roadmap Items with Product Backlog

## Roadmap Item A: Domain Contracts and Architecture Baseline

### Objective

Lock down data models, event contracts, and section-state workflow before build.

### Backlog

1. **A1 - Finalize canonical event envelope**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - Standard envelope fields documented and implemented in shared contract package.
  - Producers and consumers validate envelope at runtime.

2. **A2 - Define section lifecycle state machine**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - States enforced: `PLANNED -> SCRIPT_READY -> QUESTIONS_READY -> AUDIO_READY -> VALIDATED -> PUBLISHED`.
  - Invalid transitions are rejected and logged.

3. **A3 - Define renderer JSON schema for all supported question engines**
- Type: Story
- Priority: P0
- Owner: Backend + Frontend
- Acceptance Criteria:
  - JSON schema includes all required engine configs.
  - Example payloads pass schema checks and render in UI sandbox.

4. **A4 - Content package manifest spec**
- Type: Story
- Priority: P1
- Owner: Backend
- Acceptance Criteria:
  - Manifest includes question JSON URL, audio assets, anchors, answer key.
  - App can load package by manifest only.

5. **A5 - ADRs (Architecture Decision Records)**
- Type: Task
- Priority: P1
- Owner: Engineering Lead
- Acceptance Criteria:
  - ADRs written for orchestration engine, queue/topic strategy, and validation strategy.

### Dependencies

- None (foundational phase).

---

## Roadmap Item B: Sequential Orchestration and Eventing

### Objective

Implement reliable, idempotent section orchestration with strict ordering and retries.

### Backlog

1. **B1 - Session orchestration worker**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - Consumes `listening.session.plan.created`.
  - Enqueues section generation strictly in order (1 to 4).

2. **B2 - Idempotency and lock manager**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - Duplicate events do not duplicate section generation.
  - Step-level idempotency keys are persisted and enforced.

3. **B3 - Retry policy and dead-letter routing**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - Retryable vs non-retryable errors are classified.
  - Failed terminal jobs route to DLQ with debug context.

4. **B4 - Priority queue for user-imminent sessions**
- Type: Story
- Priority: P1
- Owner: Backend
- Acceptance Criteria:
  - Sessions starting soon are prioritized over later weekly sessions.
  - Metrics expose queue delay by priority.

5. **B5 - State transition event publishing**
- Type: Story
- Priority: P1
- Owner: Backend
- Acceptance Criteria:
  - Emits `listening.section.state.changed` and `listening.section.published`.
  - App receives real-time state updates.

### Dependencies

- Requires Roadmap Item A contracts.

---

## Roadmap Item C: Script Generation Subsystem

### Objective

Generate coherent section narratives as 3 linked scripts that respect model constraints.

### Backlog

1. **C1 - Section story blueprint generator**
- Type: Story
- Priority: P0
- Owner: AI/Backend
- Acceptance Criteria:
  - Produces entities, timeline, key facts for section coherence.

2. **C2 - 3-segment script generation**
- Type: Story
- Priority: P0
- Owner: AI/Backend
- Acceptance Criteria:
  - Generates 3 linked segments per section.
  - Segment durations target 2-3 minutes each.

3. **C3 - Anchor marker generation**
- Type: Story
- Priority: P1
- Owner: AI/Backend
- Acceptance Criteria:
  - Outputs stable `listen_from_here` anchors tied to segments/questions.

4. **C4 - Continuity validator**
- Type: Story
- Priority: P1
- Owner: AI/Backend
- Acceptance Criteria:
  - Detects contradictions across segment facts and named entities.
  - Blocks publish on severe inconsistency.

5. **C5 - Prompt/version registry**
- Type: Task
- Priority: P2
- Owner: AI Platform
- Acceptance Criteria:
  - Prompt templates are versioned and traceable in metadata.

### Dependencies

- Depends on A and B.

---

## Roadmap Item D: Question Generation + Config-Driven Renderer Contracts

### Objective

Generate mixed question blocks for each section and render from JSON (not hardcoded UI).

### Backlog

1. **D1 - Question block planner (3 blocks / 10 questions)**
- Type: Story
- Priority: P0
- Owner: AI/Backend
- Acceptance Criteria:
  - Maps question ranges to segments (`3+3+4` or similar).
  - Enforces engine mix from section plan.

2. **D2 - Engine adapters for key question types**
- Type: Story
- Priority: P0
- Owner: AI/Backend
- Acceptance Criteria:
  - Supports form/table completion, completion variants, MCQ, multi-select, map/diagram, matching.

3. **D3 - Answer key + alternate answer handling**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - Every question has accepted answer set and scoring metadata.

4. **D4 - Error tag taxonomy per question**
- Type: Story
- Priority: P1
- Owner: Backend + Learning Design
- Acceptance Criteria:
  - Wrong answers can be mapped to skill/challenge tags.

5. **D5 - Renderer integration harness**
- Type: Story
- Priority: P1
- Owner: Frontend
- Acceptance Criteria:
  - UI renders all supported schema types from JSON fixtures.
  - No hardcoded type-specific branching outside renderer framework.

### Dependencies

- Depends on A, B, C.

---

## Roadmap Item E: Accent-Aware TTS and Asset Pipeline

### Objective

Render and deliver reliable audio assets per segment with accent profile support.

### Backlog

1. **E1 - TTS provider abstraction**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - Unified interface supports selected provider(s), voices, and accents.

2. **E2 - Accent profile resolver**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - Resolves primary + fallback accent/voice for each section.

3. **E3 - Audio rendering worker for 3 segments**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - Renders all 3 segment audios, returns duration and URL metadata.

4. **E4 - Audio normalization and quality checks**
- Type: Story
- Priority: P1
- Owner: Backend
- Acceptance Criteria:
  - Loudness and format normalization applied.
  - Corrupt or zero-length files are rejected.

5. **E5 - Asset storage and signed delivery**
- Type: Story
- Priority: P1
- Owner: Backend/Infra
- Acceptance Criteria:
  - Assets stored with deterministic pathing and cache rules.
  - App can fetch via secure URL/manifest.

### Dependencies

- Depends on B and C.

---

## Roadmap Item F: Validation Gates, Quality, and Publish Controls

### Objective

Prevent invalid content from reaching users.

### Backlog

1. **F1 - Schema validation gate**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - Section fails fast if question JSON violates schema.

2. **F2 - Timing/anchor validator**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - Anchors validated against actual audio durations.

3. **F3 - Completeness validator**
- Type: Story
- Priority: P0
- Owner: Backend
- Acceptance Criteria:
  - 10 questions, full answer key coverage, required metadata present.

4. **F4 - Manual review override for flagged sections**
- Type: Story
- Priority: P2
- Owner: Ops
- Acceptance Criteria:
  - Admin can hold/reject/requeue section package.

5. **F5 - Publish manifest signer**
- Type: Task
- Priority: P2
- Owner: Backend/Infra
- Acceptance Criteria:
  - Published package includes version, checksum, and traceable build metadata.

### Dependencies

- Depends on C, D, E.

---

## Roadmap Item G: Runtime UX, Session Progress, and Section Results

### Objective

Provide smooth UX with minimal perceived wait and clear per-section outcomes.

### Backlog

1. **G1 - Session startup gate on Part 1 readiness**
- Type: Story
- Priority: P0
- Owner: Frontend + Backend
- Acceptance Criteria:
  - User can start when Part 1 is published.
  - Background generation continues for Part 2-4.

2. **G2 - In-session status prefetch and fallback loading**
- Type: Story
- Priority: P1
- Owner: Frontend
- Acceptance Criteria:
  - UI polls/preloads next part readiness.
  - Graceful transition/loading for not-yet-ready part.

3. **G3 - Per-section result page**
- Type: Story
- Priority: P0
- Owner: Frontend + Backend
- Acceptance Criteria:
  - Shows attempted/correct/incorrect/unanswered and quick feedback.

4. **G4 - Attempt telemetry capture**
- Type: Story
- Priority: P1
- Owner: Frontend + Backend
- Acceptance Criteria:
  - Stores answer changes, dwell time, replays, unanswered.

5. **G5 - Accessibility and mobile compatibility pass**
- Type: Story
- Priority: P1
- Owner: Frontend
- Acceptance Criteria:
  - Core listening and answering flow verified across target devices.

### Dependencies

- Depends on B, D, E, F.

---

## Roadmap Item H: Performance Coach and Personalization Loop

### Objective

Generate reliable, actionable personalized strategy output after each full attempt.

### Backlog

1. **H1 - Weakness profiler**
- Type: Story
- Priority: P0
- Owner: AI/Backend
- Acceptance Criteria:
  - Aggregates errors by tag and section, with severity levels.

2. **H2 - Behavior analysis model**
- Type: Story
- Priority: P1
- Owner: AI/Backend
- Acceptance Criteria:
  - Uses timing/playback patterns to distinguish skill vs behavior issues.

3. **H3 - Personalized strategy generator**
- Type: Story
- Priority: P0
- Owner: AI/Backend
- Acceptance Criteria:
  - Outputs 3-5 strategies linked to explicit evidence.

4. **H4 - Next practice set recommender**
- Type: Story
- Priority: P0
- Owner: AI/Backend
- Acceptance Criteria:
  - Recommends drill sets by weakness area, difficulty, and accent.

5. **H5 - Tutor feedback event integration**
- Type: Story
- Priority: P1
- Owner: Backend
- Acceptance Criteria:
  - Emits `listening.weekly.plan.adjustment.requested`.
  - Tutor consumes and updates next weekly plan.

### Dependencies

- Depends on D, G.

---

## Roadmap Item I: Observability, Reliability, and Rollout

### Objective

Ship safely with clear production visibility and controlled rollout.

### Backlog

1. **I1 - End-to-end tracing and dashboards**
- Type: Story
- Priority: P0
- Owner: Backend/Infra
- Acceptance Criteria:
  - Trace spans from plan creation through publish and coaching.
  - Dashboard shows queue delays, failures, publish times.

2. **I2 - Alerting for critical SLO breaches**
- Type: Story
- Priority: P0
- Owner: Infra
- Acceptance Criteria:
  - Alerts for publish failures, DLQ spikes, TTS error spikes.

3. **I3 - Canary rollout by cohort**
- Type: Story
- Priority: P1
- Owner: Product + Engineering
- Acceptance Criteria:
  - Gradual rollout with cohort flags and rollback controls.

4. **I4 - Migration and backfill tooling**
- Type: Story
- Priority: P2
- Owner: Backend
- Acceptance Criteria:
  - Supports reprocessing old sessions/plans into new structure if needed.

5. **I5 - Post-launch QA checklist and runbook**
- Type: Task
- Priority: P1
- Owner: Engineering + Ops
- Acceptance Criteria:
  - Incident response and operational playbook documented.

### Dependencies

- Runs alongside all implementation phases; finalized before full rollout.

---

## Roadmap Item J: AI Governance, Hallucination Prevention, and Security Controls

### Objective

Ensure generated content and coaching outputs are safe, evidence-grounded, auditable, and compliant before broad rollout.

### Backlog

1. **J1 - AI governance policy baseline**
- Type: Story
- Priority: P0
- Owner: Product + Engineering + Security
- Acceptance Criteria:
  - Defines production policy for model/prompt/version approvals.
  - Defines change control workflow for prompts, scoring rules, and agent logic.
  - Defines mandatory audit metadata per generated artifact.

2. **J2 - Hallucination prevention and evidence-binding**
- Type: Story
- Priority: P0
- Owner: AI/Backend
- Acceptance Criteria:
  - All coaching/recommendation outputs must reference evidence (`section`, `questionIds`, `error tags`).
  - Deterministic fallback path is used when confidence/validation fails.
  - Unsupported claims are blocked by validation gate before publish.

3. **J3 - Prompt/model registry and release controls**
- Type: Story
- Priority: P1
- Owner: AI Platform
- Acceptance Criteria:
  - All model/prompt templates are versioned and traceable in metadata.
  - Runtime payload records include model version + prompt version used.
  - Rollback to previous approved prompt/model version is supported.

4. **J4 - Data security and privacy guardrails**
- Type: Story
- Priority: P0
- Owner: Backend + Security
- Acceptance Criteria:
  - PII redaction policy enforced in logs/events.
  - Secrets are only loaded from secure env/secret manager and never returned in API payloads.
  - Data retention/deletion policy exists for generated content and analytics metadata.

5. **J5 - Human override and compliance audit workflow**
- Type: Story
- Priority: P1
- Owner: Ops + Product
- Acceptance Criteria:
  - Flagged sections/reports can be held, re-reviewed, or force-regenerated by authorized operators.
  - Override actions are logged with actor, timestamp, reason, and affected artifact IDs.
  - Quarterly governance audit checklist is documented and executable.

### Dependencies

- Depends on A, F, H, I.

---

## 4) Cross-Cutting Non-Functional Backlog

1. **N1 - Security and secret management hardening**
- Priority: P0
- Acceptance Criteria: all provider keys in secret manager, no plaintext in logs.

2. **N2 - Data retention and privacy policy alignment**
- Priority: P1
- Acceptance Criteria: metadata retention policy enforced by scheduled jobs.

3. **N3 - Cost guardrails**
- Priority: P1
- Acceptance Criteria: per-session LLM/TTS cost tracking and budget alerts.

4. **N4 - Test strategy**
- Priority: P0
- Acceptance Criteria:
  - contract tests for events
  - integration tests for section pipeline
  - e2e tests for full listening attempt and final report

---

## 5) Release Plan and Milestone Gates

## Milestone M1: Foundations Ready

- Complete: A, B (P0 stories)
- Exit Criteria:
  - Session orchestration runs sequentially in staging.
  - Event contracts are validated in CI.

## Milestone M2: Content Pipeline Ready

- Complete: C, D, E (P0 stories)
- Exit Criteria:
  - All 4 sections can be generated end-to-end in staging.
  - JSON renderer consumes generated question blocks.

## Milestone M3: Learner Experience Ready

- Complete: F, G (P0 stories)
- Exit Criteria:
  - Per-section result pages live.
  - Part 1 startup latency target achieved in staging load test.

## Milestone M4: Personalization Loop Ready

- Complete: H (P0 stories)
- Exit Criteria:
  - Final report includes personalized strategies + challenge highlights + next set.
  - Tutor receives actionable plan-adjustment signals.

## Milestone M5: Production Rollout

- Complete: I + J + non-functional backlog P0
- Exit Criteria:
  - Canary stable for agreed duration.
  - No critical SLO breaches.
  - Governance/security gates pass for production cohort expansion.

---

## 6) Suggested Sprint Slicing (2-week sprints)

- **Sprint 1:** A + B1/B2/B3
- **Sprint 2:** B4/B5 + C1/C2
- **Sprint 3:** C3/C4 + D1/D2
- **Sprint 4:** D3/D4/D5 + E1/E2
- **Sprint 5:** E3/E4/E5 + F1/F2/F3
- **Sprint 6:** G1/G2/G3 + H1/H3
- **Sprint 7:** G4/G5 + H2/H4/H5
- **Sprint 8:** I1/I2/I3 + J1/J2
- **Sprint 9:** I4/I5 + J3/J4/J5 + final hardening

---

## 7) Ownership Matrix (High-Level)

- **Tutor/Coach logic:** AI + Backend
- **Orchestration/eventing:** Backend + Infra
- **Generation + validation pipeline:** Backend + AI
- **Runtime renderer/UI:** Frontend
- **Observability/reliability:** Infra + Backend
- **AI governance/security/compliance:** Product + Security + AI Platform + Backend
- **Pedagogical quality:** Learning Design + AI
