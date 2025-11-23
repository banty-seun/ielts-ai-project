import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssignments,
  buildAvailabilityFromSchedule,
  deriveWeightsFromSkillRatings,
  getIsoDayForDate,
} from "./planDistributor";

const TZ = "UTC";

test("weekdays-only starting Thursday returns Thu/Fri only", () => {
  const today = new Date("2024-08-15T12:00:00Z"); // Thursday
  const assignments = buildAssignments({
    tz: TZ,
    today,
    availability: { weekdays: true, weekends: false },
    weights: {},
  });

  assert.equal(assignments.length, 2);
  const isoDays = assignments.map((assignment) => getIsoDayForDate(assignment.date, TZ));
  assert.deepEqual(isoDays, [4, 5]); // Thu, Fri
});

test("weekend availability only returns Sat/Sun", () => {
  const today = new Date("2024-08-17T08:00:00Z"); // Saturday
  const assignments = buildAssignments({
    tz: TZ,
    today,
    availability: { weekdays: false, weekends: true },
    weights: {},
  });

  assert.equal(assignments.length, 2);
  const isoDays = assignments.map((assignment) => getIsoDayForDate(assignment.date, TZ));
  assert.deepEqual(isoDays, [6, 7]); // Sat, Sun
});

test("weights emphasize listening without double-booking days", () => {
  const today = new Date("2024-08-12T08:00:00Z"); // Monday
  const weights = { listening: 2 };
  const assignments = buildAssignments({
    tz: TZ,
    today,
    availability: buildAvailabilityFromSchedule("both"),
    weights,
  });

  // Monday-Sunday => 7 days
  assert.equal(assignments.length, 7);
  const listeningCount = assignments.filter((a) => a.skill === "listening").length;
  assert(listeningCount >= 2);
  const isoDays = assignments.map((assignment) => getIsoDayForDate(assignment.date, TZ));
  const uniqueIsoDays = new Set(isoDays);
  assert.equal(uniqueIsoDays.size, assignments.length);
});
