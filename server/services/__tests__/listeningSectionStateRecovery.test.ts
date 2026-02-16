import assert from "node:assert/strict";
import type { TaskProgress } from "@shared/schema";
import { recoverSectionStateFromProgressData } from "../listeningSectionState";

const task = {
  id: "task-1",
  progressData: {
    sectionLifecycle: [
      {
        section_id: "task-1:section-1",
        section_no: 1,
        state: "QUESTIONS_READY",
        attempt: 1,
        last_error_code: null,
        updated_at: new Date().toISOString(),
        idempotency_key: "session-1:1:questions",
      },
    ],
  },
} as TaskProgress;

const recovered = recoverSectionStateFromProgressData(task, "task-1:section-1");
assert.ok(recovered);
assert.equal(recovered?.state, "QUESTIONS_READY");

const missing = recoverSectionStateFromProgressData(task, "task-1:section-2");
assert.equal(missing, null);

console.log("section recovery tests passed");
