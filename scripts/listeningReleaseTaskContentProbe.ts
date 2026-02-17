import assert from "node:assert/strict";
import express from "express";
import { registerRoutes } from "../server/routes";
import { pool } from "../server/db";

async function run() {
  const rows = (
    await pool.query(
      "select id, user_id from task_progress where lower(skill)='listening' order by created_at desc limit 1",
    )
  ).rows;
  assert.ok(rows.length > 0, "No listening tasks available for task-content probe");

  const row = rows[0];
  const taskId = String(row.id);
  const userId = String(row.user_id);

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  await registerRoutes(app);

  const appAny = app as any;
  const routeLayer = appAny._router.stack.find(
    (layer: any) => layer?.route?.path === "/api/firebase/task-content/:id" && layer?.route?.methods?.get,
  );
  assert.ok(routeLayer, "Route layer /api/firebase/task-content/:id not found");

  const handler = routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
  const req: any = {
    params: { id: taskId },
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
  assert.equal(res.statusCode, 200, `Expected 200 from task-content route for ${taskId}, got ${res.statusCode}`);

  console.log(
    "[ReleaseProbe][TaskContent]",
    JSON.stringify({
      taskId,
      statusCode: res.statusCode,
      manifestStatus: res.payload?.manifest_status ?? null,
      startupReady: res.payload?.startup_ready ?? null,
    }),
  );

  await pool.end();
}

run().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
