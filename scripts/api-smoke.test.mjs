import http from "node:http";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.env.AUTH_OFFLINE = process.env.AUTH_OFFLINE ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://localhost:5432/dev?sslmode=disable";
process.env.PORT = process.env.PORT ?? "0";
process.env.HOST = process.env.HOST ?? "127.0.0.1";
process.env.REPLIT_DOMAINS = process.env.REPLIT_DOMAINS ?? "localhost";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "test-openai-key";
const probeEnvironment = process.env.LISTENING_PROBE_ENV ?? process.env.NODE_ENV ?? "development";

const distRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const { prepareApp } = await import(distRoot);

const { server } = await prepareApp();

function decodeChunked(body) {
  let rest = body;
  let result = "";
  while (rest.length > 0) {
    const idx = rest.indexOf("\r\n");
    if (idx === -1) break;
    const len = parseInt(rest.slice(0, idx), 16);
    if (!Number.isFinite(len) || len === 0) {
      break;
    }
    const start = idx + 2;
    const chunk = rest.slice(start, start + len);
    result += chunk;
    rest = rest.slice(start + len + 2);
  }
  return result;
}

async function invoke(spec) {
  const socket = new PassThrough();
  socket.remoteAddress = "127.0.0.1";
  const req = new http.IncomingMessage(socket);
  req.method = spec.method;
  req.url = spec.path;
  req.headers = { host: "localhost", ...(spec.headers ?? {}) };

  let payload = null;
  if (spec.body !== undefined) {
    payload = typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body);
    req.headers["content-type"] = req.headers["content-type"] ?? "application/json";
    req.headers["content-length"] = Buffer.byteLength(payload).toString();
  }

  const res = new http.ServerResponse(req);
  const resSocket = new PassThrough();
  res.assignSocket(resSocket);

  const rawChunks = [];
  resSocket.on("data", (chunk) => rawChunks.push(Buffer.from(chunk)));

  const finished = new Promise((resolve, reject) => {
    const timeoutMs = Math.max(1_000, Number(spec.timeoutMs ?? 10_000));
    const timeout = setTimeout(() => {
      reject(new Error(`request_timeout:${spec.method} ${spec.path}`));
    }, timeoutMs);
    res.on("finish", () => {
      clearTimeout(timeout);
      resolve();
    });
    res.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  if (payload) {
    socket.end(payload);
  } else {
    socket.end();
  }

  server.emit("request", req, res);
  await finished;

  const raw = Buffer.concat(rawChunks).toString("utf8");
  const separator = raw.indexOf("\r\n\r\n");
  const headersText = separator >= 0 ? raw.slice(0, separator) : "";
  let bodyText = separator >= 0 ? raw.slice(separator + 4) : raw;

  if (/transfer-encoding:\s*chunked/i.test(headersText)) {
    bodyText = decodeChunked(bodyText);
  }

  let preview = bodyText.trim();
  if (preview.length > 160) {
    preview = `${preview.slice(0, 157)}…`;
  }

  let jsonSnippet = preview;
  let parsedBody = null;
  try {
    parsedBody = JSON.parse(bodyText || "{}");
    jsonSnippet = JSON.stringify(parsedBody).slice(0, 160);
  } catch {
    // keep text preview
  }

  const acceptable = spec.acceptableStatuses ?? [200];
  let ok = acceptable.includes(res.statusCode);
  if (ok && typeof spec.validate === "function") {
    ok = Boolean(spec.validate(parsedBody, res.statusCode));
  }

  return {
    name: spec.name,
    stage: spec.stage ?? "unknown",
    status: res.statusCode,
    ok,
    bodyPreview: jsonSnippet,
  };
}

const tests = [
  { name: "health", stage: "platform", method: "GET", path: "/health", acceptableStatuses: [200, 404] },
  {
    name: "onboarding-status",
    stage: "auth",
    method: "GET",
    path: "/api/firebase/auth/onboarding-status",
    acceptableStatuses: [200, 401],
  },
  {
    name: "listening-tts-health",
    stage: "audio_rendered",
    method: "GET",
    path: "/api/listening/tts/health",
    acceptableStatuses: [200, 401, 503],
  },
  {
    name: "listening-synthetic-probes",
    stage: "question_generated",
    method: "POST",
    path: "/api/listening/ops/probes/run",
    acceptableStatuses: [200, 401],
    validate: (payload, statusCode) =>
      statusCode !== 200 ||
      (Boolean(payload?.ok) &&
        Array.isArray(payload?.report?.results) &&
        payload.report.results.some((result) => result?.stage === "section_scheduled") &&
        payload.report.results.some((result) => result?.stage === "script_generated") &&
        payload.report.results.some((result) => result?.stage === "question_generated") &&
        payload.report.results.some((result) => result?.stage === "audio_rendered") &&
        payload.report.results.some((result) => result?.stage === "result_computed") &&
        payload.report.results.some((result) => result?.stage === "coach_analyzed")),
  },
  {
    name: "task-review",
    stage: "result_computed",
    method: "GET",
    path: "/api/task-progress/test-progress/review",
    acceptableStatuses: [200, 401, 404],
  },
  {
    name: "performance-analysis",
    stage: "coach_analyzed",
    method: "GET",
    path: "/api/session/performance-analysis/test-progress",
    acceptableStatuses: [200, 401, 404],
  },
];

const results = [];
for (const spec of tests) {
  try {
    const result = await invoke(spec);
    results.push(result);
  } catch (error) {
    results.push({
      name: spec.name,
      stage: spec.stage ?? "unknown",
      status: 0,
      ok: false,
      bodyPreview: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const result of results) {
  const label = result.ok ? "PASS" : "FAIL";
  console.log(`${label} ${result.name} stage=${result.stage ?? "unknown"} status=${result.status} body=${result.bodyPreview}`);
  if (!result.ok) {
    console.error(
      `[SyntheticProbe][Alert] stage=${result.stage ?? "unknown"} status=${result.status} name=${result.name} env=${probeEnvironment}`,
    );
  }
}

await new Promise((resolve) => {
  server.close(() => resolve());
});

process.exit(results.some((result) => !result.ok) ? 1 : 0);
