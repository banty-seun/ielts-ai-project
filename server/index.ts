import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { getTaskProgressById } from "./controllers/getTaskProgressController";
import { verifyFirebaseAuth, ensureFirebaseUser } from "./firebaseAuth";

const app = express();
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

// The task progress endpoint is now properly registered in routes.ts
// No need for a duplicate route here

(async () => {
  const server = await registerRoutes(app);

  // Log all registered routes in development mode for debugging
  if (process.env.NODE_ENV === 'development') {
    const routes: { method: string; path: string }[] = [];
    
    app._router.stack.forEach((middleware: any) => {
      if (middleware.route) {
        // Routes registered directly on the app
        const path = middleware.route.path;
        const methods = Object.keys(middleware.route.methods)
          .filter((method) => middleware.route.methods[method])
          .map((method) => method.toUpperCase());
        
        methods.forEach((method) => {
          routes.push({ method, path });
        });
      } else if (middleware.name === 'router') {
        // Router middleware
        middleware.handle.stack.forEach((handler: any) => {
          if (handler.route) {
            const path = handler.route.path;
            const methods = Object.keys(handler.route.methods)
              .filter((method) => handler.route.methods[method])
              .map((method) => method.toUpperCase());
            
            methods.forEach((method) => {
              routes.push({ method, path: middleware.regexp.source + path });
            });
          }
        });
      }
    });
    
    // Group and log API routes
    const apiRoutes = routes.filter(r => r.path.includes('/api'));
    
    console.log('\n=== API ROUTES ===');
    apiRoutes.forEach(route => {
      console.log(`${route.method} ${route.path}`);
    });
    console.log('=== END API ROUTES ===\n');
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
