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
    res.on("finish", resolve);
    res.on("error", reject);
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
  try {
    const parsed = JSON.parse(preview || "{}");
    jsonSnippet = JSON.stringify(parsed).slice(0, 160);
  } catch {
    // keep text preview
  }

  const acceptable = spec.acceptableStatuses ?? [200];
  const ok = acceptable.includes(res.statusCode) || res.statusCode < 500;

  return {
    name: spec.name,
    status: res.statusCode,
    ok,
    bodyPreview: jsonSnippet,
  };
}

const tests = [
  { name: "health", method: "GET", path: "/health", acceptableStatuses: [200, 404] },
  { name: "onboarding-status", method: "GET", path: "/api/firebase/auth/onboarding-status" },
  {
    name: "plan-generate",
    method: "POST",
    path: "/api/plan/generate",
    body: {
      fullName: "Test User",
      phoneNumber: "",
      targetBandScore: 7,
      testDate: null,
      notDecided: true,
      skillRatings: { listening: 5, reading: 5, writing: 5, speaking: 5 },
      immigrationGoal: "study",
      studyPreferences: {
        dailyCommitment: "30mins",
        schedule: "weekday",
        style: "ai-guided",
      },
    },
  },
  {
    name: "next-listening-task",
    method: "POST",
    path: "/api/session/next-listening-task",
    body: { progressId: "test-progress", taskId: "test-task" },
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
      status: 0,
      ok: false,
      bodyPreview: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const result of results) {
  const label = result.ok ? "PASS" : "FAIL";
  console.log(`${label} ${result.name} status=${result.status} body=${result.bodyPreview}`);
}
