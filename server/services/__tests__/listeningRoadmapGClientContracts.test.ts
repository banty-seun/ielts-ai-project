import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const PRACTICE_PAGE_PATH = path.resolve(process.cwd(), "client/src/pages/practice.tsx");
const WEEKLY_PLAN_PATH = path.resolve(process.cwd(), "client/src/components/dashboard/ListeningWeeklyPlan.tsx");
const TASK_CARD_PATH = path.resolve(process.cwd(), "client/src/components/dashboard/ListeningTaskCard.tsx");
const SESSION_KEY_PATH = path.resolve(process.cwd(), "client/src/lib/sessionKey.ts");
const COUNTDOWN_HOOK_PATH = path.resolve(process.cwd(), "client/src/hooks/useCountdown.ts");
const practiceSource = readFileSync(PRACTICE_PAGE_PATH, "utf8");
const weeklyPlanSource = readFileSync(WEEKLY_PLAN_PATH, "utf8");
const taskCardSource = readFileSync(TASK_CARD_PATH, "utf8");
const sessionKeySource = readFileSync(SESSION_KEY_PATH, "utf8");
const countdownHookSource = readFileSync(COUNTDOWN_HOOK_PATH, "utf8");

test("practice runtime includes mobile-oriented layout tokens for section flow", () => {
  assert.match(practiceSource, /sm:p-8/);
  assert.match(practiceSource, /grid-cols-2 sm:grid-cols-4/);
  assert.match(practiceSource, /flex flex-wrap gap-2 mb-4/);
});

test("practice runtime includes baseline accessibility semantics", () => {
  assert.match(practiceSource, /aria-label="Current section audio player"/);
  assert.match(practiceSource, /aria-live="polite"/);
  assert.match(practiceSource, /role="list" aria-label="Per-question status chips"/);
  assert.match(practiceSource, /aria-label="Go to previous section question"/);
  assert.match(practiceSource, /aria-label="Go to next section question"/);
  assert.match(practiceSource, /aria-label={`Answer for section question \$\{currentQuestionIndex \+ 1\}`}/);
});

test("practice runtime preserves resilience draft state across refreshes", () => {
  assert.match(practiceSource, /window\.localStorage\.getItem\(runtimeDraftKey\)/);
  assert.match(practiceSource, /window\.localStorage\.setItem\(runtimeDraftKey, JSON\.stringify\(snapshot\)\)/);
  assert.match(practiceSource, /window\.localStorage\.removeItem\(runtimeDraftKey\)/);
  assert.match(practiceSource, /transitionTimedOut/);
});

test("practice runtime draft persistence captures deterministic section block question context", () => {
  assert.match(practiceSource, /segmentId:\s*currentSegment\?\.id/);
  assert.match(practiceSource, /blockId:\s*currentQuestionBlock\?\.blockId/);
  assert.match(practiceSource, /questionId:\s*currentQuestion\?\.id/);
  assert.match(practiceSource, /pendingRuntimeRestoreRef/);
});

test("practice runtime includes transition recovery actions and keyboard focus affordances", () => {
  assert.match(practiceSource, /Exit safely/);
  assert.match(practiceSource, /Retry/);
  assert.match(practiceSource, /focus:ring-2 focus:ring-blue-500/);
  assert.match(practiceSource, /type=\"radio\"/);
  assert.match(practiceSource, /role="status" aria-live="polite"/);
});

test("practice runtime keeps polling and backoff constants configurable", () => {
  assert.match(practiceSource, /VITE_LISTENING_NEXT_STATUS_POLL_MS/);
  assert.match(practiceSource, /VITE_LISTENING_NEXT_STATUS_POLL_MAX_MS/);
  assert.match(practiceSource, /VITE_LISTENING_STARTUP_POLL_MS/);
  assert.match(practiceSource, /VITE_LISTENING_STARTUP_POLL_MAX_MS/);
});

test("practice runtime keeps mobile tap targets at minimum touch size", () => {
  assert.match(practiceSource, /min-h-\[44px\]/);
});

test("warmup flow does not seed countdown before playable start and uses explicit start ownership", () => {
  assert.match(sessionKeySource, /export const markSessionStarted =/);
  assert.match(sessionKeySource, /warming_up' \| 'ready_not_started' \| 'started' \| 'paused'/);
  assert.match(practiceSource, /markSessionStartedAtPlayableMoment/);
  assert.match(practiceSource, /const onPlay = \(\) => \{\s*markSessionStartedAtPlayableMoment\(\)/);
  assert.doesNotMatch(weeklyPlanSource, /seedSessionStart\(/);
});

test("dashboard cards distinguish preparing and ready-to-start without countdown state", () => {
  assert.match(taskCardSource, /runtimeEntryState\?: ListeningRuntimeEntryState/);
  assert.match(taskCardSource, /Preparing Part 1/);
  assert.match(taskCardSource, /Ready to start/);
  assert.match(taskCardSource, /timer not started/);
});

test("dashboard warmup is a pre-entry background polling experience with leave-and-return guidance", () => {
  assert.match(weeklyPlanSource, /Background polling active/);
  assert.match(weeklyPlanSource, /Leave and come back later/);
  assert.match(weeklyPlanSource, /Preparation continues in background/);
  assert.match(weeklyPlanSource, /Start session now/);
});

test("dashboard enters practice immediately when startup readiness is already ready", () => {
  assert.match(weeklyPlanSource, /if \(tracked\?\.ready\) \{\s*setLocation\(targetPath\);/);
  assert.match(weeklyPlanSource, /if \(initial\.ready\) \{\s*mergeWarmupStatus\(initial\);\s*setLocation\(targetPath\);/);
});

test("practice not-ready fallback explicitly positions itself as pre-entry exception path", () => {
  assert.match(practiceSource, /This pre-entry fallback appears only when readiness changes after navigation/);
  assert.match(practiceSource, /Preparation continues without consuming session time/);
  assert.match(practiceSource, /Check now/);
});

test("countdown hook debug logs are gated to reduce QA noise", () => {
  assert.match(countdownHookSource, /DEBUG_COUNTDOWN/);
  assert.doesNotMatch(countdownHookSource, /console\.log\(\"\\[COUNTDOWN\\] tick\"/);
});
