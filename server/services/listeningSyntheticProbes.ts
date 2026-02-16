import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { listeningSyntheticProbeRun, taskProgress } from "@shared/schema";
import { getListeningOrchestratorQueueSnapshot } from "./listeningOrchestratorWorker";
import { createQuestionBlockPlan } from "./listeningQuestionPlanner";
import { resolvePromptTemplateForExecution } from "./listeningPromptRegistry";
import { getTtsProviderHealth } from "../audioService";

export type ListeningSyntheticProbeStage =
  | "section_scheduled"
  | "script_generated"
  | "question_generated"
  | "audio_rendered"
  | "result_computed"
  | "coach_analyzed";

export type ListeningSyntheticProbeResult = {
  probeName: string;
  stage: ListeningSyntheticProbeStage;
  success: boolean;
  statusCode: number;
  failureReason: string | null;
  details: Record<string, unknown>;
  environment: string;
};

type ProbeRuntimeState = {
  timer: NodeJS.Timeout | null;
  intervalMs: number | null;
  lastRunAt: string | null;
  lastRunId: string | null;
};

const state: ProbeRuntimeState = {
  timer: null,
  intervalMs: null,
  lastRunAt: null,
  lastRunId: null,
};

const runProbe = async (params: {
  probeName: string;
  stage: ListeningSyntheticProbeStage;
  environment: string;
  check: () => Promise<{ ok: boolean; statusCode?: number; reason?: string; details?: Record<string, unknown> }>;
}): Promise<ListeningSyntheticProbeResult> => {
  try {
    const outcome = await params.check();
    return {
      probeName: params.probeName,
      stage: params.stage,
      success: Boolean(outcome.ok),
      statusCode: Number(outcome.statusCode ?? (outcome.ok ? 200 : 500)),
      failureReason: outcome.ok ? null : String(outcome.reason ?? "probe_failed"),
      details: outcome.details ?? {},
      environment: params.environment,
    };
  } catch (error: any) {
    return {
      probeName: params.probeName,
      stage: params.stage,
      success: false,
      statusCode: 500,
      failureReason: error?.message ?? "probe_exception",
      details: {
        error_name: error?.name ?? "Error",
      },
      environment: params.environment,
    };
  }
};

const persistProbeResults = async (runId: string, results: ListeningSyntheticProbeResult[]) => {
  if (!results.length) return;
  await db.insert(listeningSyntheticProbeRun).values(
    results.map((result) => ({
      id: `lspr_${randomUUID()}`,
      runId,
      probeName: result.probeName,
      stage: result.stage,
      environment: result.environment,
      success: result.success,
      statusCode: result.statusCode,
      failureReason: result.failureReason,
      details: result.details,
      createdAt: new Date(),
    })),
  );
};

