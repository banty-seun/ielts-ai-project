# Listening Module Event Contracts

This document defines exact event contracts between:

- `Tutor Agent`
- `Section Orchestrator`
- `Script Agent`
- `Question Agent`
- `TTS/Accent Agent` (provider-facing worker)
- `Performance Coach Agent`
- `App/API` consumers

The contracts are versioned, idempotent, and safe for sequential section processing (`Part 1 -> Part 2 -> Part 3 -> Part 4`).

## 1) Canonical Event Envelope (Required for all events)

```json
{
  "event_id": "evt_01JABCXYZ...",
  "event_type": "listening.session.plan.created",
  "event_version": "1.0.0",
  "occurred_at": "2026-02-09T22:30:00.000Z",
  "producer": "tutor-agent",
  "trace_id": "trc_01J...",
  "correlation_id": "sess_01J...",
  "idempotency_key": "sess_01J...:event_type:v1",
  "tenant_id": "org_123",
  "user_id": "usr_123",
  "payload": {}
}
```

## 2) Standard Metadata Rules

- `event_type`: dot-separated, immutable once published.
- `event_version`: semantic version; additive fields are minor version changes.
- `correlation_id`: always session-level (`listening_session_id`).
- `trace_id`: request trace across all pipeline steps.
- `idempotency_key`: deterministic per step attempt boundary.
- `partition_key`: `listening_session_id` for ordering guarantees.

## 3) Topics / Streams

- `listening.plan.events`
- `listening.section.commands`
- `listening.section.events`
- `listening.asset.events`
- `listening.attempt.events`
- `listening.feedback.events`
- `listening.deadletter`

## 4) Lifecycle: Plan -> Section Build -> Attempt -> Coaching

1. Tutor creates weekly plan and emits session plan event.
2. Orchestrator consumes and starts sequential section pipeline.
3. For each section: script -> questions -> TTS -> validation -> publish.
4. App delivers per-part results and emits attempt completion.
5. Performance Coach analyzes final attempt and emits recommendations.
6. Tutor consumes feedback to adjust next weekly plan.

---

## 5) Tutor Agent Contracts

### 5.1 `listening.session.plan.created` (Tutor -> Orchestrator)
**Topic:** `listening.plan.events`

```json
{
  "event_type": "listening.session.plan.created",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "weekly_plan_id": "wkp_123",
    "target_total_minutes": 32,
    "sections": [
      {
        "section_no": 1,
        "target_minutes": 8,
        "question_count": 10,
        "context_type": "everyday_social_conversation",
        "accent_profile": { "primary": "uk", "secondary": ["au"] },
        "question_engine_mix": ["form_completion", "multi_select", "sentence_completion"]
      },
      {
        "section_no": 2,
        "target_minutes": 8,
        "question_count": 10,
        "context_type": "everyday_social_monologue",
        "accent_profile": { "primary": "au", "secondary": ["uk"] },
        "question_engine_mix": ["table_completion", "note_completion", "matching"]
      },
      {
        "section_no": 3,
        "target_minutes": 8,
        "question_count": 10,
        "context_type": "educational_conversation",
        "accent_profile": { "primary": "uk", "secondary": ["us"] },
        "question_engine_mix": ["summary_completion", "diagram_labeling", "multi_select"]
      },
      {
        "section_no": 4,
        "target_minutes": 8,
        "question_count": 10,
        "context_type": "educational_lecture",
        "accent_profile": { "primary": "us", "secondary": ["uk"] },
        "question_engine_mix": ["mcq_single", "note_completion", "map_labeling"]
      }
    ],
    "constraints": {
      "segment_count_per_section": 3,
      "segment_duration_min": 120,
      "segment_duration_max": 210,
      "sections_must_run_sequentially": true
    }
  }
}
```

### 5.2 `listening.weekly.plan.adjustment.requested` (PerfCoach -> Tutor)
**Topic:** `listening.feedback.events`

