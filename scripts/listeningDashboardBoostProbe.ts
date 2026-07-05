import assert from "node:assert/strict";
import express from "express";
import { registerRoutes } from "../server/routes";
import { pool } from "../server/db";

async function run() {
  const rows = (
    await pool.query(
      `select weekly_plan_id, user_id
       from task_progress
       where lower(skill)='listening' and weekly_plan_id is not null
       order by created_at desc
       limit 1`,
    )
  ).rows;
  assert.ok(rows.length > 0, "No listening weekly-plan task progress rows available");

  const weeklyPlanId = String(rows[0].weekly_plan_id);
  const userId = String(rows[0].user_id);

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  await registerRoutes(app);

  const appAny = app as any;
  const routeLayer = appAny._router.stack.find(
    (layer: any) =>
      layer?.route?.path === "/api/firebase/task-progress/weekly-plan/:weeklyPlanId" &&
      layer?.route?.methods?.get,
  );
  assert.ok(routeLayer, "Route layer /api/firebase/task-progress/weekly-plan/:weeklyPlanId not found");
  const handler = routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;

  const req: any = {
    params: { weeklyPlanId },
    query: {},
    body: {},
    headers: {},
    header(name: string) {
      return this.headers?.[String(name).toLowerCase()];
    },
    user: { id: userId },
    firebaseUser: { uid: userId },
  };
  const res: any = {
    statusCode: 200,
    payload: null,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.payload = data;
      this.headersSent = true;
      return this;
    },
  };

  await handler(req, res);
  assert.equal(res.statusCode, 200, `Expected 200 from weekly-plan progress route, got ${res.statusCode}`);
  assert.equal(Boolean(res.payload?.success), true, "Expected success=true");
  assert.equal(
    String(res.payload?.dashboardPrefetchBoost?.source ?? ""),
    "dashboard_open",
    "Expected dashboardPrefetchBoost.source=dashboard_open",
  );

  const taskProgress = Array.isArray(res.payload?.taskProgress) ? res.payload.taskProgress : [];
  const listeningRows = taskProgress.filter((row: any) => String(row?.skill ?? "").toLowerCase() === "listening");
  assert.ok(listeningRows.length > 0, "No listening taskProgress rows returned");
  assert.ok(
    listeningRows.some((row: any) => row?.listeningReadiness && typeof row.listeningReadiness.status === "string"),
    "Expected listeningReadiness summaries on listening taskProgress rows",
  );

  const boost = res.payload?.dashboardPrefetchBoost ?? {};
  const attempted = Number(boost.attempted ?? 0);
  const enqueued = Number(boost.enqueued ?? 0);
  const failed = Number(boost.failed ?? 0);
  if (attempted > 0) {
    assert.equal(
      enqueued + failed,
      attempted,
      "dashboardPrefetchBoost accounting mismatch (enqueued + failed must equal attempted)",
    );
  }

  console.log(
    "[ReleaseProbe][DashboardBoost]",
    JSON.stringify({
      weeklyPlanId,
      userId,
      statusCode: res.statusCode,
      dashboardPrefetchBoost: boost,
      sampleReadiness: listeningRows.slice(0, 3).map((row: any) => ({
        taskId: row.id,
        status: row.listeningReadiness?.status ?? null,
        partReady: row.listeningReadiness?.partReady ?? null,
        prefetchStatus: row.listeningReadiness?.prefetchStatus ?? null,
      })),
    }),
  );

  await pool.end();
  process.exit(0);
}

run().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});

