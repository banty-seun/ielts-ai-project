import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";

// Load root .env first (optional values)
loadEnv();

// Load server-specific .env with override if present
const serverEnvPath = path.resolve(process.cwd(), "server", ".env");
if (fs.existsSync(serverEnvPath)) {
  loadEnv({ path: serverEnvPath, override: true });
}
