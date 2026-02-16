# Roadmap Item F: Validation Gates, Quality, and Publish Controls

This document expands **Roadmap Item F** from `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md` into detailed user stories and acceptance criteria.

It is codebase-aware and identifies what validation/publish controls already exist versus what must be added for the new section-based architecture.

## Label Legend

- `[EXISTS]` Already implemented and reusable.
- `[MODIFY]` Exists but needs adaptation.
- `[NEW]` Must be added.
- `[DEPRECATE]` Should be phased out from critical path.

---

## 0) Current-State Baseline (Roadmap F Scope)

### Reusable foundation

1. Transcript quality validation exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/content.ts` (`validateTranscriptComplete`). `[EXISTS]`
2. Retry and error classification baseline exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/prefetchRetry.ts` and prefetch flow in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`. `[EXISTS]`
3. Readiness statuses and progression flags are stored in `progressData.sessionPrefetch` within `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`. `[EXISTS]`
4. Question normalization and segment ordering logic exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/segmentOrder.ts` and route normalization block. `[EXISTS]`
5. Audio presence checks exist via `checkAudioExists` and S3 `HeadObject` checks in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/audioService.ts` and `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/audio/uploadPollyMp3.ts`. `[EXISTS]`

### Gaps vs target architecture

1. No unified section-level validation gate framework (schema, timing anchors, answer keys, manifest completeness) before publish. `[NEW]`
2. No explicit publish state `VALIDATED -> PUBLISHED` with hard gate semantics beyond prefetch readiness flags. `[MODIFY]`
3. No centralized quality report artifact per section generation run. `[NEW]`
4. No structured manual review queue/override workflow for flagged content. `[NEW]`
5. No manifest signer/checksum integrity contract for final published packages. `[NEW]`

### Candidates to phase out

1. Route-level “best effort” fallback to partial-ready as final quality outcome without explicit validation bundle. `[DEPRECATE]`
2. Ad-hoc console logging as primary quality evidence. `[DEPRECATE]`

---

## F1 - Schema Validation Gate

### F1.1 Story - Unified Validation Orchestrator

**User Story**  
As a backend engineer, I want a centralized validation orchestrator so all section artifacts pass required checks before publish.

**Acceptance Criteria**

1. Validation orchestrator runs as a distinct step after generation and before publish (`VALIDATION_GATE`). `[NEW]`
2. Existing transcript validator (`validateTranscriptComplete`) is integrated as one gate within the orchestrator. `[EXISTS]`
3. Gate supports pluggable validators (question schema, answer keys, anchors, assets). `[NEW]`
4. Gate outputs pass/fail verdict plus structured failure reasons. `[NEW]`

### F1.2 Story - Renderer Schema Validation

**User Story**  
As a frontend reliability owner, I want strict renderer schema validation so malformed question payloads never reach runtime UI.

**Acceptance Criteria**

1. Section question payload is validated against renderer contract schema from Roadmap D. `[NEW]`
2. Existing legacy MCQ shape compatibility remains supported through explicit adapter validation path. `[MODIFY]`
3. Invalid schema blocks publish and emits canonical error code (e.g., `QUESTION_SCHEMA_INVALID`). `[NEW]`
4. Validation error includes field-level path for debugging. `[NEW]`

### F1.3 Story - Question Coverage Validation

**User Story**  
As a content QA engineer, I want full question coverage checks so each section has exactly 10 valid questions mapped to blocks.

**Acceptance Criteria**

1. Gate verifies exactly 10 section questions with no duplicate question numbers. `[NEW]`
2. Existing segment assignment utilities (`segmentAssignments`, `segmentOrder`) are reused to verify mapping completeness where applicable. `[EXISTS]`
3. Every question must map to one block and one segment. `[NEW]`
4. Coverage failure blocks publish and returns actionable diagnostics. `[NEW]`

---

## F2 - Timing/Anchor Validator

### F2.1 Story - Anchor Bounds Validator

**User Story**  
As a QA engineer, I want anchor offsets validated against real audio durations so “listen from here” actions are always valid.

**Acceptance Criteria**

1. Each anchor offset is validated as `0 <= offset < segment_duration`. `[NEW]`
2. Existing audio duration metadata from TTS pipeline is reused for bounds checks. `[MODIFY]`
3. Out-of-range anchors fail validation with error code `ANCHOR_OUT_OF_BOUNDS`. `[NEW]`
4. Validator report includes segment and anchor identifiers for remediation. `[NEW]`

### F2.2 Story - Segment Duration Consistency Validator

**User Story**  
As a product engineer, I want duration consistency checks so section audio stays within expected timing budget.

**Acceptance Criteria**

1. Segment durations are checked against configured min/max bounds. `[NEW]`
2. Existing estimated duration fields (`estimatedDurationSec`) are treated as auxiliary, not sole source of truth for gate decisions. `[MODIFY]`
3. Section total duration is checked against configured section budget tolerance. `[NEW]`
4. Violations trigger targeted regeneration policy for affected segment(s). `[NEW]`

### F2.3 Story - Timing QA Artifact

**User Story**  
As an operator, I want a timing QA artifact so timing gate outcomes are traceable and auditable.

**Acceptance Criteria**

1. Timing validator writes structured QA artifact per section run (durations, anchors, deviations). `[NEW]`
2. Artifact link is attached to section state/event metadata. `[NEW]`
3. Existing logs can remain for debugging but cannot replace persisted QA artifacts. `[MODIFY]`

---

## F3 - Completeness Validator

### F3.1 Story - Answer Key Completeness Gate

**User Story**  
As a scoring engineer, I want answer-key completeness validation so all questions are gradeable before publish.

**Acceptance Criteria**

1. Every question has answer-key coverage according to engine type (single/multi/text/matching). `[NEW]`
2. Existing MCQ scoring compatibility in `/server/services/scoring.ts` is preserved during migration. `[EXISTS]`
3. Missing answer-key entries fail gate with `ANSWER_KEY_MISSING`. `[NEW]`
4. Validation report includes unresolved question IDs. `[NEW]`

### F3.2 Story - Asset Completeness Gate

**User Story**  
As an app engineer, I want asset completeness validation so published sections never reference missing audio artifacts.

**Acceptance Criteria**

1. Gate verifies all required segment assets exist and are retrievable (HEAD/metadata). `[NEW]`
2. Existing `checkAudioExists` and upload head checks are reused/extended for segment batches. `[MODIFY]`
3. Missing or inaccessible asset blocks publish with `ASSET_MISSING`/`ASSET_UNREACHABLE`. `[NEW]`
4. Asset verification details are persisted with publish candidate metadata. `[NEW]`

### F3.3 Story - Manifest Completeness Gate

**User Story**  
As a client consumer, I want manifest completeness checks so app can load section runtime from one coherent package.

**Acceptance Criteria**

1. Manifest contains required references: question payload, answer key, anchors, and all segment audio entries. `[NEW]`
2. Legacy fallback fields (`audioUrl`, legacy `questions`) remain available while migration flag is active. `[MODIFY]`
3. Incomplete manifest fails gate with canonical error code. `[NEW]`
4. Manifest schema version is present and validated. `[NEW]`

---

## F4 - Manual Review Override for Flagged Sections

### F4.1 Story - Flagged Content Review Queue

**User Story**  
As an operations reviewer, I want a review queue for flagged sections so high-risk content is inspected before publication.

**Acceptance Criteria**

1. Sections with configured high-severity validation failures are routed to a review queue state. `[NEW]`
2. Existing failure statuses in prefetch flow remain mapped for compatibility but are not final publish control state. `[MODIFY]`
3. Queue item includes section context, failed checks, artifacts, and replay options. `[NEW]`
4. Review queue supports pagination/filtering by failure type and severity. `[NEW]`

### F4.2 Story - Manual Approve/Reject/Requeue Controls

**User Story**  
As a reviewer, I want explicit override actions so I can approve, reject, or requeue flagged section packages safely.

**Acceptance Criteria**

1. Actions supported: `APPROVE_WITH_OVERRIDE`, `REJECT`, `REQUEUE_STEP`. `[NEW]`
2. Each action requires reviewer identity and reason notes for audit trail. `[NEW]`
3. Requeue action integrates with orchestrator idempotency/step retry semantics. `[NEW]`
4. Overrides are visible in final section metadata and event history. `[NEW]`

### F4.3 Story - Review SLA and Escalation

**User Story**  
As an operations manager, I want review SLAs and escalation so blocked sections do not stall unnoticed.

**Acceptance Criteria**

1. Review queue items have SLA timers and escalation thresholds. `[NEW]`
2. Alerting is emitted for overdue flagged sections. `[NEW]`
3. Metrics report manual-review volume, approval rate, and mean resolution time. `[NEW]`

---

## F5 - Publish Manifest Signer

### F5.1 Story - Manifest Integrity Signature

**User Story**  
As a platform security engineer, I want signed/hashed manifests so publish artifacts have integrity guarantees.

**Acceptance Criteria**

1. Manifest includes checksum/hash over critical references and metadata. `[NEW]`
2. Signature/hash generation occurs only after all validation gates pass. `[NEW]`
3. Hash algorithm/version is explicitly stored in manifest metadata. `[NEW]`
4. Signature mismatch at consume-time results in hard failure and alert. `[NEW]`

### F5.2 Story - Immutable Publish Versioning

**User Story**  
As a release engineer, I want immutable publish versions so clients get stable section packages and rollbacks are deterministic.

**Acceptance Criteria**

1. Published package versions are immutable; modifications require new version publish. `[NEW]`
2. Existing update methods (`updateTaskContent`) remain for draft/regeneration stages only, not for mutating published versions. `[MODIFY]`
3. Version metadata includes generation trace IDs and validator report references. `[NEW]`
4. Rollback can point clients to prior valid manifest version. `[NEW]`

### F5.3 Story - Publish Audit Trail

**User Story**  
As an auditor, I want a complete publish trail so every released section can be traced to its validation and generation lineage.

**Acceptance Criteria**

1. Audit record contains: who/what published, timestamp, manifest version, validation verdicts, override actions (if any). `[NEW]`
2. Existing logs are retained for troubleshooting but audit source of truth is persisted structured data. `[MODIFY]`
3. Audit records are queryable by session, section, and event correlation ID. `[NEW]`

---

## Implementation Notes for Roadmap Item F

1. Keep existing transcript validation and retry logic, but move to a formal multi-gate validation pipeline.
2. Introduce hard publish control boundary: `VALIDATED` is required before `PUBLISHED`.
3. Persist QA artifacts and audit records; avoid relying on console logs as evidence.
4. Add manual review only for configured high-severity or unresolved failure classes.
5. Preserve legacy response compatibility while moving clients to manifest-native consumption.

## Suggested Deliverables Checklist (F Complete)

1. Unified validation orchestrator with pluggable gate framework.
2. Timing/anchor and completeness validators with structured QA artifacts.
3. Manifest completeness + integrity signing controls.
4. Manual review queue and override workflow.
5. Publish audit trail with immutable version semantics.

---

## Implementation Status Snapshot (2026-02-10)

Legend for this snapshot:
- `[IMPLEMENTED]` Acceptance criteria are materially met in current runtime flow.
- `[PARTIAL]` Some criteria exist, but at least one key requirement is missing.
- `[MISSING]` No production-grade implementation found for criteria.

### F1 - Schema Validation Gate

1. **F1.1 Unified Validation Orchestrator** - `[IMPLEMENTED]`  
   Multi-gate validation runs after generation and before publish, with pluggable gates and structured verdict output.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningValidationGate.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`.
