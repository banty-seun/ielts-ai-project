import assert from "node:assert/strict";
import { assertSequentialSectionStart } from "@shared/listening";
import { buildSectionStepIdempotencyKey } from "../listeningEvents";
import { classifyListeningRetry, getListeningRetryDelayMs } from "../listeningRetryPolicy";
import { deriveListeningPriority } from "../listeningPriority";

const idempotency = buildSectionStepIdempotencyKey("session_1", 2, "tts");
assert.equal(idempotency, "session_1:2:tts:v1");

const blocked = assertSequentialSectionStart({
  requestedSectionNo: 3,
  sections: [
    {
      section_id: "s1",
      section_no: 1,
      state: "PUBLISHED",
      attempt: 0,
      updated_at: new Date().toISOString(),
      idempotency_key: "x",
      last_error_code: null,
    },
    {
      section_id: "s2",
      section_no: 2,
      state: "SCRIPT_READY",
      attempt: 0,
      updated_at: new Date().toISOString(),
      idempotency_key: "y",
      last_error_code: null,
    },
  ],
});
assert.equal(blocked.ok, false);

const allowed = assertSequentialSectionStart({
  requestedSectionNo: 3,
  sections: [
    {
      section_id: "s1",
      section_no: 1,
      state: "PUBLISHED",
      attempt: 0,
      updated_at: new Date().toISOString(),
      idempotency_key: "x",
      last_error_code: null,
    },
    {
      section_id: "s2",
      section_no: 2,
      state: "PUBLISHED",
      attempt: 0,
      updated_at: new Date().toISOString(),
      idempotency_key: "y",
      last_error_code: null,
    },
  ],
});
assert.equal(allowed.ok, true);

const retryable = classifyListeningRetry({ step: "tts", errorCode: "TTS_TIMEOUT" });
assert.equal(retryable.disposition, "retryable");
assert.equal(getListeningRetryDelayMs("tts", 0), 5000);

const nonRetryable = classifyListeningRetry({ step: "publish", errorCode: "SCHEMA_INVALID" });
assert.equal(nonRetryable.disposition, "non_retryable");

const p1 = deriveListeningPriority({
  sessionStartAt: new Date(Date.now() + 30 * 60 * 1000),
  dashboardOpenBoost: true,
  readinessGap: 2,
});
assert.equal(p1.priorityClass, "P1_CURRENT");

const p3 = deriveListeningPriority({
  sessionStartAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
});
assert.equal(p3.priorityClass, "P3_LATER");

console.log("listening roadmap B contract tests passed");
