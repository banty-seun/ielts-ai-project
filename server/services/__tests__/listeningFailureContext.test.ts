import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScriptSubsystemFailureContext } from "../listeningFailureContext";

test("failure context includes continuity and anchor validation artifacts", () => {
  const ctx = buildScriptSubsystemFailureContext({
    stage: "continuity",
    errorCode: "CONTINUITY_HIGH_SEVERITY",
    retryable: false,
    details: ["fact mismatch"],
    continuity: { issues: [{ severity: "high" }] },
    anchorValidation: { ok: false, errors: ["a1:OFFSET_OUT_OF_BOUNDS"] },
  });

  assert.equal(ctx.stage, "continuity");
  assert.equal(ctx.error_code, "CONTINUITY_HIGH_SEVERITY");
  assert.equal(ctx.retryable, false);
  assert.equal(Array.isArray(ctx.details), true);
  assert.equal(ctx.continuity_report !== null, true);
  assert.equal(ctx.anchor_validation !== null, true);
});