```json
{
  "event_type": "listening.weekly.plan.adjustment.requested",
  "event_version": "1.0.0",
  "payload": {
    "weekly_plan_id": "wkp_123",
    "listening_session_id": "lsn_123",
    "weakness_profile": [
      { "tag": "number_capture", "severity": "high" },
      { "tag": "distractor_filtering", "severity": "medium" }
    ],
    "recommended_focus": [
      "part3_conversation",
      "diagram_labeling",
      "accent_au"
    ]
  }
}
```

---

## 6) Section Orchestrator Contracts

### 6.1 `listening.section.build.requested` (Orchestrator -> Sub-agent workers)
**Topic:** `listening.section.commands`

```json
{
  "event_type": "listening.section.build.requested",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s1",
    "section_no": 1,
    "depends_on_section_no": null,
    "target_minutes": 8,
    "question_count": 10,
    "context_type": "everyday_social_conversation",
    "accent_profile": { "primary": "uk", "secondary": ["au"] },
    "question_engine_mix": ["form_completion", "multi_select", "sentence_completion"],
    "segment_plan": [
      { "segment_no": 1, "target_seconds": 180 },
      { "segment_no": 2, "target_seconds": 170 },
      { "segment_no": 3, "target_seconds": 130 }
    ]
  }
}
```

### 6.2 `listening.section.state.changed` (Orchestrator -> App/Observers)
**Topic:** `listening.section.events`

```json
{
  "event_type": "listening.section.state.changed",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s1",
    "section_no": 1,
    "state": "SCRIPT_READY",
    "previous_state": "PLANNED",
    "attempt": 1
  }
}
```

**Allowed states**

- `PLANNED`
- `SCRIPT_READY`
- `QUESTIONS_READY`
- `AUDIO_READY`
- `VALIDATED`
- `PUBLISHED`
- `FAILED`

### 6.3 `listening.section.published` (Orchestrator -> App)
**Topic:** `listening.section.events`

```json
{
  "event_type": "listening.section.published",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s1",
    "section_no": 1,
    "manifest": {
      "question_json_url": "s3://.../section1/questions.json",
      "audio_assets": [
        {
          "segment_no": 1,
          "accent": "uk",
          "url": "s3://.../section1/seg1_uk.mp3",
          "duration_seconds": 177
        }
      ],
      "anchors_url": "s3://.../section1/anchors.json",
      "answer_key_url": "s3://.../section1/answers.json"
    }
  }
}
```

---

## 7) Script Agent Contracts

### 7.1 `listening.section.script.generate.requested` (Orchestrator -> ScriptAgent)
**Topic:** `listening.section.commands`

```json
{
  "event_type": "listening.section.script.generate.requested",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s1",
    "section_no": 1,
    "context_type": "everyday_social_conversation",
    "target_minutes": 8,
    "segment_plan": [
      { "segment_no": 1, "target_seconds": 180 },
      { "segment_no": 2, "target_seconds": 170 },
      { "segment_no": 3, "target_seconds": 130 }
    ],
    "accent_profile": { "primary": "uk", "secondary": ["au"] }
  }
}
```

### 7.2 `listening.section.script.generated` (ScriptAgent -> Orchestrator)
**Topic:** `listening.section.events`

```json
{
  "event_type": "listening.section.script.generated",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s1",
    "section_no": 1,
    "story_blueprint": {
      "entities": ["Mia", "Housing Officer"],
      "timeline": ["enquiry", "requirements", "confirmation"],
      "facts": [
        "passport number",
        "homestay preference"
      ]
    },
    "segments": [
      {
        "segment_no": 1,
        "transcript": "....",
        "target_seconds": 180,
        "predicted_duration_seconds": 176,
        "anchors": [{ "label": "q1_start", "offset_seconds": 14 }]
      },
      {
        "segment_no": 2,
        "transcript": "....",
        "target_seconds": 170,
        "predicted_duration_seconds": 168,
        "anchors": [{ "label": "q4_start", "offset_seconds": 9 }]
      },
      {
        "segment_no": 3,
        "transcript": "....",
        "target_seconds": 130,
        "predicted_duration_seconds": 127,
        "anchors": [{ "label": "q7_start", "offset_seconds": 12 }]
      }
    ],
    "accent_plan": { "primary": "uk", "alternates": ["au"] }
  }
}
```

