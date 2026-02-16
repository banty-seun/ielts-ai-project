# Roadmap Item G: Runtime UX, Session Progress, and Section Results

This document expands **Roadmap Item G** from `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md` into detailed user stories and acceptance criteria.

It is codebase-aware and identifies what runtime UX/session-result capabilities already exist versus what must be added for section-based listening flow.

## Label Legend

- `[EXISTS]` Already implemented and reusable.
- `[MODIFY]` Exists but needs adaptation.
- `[NEW]` Must be added.
- `[DEPRECATE]` Should be phased out from critical path.

---

## 0) Current-State Baseline (Roadmap G Scope)

### Reusable foundation

1. Session runtime page exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/client/src/pages/listening-session.tsx`. `[EXISTS]`
2. Session lifecycle hook exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/client/src/hooks/useListeningSession.ts` (pause/resume/sync/submit/next). `[EXISTS]`
3. Drift-resistant timer exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/client/src/hooks/useSessionTimer.ts`. `[EXISTS]`
4. Practice runtime UI exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/client/src/components/practice/ListeningPracticeSession.tsx`. `[EXISTS]`
5. End-of-session summary component exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/client/src/components/practice/SessionSummary.tsx`. `[EXISTS]`
6. Readiness/warming API response shape exists (`ready`, `phase`, `etaSecs`, `session.status`) in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` and `/Users/oluwaseunbantale/Documents/ielts-ai-project/client/src/hooks/useTaskContent.ts`. `[EXISTS]`

### Gaps vs target architecture

1. Current runtime flow is audio-package centric; explicit section/part UX (Part 1..4 with 10 questions each and section result pages) is not first-class yet. `[MODIFY]`
2. No native UI model for “3 internal blocks within each section” as the primary interaction unit. `[NEW]`
3. Existing summary is end-of-session; per-section result pages with challenge breakdowns are not fully implemented. `[MODIFY]`
4. No explicit runtime read model tied to orchestrator section-state events. `[NEW]`

### Candidates to phase out

1. Runtime assumption that “next audio” top-up is the primary progression model for listening sessions. `[DEPRECATE]`
2. Session UX depending on route-triggered generation side-effects instead of explicit readiness contracts. `[DEPRECATE]`

---

## G1 - Session Startup Gate on Part 1 Readiness

### G1.1 Story - Startup Readiness Contract

**User Story**  
As a learner, I want to start immediately when Part 1 is ready so I do not wait for all parts before beginning.

**Acceptance Criteria**

1. Session startup requires `Part 1` readiness only (published/ready state), not full session readiness. `[NEW]`
2. Existing readiness responses (`ready`, `phase`, `etaSecs`) remain supported during migration. `[EXISTS]`
3. If Part 1 is not ready, UI shows deterministic waiting state with retry/polling strategy. `[MODIFY]`
4. Startup gate logic is driven by orchestrator state/read model, not route-side generation trigger. `[NEW]`

### G1.2 Story - Fallback for Legacy Runtime

**User Story**  
As a release engineer, I want backward compatibility for current session-start endpoints so rollout can happen without breaking active users.

**Acceptance Criteria**

1. Existing `/api/session/start` flow continues to work for legacy session objects. `[EXISTS]`
2. New clients can consume section readiness contract while old clients remain on legacy package shape. `[MODIFY]`
3. Feature flag controls which startup gate mode is active per cohort/environment. `[NEW]`
4. Rollback to legacy startup mode is possible without schema migration rollback. `[NEW]`

### G1.3 Story - User Intent Boost Integration

**User Story**  
As a backend integrator, I want dashboard/open/start interactions to boost generation priority so Part 1 is ready by expected start time.

**Acceptance Criteria**

1. On dashboard/session open, frontend triggers readiness refresh/boost signal. `[NEW]`
2. Existing prefetch warmup triggers in task-content flow remain supported in migration. `[EXISTS]`
3. Boost requests are idempotent and do not duplicate session jobs. `[NEW]`
4. Telemetry tracks startup gate wait times and boost effectiveness. `[NEW]`

