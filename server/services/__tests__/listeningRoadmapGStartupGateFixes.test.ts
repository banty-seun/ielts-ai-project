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

test("dashboard startup gate polls task-content readiness before entering practice", () => {
  assert.match(weeklyPlanSource, /waitForStartupGateReady/);
  assert.match(weeklyPlanSource, /getFreshWithAuth<any>\(\s*`\/api\/firebase\/task-content\/\$\{encodeURIComponent\(params\.progressId\)\}`/);
  assert.match(weeklyPlanSource, /Preparing Part 1 before opening practice/);
  assert.match(weeklyPlanSource, /enterPracticeWhenReady/);
});

test("practice page renders explicit pre-entry fallback outside runtime sandbox", () => {
  assert.match(practiceSource, /const StartupEntryFallback =/);
  assert.match(practiceSource, /Part 1 is still warming up\./);
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