---

## 8) Question Agent Contracts

### 8.1 `listening.section.questions.generate.requested` (Orchestrator -> QuestionAgent)
**Topic:** `listening.section.commands`

```json
{
  "event_type": "listening.section.questions.generate.requested",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s1",
    "section_no": 1,
    "question_count": 10,
    "question_engine_mix": ["form_completion", "multi_select", "sentence_completion"],
    "segments": [
      { "segment_no": 1, "transcript_ref": "seg1" },
      { "segment_no": 2, "transcript_ref": "seg2" },
      { "segment_no": 3, "transcript_ref": "seg3" }
    ]
  }
}
```

### 8.2 `listening.section.questions.generated` (QuestionAgent -> Orchestrator)
**Topic:** `listening.section.events`

```json
{
  "event_type": "listening.section.questions.generated",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s1",
    "section_no": 1,
    "question_blocks": [
      {
        "block_no": 1,
        "segment_no": 1,
        "engine": "form_completion",
        "question_numbers": [1, 2, 3],
        "renderer_config": { "type": "table_form", "max_words": 3, "allow_number": true }
      },
      {
        "block_no": 2,
        "segment_no": 2,
        "engine": "multi_select",
        "question_numbers": [4, 5, 6],
        "renderer_config": { "type": "multi_select", "select_count": 2, "options": ["A", "B", "C", "D"] }
      },
      {
        "block_no": 3,
        "segment_no": 3,
        "engine": "sentence_completion",
        "question_numbers": [7, 8, 9, 10],
        "renderer_config": { "type": "inline_blanks", "max_words": 3, "allow_number": true }
      }
    ],
    "answer_key": [
      { "question_no": 1, "accepted": ["Yuchini"] },
      { "question_no": 2, "accepted": ["AB12345"] }
    ],
    "error_tags_by_question": [
      { "question_no": 1, "tags": ["spelling", "name_capture"] },
      { "question_no": 4, "tags": ["distractor_filtering"] }
    ]
  }
}
```

---

## 9) TTS / Accent Worker Contracts

### 9.1 `listening.section.tts.render.requested` (Orchestrator -> TTS Worker)
**Topic:** `listening.section.commands`

```json
{
  "event_type": "listening.section.tts.render.requested",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s1",
    "section_no": 1,
    "accent_profile": { "primary": "uk", "secondary": ["au"] },
    "segments": [
      { "segment_no": 1, "transcript": "....", "target_seconds": 180 },
      { "segment_no": 2, "transcript": "....", "target_seconds": 170 },
      { "segment_no": 3, "transcript": "....", "target_seconds": 130 }
    ]
  }
}
```

### 9.2 `listening.section.tts.rendered` (TTS Worker -> Orchestrator)
**Topic:** `listening.asset.events`

```json
{
  "event_type": "listening.section.tts.rendered",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s1",
    "section_no": 1,
    "assets": [
      {
        "segment_no": 1,
        "accent": "uk",
        "voice": "Amy",
        "audio_url": "s3://.../s1/seg1_uk.mp3",
        "duration_seconds": 178,
        "sample_rate_hz": 44100
      }
    ],
    "provider_metadata": {
      "provider": "polly",
      "request_ids": ["req_1", "req_2", "req_3"]
    }
  }
}
```

---

## 10) Attempt and Result Contracts (App/API)

### 10.1 `listening.part.completed`
**Topic:** `listening.attempt.events`

```json
{
  "event_type": "listening.part.completed",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "attempt_id": "att_123",
    "section_no": 1,
    "score": { "correct": 7, "incorrect": 2, "unanswered": 1, "accuracy": 0.7 },
    "question_outcomes": [
      {
        "question_no": 1,
        "status": "correct",
        "response_time_ms": 11800,
        "changed_answer_count": 1,
        "replay_count": 0
      }
    ]
  }
}
```

