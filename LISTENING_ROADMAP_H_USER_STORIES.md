# Roadmap Item H: Performance Coach and Personalization Loop

This document expands **Roadmap Item H** from `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md` into detailed user stories and acceptance criteria.

It is codebase-aware and identifies what coaching/analytics pieces already exist versus what must be added for the full personalization loop.

## Label Legend

- `[EXISTS]` Already implemented and reusable.
- `[MODIFY]` Exists but needs adaptation.
- `[NEW]` Must be added.
- `[DEPRECATE]` Should be phased out from critical path.

---

## 0) Current-State Baseline (Roadmap H Scope)

### Reusable foundation

1. Per-audio advisor generation exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/openai.ts` (`generateAdvisorFeedback`). `[EXISTS]`
2. Advisor endpoint exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` (`POST /api/session/advisor`). `[EXISTS]`
3. Attempt persistence exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` and `/Users/oluwaseunbantale/Documents/ielts-ai-project/shared/schema.ts` (`task_attempts`, `POST /api/firebase/task-progress/:id/attempt`). `[EXISTS]`
4. Tag-based scoring/histogram utilities exist in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/scoring.ts` and `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/feedback.ts`. `[EXISTS]`
5. Recent listening summary access exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/perfStore.ts`. `[EXISTS]`

### Gaps vs target architecture

1. No dedicated Performance Coach agent that consumes full-session section-level telemetry and produces structured weakness profiles/recommendations. `[NEW]`
2. Current advisor is per-audio short feedback; not a full-session personalized plan with next-practice set selection. `[MODIFY]`
3. No formal event contract loop from coach output back to Tutor plan adjustment in production flow. `[NEW]`
4. No explicit model to separate skill weakness vs behavior/time-management issues. `[NEW]`
5. No standardized recommendation object with confidence/severity and evidence links. `[NEW]`

### Candidates to phase out

1. Relying only on generic per-audio tips as the primary personalization output. `[DEPRECATE]`
2. Non-structured coaching outputs that are difficult to feed back into planning logic. `[DEPRECATE]`

---

## H1 - Weakness Profiler

### H1.1 Story - Weakness Profile Domain Model

**User Story**  
As a learning analytics engineer, I want a structured weakness profile model so user challenges are represented consistently across sessions.

**Acceptance Criteria**

1. Weakness profile schema includes `tag`, `severity`, `evidence_questions`, `affected_sections`, and `confidence`. `[NEW]`
2. Existing tag taxonomy from `server/services/scoring.ts` is reused as baseline. `[EXISTS]`
3. Profile schema supports engine-specific tags introduced in Roadmap D. `[MODIFY]`
4. Profile output is persisted with session correlation and version metadata. `[NEW]`

### H1.2 Story - Profile Aggregation Logic

**User Story**  
As a coach-engine maintainer, I want aggregation rules so repeated mistakes are ranked and prioritized reliably.

**Acceptance Criteria**

1. Aggregation combines per-question outcomes into weighted weakness scores by frequency and severity. `[NEW]`
2. Existing histogram aggregation patterns in `feedback.ts` are reused as starter logic. `[EXISTS]`
3. Profile ranks top weakness areas with deterministic tie-break logic. `[NEW]`
4. Aggregation handles missing data gracefully for legacy attempts. `[MODIFY]`

### H1.3 Story - Section-Aware Weakness Mapping

**User Story**  
As a product owner, I want weaknesses mapped to section contexts so users know where breakdowns happen most.

**Acceptance Criteria**

1. Profile links weaknesses to section/part IDs and question ranges. `[NEW]`
2. Existing per-audio/session scoring structures are adapted to section model during migration. `[MODIFY]`
3. Output supports “top issues by section” view for final report UI. `[NEW]`
4. Mapping is validated against session question metadata integrity checks. `[NEW]`

---

## H2 - Behavior Analysis Model

### H2.1 Story - Interaction Signal Model

**User Story**  
As a performance analyst, I want behavior-signal modeling so recommendations reflect timing/playback patterns and not only correctness.

**Acceptance Criteria**

1. Behavior signals include at least: response latency, answer changes, replay frequency, skipped/unanswered counts. `[NEW]`
2. Existing attempt duration and answer data in `task_attempts` are reused. `[EXISTS]`
3. Behavior schema supports section-level and whole-session rollups. `[NEW]`
4. Signals are normalized for session length and question count differences. `[NEW]`

### H2.2 Story - Skill-vs-Behavior Separation

**User Story**  
As a tutor system owner, I want model outputs to distinguish knowledge gaps from behavior constraints so interventions are targeted.

**Acceptance Criteria**

1. Analysis labels insights as `skill_gap`, `behavior_pattern`, or `mixed`. `[NEW]`
2. Rules combine correctness tags with behavior metrics to infer root cause class. `[NEW]`
3. Confidence score is provided for each inferred root cause. `[NEW]`
4. Edge cases with low-confidence inference are flagged as “needs more data.” `[NEW]`

### H2.3 Story - Trend and Drift Analysis

**User Story**  
As a learner, I want trend awareness so I can see whether performance is improving, flat, or declining over recent sessions.

**Acceptance Criteria**

1. Trend logic extends existing `up/down/flat` summary with section/tag dimensions over recent attempts. `[MODIFY]`
2. Existing recent summaries from `perfStore.ts` are reused as baseline historical input. `[EXISTS]`
3. Trend output includes confidence and data-window metadata. `[NEW]`
4. Drift alerts are surfaced when performance drops significantly in a specific weakness area. `[NEW]`

---

## H3 - Personalized Strategy Generator

### H3.1 Story - Strategy Output Contract

**User Story**  
As a learner, I want personalized strategies tied to my actual mistakes so guidance is specific and actionable.

**Acceptance Criteria**

1. Strategy object includes `title`, `action`, `rationale`, `linked_weakness_tags`, and `expected_outcome`. `[NEW]`
2. Existing advisor summary/actions format is supported as fallback shape during migration. `[MODIFY]`
3. Strategies include explicit evidence references (question IDs/sections). `[NEW]`
4. Output supports priority ordering (top 3-5 actions). `[NEW]`

### H3.2 Story - Strategy Rule Engine

**User Story**  
As a coach maintainer, I want deterministic rules for common weakness patterns so recommendations remain consistent and explainable.

**Acceptance Criteria**

1. Rule templates exist for core weakness categories (numbers/dates, distractors, map/diagram, multi-select, note completion). `[NEW]`
2. Existing friendly tag labels from `scoring.ts` are reused in user-facing explanation text. `[EXISTS]`
3. Rule outputs are customizable by severity and confidence. `[NEW]`
4. Fallback strategy is produced if no rule confidently matches. `[NEW]`

### H3.3 Story - Generative Strategy Enhancement

**User Story**  
As a product owner, I want optional LLM enhancement of strategy text so recommendations stay natural while preserving structured logic.

**Acceptance Criteria**

1. LLM enhancement runs on top of structured strategy objects, not as raw free-form replacement. `[NEW]`
2. Existing `generateAdvisorFeedback` pathway can be reused as model-call pattern baseline. `[EXISTS]`
3. Guardrails prevent hallucinated unsupported claims by requiring evidence-bound prompts. `[NEW]`
4. If model call fails, deterministic rule-based output is returned. `[NEW]`

---

## H4 - Next Practice Set Recommender

### H4.1 Story - Practice Recommendation Contract

**User Story**  
As a learner, I want recommended next practice sets aligned to my weakness areas so next steps are clear.

**Acceptance Criteria**

1. Recommendation object includes `focus`, `difficulty`, `accent`, `count`, and `reason`. `[NEW]`
2. Recommendations are ranked by weakness severity and confidence. `[NEW]`
3. Existing plan/skill metadata structures are reused to map recommendations into planned activities. `[MODIFY]`
4. Recommendation list avoids duplicate or contradictory actions. `[NEW]`

### H4.2 Story - Difficulty and Accent Targeting

**User Story**  
As a tutor planner, I want recommendations to adjust difficulty/accent focus based on user profile and recent performance.

**Acceptance Criteria**

1. Difficulty recommendation uses current level, target band, and recent trend to pick next challenge level. `[NEW]`
2. Accent recommendation uses error patterns linked to accent/context exposure data when available. `[NEW]`
3. Existing accent normalization and enums are reused for canonical output values. `[EXISTS]`
4. If insufficient accent evidence exists, recommendation defaults to balanced accent rotation. `[NEW]`

### H4.3 Story - Recommendation Quality Guard

**User Story**  
As a quality owner, I want recommendation sanity checks so users do not receive unrealistic or conflicting next sets.

**Acceptance Criteria**

1. Guard checks for excessive workload, duplicate focus, and unsupported engine references. `[NEW]`
2. Recommendations violating guard are corrected or replaced before publish. `[NEW]`
3. Guard outcomes are logged for iterative tuning. `[NEW]`

---

## H5 - Tutor Feedback Event Integration

### H5.1 Story - Coach Output Event Publisher

**User Story**  
As a backend integrator, I want coach analysis published as a structured event so tutor planning can consume it automatically.

**Acceptance Criteria**

1. Performance Coach emits `listening.performance.analyzed` event with weakness profile, strategies, challenges, and next sets. `[NEW]`
2. Event uses canonical envelope/versioning contracts defined in roadmap A/B artifacts. `[NEW]`
3. Publish is idempotent per `session_id + attempt_id + analysis_version`. `[NEW]`
4. Event failures use retry/DLQ flow from orchestration policy. `[NEW]`

### H5.2 Story - Tutor Adjustment Request Bridge

**User Story**  
As a tutor-agent engineer, I want coach output translated into tutor adjustment requests so weekly plans adapt automatically.

**Acceptance Criteria**

1. Bridge emits `listening.weekly.plan.adjustment.requested` with prioritized focus updates. `[NEW]`
2. Existing weekly plan generation pipeline remains usable while adjustment bridge is introduced. `[EXISTS]`
3. Adjustment payload includes trace links to source session analysis. `[NEW]`
4. Duplicate adjustment requests for same source analysis are deduplicated. `[NEW]`

### H5.3 Story - Personalization Closed Loop Verification

**User Story**  
As a product owner, I want closed-loop verification so we can prove coach outputs influence future plans and outcomes.

**Acceptance Criteria**

1. System records linkage from source session analysis -> updated plan item(s) -> subsequent attempt outcomes. `[NEW]`
2. Existing plan persistence models are reused with additional linkage metadata. `[MODIFY]`
3. Dashboard/reporting can display “recommendation adopted” and trend impact indicators. `[NEW]`
4. Missing linkage is tracked as a loop-break metric for reliability improvement. `[NEW]`

---

## Implementation Notes for Roadmap Item H

1. Keep current advisor endpoint for immediate feedback, but add dedicated full-session Performance Coach pipeline.
2. Reuse existing scoring tags/histograms and task-attempt storage before introducing more complex ML layers.
3. Produce structured outputs first (weakness profile, strategies, recommendations), then optionally enrich language with LLM.
4. Integrate coach-to-tutor event loop only after contract/versioning foundations (A/B) are in place.
5. Maintain compatibility with existing session summary UI while adding richer final-report inputs.

## Suggested Deliverables Checklist (H Complete)

1. Weakness profiler with section-aware severity scoring.
2. Behavior analysis layer separating skill vs behavior constraints.
3. Personalized strategy generator with evidence-linked outputs.
4. Next-practice recommender with difficulty/accent targeting.
5. Coach output events feeding tutor plan-adjustment loop and closed-loop observability.