export const runListeningSyntheticProbeSuite = async (params?: {
  environment?: string;
  persist?: boolean;
}) => {
  const environment = String(params?.environment ?? process.env.LISTENING_PROBE_ENV ?? process.env.NODE_ENV ?? "development");
  const runId = `lprobe_${randomUUID()}`;
  const results = await Promise.all([
    runProbe({
      probeName: "orchestration_kickoff",
      stage: "section_scheduled",
      environment,
      check: async () => {
        const queue = getListeningOrchestratorQueueSnapshot();
        return {
          ok: true,
          statusCode: 200,
          details: {
            queue_depth: queue.length,
          },
        };
      },
    }),
    runProbe({
      probeName: "script_generation_contract",
      stage: "script_generated",
      environment,
      check: async () => {
        const prompt = await resolvePromptTemplateForExecution({
          promptId: "listening.segment.generation",
          userId: "synthetic-probe",
          sectionId: "synthetic-section",
        });
        return {
          ok: Boolean(prompt.selected?.template),
          statusCode: prompt.selected?.template ? 200 : 503,
          reason: prompt.selected?.template ? undefined : "prompt_template_missing",
          details: {
            prompt_id: prompt.selected?.prompt_id ?? null,
            version: prompt.selected?.version ?? null,
            assignment_mode: prompt.assignment.mode,
          },
        };
      },
    }),
    runProbe({
      probeName: "question_generation_contract",
      stage: "question_generated",
      environment,
      check: async () => {
        const blockPlan = createQuestionBlockPlan({
          sectionNo: 1,
          contextType: "everyday_social_conversation",
        });
        return {
          ok: Array.isArray(blockPlan.plans) && blockPlan.plans.length === 3,
          statusCode: Array.isArray(blockPlan.plans) && blockPlan.plans.length === 3 ? 200 : 503,
          reason:
            Array.isArray(blockPlan.plans) && blockPlan.plans.length === 3
              ? undefined
              : "question_block_plan_invalid",
          details: {
            build_id: blockPlan.build_id,
            block_count: blockPlan.plans.length,
          },
        };
      },
    }),
    runProbe({
      probeName: "tts_readiness",
      stage: "audio_rendered",
      environment,
      check: async () => {
        const health = await getTtsProviderHealth();
        return {
          ok: Boolean(health.ok),
          statusCode: health.ok ? 200 : 503,
          reason: health.ok ? undefined : "tts_provider_unhealthy",
          details: {
            provider: health.provider,
            provider_version: health.providerVersion,
            configured_provider: health.configuredProvider,
          },
        };
      },
    }),
    runProbe({
      probeName: "section_result_retrieval",
      stage: "result_computed",
      environment,
      check: async () => {
        const [recent] = await db
          .select({
            id: taskProgress.id,
            progressData: taskProgress.progressData,
          })
          .from(taskProgress)
          .where(and(eq(taskProgress.skill, "listening"), eq(taskProgress.status, "completed")))
          .orderBy(desc(taskProgress.updatedAt))
          .limit(1);
        if (!recent) {
          return {
            ok: true,
            statusCode: 204,
            details: {
              sample: "none",
            },
          };
        }
        const progressData = (recent.progressData ?? {}) as Record<string, any>;
        const sectionResults = Array.isArray(progressData.sectionResults) ? progressData.sectionResults : [];
        return {
          ok: true,
          statusCode: 200,
          details: {
            task_id: recent.id,
            section_results_count: sectionResults.length,
          },
        };
      },
    }),
    runProbe({
      probeName: "coach_output_availability",
      stage: "coach_analyzed",
      environment,
      check: async () => {
        const [recent] = await db
          .select({
            id: taskProgress.id,
            progressData: taskProgress.progressData,
          })
          .from(taskProgress)
          .where(and(eq(taskProgress.skill, "listening"), eq(taskProgress.status, "completed")))
          .orderBy(desc(taskProgress.updatedAt))
          .limit(1);
        if (!recent) {
          return {
            ok: true,
            statusCode: 204,
            details: {
              sample: "none",
            },
          };
        }
        const coach = (((recent.progressData ?? {}) as Record<string, any>).performanceCoach ?? {}) as Record<string, any>;
        return {
          ok: true,
          statusCode: 200,
          details: {
            task_id: recent.id,
            coach_available: Boolean(coach.latest),
          },
        };
      },
    }),
  ]);

  if (params?.persist !== false) {
    try {
      await persistProbeResults(runId, results);
    } catch (error: any) {
      console.warn("[SyntheticProbe][PersistSkipped]", {
        runId,
        message: error?.message ?? "persist_failed",
      });
    }
  }

  for (const result of results) {
    if (!result.success) {
      console.error(
        `[SyntheticProbe][Alert] stage=${result.stage} status=${result.statusCode} name=${result.probeName} env=${result.environment}`,
      );
    }
  }

  state.lastRunAt = new Date().toISOString();
  state.lastRunId = runId;

  return {
    runId,
    generatedAt: state.lastRunAt,
    environment,
    results,
  };
};

export const startListeningSyntheticProbeScheduler = (params?: {
  intervalMs?: number;
}) => {
  if (state.timer) return;
  const configured = Number(process.env.LISTENING_SYNTHETIC_PROBE_INTERVAL_MS ?? 0);
  const requestedIntervalMs = Number(params?.intervalMs ?? configured);
  const intervalMs = Math.max(60_000, Number.isFinite(requestedIntervalMs) ? requestedIntervalMs : 0);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return;
  }
  state.intervalMs = intervalMs;
  state.timer = setInterval(() => {
    void runListeningSyntheticProbeSuite({
      persist: true,
    }).catch((error: any) => {
      console.error("[SyntheticProbe][SchedulerError]", {
        message: error?.message ?? "unknown",
      });
    });
  }, intervalMs);
  if (typeof state.timer.unref === "function") {
    state.timer.unref();
  }
};

export const stopListeningSyntheticProbeScheduler = () => {
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = null;
  state.intervalMs = null;
};

export const getListeningSyntheticProbeSchedulerStatus = () => {
  return {
    active: Boolean(state.timer),
    intervalMs: state.intervalMs,
    lastRunAt: state.lastRunAt,
    lastRunId: state.lastRunId,
    configuredSchedule: process.env.LISTENING_SYNTHETIC_PROBE_SCHEDULE ?? null,
    environment: process.env.LISTENING_PROBE_ENV ?? process.env.NODE_ENV ?? "development",
  };
};

export const listRecentListeningSyntheticProbeRuns = async (params?: {
  limit?: number;
  environment?: string;
}) => {
  const limit = Math.max(1, Math.min(1000, Number(params?.limit ?? 200)));
  const conditions = [];
  if (params?.environment) {
    conditions.push(eq(listeningSyntheticProbeRun.environment, params.environment));
  }
  return db
    .select()
    .from(listeningSyntheticProbeRun)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(listeningSyntheticProbeRun.createdAt))
    .limit(limit);
};
