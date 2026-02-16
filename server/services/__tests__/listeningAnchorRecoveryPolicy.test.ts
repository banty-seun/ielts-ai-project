import assert from "node:assert/strict";
import { test } from "node:test";
import { getAnchorRecoveryDecision } from "../listeningAnchorRecoveryPolicy";

test("anchor recovery policy uses anchor_map until max attempts", () => {
  assert.equal(getAnchorRecoveryDecision({ policy: "anchor_map", attempt: 0, maxAttempts: 2 }), "anchor_map");
  assert.equal(getAnchorRecoveryDecision({ policy: "anchor_map", attempt: 1, maxAttempts: 2 }), "anchor_map");
  assert.equal(getAnchorRecoveryDecision({ policy: "anchor_map", attempt: 2, maxAttempts: 2 }), "stop");
});

test("anchor recovery policy uses segment mode until max attempts", () => {
  assert.equal(getAnchorRecoveryDecision({ policy: "segment", attempt: 0, maxAttempts: 3 }), "segment");
  assert.equal(getAnchorRecoveryDecision({ policy: "segment", attempt: 2, maxAttempts: 3 }), "segment");
  assert.equal(getAnchorRecoveryDecision({ policy: "segment", attempt: 3, maxAttempts: 3 }), "stop");
});