### 10.2 `listening.session.completed`
**Topic:** `listening.attempt.events`

```json
{
  "event_type": "listening.session.completed",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "attempt_id": "att_123",
    "overall_score": 31,
    "section_scores": [
      { "section_no": 1, "score": 7 },
      { "section_no": 2, "score": 8 },
      { "section_no": 3, "score": 7 },
      { "section_no": 4, "score": 9 }
    ],
    "metadata": {
      "total_playback_replays": 14,
      "avg_response_time_ms": 9800,
      "accent_used": "uk"
    }
  }
}
```

---

## 11) Performance Coach Contracts

### 11.1 `listening.performance.analysis.requested` (App/Orchestrator -> PerfCoach)
**Topic:** `listening.feedback.events`

```json
{
  "event_type": "listening.performance.analysis.requested",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "attempt_id": "att_123",
    "input_refs": {
      "part_results_url": "s3://.../attempt/parts.json",
      "question_tags_url": "s3://.../session/question-tags.json"
    }
  }
}
```

### 11.2 `listening.performance.analyzed` (PerfCoach -> App + Tutor)
**Topic:** `listening.feedback.events`

```json
{
  "event_type": "listening.performance.analyzed",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "attempt_id": "att_123",
    "weakness_profile": [
      { "tag": "number_capture", "severity": "high", "evidence_questions": [12, 25, 31] },
      { "tag": "map_labeling", "severity": "medium", "evidence_questions": [19, 20] }
    ],
    "personalized_strategies": [
      {
        "strategy_id": "st_1",
        "title": "Numbers and dates drill",
        "action": "Do 10-minute dictation drill before each session",
        "rationale": "High miss rate on numeric capture questions"
      }
    ],
    "specific_challenges": [
      "Misses correction cues after distractor options",
      "Loses accuracy in final third of sections"
    ],
    "next_practice_set": [
      { "focus": "distractor_filtering", "difficulty": "medium", "accent": "au", "count": 2 },
      { "focus": "map_labeling", "difficulty": "easy", "accent": "uk", "count": 1 }
    ]
  }
}
```

---

## 12) Failure and Retry Contracts

### 12.1 `listening.section.step.failed`
**Topic:** `listening.section.events`

```json
{
  "event_type": "listening.section.step.failed",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s2",
    "section_no": 2,
    "step": "TTS_RENDER",
    "error_code": "TTS_TIMEOUT",
    "retryable": true,
    "attempt": 2,
    "max_attempts": 5
  }
}
```

### 12.2 `listening.section.sent.to.deadletter`
**Topic:** `listening.deadletter`

```json
{
  "event_type": "listening.section.sent.to.deadletter",
  "event_version": "1.0.0",
  "payload": {
    "listening_session_id": "lsn_123",
    "section_id": "lsn_123_s2",
    "step": "QUESTION_GENERATION",
    "reason": "NON_RETRYABLE_SCHEMA_ERROR",
    "last_error_ref": "err_456"
  }
}
```

---

## 13) Ordering, Idempotency, and SLA Rules

- Section execution order is strict and global per session:
  - `section_no = 1` must be `PUBLISHED` before `section_no = 2` starts, etc.
- Per-step idempotency keys:
  - `session_id:section_no:step_name:v1`
- Consumers must be at-least-once safe.
- Suggested step SLAs:
  - Script generation: 30s p95
  - Question generation: 20s p95
  - TTS render (3 segments): 45s p95
  - Validation + publish: 10s p95

## 14) Minimum Validation Gates Before Publish

- `question_count == 10` per section
- exactly `3` segments per section
- segment durations within configured bounds
- all question numbers mapped to a renderer block
- answer key present for all questions
- anchor offsets valid against rendered audio durations
- no schema errors in renderer JSON

