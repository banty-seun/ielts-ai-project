import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { taskProgress } from "@shared/schema";
import { resolveListeningQuestionContract } from "../services/listeningQuestionContractState";
import { validateRendererWithAdapterRules } from "../services/listeningQuestionAdapters";
import { validateTranscriptComplete } from "../services/content";
import { storage } from "../storage";

const args = process.argv.slice(2);
const userIdArg = args.find((arg) => arg.startsWith("--user-id="))?.split("=")[1] ?? null;
const weeklyPlanIdArg = args.find((arg) => arg.startsWith("--weekly-plan-id="))?.split("=")[1] ?? null;
const reportPathArg =
  args.find((arg) => arg.startsWith("--report="))?.split("=")[1] ??
  "/tmp/listening-migration-reconciliation.json";
const mismatchThreshold = Number(
  args.find((arg) => arg.startsWith("--mismatch-threshold="))?.split("=")[1] ?? "0.05",
);

type Reconciliation = {
  total: number;
  matched: number;
  mismatched: number;
  mismatchRate: number;
  categories: Record<string, number>;
  samples: Record<string, string[]>;
  threshold: number;
  pass: boolean;
  generatedAt: string;
};

const pushSample = (samples: Record<string, string[]>, category: string, taskId: string) => {
  if (!samples[category]) samples[category] = [];
  if (samples[category].length < 20) samples[category].push(taskId);
};

const run = async () => {
  const conditions: any[] = [eq(taskProgress.skill, "listening")];
  if (userIdArg) conditions.push(eq(taskProgress.userId, userIdArg));
  if (weeklyPlanIdArg) conditions.push(eq(taskProgress.weeklyPlanId, weeklyPlanIdArg));

  const rows = await db
    .select({ id: taskProgress.id })
    .from(taskProgress)
    .where(and(...conditions));

  const categories: Record<string, number> = {};
  const samples: Record<string, string[]> = {};
  let matched = 0;
  let mismatched = 0;

  for (const row of rows) {
    const task = await storage.getTaskProgress(row.id);
    if (!task) continue;

    let hasMismatch = false;
    const bump = (category: string) => {
      categories[category] = (categories[category] ?? 0) + 1;
      pushSample(samples, category, row.id);
      hasMismatch = true;
    };

    const progressData = (task.progressData ?? {}) as Record<string, any>;
    const segments = Array.isArray(progressData.segments) ? progressData.segments : [];
    if (segments.length !== 4) bump("section_count_not_4");

    const contract = resolveListeningQuestionContract(task);
    if (!contract.ok) {
      bump("question_contract_invalid");
    } else {
      const questionCount = contract.stableQuestions.length;
      if (questionCount !== 10) bump("question_count_not_10");
      if (!Array.isArray(contract.rendererPayload.blocks) || contract.rendererPayload.blocks.length !== 3) {
        bump("block_count_not_3");
      }
      const adapterValidation = validateRendererWithAdapterRules(contract.rendererPayload.blocks);
      if (!adapterValidation.ok) {
        bump("renderer_payload_not_renderable");
      }
      const missingQuestionRef = contract.rendererPayload.blocks.some((block) => {
        const questionIds = Array.isArray((block as any)?.question_ids) ? ((block as any).question_ids as any[]) : [];
        return questionIds.some((id) => !contract.stableQuestions.some((question) => String(question.id) === String(id)));
      });
      if (missingQuestionRef) {
        bump("renderer_question_reference_mismatch");
      }
    }

    const transcriptCheck = validateTranscriptComplete(task.scriptText ?? "");
    if (!transcriptCheck.ok) {
      bump("transcript_invalid");
    }

    if (hasMismatch) mismatched += 1;
    else matched += 1;
  }

  const total = matched + mismatched;
  const mismatchRate = total > 0 ? mismatched / total : 0;
  const reconciliation: Reconciliation = {
    total,
    matched,
    mismatched,
    mismatchRate,
    categories,
    samples,
    threshold: mismatchThreshold,
    pass: mismatchRate <= mismatchThreshold,
    generatedAt: new Date().toISOString(),
  };

  const dir = path.dirname(reportPathArg);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reportPathArg, JSON.stringify(reconciliation, null, 2));

  console.log("[ListeningMigration][Reconciliation]", {
    total,
    matched,
    mismatched,
    mismatchRate: Number(mismatchRate.toFixed(4)),
    threshold: mismatchThreshold,
    pass: reconciliation.pass,
    reportPath: reportPathArg,
  });

  if (!reconciliation.pass) {
    process.exitCode = 2;
  }
};

run().catch((error) => {
  console.error("[ListeningMigration][Reconciliation][Fatal]", {
    message: (error as any)?.message ?? "unknown",
  });
  process.exit(1);
});
