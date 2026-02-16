# Roadmap Item D: Question Generation + Config-Driven Renderer Contracts

This document expands **Roadmap Item D** from `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md` into detailed user stories and acceptance criteria.

It is codebase-aware and marks reusable pieces vs required new work for question generation and renderer contracts.

## Label Legend

- `[EXISTS]` Already implemented and reusable.
- `[MODIFY]` Exists but needs adaptation.
- `[NEW]` Must be added.
- `[DEPRECATE]` Should be phased out from critical path.

---

## 0) Current-State Baseline (Roadmap D Scope)

### Reusable foundation

1. Question storage shape exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/shared/schema.ts` (`id`, `question`, `options`, `correctAnswer`, `explanation`, optional `type`, `tags`, `groupId`). `[EXISTS]`
2. Question generation function exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/openai.ts` (`generateQuestionsFromScript`) and currently produces 10 MCQs. `[EXISTS]`
3. Question normalization logic exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` (`normalizeQuestionsForClient`, `mapPackageQuestions`). `[EXISTS]`
4. Segment assignment/order utilities exist in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/segmentOrder.ts`. `[EXISTS]`
5. Scoring/tag support exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/scoring.ts`. `[EXISTS]`

### Gaps vs target architecture

1. No formal renderer schema for multiple question engines/blocks; current flow is primarily MCQ-based. `[MODIFY]`
2. UI component `/client/src/components/practice/ListeningPracticeSession.tsx` currently renders mostly radio-option questions; no config-driven block renderer. `[MODIFY]`
3. No first-class “3 blocks per section” generation contract tied to segment-level script outputs. `[NEW]`
4. No standardized answer-key model for non-MCQ engines (blank matching, list matching, map labels, etc.). `[NEW]`
5. No fixture-based cross-engine renderer contract test suite. `[NEW]`

### Candidates to phase out

1. Assumption that every listening question has exactly 4 options and one letter answer. `[DEPRECATE]`
2. Route-level ad-hoc normalization as the main compatibility strategy long-term. `[MODIFY]`

---

## D1 - Question Block Planner (3 blocks / 10 questions)

### D1.1 Story - Section Block Plan Contract

**User Story**  
As a question-generation engineer, I want a formal block plan so each section distributes 10 questions across 3 internal blocks consistently.

**Acceptance Criteria**

1. Block plan schema defines `section_no`, `block_no`, `segment_no`, `question_range`, `engine_type`, `instructions`. `[NEW]`
2. Planner supports valid distributions like `3+3+4` and `4+3+3` with deterministic mapping. `[NEW]`
3. Existing segment assignment utilities in `/server/services/segmentOrder.ts` are reused for mapping scaffolding where applicable. `[EXISTS]`
4. Missing block coverage for any question number fails validation. `[NEW]`

### D1.2 Story - Context-Aware Engine Mix Planner

**User Story**  
As a learning designer, I want engine mixes selected per section context so question styles align with IELTS section characteristics.

**Acceptance Criteria**

1. Planner consumes section context (`social conversation`, `lecture`, etc.) and picks allowed engine sets. `[NEW]`
2. Existing metadata (`ieltsPart`, `scriptType`, `contextLabel`) is reused as input hints. `[EXISTS]`
3. Planner rejects invalid combinations (e.g., incompatible engine for chosen section format). `[NEW]`
4. Planner output is persisted and traceable by section build ID. `[NEW]`

### D1.3 Story - Question Number Stability

**User Story**  
As a frontend engineer, I want stable question numbering so answer tracking and review states do not break across rerenders/retries.

**Acceptance Criteria**

1. Question numbers remain stable for a published section package. `[NEW]`
2. Existing question ID normalization in `segmentOrder.ts` can be reused but must preserve published question numbers. `[MODIFY]`
3. Re-generation of one block cannot renumber unaffected blocks unless a full section version bump occurs. `[NEW]`

---

## D2 - Engine Adapters for Key Question Types

### D2.1 Story - Engine Adapter Interface

**User Story**  
As a platform engineer, I want a unified engine adapter interface so all question engines can be generated, validated, and rendered consistently.

**Acceptance Criteria**

1. A common adapter interface is defined (`generate`, `validate`, `normalize`, `answerKeyExtract`). `[NEW]`
2. Existing MCQ generation logic in `generateQuestionsFromScript` is wrapped as `mcq_single` adapter. `[MODIFY]`
3. Adapter output conforms to renderer block schema and includes engine-specific payload. `[NEW]`
4. Adapter failures return structured error codes for orchestrator retry logic. `[NEW]`

### D2.2 Story - Initial Engine Set Implementation

**User Story**  
As a product owner, I want core engine implementations so sections can include mixed question styles matching screenshot designs.

**Acceptance Criteria**

1. Engines implemented at minimum:
   - `mcq_single`
   - `multi_select`
   - `form_or_table_completion`
   - `sentence_or_note_completion`
   - `map_or_diagram_labeling`
   - `matching_letters` `[NEW]`
2. Existing MCQ shape support is retained for legacy consumers. `[EXISTS]`
3. Each engine has validation rules for required fields and instruction constraints (`max words`, `letters to choose`, etc.). `[NEW]`
4. Each engine returns consistent data for scoring and review UI. `[NEW]`

### D2.3 Story - Engine Migration Adapter

**User Story**  
As a backend maintainer, I want a migration adapter so old MCQ-only payloads can be consumed by new renderer contracts during rollout.

**Acceptance Criteria**

1. Legacy question arrays are transformable into renderer block format automatically. `[NEW]`
2. Existing `normalizeQuestionsForClient` in `/server/routes.ts` is reused as transition helper where safe. `[MODIFY]`
3. Migration adapter logs transformed payload version and compatibility mode. `[NEW]`
4. No data loss for existing `correctAnswer`, `options`, `explanation`, `tags`. `[EXISTS]`

---

## D3 - Answer Key + Alternate Answer Handling

### D3.1 Story - Unified Answer Key Schema

**User Story**  
As a scoring engineer, I want a unified answer key schema so all engine types can be graded reliably.

**Acceptance Criteria**

1. Answer key schema supports:
   - single correct option
   - multiple correct options
   - accepted text variants (normalized)
   - ordered vs unordered matching modes `[NEW]`
2. Existing MCQ correctness logic in `/server/services/scoring.ts` remains supported through compatibility mapping. `[EXISTS]`
3. Every question in a published section has answer key coverage. `[NEW]`
4. Missing key coverage blocks publish. `[NEW]`

### D3.2 Story - Text Answer Normalization Rules

**User Story**  
As a learner experience owner, I want text normalization rules so valid equivalent answers are accepted fairly.

**Acceptance Criteria**

1. Normalization supports case-folding, punctuation trimming, whitespace normalization, and configurable numeric handling. `[NEW]`
2. Rule config allows per-question overrides (`strict` vs `lenient`). `[NEW]`
3. Accepted alternatives are auditable in answer-key payload and review logs. `[NEW]`
4. Existing fields are preserved for legacy MCQ scoring unaffected by text normalization. `[EXISTS]`

### D3.3 Story - Scoring Bridge for Mixed Engines

**User Story**  
As a backend engineer, I want a scoring bridge so mixed-engine sections can still produce consistent per-part and final scores.

**Acceptance Criteria**

1. Mixed-engine scoring emits standardized per-question outcome objects. `[NEW]`
2. Existing histogram/tag summarization in `server/services/scoring.ts` and `server/services/feedback.ts` is reused. `[EXISTS]`
3. Score outputs remain compatible with current session summary interfaces in `/shared/schema.ts` during migration. `[MODIFY]`
4. Regression tests cover at least one section with 3 distinct engine types. `[NEW]`

---

## D4 - Error Tag Taxonomy per Question

### D4.1 Story - Taxonomy Expansion Contract

**User Story**  
As a learning analyst, I want a consistent tag taxonomy across engines so error diagnosis and coaching remain reliable.

**Acceptance Criteria**

1. Taxonomy extends beyond current MCQ-centric tags to include engine-specific tags (e.g., `spelling_capture`, `map_spatial_reference`, `instruction_limit_violation`). `[NEW]`
2. Existing tags in scoring (`numbers`, `dates`, `maps`, `directions`, `synonyms`, etc.) remain valid. `[EXISTS]`
3. Tag schema is versioned and documented for analytics consumers. `[NEW]`
4. Unknown tags are rejected or mapped to fallback tag with warning. `[NEW]`

### D4.2 Story - Tagging During Generation

**User Story**  
As a content pipeline engineer, I want tags attached during question generation so downstream coaching has rich signals without post-hoc guessing.

**Acceptance Criteria**

1. Each generated question includes at least one error-analysis tag. `[NEW]`
2. Existing optional `tags` field in shared `Question` type remains usable for backward compatibility. `[EXISTS]`
3. Missing tags trigger validation warning in draft mode and failure in publish mode (configurable). `[NEW]`
4. Tagging logic supports engine-specific defaults when model output is incomplete. `[NEW]`

### D4.3 Story - Tag Quality Review

**User Story**  
As a QA engineer, I want tag quality checks so inconsistent tagging doesn’t degrade the Performance Coach output.

**Acceptance Criteria**

1. Validation checks tag-engine compatibility rules (e.g., map-specific tags only on map/diagram blocks). `[NEW]`
2. Existing feedback generation pipeline can consume tags without breaking old sessions. `[EXISTS]`
3. Quality report includes low-confidence or conflicting tag assignments. `[NEW]`

---

## D5 - Renderer Integration Harness

### D5.1 Story - Config-Driven Renderer Core

**User Story**  
As a frontend engineer, I want a config-driven renderer so listening question UI is derived from JSON contracts rather than hardcoded question components.

**Acceptance Criteria**

1. Renderer core reads block schema and dispatches to engine-specific renderers. `[NEW]`
2. Existing question list UI in `/client/src/components/practice/ListeningPracticeSession.tsx` remains available for legacy MCQ payload mode. `[EXISTS]`
3. Renderer supports per-block instructions and per-question numbering exactly as payload specifies. `[NEW]`
4. Unsupported engine blocks fail gracefully with visible fallback state and telemetry. `[NEW]`

### D5.2 Story - Engine Renderer Components

**User Story**  
As a UX engineer, I want dedicated components per engine so users can interact with each question type appropriately.

**Acceptance Criteria**

1. Engine components are created for all initial engine set types and wired via renderer dispatch map. `[NEW]`
2. Form/table completion supports inline blanks and constraints (`max words/number`). `[NEW]`
3. Multi-select supports configured selection count and validation messaging. `[NEW]`
4. Legacy radio-option rendering remains functional when engine type is absent and old MCQ payload is used. `[MODIFY]`

### D5.3 Story - Renderer Contract Test Harness

**User Story**  
As a QA lead, I want fixture-based contract tests so backend payload changes cannot silently break frontend rendering.

**Acceptance Criteria**

1. A fixture suite is added with representative payloads for each engine. `[NEW]`
2. Fixtures are validated against shared schema before UI tests execute. `[NEW]`
3. Existing session UI smoke path remains test-covered for legacy mode. `[EXISTS]`
4. CI fails on any schema-render mismatch. `[NEW]`

### D5.4 Story - End-to-End Migration Gate

**User Story**  
As a release manager, I want a dual-mode migration gate so rollout can happen gradually without breaking current users.

**Acceptance Criteria**

1. Feature flag enables new renderer mode per cohort/environment. `[NEW]`
2. API can return both legacy and new contract forms during migration window. `[MODIFY]`
3. Telemetry compares error rates and completion rates across old/new renderer modes. `[NEW]`
4. Rollback path disables new renderer without data loss. `[NEW]`

---

## Implementation Notes for Roadmap Item D

1. Keep MCQ legacy compatibility while introducing block-engine contracts.
2. Build shared schemas first, then backend adapters, then frontend renderer components.
3. Reuse existing helpers where possible:
- `segmentOrder.ts` for mapping/order foundations
- `scoring.ts`/`feedback.ts` for tag and analytics continuity
- shared question base fields in `shared/schema.ts`
4. Avoid route-level ad-hoc transformations as long-term architecture; move normalization into explicit adapter layer.

## Suggested Deliverables Checklist (D Complete)

1. Question block planner contract and generator.
2. Engine adapter framework + initial engine implementations.
3. Unified answer key schema with alternate-answer handling.
4. Expanded tag taxonomy and tagging QA checks.
5. Config-driven frontend renderer + contract fixture tests + migration flag.

