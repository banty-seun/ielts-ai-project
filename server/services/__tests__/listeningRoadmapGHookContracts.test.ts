import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const HOOK_PATH = path.resolve(process.cwd(), "client/src/hooks/useListeningSession.ts");
const hookSource = readFileSync(HOOK_PATH, "utf8");

test("useListeningSession requestNextAudio checks next-part status before fallback creation", () => {
  assert.match(hookSource, /\/api\/session\/next-part-status\/\$\{encodeURIComponent\(taskId\)\}/);
  assert.match(hookSource, /maxStatusPollAttempts\s*=\s*4/);
  assert.match(hookSource, /statusData\?\.status === 'ready'/);
});

test("useListeningSession requestNextAudio keeps fallback path for next-listening-task", () => {
  assert.match(hookSource, /\/api\/session\/next-listening-task/);
  assert.match(hookSource, /progressId:\s*taskId/);
  assert.match(hookSource, /remainingMs:\s*remaining/);
});

test("useListeningSession requestNextAudio includes backoff and safe failure result", () => {
  assert.match(hookSource, /Math\.min\(12000,\s*1000 \* \(2 \*\* attempt\)\)/);
  assert.match(hookSource, /reason:\s*data\.reason \|\| 'Unknown error'/);
  assert.match(hookSource, /return \{ ok: false, reason: err\.message \};/);
});

test("useListeningSession progression is section-aware and does not append new audio packages in critical path", () => {
  assert.match(hookSource, /if \(data\.ok && data\.progressId\)/);
  assert.doesNotMatch(hookSource, /if \(data\.ok && data\.audio\)/);
  assert.doesNotMatch(hookSource, /prefetchedAudios:\s*\[\.\.\.\(prev\.prefetchedAudios \|\| \[\]\), data\.audio\]/);
});