---

## G2 - In-Session Status Prefetch and Fallback Loading

### G2.1 Story - Next-Part Prefetch Status UI

**User Story**  
As a learner, I want visible next-part readiness status while I work on the current part so transitions feel smooth.

**Acceptance Criteria**

1. Runtime header/status area shows next-part readiness (`ready`, `warming`, `queued`, `error`). `[NEW]`
2. Existing `phase` and `etaSecs` values are reused where available for transitional display. `[EXISTS]`
3. Status refresh interval is configurable and avoids aggressive polling. `[NEW]`
4. Status errors are non-blocking and degrade gracefully to retry state. `[NEW]`

### G2.2 Story - Transition Fallback Loader

**User Story**  
As a learner, I want a clear fallback transition when the next part is not ready so I understand what is happening.

**Acceptance Criteria**

1. If next part not ready on transition, show blocking transition screen with context and retry behavior. `[NEW]`
2. Existing “Generating next audio...” loading affordance in runtime can be reused as base UX pattern. `[EXISTS]`
3. Transition loader supports timeout/escalation path with user-safe messaging. `[NEW]`
4. Transition does not lose in-progress answers from completed part. `[NEW]`

### G2.3 Story - Polling and Recovery Strategy

**User Story**  
As an app engineer, I want robust polling/recovery logic so temporary backend delays do not force users to restart sessions.

**Acceptance Criteria**

1. Polling backoff strategy is implemented for next-part readiness checks. `[NEW]`
2. Existing request-next flow in `useListeningSession` is adapted for section-aware progression. `[MODIFY]`
3. Recovery path handles transient API failures and resumes automatically when possible. `[NEW]`
4. Persistent failures surface retry + exit-safe actions without data loss. `[NEW]`

---

## G3 - Per-Section Result Page

### G3.1 Story - Section Result Data Model

**User Story**  
As a learner, I want a result page after each section so I can review performance before moving on.

**Acceptance Criteria**

1. Section result contract includes: attempted, correct, incorrect, unanswered, accuracy, and timing summary. `[NEW]`
2. Existing scoring summaries and result structures in `shared/schema.ts` remain supported for session-end compatibility. `[MODIFY]`
3. Result payload includes challenge tags aggregated from question outcomes. `[NEW]`
4. Section results are persisted and retrievable independently of full-session completion. `[NEW]`

### G3.2 Story - Section Result UI

**User Story**  
As a learner, I want a clear, actionable section result screen so I can understand immediate strengths and weaknesses.

**Acceptance Criteria**

1. A dedicated per-section result component/page is added and shown on section submission. `[NEW]`
2. Existing `SessionSummary` remains as full-session terminal summary in migration mode. `[EXISTS]`
3. UI presents quick feedback by question type/challenge area. `[NEW]`
4. User can proceed to next section only after acknowledging section result state. `[NEW]`

### G3.3 Story - Section Review Navigation

**User Story**  
As a learner, I want section-level question review status so I can see which items were answered/skipped.

**Acceptance Criteria**

1. Section result view supports per-question status chips (correct/incorrect/unanswered). `[NEW]`
2. Existing answer-capture model in `ListeningPracticeSession` is reused for outcome derivation. `[EXISTS]`
3. Review navigation remains read-only after section submission unless product policy allows edits. `[NEW]`
4. Review state is consistent across refresh/resume. `[NEW]`

---

## G4 - Attempt Telemetry Capture

### G4.1 Story - Detailed Interaction Telemetry

**User Story**  
As a learning analytics owner, I want detailed interaction telemetry so performance diagnostics and personalization are evidence-based.

**Acceptance Criteria**

