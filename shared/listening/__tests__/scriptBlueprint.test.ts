import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveExpectedContextType, validateBlueprintQuality, validateContextScriptTypeCompatibility } from "../scriptBlueprint";

test("resolveExpectedContextType maps IELTS parts to all 4 context classes", () => {
  assert.equal(resolveExpectedContextType({ ieltsPart: 1 }), "everyday_social_conversation");
  assert.equal(resolveExpectedContextType({ ieltsPart: 2 }), "everyday_social_monologue");
  assert.equal(resolveExpectedContextType({ ieltsPart: 3 }), "educational_conversation");
  assert.equal(resolveExpectedContextType({ ieltsPart: 4 }), "educational_lecture");
});

test("resolveExpectedContextType uses script type compatibility hint when part missing", () => {
  assert.equal(resolveExpectedContextType({ scriptType: "monologue" }), "educational_lecture");
  assert.equal(resolveExpectedContextType({ scriptType: "dialogue" }), "everyday_social_conversation");
});

test("validateBlueprintQuality enforces entities, timeline, and min facts", () => {
  const result = validateBlueprintQuality(
    {
      blueprint_id: "bp_1",
      blueprint_version: 1,
      section_id: "section-1",
      section_no: 1,
      context_type: "everyday_social_conversation",
      entities: [],
      timeline: [],
      facts: [],
      roles: ["participant_a"],
      accent_plan: {
        default_accent: "British",
        segment_accents: [
          { segment_no: 1, accent: "British" },
          { segment_no: 2, accent: "British" },
          { segment_no: 3, accent: "British" },
        ],
      },
      script_type: "dialogue",
      created_at: new Date().toISOString(),
    },
    3,
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("BLUEPRINT_ENTITIES_EMPTY"));
  assert.ok(result.errors.includes("BLUEPRINT_TIMELINE_EMPTY"));
  assert.ok(result.errors.includes("BLUEPRINT_FACTS_BELOW_MINIMUM"));
});

test("context/scriptType compatibility rejects mismatched combinations with explicit messages", () => {
  const mismatch = validateContextScriptTypeCompatibility({
    ieltsPart: 1,
    scriptType: "monologue",
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some((entry) => entry.includes("BLUEPRINT_CONTEXT_SCRIPT_TYPE_MISMATCH")));

  const compatible = validateContextScriptTypeCompatibility({
    ieltsPart: 4,
    scriptType: "monologue",
  });
  assert.equal(compatible.ok, true);
});
