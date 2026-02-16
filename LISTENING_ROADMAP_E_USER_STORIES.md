# Roadmap Item E: Accent-Aware TTS and Asset Pipeline

This document expands **Roadmap Item E** from `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md` into detailed user stories and acceptance criteria.

It is codebase-aware and marks reusable implementation vs required changes for accent-aware synthesis and asset delivery.

## Label Legend

- `[EXISTS]` Already implemented and reusable.
- `[MODIFY]` Exists but needs adaptation.
- `[NEW]` Must be added.
- `[DEPRECATE]` Should be phased out from critical path.

---

## 0) Current-State Baseline (Roadmap E Scope)

### Reusable foundation

1. Polly synthesis pipeline exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/audioService.ts` (`generateAudioFromScript`). `[EXISTS]`
2. Accent normalization utility exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/utils/audio.ts` (`normalizeAccent`). `[EXISTS]`
3. Accent-to-voice mapping exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/shared/constants.ts` (`ACCENT_TO_TTS_VOICE`). `[EXISTS]`
4. S3 upload helper exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/audio/uploadPollyMp3.ts`. `[EXISTS]`
5. Audio existence check exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/audioService.ts` (`checkAudioExists`). `[EXISTS]`
6. Task metadata already stores `audioUrl`, `accent`, `duration` in `/Users/oluwaseunbantale/Documents/ielts-ai-project/shared/schema.ts`. `[EXISTS]`

### Gaps vs target architecture

1. Current API is single-audio-per-task oriented; section/segment asset package model is not first-class. `[MODIFY]`
2. No explicit TTS provider abstraction layer with adapter interface and failover policy. `[NEW]`
3. Duration currently estimated from word count; no canonical measured duration contract for publish gating. `[MODIFY]`
4. Limited post-processing/quality checks for loudness/format quality across generated assets. `[NEW]`
5. Asset delivery model is raw S3 URL-centric; no section manifest-native delivery contract yet. `[MODIFY]`

### Candidates to phase out

1. Excessive debug logging in production path of TTS generation pipeline. `[DEPRECATE]`
2. Treating `audioUrl` string alone as complete delivery contract for section runtime. `[DEPRECATE]`

---

## E1 - TTS Provider Abstraction

### E1.1 Story - Provider Adapter Interface

**User Story**  
As a backend platform engineer, I want a provider abstraction so we can support current and future TTS providers without rewriting orchestration logic.

**Acceptance Criteria**

1. A provider interface is defined (e.g., `synthesize`, `validateInput`, `healthcheck`, `normalizeError`). `[NEW]`
2. Existing Polly implementation in `/server/audioService.ts` is wrapped as the first adapter implementation. `[MODIFY]`
3. Orchestrator/TTS worker calls abstraction API, not Polly SDK directly in business flow code. `[NEW]`
4. Provider-specific error mapping returns canonical error codes for retry policy integration. `[NEW]`

### E1.2 Story - Provider Configuration and Routing

**User Story**  
As an operations engineer, I want provider configuration control so environments can select providers and fail safely.

**Acceptance Criteria**

1. Environment-configured provider selection is supported with safe defaults. `[NEW]`
2. Existing AWS region/bucket env settings continue to work as default config path. `[EXISTS]`
3. Misconfiguration fails fast at startup/healthcheck with actionable diagnostics. `[NEW]`
4. Provider choice and version are included in synthesis metadata. `[NEW]`

### E1.3 Story - Provider Health and Fallback Policy

**User Story**  
As an SRE, I want health checks and fallback policy so temporary provider instability does not halt the pipeline.

**Acceptance Criteria**

1. Healthcheck endpoint/job validates provider credentials and synthesis capability. `[NEW]`
2. Existing credential checks in `generateAudioFromScript` are retained as runtime safety net. `[EXISTS]`
3. Fallback path can reroute synthesis to backup provider/accent voice when configured. `[NEW]`
4. Fallback usage is logged and metered for alerting. `[NEW]`

---

## E2 - Accent Profile Resolver

### E2.1 Story - Canonical Accent Resolver

**User Story**  
As a content pipeline engineer, I want canonical accent resolution so requested accent names produce deterministic voice selection.

**Acceptance Criteria**

1. Accent resolver accepts free-form accent inputs and emits canonical accent enum values. `[EXISTS]`
2. Resolver supports primary + secondary fallback accents per section plan. `[NEW]`
3. Existing `normalizeAccent` function is reused as core normalization primitive. `[EXISTS]`
4. Unknown accent inputs are mapped to default accent with warning telemetry. `[EXISTS]`

### E2.2 Story - Voice Resolution by Accent

**User Story**  
As a TTS engineer, I want deterministic voice resolution by accent so output remains consistent across retries and replays.

**Acceptance Criteria**

1. Voice resolver maps canonical accent to provider voice ID(s). `[NEW]`
2. Existing `ACCENT_TO_TTS_VOICE` mapping is reused as baseline mapping table. `[EXISTS]`
3. Resolver supports voice fallback order if primary voice fails provider validation. `[NEW]`
4. Selected voice ID is persisted in asset metadata and section manifest. `[NEW]`

### E2.3 Story - Accent Plan Contract for Section Segments

**User Story**  
As an orchestrator engineer, I want accent plan contracts per segment so segment A/B/C audio can be synthesized with predictable accents.

**Acceptance Criteria**

1. Section synthesis request supports segment-level accent/voice override while honoring section defaults. `[NEW]`
2. Existing segment metadata fields (`accent`, `voiceId`) from `/server/services/taskFactory.ts` are reused where available. `[EXISTS]`
3. Missing segment-level accent falls back to section accent plan deterministically. `[NEW]`
4. Segment synthesis response includes accent and voice provenance. `[NEW]`

---

## E3 - Audio Rendering Worker for 3 Segments

### E3.1 Story - Segment Batch Synthesis Worker

**User Story**  
As a backend engineer, I want a dedicated segment rendering worker so all three scripts for a section are synthesized and tracked as one unit.

**Acceptance Criteria**

1. Worker consumes a section render request containing 3 scripts and accent plan. `[NEW]`
2. Existing `generateAudioFromScript` can be reused internally as segment synthesis primitive. `[MODIFY]`
3. Worker returns per-segment results (`url`, `duration`, `accent`, `voice`, `status`). `[NEW]`
4. Worker supports partial retry of failed segments without re-rendering successful segments. `[NEW]`

### E3.2 Story - Accurate Duration Contract

**User Story**  
As a validation engineer, I want accurate duration metadata so anchors and timing gates use real media durations.

**Acceptance Criteria**

1. Rendering pipeline stores measured/derived duration per segment in synthesis response. `[NEW]`
2. Existing word-count duration estimate remains allowed as fallback only when exact media duration is unavailable. `[MODIFY]`
3. Publish gate consumes segment duration from synthesis metadata, not session timer minutes. `[NEW]`
4. Duration anomalies (zero/too short/unexpected) trigger validation failure and retry. `[NEW]`

### E3.3 Story - Idempotent Rendering by Segment Key

**User Story**  
As a platform engineer, I want idempotent rendering so duplicate section step events do not generate duplicate objects or overwrite unexpectedly.

**Acceptance Criteria**

1. Rendering key is deterministic per `session_id + section_no + segment_no + accent + prompt_version`. `[NEW]`
2. Existing task-level pathing in `uploadPollyMp3` is adapted to include segment-aware deterministic keys. `[MODIFY]`
3. Duplicate request with same key returns existing asset metadata without regenerating audio. `[NEW]`
4. Idempotency collisions are logged with correlation metadata. `[NEW]`

---

## E4 - Audio Normalization and Quality Checks

### E4.1 Story - Post-Processing Standardization

**User Story**  
As a learner experience owner, I want normalized audio loudness/format so playback quality is consistent across sections and devices.

**Acceptance Criteria**

1. Post-processing policy defines target output format, sample rate, and loudness baseline. `[NEW]`
2. Existing generated output format (`MP3`, sample rate) in audio service is retained as baseline config. `[EXISTS]`
3. If post-processing fails, segment is marked failed and retried according to policy. `[NEW]`
4. Final asset metadata records processing pipeline version. `[NEW]`

### E4.2 Story - Corruption and Silence Detection

**User Story**  
As a QA engineer, I want automated checks for corrupt/silent files so unusable audio is blocked before publish.

**Acceptance Criteria**

1. Validation checks include non-zero length, minimum expected byte size, and decodable media stream. `[NEW]`
2. Existing suspicious-small-buffer guard in `/server/audioService.ts` is retained and converted into structured validator result. `[MODIFY]`
3. Failed validation prevents section publish and raises canonical error code. `[NEW]`
4. Validator outcomes are persisted for operational diagnostics. `[NEW]`

### E4.3 Story - Quality Telemetry and Alerting Hooks

**User Story**  
As an SRE, I want quality metrics so regressions in TTS output are detected quickly.

**Acceptance Criteria**

1. Metrics emitted: synth success rate, average duration, failure codes, retry counts, silence/corruption detections. `[NEW]`
2. Existing debug logs are retained in dev but replaced by structured production telemetry fields. `[MODIFY]`
3. Alert thresholds defined for spikes in audio validation failures. `[NEW]`

---

## E5 - Asset Storage and Signed Delivery

### E5.1 Story - Deterministic Asset Naming and Storage Layout

**User Story**  
As a backend engineer, I want deterministic storage paths so assets are traceable, cache-safe, and idempotent.

**Acceptance Criteria**

1. Asset key format includes session/section/segment/accent/version dimensions. `[NEW]`
2. Existing `uploadPollyMp3` helper is extended to support segment-level keying and metadata tags. `[MODIFY]`
3. Existing bucket/region configuration fallback remains supported. `[EXISTS]`
4. Storage metadata includes checksum/hash for integrity checks. `[NEW]`

### E5.2 Story - Delivery URL Policy (Public vs Signed)

**User Story**  
As a security engineer, I want configurable delivery URL policy so we can use signed URLs where required without changing app contracts.

**Acceptance Criteria**

1. Delivery layer supports both public S3 URLs and signed URL mode by environment/config. `[NEW]`
2. Existing public URL path behavior remains functional for current environment. `[EXISTS]`
3. URL mode and expiry (for signed mode) are encoded in manifest metadata. `[NEW]`
4. CORS and playback compatibility checks pass in both delivery modes. `[NEW]`

### E5.3 Story - Manifest-Native Asset Publishing

**User Story**  
As a frontend/app engineer, I want assets published via manifest references so clients no longer rely on single `audioUrl` assumptions.

**Acceptance Criteria**

1. Section publish outputs include `audio_assets[]` with segment-level URLs, durations, accent, and voice metadata. `[NEW]`
2. Existing `audioUrl` field remains populated for legacy compatibility during migration. `[MODIFY]`
3. Client can load section audio entirely from manifest entries. `[NEW]`
4. Missing asset in manifest blocks publish completion. `[NEW]`

### E5.4 Story - Asset Retrieval Verification

**User Story**  
As an operations engineer, I want post-upload retrieval verification so broken asset references are caught before users hit playback failures.

**Acceptance Criteria**

1. Post-upload verification checks object metadata and fetchability (HEAD/GET where policy allows). `[NEW]`
2. Existing `checkAudioExists` logic is reused/extended for batch segment verification. `[MODIFY]`
3. Verification failure triggers retry or marks section step failed with canonical error code. `[NEW]`
4. Verification results are attached to section QA logs and manifest build metadata. `[NEW]`

---

## Implementation Notes for Roadmap Item E

1. Keep current Polly pipeline operational while introducing provider abstraction and segment-worker contracts.
2. Reuse existing accent normalization/mapping functions; avoid duplicating accent logic.
3. Shift from task-single-audio model to section-segment asset manifests with compatibility fields preserved.
4. Reduce production noise from raw debug logging; move to structured telemetry.
5. Validate asset fetchability and quality before section publish state transitions.

## Suggested Deliverables Checklist (E Complete)

1. Provider abstraction with Polly adapter + health checks.
2. Accent/voice resolver with fallback policy.
3. 3-segment rendering worker with idempotent keying and accurate duration metadata.
4. Audio normalization and quality validator gates.
5. Deterministic storage layout + manifest-native asset delivery + retrieval verification.

