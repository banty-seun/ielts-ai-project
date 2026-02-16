#!/usr/bin/env node
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const stagedOnly = args.has("--staged");

const ROOT_PREFIXES = ["server/", "client/", "shared/", "scripts/"];
const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".sh",
  ".env.example",
]);
const IGNORE_PATTERNS = [/^dist\//, /^node_modules\//, /^drizzle\//, /^client\/src\/fixtures\//];
const INLINE_IGNORE_TOKEN = "secret-scan:ignore";

const SECRET_PATTERNS = [
  { name: "OpenAI key", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "AWS access key ID", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "GitHub token", regex: /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: "Private key block", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    name: "Hardcoded credential assignment",
    regex:
      /\b(?:OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|FIREBASE_PRIVATE_KEY|PASSWORD|SECRET)\b\s*[:=]\s*["'`][^"'`\n]{6,}["'`]/g,
  },
];

function getTrackedFiles() {
  const command = stagedOnly
    ? "git diff --cached --name-only --diff-filter=ACM"
    : "git ls-files";
  const out = execSync(command, { encoding: "utf8" });
  return out
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}

function shouldScan(filePath) {
  if (!ROOT_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return false;
  if (IGNORE_PATTERNS.some((pattern) => pattern.test(filePath))) return false;
  const ext = path.extname(filePath);
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  return filePath.endsWith(".env.example");
}

async function scanFile(filePath) {
  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const findings = [];
  const lines = content.split("\n");
  for (const pattern of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.includes(INLINE_IGNORE_TOKEN)) continue;
      if (pattern.regex.test(line)) {
        findings.push({
          filePath,
          line: i + 1,
          name: pattern.name,
          snippet: line.trim().slice(0, 180),
        });
      }
      pattern.regex.lastIndex = 0;
    }
  }
  return findings;
}

async function main() {
  const files = getTrackedFiles().filter(shouldScan);
  const findings = [];
  for (const file of files) {
    const fileFindings = await scanFile(file);
    findings.push(...fileFindings);
  }

  if (findings.length === 0) {
    console.log(`[secret-scan] OK (${files.length} files scanned${stagedOnly ? ", staged only" : ""})`);
    process.exit(0);
  }

  console.error(`[secret-scan] ${findings.length} potential secret(s) detected:`);
  for (const finding of findings) {
    console.error(`- ${finding.filePath}:${finding.line} [${finding.name}] ${finding.snippet}`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error("[secret-scan] failed", error);
  process.exit(1);
});
