import 'dotenv/config';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const ID_TOKEN = process.env.ID_TOKEN; // Firebase bearer token
const PLAN_WEEK = Number(process.env.PLAN_WEEK || 1);

// Small helper
async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  if (ID_TOKEN) headers.set('Authorization', `Bearer ${ID_TOKEN}`);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} on ${path}\n${text}`);
  }
  return json;
}

function approxEq(a: number, b: number, tol: number) {
  return Math.abs(a - b) <= tol;
}

(async () => {
  console.log(`[SMOKE] BASE_URL=${BASE_URL} WEEK=${PLAN_WEEK}`);

  // 1) Get weekly plan & pick a listening task
  const weekly = await api(`/api/plan/weekly/${PLAN_WEEK}`);
  const listeningPlans =
    weekly?.skills?.listening?.plan ?? weekly?.skills?.listening ?? [];
  if (!Array.isArray(listeningPlans) || listeningPlans.length === 0) {
    console.log('[SMOKE][FAIL] No listening plan items found. Did you finish onboarding & generate a plan?');
    process.exit(1);
  }

  const first = listeningPlans[0];
  const weeklyPlanId = first.weeklyPlanId || weekly?.skills?.listening?.weeklyPlanId || weekly?.weeklyPlanId;
  const taskId = first.id;
  if (!weeklyPlanId || !taskId) {
    console.log('[SMOKE][FAIL] Missing weeklyPlanId or taskId in listening plan item.');
    process.exit(1);
  }
  console.log(`[SMOKE] Chosen weeklyPlanId=${weeklyPlanId} taskId=${taskId}`);

  // 2) Start the task (server should create/ensure segments here)
  const startRes = await api(`/api/task-progress/start`, {
    method: 'POST',
    body: JSON.stringify({ weeklyPlanId, taskId }),
  });

  const progressId = startRes?.id;
  const startDuration = startRes?.duration;
  if (!progressId) {
    console.log('[SMOKE][FAIL] /start did not return a progress id.', startRes);
    process.exit(1);
  }
  console.log(`[SMOKE] Started progressId=${progressId} duration(min)=${startDuration}`);

  // 3) Fetch the task progress to inspect segments
  const prog = await api(`/api/task-progress/${progressId}`);
  const durationMin = prog?.duration ?? startDuration;
  const segments = prog?.progressData?.segments ?? [];
  const totalSec = (segments || []).reduce((s: number, seg: any) => s + Number(seg?.estimatedDurationSec || 0), 0);

  console.log(`[SMOKE] segments.length=${segments?.length ?? 0} totalSec=${totalSec} expected≈${durationMin * 60}`);

  // 4) Print accents & parts
  for (const [i, seg] of (segments || []).entries()) {
    console.log(`  [Seg ${i + 1}] part=${seg?.ieltsPart} accent=${seg?.accent || seg?.voice || 'n/a'} sec=${seg?.estimatedDurationSec}`);
  }

  // 5) Assertions
  const okLen = segments?.length === 4;
  const okSum = approxEq(totalSec, durationMin * 60, 45); // ±45s tolerance
  if (!okLen || !okSum) {
    console.log(`[SMOKE][FAIL] segmentsOk=${okLen} sumOk=${okSum}`);
    process.exit(1);
  }

  console.log('[SMOKE][PASS] 4 segments present and duration sums ≈ session minutes.');
  process.exit(0);
})().catch((e) => {
  console.error('[SMOKE][ERROR]', e?.message || e);
  process.exit(1);
});
