import assert from "node:assert/strict";
import { resolveResumeTargetState } from "../listeningSectionState";

assert.equal(resolveResumeTargetState("PLANNED"), "SCRIPT_READY");
assert.equal(resolveResumeTargetState("SCRIPT_READY"), "QUESTIONS_READY");
assert.equal(resolveResumeTargetState("QUESTIONS_READY"), "AUDIO_READY");
assert.equal(resolveResumeTargetState("AUDIO_READY"), "VALIDATED");
assert.equal(resolveResumeTargetState("VALIDATED"), "PUBLISHED");
assert.equal(resolveResumeTargetState("FAILED"), "PLANNED");
assert.equal(resolveResumeTargetState("PUBLISHED"), null);

console.log("listening re-entry resume tests passed");