2. **F1.2 Renderer Schema Validation** - `[IMPLEMENTED]`  
   Renderer payload is schema-validated with legacy adapter compatibility and canonical `QUESTION_SCHEMA_INVALID` errors including field paths.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningValidationGate.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningQuestionAdapters.ts`.
3. **F1.3 Question Coverage Validation** - `[IMPLEMENTED]`  
   Gate enforces exactly 10 questions, unique numbering, and one-block/one-segment mapping with actionable diagnostics.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningValidationGate.ts`.

### F2 - Timing/Anchor Validator

1. **F2.1 Anchor Bounds Validator** - `[IMPLEMENTED]`  
   Anchor bounds checks are hard publish gates and emit canonical `ANCHOR_OUT_OF_BOUNDS` diagnostics.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningValidationGate.ts`.
2. **F2.2 Segment Duration Consistency Validator** - `[IMPLEMENTED]`  
   Segment min/max and section budget tolerance are enforced, with targeted regeneration hints for affected segments.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningValidationGate.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`.
3. **F2.3 Timing QA Artifact** - `[IMPLEMENTED]`  
   Structured timing artifact is persisted per run and linked in section progress metadata.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningValidationGate.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`.

### F3 - Completeness Validator

1. **F3.1 Answer Key Completeness Gate** - `[IMPLEMENTED]`  
   Answer-key coverage is enforced per engine with unresolved question diagnostics and legacy scoring compatibility preserved.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningValidationGate.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/scoring.ts`.
