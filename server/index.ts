import "./env";
import express, { type Request, type Response, type NextFunction } from "express";
import os from "node:os";
import net from "node:net";
import dns from "node:dns";
import { pathToFileURL } from "node:url";
import { type Server } from "http";
import { pool } from "./db";
import { registerRoutes } from "./routes";
import { runListeningReleaseSchemaGate } from "./services/listeningReleaseSchemaGate";
import { setupVite, serveStatic, log } from "./vite";

export const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

let baseServer: Server | null = null;
let routesConfigured = false;
let assetsConfigured = false;
let listeningSchemaPreflightComplete = false;

async function ensureListeningSchemaPreflight() {
  if (listeningSchemaPreflightComplete) {
    return;
  }

  const enabled = process.env.LISTENING_STARTUP_SCHEMA_PREFLIGHT !== "false";
  if (!enabled) {
    log("[ListeningSchemaGate] SKIP startup preflight disabled via LISTENING_STARTUP_SCHEMA_PREFLIGHT=false");
    listeningSchemaPreflightComplete = true;
    return;
  }

  const result = await runListeningReleaseSchemaGate(pool);
  if (!result.ok) {
    throw new Error(result.message);
  }

  log(result.message);
  listeningSchemaPreflightComplete = true;
}

async function ensureRoutesConfigured() {
  if (routesConfigured && baseServer) {
    return baseServer;
  }

  if (!routesConfigured) {
    baseServer = await registerRoutes(app);
    routesConfigured = true;

    app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      const url = req.originalUrl ?? req.url;

      log(`[Error] ${req.method} ${url} -> ${status} "${message}"`);
      if (status >= 500) {
        console.error(err);
      }

      if (!res.headersSent) {
        res.status(status).json({ message });
      }
    });
  }

  return baseServer;
}

async function ensureAssetsConfigured() {
  if (assetsConfigured || !baseServer) {
    return;
  }

  if (app.get("env") === "development") {
    await setupVite(app, baseServer);
  } else {
    serveStatic(app);
  }

  assetsConfigured = true;
}

export async function prepareApp(options: { withAssets?: boolean } = {}) {
  await ensureListeningSchemaPreflight();
  const server = await ensureRoutesConfigured();
  if (options.withAssets) {
    await ensureAssetsConfigured();
  }
  return { app, server };
}

function logBindDiagnostics(host: string, port: number, envPortRaw: string | undefined, isNumeric: boolean) {
  console.log("[BindDebug] host:", host, "port:", port, "envPortRaw:", envPortRaw, "isNumeric:", isNumeric);
  console.log("[BindDebug] typeof host:", typeof host, "typeof port:", typeof port);
  console.log("[BindDebug] net.isIP(host):", net.isIP(host));
  dns.lookup(host, (err, addr, fam) => console.log("[BindDebug] dns.lookup:", { err: !!err, addr, fam }));
  console.log("[BindDebug] process.versions:", process.versions);
  console.log("[BindDebug] os.platform:", os.platform(), "os.release:", os.release());
  console.log("[BindDebug] REPL* snapshot:", {
    REPL_ID: !!process.env.REPL_ID,
    REPLIT_DB_URL: !!process.env.REPLIT_DB_URL,
    REPLIT_DEPLOYMENT: !!process.env.REPLIT_DEPLOYMENT,
    REPLIT_APP_NAME: !!process.env.REPLIT_APP_NAME,
  });
}

export async function startServer(options: { host?: string; port?: number } = {}) {
  const { server } = await prepareApp({ withAssets: true });
  const srv = server;

  if (!srv) {
    throw new Error("HTTP server failed to initialize");
  }

  const envPort = process.env.PORT;
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";
  const isNumeric = typeof envPort === "string" && /^\d+$/.test(envPort);
  const fallbackPort = 5000;
  const port = options.port ?? (isNumeric ? Number(envPort) : fallbackPort);

  if (envPort && !isNumeric) {
    console.warn(
      `[Startup] Ignoring non-numeric PORT value "${envPort}". Defaulting to ${port}.`
    );
  }

  logBindDiagnostics(host, port, envPort, isNumeric);

  return await new Promise<Server>((resolve, reject) => {
    srv.listen({ host, port }, () => {
      log(`[Startup] Server listening on http://${host}:${port}`);
      resolve(srv);
    });

    srv.on("error", (err: any) => {
      console.error("[Startup] ERROR", err?.code, err?.message);
      reject(err);
    });
  });
}

function isMainModule(metaUrl: string) {
  if (!process.argv[1]) {
    return false;
  }
  const mainUrl = pathToFileURL(process.argv[1]).href;
  return metaUrl === mainUrl;
}

if (isMainModule(import.meta.url)) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export default app;