1. Telemetry captures per-question response time, answer changes, replay counts, and unanswered state. `[NEW]`
2. Existing `TaskAttempt` model already captures core answer/score/duration fields and is reused. `[EXISTS]`
3. Telemetry schema versioning is defined for future additions. `[NEW]`
4. Missing telemetry fields in legacy sessions do not break processing pipelines. `[MODIFY]`

### G4.2 Story - Section and Session Analytics Aggregation

**User Story**  
As a backend engineer, I want analytics aggregated by section and full session so coaches and reports can use consistent metrics.

**Acceptance Criteria**

1. Aggregation outputs per-section and full-session analytics artifacts. `[NEW]`
2. Existing histogram/tag aggregation logic in `server/services/scoring.ts` and `server/services/feedback.ts` is reused where applicable. `[EXISTS]`
3. Aggregates include playback behavior and timing distribution metadata. `[NEW]`
4. Aggregation jobs are idempotent and rerunnable. `[NEW]`

### G4.3 Story - Telemetry Privacy and Retention Controls

**User Story**  
As a compliance owner, I want retention and minimization controls for telemetry so analytics remain privacy-safe.

**Acceptance Criteria**

1. Telemetry retention policy is defined and enforced via scheduled cleanup. `[NEW]`
2. Personally sensitive fields are excluded or masked in analytics storage where not required. `[NEW]`
3. Existing storage paths are reviewed for least-data principle and updated where needed. `[MODIFY]`
4. Compliance checks are included in release checklist. `[NEW]`

---

## G5 - Accessibility and Mobile Compatibility Pass

### G5.1 Story - Mobile Runtime Usability

**User Story**  
As a mobile user, I want section runtime interactions (audio controls, question answering, navigation) to be usable without layout breakage.

**Acceptance Criteria**

1. Core runtime views are validated at target mobile breakpoints for layout, tap targets, and scroll behavior. `[NEW]`
2. Existing responsive structure in current practice components is reused as baseline. `[EXISTS]`
3. Section transitions and result pages are mobile-optimized. `[NEW]`
4. Mobile regressions are covered by automated viewport tests where feasible. `[NEW]`

### G5.2 Story - Accessibility Baseline for Runtime

**User Story**  
As a learner using assistive technology, I want accessible runtime controls and result screens so I can complete sessions independently.

**Acceptance Criteria**

1. Keyboard navigation supports all interactive controls (audio, answer inputs, submit, next). `[NEW]`
2. Form controls have proper labels/ARIA attributes and error messaging semantics. `[NEW]`
3. Existing components are audited and remediated for color contrast and focus states. `[MODIFY]`
4. Accessibility checks are included in CI/lint gates where possible. `[NEW]`

### G5.3 Story - Runtime Resilience UX

**User Story**  
As a learner, I want robust runtime behavior under network interruptions so I do not lose progress.

**Acceptance Criteria**

1. In-flight answer state survives transient network failures and refreshes within session policy. `[NEW]`
2. Existing session sync/pause/resume endpoints are reused for recovery where possible. `[EXISTS]`
3. Recovery messaging is user-friendly and avoids technical error leakage. `[NEW]`
4. Resume path restores current section/block/question context deterministically. `[NEW]`

---

## Implementation Notes for Roadmap Item G

1. Keep current session infrastructure (timer, pause/resume, sync) and adapt it to section-first runtime semantics.
2. Introduce explicit per-section UX states (in-progress, submitted, result-shown) while keeping final session summary.
3. Replace top-up “next audio” assumptions with next-section readiness contracts from orchestrator/read model.
4. Expand telemetry capture incrementally and feed standardized outputs into Performance Coach pipeline.
5. Maintain backward-compatible readiness API fields during migration.

## Suggested Deliverables Checklist (G Complete)

1. Part-1 startup gate + readiness-based runtime entry.
2. Next-section prefetch status and transition fallback UX.
3. Per-section result pages with challenge breakdown.
4. Detailed attempt telemetry capture and aggregation.
5. Mobile/accessibility hardening and resilience UX pass.