2. **F3.2 Asset Completeness Gate** - `[IMPLEMENTED]`  
   Asset existence/retrievability checks block publish using canonical `ASSET_MISSING` and `ASSET_UNREACHABLE`, with persisted diagnostics.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningValidationGate.ts`.
3. **F3.3 Manifest Completeness Gate** - `[IMPLEMENTED]`  
   Manifest references and schema version are validated pre-publish, and incomplete manifests fail with canonical code.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningValidationGate.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/shared/listening/manifest.ts`.

### F4 - Manual Review Override for Flagged Sections

1. **F4.1 Flagged Content Review Queue** - `[IMPLEMENTED]`  
   High-severity failures route to persisted review queue items with section context, failed checks, artifacts, replay options, and filtered pagination APIs.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningReviewWorkflow.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/shared/schema.ts`.
2. **F4.2 Manual Approve/Reject/Requeue Controls** - `[IMPLEMENTED]`  
   Action APIs support `APPROVE_WITH_OVERRIDE`, `REJECT`, `REQUEUE_STEP`, require reviewer identity and notes, and persist audit history.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningReviewWorkflow.ts`.
3. **F4.3 Review SLA and Escalation** - `[IMPLEMENTED]`  
   SLA timers, overdue escalation audits/outbox alerts, and review metrics are implemented.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningReviewWorkflow.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`.

### F5 - Publish Manifest Signer

1. **F5.1 Manifest Integrity Signature** - `[IMPLEMENTED]`  
   Manifest checksum/signature metadata is added after gate pass and verified at consume-time with hard failure and alert audit.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningManifestIntegrity.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`.
2. **F5.2 Immutable Publish Versioning** - `[IMPLEMENTED]`  
   Immutable manifest version ledger, active-version pointer, rollback endpoint, and published-mutation guard are implemented.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/listeningManifestVersioning.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/storage.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`.
3. **F5.3 Publish Audit Trail** - `[IMPLEMENTED]`  
   Structured publish audit records include actor, version, validation references, override actions, and query filters by task/section/correlation ID.  
   Evidence: `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/storage.ts`, `/Users/oluwaseunbantale/Documents/ielts-ai-project/shared/schema.ts`.

### Net Assessment

1. Roadmap F backend controls are now implemented end-to-end in orchestration, validation, review, versioning, integrity, and audit paths.
2. Remaining typecheck failures are currently outside this roadmap scope (frontend React Query typing migration issues).
