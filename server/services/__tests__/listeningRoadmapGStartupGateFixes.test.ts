import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const WEEKLY_PLAN_PATH = path.resolve(ROOT, "client/src/components/dashboard/ListeningWeeklyPlan.tsx");
const PRACTICE_PATH = path.resolve(ROOT, "client/src/pages/practice.tsx");
const READINESS_PATH = path.resolve(ROOT, "server/services/listeningReadiness.ts");
const ROUTES_PATH = path.resolve(ROOT, "server/routes.ts");

const weeklyPlanSource = readFileSync(WEEKLY_PLAN_PATH, "utf8");
const practiceSource = readFileSync(PRACTICE_PATH, "utf8");
const readinessSource = readFileSync(READINESS_PATH, "utf8");
const routesSource = readFileSync(ROUTES_PATH, "utf8");

test("dashboard startup gate keeps warmup in pre-entry panel with background polling before entering practice", () => {
  assert.doesNotMatch(weeklyPlanSource, /waitForStartupGateReady/);
  assert.match(weeklyPlanSource, /getFreshWithAuth<any>\(\s*`\/api\/firebase\/task-content\/\$\{encodeURIComponent\(params\.progressId\)\}`/);
  assert.match(weeklyPlanSource, /Preparing Part 1 before opening practice/);
  assert.match(weeklyPlanSource, /backgroundPolling:\s*!refreshed\.ready/);
  assert.match(weeklyPlanSource, /Leave and come back later/);
  assert.match(weeklyPlanSource, /Start session now/);
  assert.match(weeklyPlanSource, /if \(initial\.ready\) \{\s*mergeWarmupStatus\(initial\);\s*setLocation\(targetPath\);/);
});

test("practice page renders explicit pre-entry fallback outside runtime sandbox", () => {
  assert.match(practiceSource, /const StartupEntryFallback =/);
  assert.match(practiceSource, /This pre-entry fallback appears only when readiness changes after navigation/);
  assert.match(practiceSource, /Preparation continues without consuming session time/);
  assert.match(practiceSource, /Check now/);
  assert.match(practiceSource, /return \(\s*<StartupEntryFallback/);
});

test("readiness service degrades gracefully when readiness model relation is missing", () => {
  assert.match(readinessSource, /const isMissingRelationError =/);
  assert.match(readinessSource, /Readiness model table unavailable; using sessionPrefetch fallback/);
});

test("boost endpoint returns controlled degraded response for missing relation errors", () => {
  assert.match(routesSource, /listeningBoostMissingRelationWarningEmitted/);
  assert.match(routesSource, /degraded:\s*true/);
  assert.match(routesSource, /Listening readiness boost temporarily unavailable; retrying with fallback mode\./);
});
