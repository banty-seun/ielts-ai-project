import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const PRACTICE_PAGE_PATH = path.resolve(process.cwd(), "client/src/pages/practice.tsx");
const practiceSource = readFileSync(PRACTICE_PAGE_PATH, "utf8");

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
