import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { taskProgress } from "@shared/schema";
import { storage } from "../storage";
import { resolveListeningQuestionContract } from "../services/listeningQuestionContractState";
import { validateTranscriptComplete } from "../services/content";

type Row = {
  id: string;
  userId: string;
  weeklyPlanId: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

type Checkpoint = {
  lastTaskId?: string;
  processed: number;
  skipped: number;
  failed: number;
  noOp: number;
  autoFix: number;
  manualReview: number;
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const userIdArg = args.find((arg) => arg.startsWith("--user-id="))?.split("=")[1] ?? null;
const weeklyPlanIdArg = args.find((arg) => arg.startsWith("--weekly-plan-id="))?.split("=")[1] ?? null;
const fromDateArg = args.find((arg) => arg.startsWith("--from-date="))?.split("=")[1] ?? null;
const toDateArg = args.find((arg) => arg.startsWith("--to-date="))?.split("=")[1] ?? null;
const checkpointPathArg =
  args.find((arg) => arg.startsWith("--checkpoint="))?.split("=")[1] ??
  "/tmp/listening-contract-backfill-checkpoint.json";
const reportPathArg =
  args.find((arg) => arg.startsWith("--report="))?.split("=")[1] ??
  "/tmp/listening-contract-backfill-report.json";
const progressLogEvery = Math.max(
  1,
  Number(args.find((arg) => arg.startsWith("--progress-log-every="))?.split("=")[1] ?? "50"),
);

const correlationId = `mig_${randomUUID()}`;
const startedAt = new Date().toISOString();
const mismatchSamples: Record<string, string[]> = {};

const pushMismatch = (key: string, taskId: string) => {
  if (!mismatchSamples[key]) mismatchSamples[key] = [];
  if (mismatchSamples[key].length < 20) mismatchSamples[key].push(taskId);
};

const readCheckpoint = (filePath: string): Checkpoint => {
  try {
    if (!fs.existsSync(filePath)) {
      return { processed: 0, skipped: 0, failed: 0, noOp: 0, autoFix: 0, manualReview: 0 };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return { processed: 0, skipped: 0, failed: 0, noOp: 0, autoFix: 0, manualReview: 0 };
  }
};

const writeCheckpoint = (filePath: string, checkpoint: Checkpoint) => {
  fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
};

const ensureDir = (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const run = async () => {
  const checkpoint = readCheckpoint(checkpointPathArg);
  const conditions: any[] = [eq(taskProgress.skill, "listening")];
  if (userIdArg) conditions.push(eq(taskProgress.userId, userIdArg));
  if (weeklyPlanIdArg) conditions.push(eq(taskProgress.weeklyPlanId, weeklyPlanIdArg));
  if (fromDateArg) conditions.push(gte(taskProgress.createdAt, new Date(fromDateArg)));
  if (toDateArg) conditions.push(lte(taskProgress.createdAt, new Date(toDateArg)));
  if (checkpoint.lastTaskId) {
    conditions.push(sql`${taskProgress.id} > ${checkpoint.lastTaskId}`);
  }

  const rows = (await db
    .select({
      id: taskProgress.id,
      userId: taskProgress.userId,
      weeklyPlanId: taskProgress.weeklyPlanId,
      createdAt: taskProgress.createdAt,
      updatedAt: taskProgress.updatedAt,
    })
    .from(taskProgress)
    .where(and(...conditions))
    .orderBy(asc(taskProgress.id))) as Row[];

  console.log("[ListeningMigration][Start]", {
    correlationId,
    dryRun,
    totalCandidates: rows.length,
    userId: userIdArg,
    weeklyPlanId: weeklyPlanIdArg,
    fromDate: fromDateArg,
    toDate: toDateArg,
    checkpointPath: checkpointPathArg,
  });

  for (const row of rows) {
    checkpoint.lastTaskId = row.id;
    try {
      const task = await storage.getTaskProgress(row.id);
      if (!task) {
        checkpoint.skipped += 1;
        writeCheckpoint(checkpointPathArg, checkpoint);
        continue;
      }

      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const transcriptCheck = validateTranscriptComplete(task.scriptText ?? "");
      const contract = resolveListeningQuestionContract(task);

      const updates: Record<string, any> = {};
      let changed = false;

      if (!progressData.migrationInventory) {
        updates.migrationInventory = {
          version: "1.0.0",
          lastCheckedAt: new Date().toISOString(),
          correlationId,
        };
        changed = true;
      }

      if (contract.ok && contract.changed) {
        updates.listeningQuestionContract = contract.nextProgressData.listeningQuestionContract;
        changed = true;
      }

      const sectionResults = Array.isArray(progressData.sectionResults) ? progressData.sectionResults : [];
      if (sectionResults.length) {
        const normalizedSectionResults = sectionResults.map((section: any, index: number) => ({
          sectionId: String(section?.sectionId ?? `section-${index + 1}`),
          sectionNo: Number(section?.sectionNo ?? index + 1),
          attempted: Number(section?.attempted ?? 0),
          correct: Number(section?.correct ?? 0),
          incorrect: Number(section?.incorrect ?? 0),
          unanswered: Number(section?.unanswered ?? 0),
          accuracy: Number(section?.accuracy ?? 0),
          timingSummary: section?.timingSummary ?? null,
          submittedAt: section?.submittedAt ?? null,
          acknowledged: Boolean(section?.acknowledged),
        }));
        if (JSON.stringify(sectionResults) !== JSON.stringify(normalizedSectionResults)) {
          updates.sectionResults = normalizedSectionResults;
          changed = true;
        }
      }

      const coach = (progressData.performanceCoach ?? {}) as Record<string, any>;
      if (coach.latest && !coach.latest.source_analysis_id && coach.latest.closed_loop?.source_analysis_id) {
        updates.performanceCoach = {
          ...coach,
          latest: {
            ...coach.latest,
            source_analysis_id: coach.latest.closed_loop.source_analysis_id,
          },
        };
        changed = true;
      }

      if (!contract.ok || !transcriptCheck.ok) {
        checkpoint.manualReview += 1;
        if (!contract.ok) pushMismatch("question_contract_invalid", row.id);
        if (!transcriptCheck.ok) pushMismatch("transcript_invalid", row.id);
      } else if (changed) {
        checkpoint.autoFix += 1;
      } else {
        checkpoint.noOp += 1;
      }

      if (changed && !dryRun) {
        await storage.updateTaskProgress(row.id, {
          progressData: {
            ...progressData,
            ...updates,
            migrationInventory: {
              ...(progressData.migrationInventory ?? {}),
              version: "1.0.0",
              lastCheckedAt: new Date().toISOString(),
              correlationId,
            },
          },
        });
      }

      checkpoint.processed += 1;
    } catch (error: any) {
      checkpoint.failed += 1;
      pushMismatch("task_processing_error", row.id);
      console.error("[ListeningMigration][Error]", {
        correlationId,
        taskId: row.id,
        message: error?.message ?? "unknown",
      });
    } finally {
      writeCheckpoint(checkpointPathArg, checkpoint);
      const handled = checkpoint.processed + checkpoint.skipped + checkpoint.failed;
      if (handled > 0 && handled % progressLogEvery === 0) {
        console.log("[ListeningMigration][Progress]", {
          correlationId,
          handled,
          processed: checkpoint.processed,
          skipped: checkpoint.skipped,
          failed: checkpoint.failed,
          noOp: checkpoint.noOp,
          autoFix: checkpoint.autoFix,
          manualReview: checkpoint.manualReview,
          lastTaskId: checkpoint.lastTaskId ?? null,
        });
      }
    }
  }

  const completedAt = new Date().toISOString();
  const report = {
    inventoryVersion: "1.0.0",
    correlationId,
    dryRun,
    filters: {
      userId: userIdArg,
      weeklyPlanId: weeklyPlanIdArg,
      fromDate: fromDateArg,
      toDate: toDateArg,
    },
    metrics: {
      processed: checkpoint.processed,
      skipped: checkpoint.skipped,
      failed: checkpoint.failed,
      noOp: checkpoint.noOp,
      autoFix: checkpoint.autoFix,
      manualReview: checkpoint.manualReview,
    },
    mismatchSamples,
    startedAt,
    completedAt,
  };

  ensureDir(reportPathArg);
  fs.writeFileSync(reportPathArg, JSON.stringify(report, null, 2));
  console.log("[ListeningMigration][Complete]", {
    correlationId,
    reportPath: reportPathArg,
    checkpointPath: checkpointPathArg,
    ...report.metrics,
  });
};

run().catch((error) => {
  console.error("[ListeningMigration][Fatal]", {
    correlationId,
    message: (error as any)?.message ?? "unknown",
  });
  process.exit(1);
});
