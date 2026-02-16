# Roadmap Item C: Script Generation Subsystem

This document expands **Roadmap Item C** from `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md` into detailed user stories and acceptance criteria.

It is codebase-aware and highlights what can be reused vs what must be built for the new 3-linked-script-per-section model.

## Label Legend

- `[EXISTS]` Already implemented and reusable.
- `[MODIFY]` Exists but needs adaptation.
- `[NEW]` Must be added.
- `[DEPRECATE]` Should be phased out from critical path.

---

## 0) Current-State Baseline (Roadmap C Scope)

### Reusable foundation

1. Script generation function exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/openai.ts` via `generateListeningScriptForTask(...)`. `[EXISTS]`
2. Session package generation exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/openai.ts` via `generateListeningSessionPackage(...)` returning multiple audios. `[EXISTS]`
3. Transcript quality check exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/content.ts` via `validateTranscriptComplete(...)`. `[EXISTS]`
4. Accent normalization utilities exist in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/utils/audio.ts`. `[EXISTS]`
5. Segment scaffolding exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/taskFactory.ts` (`ensureListeningSegments`). `[EXISTS]`

### Gaps vs target architecture

1. Current script generation is mostly single-script-per-task; no explicit section blueprint with 3 linked segments. `[MODIFY]`
2. No formal entity/timeline continuity checker across segments. `[NEW]`
3. No first-class anchor generation contract tied to segment/question blocks for “listen from here.” `[NEW]`
4. Prompt/version governance is not centralized as a registry with rollout controls. `[NEW]`

### Candidates to phase out

1. Treating one generated script as the whole section content in primary path. `[DEPRECATE]`
2. Implicit duration targeting around generic 6-minute script only, without section-segment strategy. `[MODIFY]`

---

## C1 - Section Story Blueprint Generator

### C1.1 Story - Blueprint Domain Model

**User Story**  
As a script engineer, I want a section blueprint model so each section has a coherent narrative plan before segment generation starts.

**Acceptance Criteria**

1. Blueprint contract includes at minimum: `entities`, `roles`, `timeline`, `facts`, `context_type`, `section_no`, `accent_plan`. `[NEW]`
2. Existing metadata fields (`topicDomain`, `contextLabel`, `scenarioOverview`, `scriptType`) in task content are mapped into blueprint fields. `[EXISTS]`
3. Blueprint is persisted per section and versioned for traceability. `[NEW]`
4. Blueprint generation failures return structured error codes and are retryable where transient. `[NEW]`

### C1.2 Story - Context-Type Enforcement (4 IELTS context classes)

**User Story**  
As a product owner, I want blueprint generation to enforce the required context class per section so coverage is pedagogically correct.

**Acceptance Criteria**

1. Section context is enforced to one of:
   - `everyday_social_conversation`
   - `everyday_social_monologue`
   - `educational_conversation`
   - `educational_lecture` `[NEW]`
2. Existing part metadata support (`ieltsPart`, `scriptType`) is reused as compatibility hints. `[EXISTS]`
3. Blueprint generation rejects mismatched context/script-type combinations with explicit validation messages. `[NEW]`
4. Automated tests cover all 4 context classes. `[NEW]`

### C1.3 Story - Blueprint Quality Gate

**User Story**  
As a QA engineer, I want a quality gate for blueprints so weak plans do not cascade into poor segments.

**Acceptance Criteria**

1. Blueprint must have non-empty entities, timeline checkpoints, and minimum fact count. `[NEW]`
2. Existing transcript validator is reused only for final script checks, not blueprint checks. `[EXISTS]`
3. Invalid blueprint transitions section state to `FAILED` with actionable reason. `[NEW]`

---

## C2 - 3-Segment Script Generation

### C2.1 Story - Linked Segment Generation

**User Story**  
As an AI pipeline engineer, I want each section generated as 3 linked segments so we fit model constraints and keep coherence.

**Acceptance Criteria**

1. Segment outputs per section are exactly 3 (`A`, `B`, `C`) and all reference the same blueprint. `[NEW]`
2. Existing script generation function (`generateListeningScriptForTask`) is reused internally where possible via wrapper/adaptor for segment mode. `[MODIFY]`
3. Segment outputs include stable IDs, transcript text, predicted duration, and linkage metadata. `[NEW]`
4. Missing/empty segment fails section step and triggers retry policy. `[NEW]`

### C2.2 Story - Segment Duration Targeting

**User Story**  
As a content architect, I want segment duration constraints so each section totals ~8 minutes without overloading a single generation call.

**Acceptance Criteria**

1. Segment target durations are configurable (default 2-3 minutes each). `[NEW]`
2. Sum of segment durations per section must remain within configured section budget tolerance. `[NEW]`
3. Existing estimated duration fields (`estimatedDurationSec`) are reused and validated at segment level. `[EXISTS]`
4. Any out-of-bound segment requires regeneration or fallback with logged reason. `[NEW]`

### C2.3 Story - Difficulty and Band Alignment

**User Story**  
As a learning designer, I want segment scripts aligned to learner level and target band so content progression is appropriate.

**Acceptance Criteria**

1. Segment prompts accept `userLevel`, `targetBand`, and section context constraints. `[EXISTS]`
2. Returned metadata includes declared difficulty and confidence markers for downstream QA. `[NEW]`
3. Existing difficulty field storage is reused (`difficulty` on task content) during migration. `[EXISTS]`
4. Regression tests compare generated scripts against difficulty rubric checks. `[NEW]`

### C2.4 Story - Accent Plan Integration

**User Story**  
As a platform engineer, I want scripts generated with accent awareness so TTS conversion uses coherent voice/accent settings.

**Acceptance Criteria**

1. Segment generation output includes `accent_plan` reference and preferred voice hints per segment. `[NEW]`
2. Existing accent normalization (`normalizeAccent`) is reused for canonical accent values. `[EXISTS]`
3. Missing accent values fall back to configured default accent with warning-level logs. `[EXISTS]`
4. Accent plan is persisted with segment metadata for TTS stage consumption. `[NEW]`

---

## C3 - Anchor Marker Generation

### C3.1 Story - Anchor Contract Definition

**User Story**  
As a frontend engineer, I want explicit anchor markers so “listen from here” jumps are deterministic and stable.

**Acceptance Criteria**

1. Anchor schema includes `anchor_id`, `segment_no`, `offset_seconds`, `label`, and optional `question_range`. `[NEW]`
2. Anchors are generated during script step and carried through publish manifest. `[NEW]`
3. Existing section question assignment logic (`segmentOrder`/assignments) is reused to map anchors to question ranges where possible. `[EXISTS]`
4. Missing anchors for a configured block is treated as validation failure. `[NEW]`

### C3.2 Story - Anchor Timing Validation

**User Story**  
As a QA engineer, I want anchor offsets validated against generated audio durations so jump links do not point outside media bounds.

**Acceptance Criteria**

1. Every anchor offset must be `>= 0` and `< segment_audio_duration`. `[NEW]`
2. Existing audio duration values from TTS result are reused for bounds checks. `[EXISTS]`
3. Invalid anchors trigger targeted regeneration of anchor map or segment (configurable). `[NEW]`
4. Validation result is persisted and attached to section QA status. `[NEW]`

---

## C4 - Continuity Validator

### C4.1 Story - Entity/Facts Continuity Checker

**User Story**  
As a content quality owner, I want continuity checks across segment A/B/C so names, numbers, and facts remain consistent.

**Acceptance Criteria**

1. Validator compares entities, key facts, and timeline claims across all three segments. `[NEW]`
2. Existing parsed metadata fields (`topicDomain`, `contextLabel`, `scenarioOverview`) are used as supplemental continuity signals. `[EXISTS]`
3. High-severity contradictions (e.g., name/fact flips) fail validation and block publish. `[NEW]`
4. Low-severity issues produce warnings for optional regeneration. `[NEW]`

### C4.2 Story - Linguistic Coherence Checker

**User Story**  
As a QA engineer, I want coherence checks so segments read like one story instead of disconnected snippets.

**Acceptance Criteria**

1. Checker verifies segment transitions reference prior context without abrupt resets. `[NEW]`
2. Existing transcript completeness validator remains a prerequisite but not the sole coherence gate. `[EXISTS]`
3. Coherence score threshold is configurable and logged per section. `[NEW]`
4. Failing scores trigger regeneration policy for affected segment(s). `[NEW]`

### C4.3 Story - Continuity Reports for Debugging

**User Story**  
As a backend engineer, I want machine-readable continuity reports so failures are diagnosable and replay-safe.

**Acceptance Criteria**

1. Validator emits report with issue type, segment refs, severity, and remediation hint. `[NEW]`
2. Reports are linked to section/step IDs and included in failure events. `[NEW]`
3. Existing logging style can be retained but must include structured fields, not only plain console text. `[MODIFY]`

---

## C5 - Prompt/Version Registry

### C5.1 Story - Prompt Registry Store

**User Story**  
As an AI platform engineer, I want a prompt registry so script-generation prompts are versioned, auditable, and rollout-safe.

**Acceptance Criteria**

1. Registry tracks prompt templates with `prompt_id`, `version`, `status`, `created_by`, `created_at`. `[NEW]`
2. Current inline prompts in `server/openai.ts` are extracted into registry-managed templates (or template modules). `[MODIFY]`
3. Each generation result stores prompt version metadata for traceability. `[NEW]`
4. Rollback to prior prompt version is supported without code redeploy. `[NEW]`

### C5.2 Story - Prompt Experiment Controls

**User Story**  
As a product experiment owner, I want controlled prompt rollout so we can test quality improvements without destabilizing production.

**Acceptance Criteria**

1. Prompt version selection supports cohort-based or percentage-based rollout. `[NEW]`
2. Existing generation pathways remain default until registry-based selection is enabled. `[MODIFY]`
3. Experiment assignment and outcomes are logged with section/session IDs. `[NEW]`
4. Feature flag controls exist to disable experimental prompts quickly. `[NEW]`

### C5.3 Story - Prompt Quality Regression Suite

**User Story**  
As a QA owner, I want regression checks for prompt versions so new templates do not degrade script quality.

**Acceptance Criteria**

1. Golden test fixtures validate minimum output quality (length, structure, continuity signals). `[NEW]`
2. Existing transcript completeness check is part of regression gating. `[EXISTS]`
3. Prompt version cannot be promoted to `active` unless regression suite passes. `[NEW]`

---

## Implementation Notes for Roadmap Item C

1. Introduce blueprint and segment contracts before altering TTS/question stages.
2. Build a compatibility layer so existing single-script task flow still works during migration.
3. Reuse existing utilities:
- `validateTranscriptComplete` for transcript quality baseline
- `normalizeAccent` for accent canonicalization
- existing metadata fields in `taskProgress`
4. Move toward section-native artifacts (`blueprint + segments + anchors`) and reduce reliance on single `scriptText`.

## Suggested Deliverables Checklist (C Complete)

1. Section blueprint generator + persistence.
2. 3-linked-segment script generator with duration constraints.
3. Anchor generation + timing validation.
4. Continuity validator + structured reports.
5. Prompt/version registry + controlled rollout + regression gates.

