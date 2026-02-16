import assert from "node:assert/strict";
import {
  applySectionStateTransition,
  canTransitionSectionState,
  mapPrefetchStatusToSectionState,
} from "../sectionState";

assert.equal(canTransitionSectionState("PLANNED", "SCRIPT_READY"), true);
assert.equal(canTransitionSectionState("PLANNED", "PUBLISHED"), false);

const allowed = applySectionStateTransition({
  sectionId: "s1",
  fromState: "SCRIPT_READY",
  toState: "QUESTIONS_READY",
  eventId: "evt-1",
});
assert.equal(allowed.ok, true);

const blocked = applySectionStateTransition({
  sectionId: "s1",
  fromState: "SCRIPT_READY",
  toState: "PUBLISHED",
  eventId: "evt-2",
});
assert.equal(blocked.ok, false);

assert.equal(mapPrefetchStatusToSectionState("idle"), "PLANNED");
assert.equal(mapPrefetchStatusToSectionState("running"), "SCRIPT_READY");
assert.equal(mapPrefetchStatusToSectionState("ready"), "PUBLISHED");
assert.equal(mapPrefetchStatusToSectionState("error"), "FAILED");

console.log("sectionState tests passed");
