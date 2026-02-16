import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveSegmentAssignmentsForCoverage,
  validateSegmentAssignmentCoverage,
} from "../segmentOrder";

test("deriveSegmentAssignmentsForCoverage creates deterministic coverage from empty assignments", () => {
  const derived = deriveSegmentAssignmentsForCoverage({
    questionIds: Array.from({ length: 10 }, (_, idx) => `q${idx + 1}`),
    segmentIds: ["seg_1", "seg_2", "seg_3"],
    existingAssignments: {},
  });
  assert.equal(derived.changed, true);
  assert.deepEqual(Object.keys(derived.assignments).sort(), ["seg_1", "seg_2", "seg_3"]);
  const totalAssigned = Object.values(derived.assignments).reduce((sum, ids) => sum + ids.length, 0);
  assert.equal(totalAssigned, 10);
});

test("validateSegmentAssignmentCoverage fails when a question appears in multiple segments", () => {
  const validation = validateSegmentAssignmentCoverage({
    questionIds: ["q1", "q2", "q3"],
    segmentIds: ["seg_1", "seg_2"],
    assignments: {
      seg_1: ["q1", "q2"],
      seg_2: ["q2", "q3"],
    },
    segmentOrder: {},
  });
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.diagnostics.duplicate_question_ids, ["q2"]);
});

test("validateSegmentAssignmentCoverage fails when segment order references unknown question", () => {
  const validation = validateSegmentAssignmentCoverage({
    questionIds: ["q1", "q2", "q3"],
    segmentIds: ["seg_1"],
    assignments: {
      seg_1: ["q1", "q2", "q3"],
    },
    segmentOrder: {
      seg_1: ["q1", "q_missing"],
    },
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.diagnostics.order_issues.length > 0, true);
});
