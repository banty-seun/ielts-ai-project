import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const inventoryReportPath =
  args.find((arg) => arg.startsWith("--inventory-report="))?.split("=")[1] ??
  "/tmp/listening-contract-backfill-report.json";
const reconciliationReportPath =
  args.find((arg) => arg.startsWith("--reconciliation-report="))?.split("=")[1] ??
  "/tmp/listening-migration-reconciliation.json";
const outputPath =
  args.find((arg) => arg.startsWith("--output="))?.split("=")[1] ??
  "/tmp/listening-rollout-readiness-report.json";

const readJson = (filePath: string) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required input file: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as Record<string, any>;
};

const ensureDir = (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const run = () => {
  const inventory = readJson(inventoryReportPath);
  const reconciliation = readJson(reconciliationReportPath);

  const readiness = {
    generatedAt: new Date().toISOString(),
    inputs: {
      inventoryReportPath,
      reconciliationReportPath,
    },
    migrationInventory: {
      attached: true,
      inventoryVersion: inventory.inventoryVersion ?? null,
      correlationId: inventory.correlationId ?? null,
      dryRun: Boolean(inventory.dryRun),
      filters: inventory.filters ?? {},
      metrics: inventory.metrics ?? {},
      mismatchSamples: inventory.mismatchSamples ?? {},
      startedAt: inventory.startedAt ?? null,
      completedAt: inventory.completedAt ?? null,
    },
    reconciliation: {
      pass: Boolean(reconciliation.pass),
      threshold: Number(reconciliation.threshold ?? 0),
      mismatchRate: Number(reconciliation.mismatchRate ?? 0),
      mismatched: Number(reconciliation.mismatched ?? 0),
      matched: Number(reconciliation.matched ?? 0),
      categories: reconciliation.categories ?? {},
      samples: reconciliation.samples ?? {},
      generatedAt: reconciliation.generatedAt ?? null,
    },
    gates: {
      migrationInventoryAttached: true,
      reconciliationPass: Boolean(reconciliation.pass),
      readinessPass: Boolean(reconciliation.pass),
    },
  };

  ensureDir(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(readiness, null, 2));

  console.log("[ListeningReadiness][Report]", {
    outputPath,
    readinessPass: readiness.gates.readinessPass,
    reconciliationPass: readiness.gates.reconciliationPass,
    inventoryVersion: readiness.migrationInventory.inventoryVersion,
  });

  if (!readiness.gates.readinessPass) {
    process.exitCode = 2;
  }
};

run();
