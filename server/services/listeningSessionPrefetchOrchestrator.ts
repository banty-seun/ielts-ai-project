import { v4 as uuidv4 } from "uuid";
import type { TaskProgress as TaskProgressRecord, Question as TaskQuestion } from "@shared/schema";
import { storage } from "../storage";
import { normalizeAccent } from "../utils/audio";
import { generateListeningSessionPackage } from "../openai";
import { checkAudioAssetsExist, generateAudioFromScript } from "../audioService";
import { validateTranscriptComplete } from "./content";
import { makeListeningTaskTitle } from "./title";
import { resolveSessionMinutesFromTask } from "./sessionDuration";
import {
  createListeningTraceContext,
  LISTENING_VALIDATION_GATE_STEP,
} from "@shared/listening";
import { buildSectionStepIdempotencyKey } from "./listeningEvents";
import {
  acquireListeningStepLock,
  heartbeatListeningStepLock,
  releaseListeningStepLock,
} from "./listeningLockManager";
import {
  recoverListeningSectionState,
  transitionListeningSectionState,
} from "./listeningSectionState";
import { syncLegacyPrefetchIntoSectionState } from "./listeningOrchestrator";
import { runListeningValidationGate } from "./listeningValidationGate";
import { buildSectionManifestFromTask, publishSectionManifestEvent } from "./listeningManifest";
import { publishManifestVersion } from "./listeningManifestVersioning";
import {
  classifyListeningRetry,
  getListeningRetryDelayMs,
  canonicalizeListeningErrorCode,
} from "./listeningRetryPolicy";
import { retryPrefetchJob } from "./prefetchRetry";
import { routeListeningTerminalFailureToDLQ } from "./listeningDeadLetter";
import { publishQueueDelayMetric } from "./listeningTelemetry";
import { enqueueValidationReview, shouldRouteValidationToReviewQueue } from "./listeningReviewWorkflow";
import { enqueueListeningOrchestratorJob } from "./listeningOrchestratorWorker";

export type ListeningSessionPrefetchExecutorDeps = {
  DEFAULT_SESSION_MINUTES: number;
  LISTENING_SESSION_MINUTES: number;
  PREFETCH_AUDIO_COUNT: number;
  TARGET_AUDIO_SECONDS: number;
  PREFETCH_STATUS_IDLE: string;
  PREFETCH_STATUS_RUNNING: string;
  PREFETCH_STATUS_READY: string;
  PREFETCH_STATUS_ERROR: string;
  resolveSessionDurations: (preferences: any, defaultMinutes: number) => { weekday: number; weekend: number };
  determineDayType: (options: { dayNumber?: number; explicit?: string; assignedDate?: string | Date }) => string;
  mapPackageQuestions: (questions: any[]) => TaskQuestion[];
  attemptTargetedSegmentRegeneration: (params: {
    taskId: string;
    userId: string;
    segmentNos: number[];
    userLevel: number;
    targetBand: number;
  }) => Promise<{ ok: boolean; scriptText?: string; reason?: string; segmentNos?: number[] }>;
  resolveSectionFallbackAccentsFromTask: (task: TaskProgressRecord) => string[];
};

export const ensureListeningSessionPrefetchWithDeps = async (
  taskId: string,
  userId: string,
  deps: ListeningSessionPrefetchExecutorDeps,
): Promise<void> => {
  const {
    DEFAULT_SESSION_MINUTES,
    LISTENING_SESSION_MINUTES,
    PREFETCH_AUDIO_COUNT,
    TARGET_AUDIO_SECONDS,
    PREFETCH_STATUS_IDLE,
    PREFETCH_STATUS_RUNNING,
    PREFETCH_STATUS_READY,
    PREFETCH_STATUS_ERROR,
    resolveSessionDurations,
    determineDayType,
    mapPackageQuestions,
    attemptTargetedSegmentRegeneration,
    resolveSectionFallbackAccentsFromTask,
  } = deps;

  let task: TaskProgressRecord | undefined;
  let prefetchStartMs = Date.now();
  let logContext: any = { taskId, userId };
  let lockKey: string | null = null;
  let lockOwnerId: string | null = null;

  try {
    task = await storage.getTaskWithContent(taskId);
    if (!task || task.userId !== userId) {
      return;
    }

    if (!task.weeklyPlanId || (task.skill && task.skill.toLowerCase() !== "listening")) {
      return;
    }

    const progressData = (task.progressData ?? {}) as Record<string, any>;
    const sessionPrefetch = progressData.sessionPrefetch ?? {};
    const currentStatus = sessionPrefetch.status ?? PREFETCH_STATUS_IDLE;
    if (sessionPrefetch.ready && currentStatus === PREFETCH_STATUS_READY) {
      return;
    }

    if (currentStatus === PREFETCH_STATUS_RUNNING) {
      return;
    }

    const lock = await acquireListeningStepLock({
      taskProgressId: task.id,
      userId,
      sectionNo: Number((task.progressData as any)?.sessionOrder ?? 1),
      stepName: "prefetch_generation",
    });
    if (!lock.ok) {
      console.info("[ListeningLock][Skipped]", {
        taskId: task.id,
        sectionNo: Number((task.progressData as any)?.sessionOrder ?? 1),
        step: "prefetch_generation",
        reason: lock.reason,
      });
      return;
    }
    lockKey = lock.lockKey;
    lockOwnerId = lock.ownerId;

    const sessionBatchId =
      typeof progressData.sessionBatchId === "string" && progressData.sessionBatchId.length > 0
        ? progressData.sessionBatchId
        : uuidv4();

    const studyPlans = await storage.getStudyPlansByUserId(userId);
    if (!studyPlans.length) {
      return;
    }

    const latestPlan = studyPlans[studyPlans.length - 1];
    const storedPreferences = (latestPlan.studyPreferences as any) ?? {};
    const defaultSessionMinutes =
      typeof storedPreferences.sessionMinutes === "number"
        ? storedPreferences.sessionMinutes
        : DEFAULT_SESSION_MINUTES;
    const durations = resolveSessionDurations(storedPreferences, defaultSessionMinutes);

    const baseDayType = determineDayType({
      dayNumber: task.dayNumber ?? 1,
      explicit: sessionPrefetch.dayType,
      assignedDate: sessionPrefetch.assignedDate ?? task.startedAt ?? task.createdAt,
    });
    let sessionMinutes = baseDayType === "weekend" ? durations.weekend : durations.weekday;
    sessionMinutes = Math.max(sessionMinutes, LISTENING_SESSION_MINUTES);

    const skillRatings = (latestPlan.skillRatings as Record<string, number>) ?? {};
    const targetBand = parseFloat(String(latestPlan.targetBandScore ?? 7)) || 7;
    const userLevel = Number(skillRatings.listening ?? 1);

    const activityType =
      sessionPrefetch.activityType === "monologue" || sessionPrefetch.activityType === "dialogue"
        ? sessionPrefetch.activityType
        : task.scriptType === "monologue"
          ? "monologue"
          : "dialogue";

    const scenario =
      typeof sessionPrefetch.scenario === "string" && sessionPrefetch.scenario.trim().length > 0
        ? sessionPrefetch.scenario
        : typeof task.contextLabel === "string" && task.contextLabel.trim().length > 0
          ? task.contextLabel
          : typeof task.topicDomain === "string" && task.topicDomain.trim().length > 0
            ? task.topicDomain
            : task.taskTitle ?? "Listening Practice";

    const accent = normalizeAccent(
      typeof sessionPrefetch.accent === "string" ? sessionPrefetch.accent : task.accent ?? "British",
    );

    const nowIso = new Date().toISOString();
    prefetchStartMs = Date.now();
    const queuePriority = (progressData.queuePriority ?? {}) as Record<string, any>;
    const enqueueAtMs = typeof queuePriority.enqueueAt === "string" ? new Date(queuePriority.enqueueAt).getTime() : null;
    const enqueueToStartMs = enqueueAtMs ? Math.max(0, prefetchStartMs - enqueueAtMs) : null;

    logContext = {
      batchId: sessionBatchId,
      userId,
      taskId,
      activityType,
      scenario,
      accent,
      sessionMinutes,
      prefetchCount: PREFETCH_AUDIO_COUNT,
    };
    console.log("[Prefetch][Start]", logContext);
    await publishQueueDelayMetric({
      taskProgressId: task.id,
      userId,
      sectionNo: Number((task.progressData as any)?.sessionOrder ?? 1),
      priorityClass: (queuePriority.class as any) ?? "P3_LATER",
      stepName: "prefetch_generation",
      enqueueToStartMs,
      metadata: {
        score: queuePriority.score ?? null,
      },
    });

    const runningProgress = {
      ...progressData,
      sessionBatchId,
      sessionPrefetch: {
        ...sessionPrefetch,
        batchId: sessionBatchId,
        status: PREFETCH_STATUS_RUNNING,
        ready: false,
        retryCount: sessionPrefetch.retryCount ?? 0,
        activityType,
        scenario,
        accent,
        sessionMinutes,
        dayType: baseDayType,
        startedAt: sessionPrefetch.startedAt ?? nowIso,
        updatedAt: nowIso,
        message: "Generating listening session assets",
      },
    };

    await storage.updateTaskStatus(task.id, task.status ?? "not-started", runningProgress);
    task.progressData = runningProgress;

    const pendingScriptsQueue = Array.isArray(sessionPrefetch.pendingScripts)
      ? (sessionPrefetch.pendingScripts as any[])
      : [];

    let audioItemsSource: Array<{ script: any; questions: any[] }> = [];
    let audioValidations: Array<{ ok: boolean; reason?: string }> = [];
    let expectedPrefetchCount = PREFETCH_AUDIO_COUNT;
    let packageAccent = accent;

    if (pendingScriptsQueue.length > 0 && currentStatus === PREFETCH_STATUS_ERROR) {
      const replayItems: Array<{ script: any; questions: any[] }> = [];
      for (const item of pendingScriptsQueue) {
        let scriptText = typeof item?.scriptText === "string" ? item.scriptText : "";
        const targetedSegmentNos = Array.isArray(item?.targetedSegmentNos)
          ? item.targetedSegmentNos
              .map((value: unknown) => Number(value))
              .filter((value: number) => Number.isFinite(value) && value > 0)
          : [];
        const targetedTaskId = typeof item?.taskProgressId === "string" ? item.taskProgressId : null;

        if (targetedTaskId && targetedSegmentNos.length > 0) {
          const targetedRegen = await attemptTargetedSegmentRegeneration({
            taskId: targetedTaskId,
            userId,
            segmentNos: targetedSegmentNos,
            userLevel,
            targetBand,
          });
          if (targetedRegen.ok) {
            scriptText = String(targetedRegen.scriptText ?? "");
            console.log("[Prefetch][TargetedRegen][Applied]", {
              taskId: targetedTaskId,
              segmentNos: targetedRegen.segmentNos,
            });
          } else {
            console.warn("[Prefetch][TargetedRegen][Skipped]", {
              taskId: targetedTaskId,
              segmentNos: targetedSegmentNos,
              reason: targetedRegen.reason,
            });
          }
        }

        replayItems.push({
          script: {
            script: scriptText,
            scriptType: item.scriptType,
            topicDomain: item.topicDomain,
            contextLabel: item.contextLabel,
            scenarioOverview: item.scenarioOverview,
            accent: item.scriptAccent ?? accent,
            estimatedDurationSec: TARGET_AUDIO_SECONDS,
          },
          questions: item.questions ?? [],
        });
      }
      audioItemsSource = replayItems;
      audioValidations = audioItemsSource.map((item) =>
        validateTranscriptComplete(typeof item?.script?.script === "string" ? item.script.script : ""),
      );
      expectedPrefetchCount = pendingScriptsQueue.length;
    } else {
      const maxPackageAttempts = 3;
      let generatedPackage: Awaited<ReturnType<typeof generateListeningSessionPackage>> | null = null;
      for (let attempt = 0; attempt < maxPackageAttempts; attempt++) {
        const candidate = await generateListeningSessionPackage({
          activityType: activityType as "dialogue" | "monologue",
          scenario,
          sessionDurationMinutes: sessionMinutes,
          targetBand,
          userLevel,
          accent,
          prefetchCount: PREFETCH_AUDIO_COUNT,
        });
        const validations = candidate.audios.map((audio) =>
          validateTranscriptComplete(typeof audio?.script?.script === "string" ? audio.script.script : ""),
        );
        const invalidCount = validations.filter((val) => !val.ok).length;
        if (!invalidCount) {
          generatedPackage = candidate;
          audioValidations = validations;
          break;
        }
        if (attempt === maxPackageAttempts - 1) {
          generatedPackage = candidate;
          audioValidations = validations;
          console.warn("[Session Prefetch] Using package with incomplete scripts after retries", {
            invalidCount,
          });
        } else {
          console.warn("[Session Prefetch] Script validation failed, retrying package generation", {
            attempt: attempt + 1,
            invalidCount,
          });
        }
      }

      if (!generatedPackage) {
        throw new Error("Failed to generate listening session package");
      }

      audioItemsSource = generatedPackage.audios;
      packageAccent = generatedPackage.session.accent ?? accent;
      expectedPrefetchCount = Math.min(PREFETCH_AUDIO_COUNT, audioItemsSource.length);
    }

    const planTasks = await storage.getTaskProgressByWeeklyPlan(task.weeklyPlanId, userId);
    const existingByOrder = new Map<number, TaskProgressRecord>();
    for (const existing of planTasks) {
      const pd = (existing.progressData ?? {}) as Record<string, any>;
      if (pd?.sessionBatchId === sessionBatchId && typeof pd?.sessionOrder === "number") {
        existingByOrder.set(pd.sessionOrder, existing as TaskProgressRecord);
      }
    }

    let successCount = 0;
    const pendingScripts: any[] = [];
    const audioItems = audioItemsSource.slice(0, PREFETCH_AUDIO_COUNT);

    const awsConfigured = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    if (!awsConfigured) {
      throw Object.assign(new Error("Missing AWS credentials for Polly"), { code: "POLLY_AUTH" });
    }

    for (let idx = 0; idx < audioItems.length; idx++) {
      if (lockKey && lockOwnerId) {
        await heartbeatListeningStepLock({
          lockKey,
          ownerId: lockOwnerId,
        });
      }
      const order = idx + 1;
      const audioItem = audioItems[idx];
      const script = audioItem?.script ?? {};
      const scriptText = typeof script.script === "string" ? script.script : "";
      if (!scriptText.trim()) {
        continue;
      }

      const questions = mapPackageQuestions(audioItem.questions);
      if (!questions.length) {
        continue;
      }

      const scriptValidation = audioValidations[idx] ?? validateTranscriptComplete(scriptText);
      if (!scriptValidation.ok) {
        console.warn("[Session Prefetch] Script failed validation, queued for regeneration", {
          order,
          reason: scriptValidation.reason,
        });
        pendingScripts.push({
          order,
          scriptText,
          questions,
          scriptType: typeof script.scriptType === "string" ? script.scriptType : activityType,
          scriptAccent: script.accent ?? packageAccent,
          scenarioOverview: script.scenarioOverview,
          topicDomain: script.topicDomain,
          contextLabel: script.contextLabel,
          validationReason: scriptValidation.reason ?? "invalid",
          failureCode: "TRANSCRIPT_INVALID",
        });
        continue;
      }

      const scriptAccent = normalizeAccent(script.accent ?? packageAccent);
      const scriptType =
        script.scriptType === "monologue" || script.scriptType === "dialogue"
          ? script.scriptType
          : activityType;
      const scenarioOverview =
        typeof script.scenarioOverview === "string"
          ? script.scenarioOverview
          : `${scenario} listening task`;
      const topicDomain = typeof script.topicDomain === "string" ? script.topicDomain : scenario;
      const contextLabel = typeof script.contextLabel === "string" ? script.contextLabel : topicDomain;

      let targetTask: TaskProgressRecord | undefined = order === 1
        ? task
        : existingByOrder.get(order);

      if (!targetTask) {
        const generatedTitle = makeListeningTaskTitle({
          scriptType,
          contextLabel,
          topicDomain,
          scenarioOverview,
        });

        const createdTask = await storage.createTaskProgress({
          id: uuidv4(),
          userId: task.userId,
          weeklyPlanId: task.weeklyPlanId,
          weekNumber: task.weekNumber,
          dayNumber: task.dayNumber,
          taskTitle: generatedTitle,
          skill: "listening",
          status: "not-started",
          scriptType,
          accent: scriptAccent,
          topicDomain,
          contextLabel,
          scenarioOverview,
          estimatedDurationSec: TARGET_AUDIO_SECONDS,
          duration: sessionMinutes,
          replayLimit: 3,
          progressData: {
            sessionBatchId,
            sessionOrder: order,
            sessionDurationMinutes: sessionMinutes,
            audioDurationSec: TARGET_AUDIO_SECONDS,
            sessionPrefetch: {
              batchId: sessionBatchId,
              order,
              total: PREFETCH_AUDIO_COUNT,
              ready: false,
              activityType,
              scenario,
              accent: scriptAccent,
              sessionMinutes,
              dayType: baseDayType,
              createdAt: nowIso,
            },
          },
        } as any);

        targetTask = createdTask as TaskProgressRecord;
        existingByOrder.set(order, createdTask as TaskProgressRecord);
      }

      const sectionId = `${targetTask.id}:section-${order}`;
      const sectionTrace = createListeningTraceContext({
        userId,
        taskId: targetTask.id,
        sessionBatchId,
      });
      await transitionListeningSectionState({
        task: targetTask,
        sectionId,
        sectionNo: order,
        toState: "PLANNED",
        eventId: sectionTrace.traceId,
        idempotencyKey: buildSectionStepIdempotencyKey(sectionTrace.correlationId, order, "bootstrap"),
      });

      const recovered = await recoverListeningSectionState(targetTask, sectionId);
      if (
        recovered?.state === "PUBLISHED" &&
        Boolean(targetTask.audioUrl) &&
        Array.isArray(targetTask.questions) &&
        targetTask.questions.length > 0
      ) {
        successCount += 1;
        continue;
      }

      await transitionListeningSectionState({
        task: targetTask,
        sectionId,
        sectionNo: order,
        toState: "SCRIPT_READY",
        eventId: sectionTrace.traceId,
        idempotencyKey: buildSectionStepIdempotencyKey(sectionTrace.correlationId, order, "script"),
      });

      await transitionListeningSectionState({
        task: targetTask,
        sectionId,
        sectionNo: order,
        toState: "QUESTIONS_READY",
        eventId: sectionTrace.traceId,
        idempotencyKey: buildSectionStepIdempotencyKey(sectionTrace.correlationId, order, "questions"),
      });

      const audioResult = await generateAudioFromScript(
        scriptText,
        scriptAccent,
        userId,
        targetTask.id,
        task.weekNumber ?? 1,
        {
          sessionId: sessionBatchId,
          sectionNo: order,
          correlationId: sectionTrace.correlationId,
          sectionFallbackAccents: resolveSectionFallbackAccentsFromTask(targetTask),
        },
      );

      if (!audioResult.success || !audioResult.audioUrl) {
        console.error("[Session Prefetch] Audio generation failed", {
          taskId: targetTask.id,
          order,
          reason: audioResult.error ?? "unknown",
        });
        pendingScripts.push({
          order,
          scriptText,
          questions,
          scriptType,
          scriptAccent,
          scenarioOverview,
          topicDomain,
          contextLabel,
          failureReason: audioResult.error ?? "audio_generation_failed",
          failureCode: audioResult.metadata?.errorCode ?? "TTS_TIMEOUT",
        });
        await transitionListeningSectionState({
          task: targetTask,
          sectionId,
          sectionNo: order,
          toState: "FAILED",
          eventId: sectionTrace.traceId,
          idempotencyKey: buildSectionStepIdempotencyKey(sectionTrace.correlationId, order, "audio_failed"),
          errorCode: String(audioResult.metadata?.errorCode ?? "TTS_TIMEOUT"),
        });
      }

      const derivedTitle = makeListeningTaskTitle({
        scriptType,
        contextLabel,
        topicDomain,
        scenarioOverview,
      });

      const targetTaskTitle =
        order === 1
          ? task.taskTitle ?? derivedTitle
          : targetTask.taskTitle ?? derivedTitle;

      const updatePayload: Record<string, any> = {
        scriptText,
        scriptType,
        difficulty: `Band ${targetBand}`,
        accent: scriptAccent,
        topicDomain,
        contextLabel,
        scenarioOverview,
        estimatedDurationSec: TARGET_AUDIO_SECONDS,
        questions,
        taskTitle: targetTaskTitle,
        duration: resolveSessionMinutesFromTask(targetTask, sessionMinutes),
        ieltsPart:
          script.ieltsPart === 1 || script.ieltsPart === 2 || script.ieltsPart === 3 || script.ieltsPart === 4
            ? script.ieltsPart
            : null,
      };

      const renderedSectionAssets =
        audioResult.success && audioResult.metadata
          ? [
              {
                segment_no: 1,
                accent: audioResult.metadata.accent,
                voice_id: audioResult.metadata.voiceId ?? null,
                url: audioResult.metadata.url ?? audioResult.audioUrl ?? null,
                duration_seconds: audioResult.metadata.durationSec ?? audioResult.duration ?? 0,
                provider: audioResult.metadata.provider,
                provider_version: audioResult.metadata.providerVersion,
                pipeline_version: audioResult.metadata.pipelineVersion ?? "tts-pipeline-v1",
                checksum_sha256: audioResult.metadata.checksumSha256 ?? null,
                status: audioResult.metadata.status,
                url_mode: audioResult.metadata.urlMode ?? "public",
                url_expires_at: audioResult.metadata.urlExpiresAt ?? null,
                retrieval_verified: audioResult.metadata.retrievalVerified ?? false,
                section_no: order,
                duration_source: audioResult.metadata.durationSource ?? null,
                validator_code: audioResult.metadata.validatorCode ?? null,
                validator_reason: audioResult.metadata.validatorReason ?? null,
              },
            ].filter((asset) => typeof asset.url === "string" && asset.url.length > 0 && asset.duration_seconds > 0)
          : [];
      const renderedSectionQa =
        audioResult.metadata
          ? {
              section_no: order,
              generated_at: new Date().toISOString(),
              entries: [
                {
                  segment_no: 1,
                  status: audioResult.metadata.status,
                  error_code: audioResult.metadata.errorCode ?? null,
                  error_message: audioResult.metadata.errorMessage ?? null,
                  validator_code: audioResult.metadata.validatorCode ?? null,
                  validator_reason: audioResult.metadata.validatorReason ?? null,
                  attempts: audioResult.metadata.attempts ?? 0,
                  fallback_used: audioResult.metadata.fallbackUsed ?? false,
                  retrieval_verified: audioResult.metadata.retrievalVerified ?? false,
                  duration_seconds: audioResult.metadata.durationSec ?? null,
                  duration_source: audioResult.metadata.durationSource ?? null,
                  voice_id: audioResult.metadata.voiceId ?? null,
                  accent: audioResult.metadata.accent,
                },
              ],
              summary: {
                total: 1,
                success: audioResult.metadata.status === "success" ? 1 : 0,
                failed: audioResult.metadata.status === "failed" ? 1 : 0,
                validator_failures: audioResult.metadata.validatorCode ? 1 : 0,
                retrieval_failures: audioResult.metadata.retrievalVerified === false ? 1 : 0,
              },
            }
          : null;
      const renderedSectionVerification =
        renderedSectionAssets.length > 0
          ? await checkAudioAssetsExist(renderedSectionAssets.map((asset) => String(asset.url)))
          : { ok: false, missing: [] as string[] };
      const audioReady = Boolean(audioResult.audioUrl) && renderedSectionVerification.ok;
      const taskStatus = audioReady ? PREFETCH_STATUS_RUNNING : PREFETCH_STATUS_ERROR;
      if (audioReady && audioResult.audioUrl) {
        updatePayload.audioUrl = audioResult.audioUrl;
      }
      await storage.updateTaskContent(targetTask.id, updatePayload);
      if (!renderedSectionVerification.ok) {
        pendingScripts.push({
          taskProgressId: targetTask.id,
          order,
          scriptText,
          questions,
          scriptType,
          scriptAccent,
          scenarioOverview,
          topicDomain,
          contextLabel,
          failureReason: "audio_asset_verification_failed",
          failureCode: "DELIVERY_VERIFICATION_FAILED",
        });
      }
      if (audioReady) {
        await transitionListeningSectionState({
          task: targetTask,
          sectionId,
          sectionNo: order,
          toState: "AUDIO_READY",
          eventId: sectionTrace.traceId,
          idempotencyKey: buildSectionStepIdempotencyKey(sectionTrace.correlationId, order, "audio"),
        });
      }

      const mergedProgressData = {
        ...(targetTask.progressData ?? {}),
        sessionBatchId,
        sessionOrder: order,
        sessionDurationMinutes: sessionMinutes,
        audioDurationSec: TARGET_AUDIO_SECONDS,
        sectionAudioAssets: renderedSectionAssets,
        sectionAudioQa: renderedSectionQa,
        sectionAudioVerification: renderedSectionVerification,
        sessionPrefetch: {
          ...(targetTask.progressData as any)?.sessionPrefetch,
          batchId: sessionBatchId,
          status: taskStatus,
          order,
          total: PREFETCH_AUDIO_COUNT,
          ready: audioReady,
          activityType,
          scenario,
          accent: scriptAccent,
          sessionMinutes,
          dayType: baseDayType,
          createdAt: nowIso,
          updatedAt: new Date().toISOString(),
          audioUrl: audioResult.audioUrl ?? null,
        },
      };

      const stagedTaskWithProgress = {
        ...targetTask,
        progressData: mergedProgressData,
      } as TaskProgressRecord;
      const progressWithSectionState = await syncLegacyPrefetchIntoSectionState(stagedTaskWithProgress, order);

      let progressWithManifest = progressWithSectionState;
      const candidateTask = {
        ...targetTask,
        progressData: progressWithSectionState,
        scriptText,
        questions,
        audioUrl: audioResult.audioUrl ?? targetTask.audioUrl ?? null,
        accent: scriptAccent,
        duration: resolveSessionMinutesFromTask(targetTask, sessionMinutes),
      } as TaskProgressRecord;
      const validationGate = runListeningValidationGate({
        task: candidateTask,
        sectionNo: order,
      });

      const validationReportRow = await storage.insertListeningValidationReport({
        taskProgressId: candidateTask.id,
        userId: candidateTask.userId,
        sectionId: candidateTask.id,
        sectionNo: order,
        verdict: validationGate.report.verdict,
        severity: validationGate.report.severity,
        topErrorCode: validationGate.report.top_error_code ?? null,
        report: validationGate.report as unknown as Record<string, unknown>,
        timingArtifact: (validationGate.timingArtifact ?? null) as unknown as Record<string, unknown> | null,
      });
      const timingQaArtifactRef = {
        validation_report_id: validationReportRow.id,
        section_id: candidateTask.id,
        section_no: order,
      };
      const validationGateMetadata = {
        validation_step: LISTENING_VALIDATION_GATE_STEP,
        validation_report_id: validationReportRow.id,
        timing_artifact_ref: timingQaArtifactRef,
        validation_verdict: validationGate.report.verdict,
      };

      let sectionPartReady = false;
      if (validationGate.report.verdict === "PASS") {
        await transitionListeningSectionState({
          task: targetTask,
          sectionId,
          sectionNo: order,
          toState: "VALIDATED",
          eventId: sectionTrace.traceId,
          idempotencyKey: buildSectionStepIdempotencyKey(sectionTrace.correlationId, order, "validation"),
          metadata: validationGateMetadata,
        });

        const manifestDraft = buildSectionManifestFromTask(candidateTask, {
          validationReportId: validationReportRow.id,
          validationVerdict: validationGate.report.verdict,
          traceId: sectionTrace.traceId,
          correlationId: sectionTrace.correlationId,
        });

        const publishedVersion = await publishManifestVersion({
          task: candidateTask,
          manifest: manifestDraft,
          validationReportId: validationReportRow.id,
          publishedBy: "system",
          traceId: sectionTrace.traceId,
          correlationId: sectionTrace.correlationId,
        });

        const publishIdempotencyKey = buildSectionStepIdempotencyKey(sectionTrace.correlationId, order, "publish");
        const published = await publishSectionManifestEvent({
          task: candidateTask,
          traceId: sectionTrace.traceId,
          correlationId: sectionTrace.correlationId,
          idempotencyKey: publishIdempotencyKey,
          manifest: publishedVersion.manifest,
        });

        progressWithManifest = {
          ...progressWithSectionState,
          sectionManifest: publishedVersion.manifest,
          sectionManifestVersion: publishedVersion.version.versionNo,
          validationReportId: validationReportRow.id,
          validationReport: validationGate.report,
          timingQaArtifact: validationGate.timingArtifact ?? null,
          timingQaArtifactRef,
          rendererPayload: validationGate.rendererPayload,
          manifestPublishedEvent: published.event,
          part_ready: true,
        };
        sectionPartReady = true;

        await transitionListeningSectionState({
          task: targetTask,
          sectionId,
          sectionNo: order,
          toState: "PUBLISHED",
          eventId: sectionTrace.traceId,
          idempotencyKey: buildSectionStepIdempotencyKey(sectionTrace.correlationId, order, "publish"),
        });
      } else {
        const topErrorCode = String(validationGate.report.top_error_code ?? "VALIDATION_FAILED");
        const targetedRegenCodes = new Set([
          "ANCHOR_OUT_OF_BOUNDS",
          "SEGMENT_DURATION_OUT_OF_BOUNDS",
          "SECTION_DURATION_BUDGET_EXCEEDED",
        ]);
        const timingArtifact = validationGate.timingArtifact;
        const durationOutlierSegments = (timingArtifact?.segment_durations ?? [])
          .filter((segment) => segment.within_bounds === false)
          .map((segment) => segment.segment_no);
        const anchorOutlierSegments = (timingArtifact?.anchors ?? [])
          .filter((anchor) => anchor.within_bounds === false)
          .map((anchor) => anchor.segment_no);
        const targetedSegmentNos = Array.from(
          new Set<number>([...durationOutlierSegments, ...anchorOutlierSegments]),
        ).sort((a, b) => a - b);
        if (
          topErrorCode === "SECTION_DURATION_BUDGET_EXCEEDED" &&
          targetedSegmentNos.length === 0 &&
          timingArtifact?.segment_durations?.length
        ) {
          targetedSegmentNos.push(...timingArtifact.segment_durations.map((segment) => segment.segment_no));
        }
        let reviewQueueId: string | null = null;

        if (shouldRouteValidationToReviewQueue(validationGate.report)) {
          const queued = await enqueueValidationReview({
            task: candidateTask,
            report: validationGate.report,
            traceId: sectionTrace.traceId,
            correlationId: sectionTrace.correlationId,
          });
          reviewQueueId = queued.id;
          await transitionListeningSectionState({
            task: targetTask,
            sectionId,
            sectionNo: order,
            toState: "REVIEW_REQUIRED",
            eventId: sectionTrace.traceId,
            idempotencyKey: buildSectionStepIdempotencyKey(sectionTrace.correlationId, order, "review_queue"),
            errorCode: topErrorCode,
            metadata: {
              ...validationGateMetadata,
              validation_error_code: topErrorCode,
            },
          });
        } else {
          await transitionListeningSectionState({
            task: targetTask,
            sectionId,
            sectionNo: order,
            toState: "FAILED",
            eventId: sectionTrace.traceId,
            idempotencyKey: buildSectionStepIdempotencyKey(sectionTrace.correlationId, order, "validation_failed"),
            errorCode: topErrorCode,
            metadata: {
              ...validationGateMetadata,
              validation_error_code: topErrorCode,
            },
          });
        }

        progressWithManifest = {
          ...progressWithSectionState,
          validationReportId: validationReportRow.id,
          validationReport: validationGate.report,
          timingQaArtifact: validationGate.timingArtifact ?? null,
          timingQaArtifactRef,
          manifestValidationError: {
            code: topErrorCode,
            report_id: validationReportRow.id,
            failed_gates: validationGate.report.gates.filter((gate) => gate.status === "fail"),
            targeted_regeneration_segment_nos:
              targetedRegenCodes.has(topErrorCode) && targetedSegmentNos.length > 0
                ? targetedSegmentNos
                : undefined,
          },
          reviewQueueId,
          part_ready: false,
        };

        if (reviewQueueId === null && targetedRegenCodes.has(topErrorCode) && targetedSegmentNos.length > 0) {
          pendingScripts.push({
            taskProgressId: targetTask.id,
            order,
            scriptText,
            questions,
            scriptType,
            scriptAccent,
            scenarioOverview,
            topicDomain,
            contextLabel,
            failureReason: "validation_targeted_regeneration",
            failureCode: topErrorCode,
            targetedSegmentNos,
          });
        }
      }

      await storage.updateTaskStatus(
        targetTask.id,
        targetTask.status ?? "not-started",
        progressWithManifest,
      );

      if (audioReady && sectionPartReady) {
        successCount += 1;
      }
    }

    const completedAt = new Date().toISOString();
    const allAudiosAvailable = successCount >= expectedPrefetchCount && expectedPrefetchCount > 0;
    const partialReady = false;

    const finalStatus = allAudiosAvailable ? PREFETCH_STATUS_READY : PREFETCH_STATUS_ERROR;

    const finalProgress = {
      ...progressData,
      sessionBatchId,
      sessionPrefetch: {
        ...sessionPrefetch,
        batchId: sessionBatchId,
        status: finalStatus,
        ready: finalStatus === PREFETCH_STATUS_READY,
        activityType,
        scenario,
        accent: packageAccent,
        sessionMinutes,
        dayType: baseDayType,
        updatedAt: completedAt,
        completedAt,
        successCount,
        expected: expectedPrefetchCount,
        partial: partialReady,
        retryCount: finalStatus === PREFETCH_STATUS_READY
          ? 0
          : sessionPrefetch.retryCount ?? 0,
        pendingScripts: allAudiosAvailable ? undefined : pendingScripts,
        message: finalStatus === PREFETCH_STATUS_READY
          ? "Listening session ready"
          : finalStatus === PREFETCH_STATUS_ERROR
            ? (sessionPrefetch.message ?? "Failed to prepare listening session assets")
            : sessionPrefetch.message,
      },
    };
    const finalTaskSnapshot = {
      ...task,
      progressData: finalProgress,
    } as TaskProgressRecord;
    const finalProgressWithSectionState = await syncLegacyPrefetchIntoSectionState(finalTaskSnapshot, 1);

    await storage.updateTaskStatus(task.id, task.status ?? "not-started", finalProgressWithSectionState);

    for (const [order, secondaryTask] of existingByOrder.entries()) {
      if (order === 1) continue;

      const secondaryProgressData = (secondaryTask.progressData ?? {}) as Record<string, any>;
      const secondaryFinalProgress = {
        ...secondaryProgressData,
        sessionBatchId,
        sessionPrefetch: {
          ...(secondaryProgressData.sessionPrefetch ?? {}),
          batchId: sessionBatchId,
          status: finalStatus,
          ready: finalStatus === PREFETCH_STATUS_READY,
          updatedAt: completedAt,
        },
      };
      const secondarySnapshot = {
        ...secondaryTask,
        progressData: secondaryFinalProgress,
      } as TaskProgressRecord;
      const secondaryWithSectionState = await syncLegacyPrefetchIntoSectionState(
        secondarySnapshot,
        Number((secondaryProgressData as any).sessionOrder ?? order),
      );

      await storage.updateTaskStatus(
        secondaryTask.id,
        secondaryTask.status ?? "not-started",
        secondaryWithSectionState,
      );
    }

    const durationMs = Date.now() - prefetchStartMs;
    const avgAudioGenMs = successCount > 0 ? Math.round(durationMs / successCount) : 0;
    console.log("[Prefetch][End]", {
      ...logContext,
      status: finalStatus,
      durationMs,
      successCount,
      expectedCount: expectedPrefetchCount,
      partial: partialReady,
      avgAudioGenMs,
    });
    await publishQueueDelayMetric({
      taskProgressId: task.id,
      userId,
      sectionNo: Number((task.progressData as any)?.sessionOrder ?? 1),
      priorityClass: (((progressData as any)?.queuePriority ?? {}).class as any) ?? "P3_LATER",
      stepName: "publish",
      startToPublishMs: durationMs,
      metadata: {
        status: finalStatus,
        successCount,
        expectedPrefetchCount,
      },
    });

    if (!allAudiosAvailable && !partialReady) {
      const retryCount = (sessionPrefetch.retryCount ?? 0) + 1;
      const firstFailureCode = String(pendingScripts[0]?.failureCode ?? "TTS_TIMEOUT");
      const classified = classifyListeningRetry({
        step: "tts",
        errorCode: firstFailureCode,
      });

      if (classified.disposition === "retryable") {
        const shouldRetry = await retryPrefetchJob(
          {
            taskId: task.id,
            userId,
            batchId: sessionBatchId,
            errorCode: classified.errorCode,
            currentRetryCount: retryCount - 1,
            skillType: "listening",
          },
          async (retryTaskId, retryUserId) => {
            enqueueListeningOrchestratorJob({
              taskId: retryTaskId,
              userId: retryUserId,
              sectionNo: 1,
              priorityClass: "P2_NEXT_24H",
              priorityScore: 60,
            });
          },
        );

        if (shouldRetry) {
          finalProgress.sessionPrefetch.retryCount = retryCount;
          finalProgress.sessionPrefetch.status = PREFETCH_STATUS_ERROR;
          finalProgress.sessionPrefetch.message = `Audio generation failed; retry scheduled in ${getListeningRetryDelayMs("tts", retryCount - 1)}ms`;
          finalProgress.sessionPrefetch.errorCode = classified.errorCode;
          finalProgress.sessionPrefetch.retryDelayMs = getListeningRetryDelayMs("tts", retryCount - 1);
          await storage.updateTaskStatus(task.id, task.status ?? "not-started", finalProgress);
        } else {
          const trace = createListeningTraceContext({
            userId,
            taskId: task.id,
            sessionBatchId,
          });
          await routeListeningTerminalFailureToDLQ({
            task,
            sectionId: `${task.id}:section-1`,
            sectionNo: 1,
            stepName: "tts",
            errorCode: classified.errorCode,
            attempts: retryCount,
            context: {
              batchId: sessionBatchId,
            },
            traceId: trace.traceId,
            correlationId: trace.correlationId,
          });
        }
      } else {
        const trace = createListeningTraceContext({
          userId,
          taskId: task.id,
          sessionBatchId,
        });
        await routeListeningTerminalFailureToDLQ({
          task,
          sectionId: `${task.id}:section-1`,
          sectionNo: 1,
          stepName: "tts",
          errorCode: classified.errorCode,
          attempts: retryCount,
          context: {
            batchId: sessionBatchId,
          },
          traceId: trace.traceId,
          correlationId: trace.correlationId,
        });
      }
    }
  } catch (error: any) {
    const durationMs = Date.now() - prefetchStartMs;
    console.error("[Prefetch][Error]", {
      ...logContext,
      durationMs,
      errorCode: error?.code,
      errorMessage: error?.message,
      stack: error?.stack?.split("\n").slice(0, 3).join(" "),
    });

    if (!task) {
      return;
    }

    const progressData = (task.progressData ?? {}) as Record<string, any>;
    const sessionPrefetch = progressData.sessionPrefetch ?? {};
    const nowIso = new Date().toISOString();
    const isAuthError = error?.code === "POLLY_AUTH";
    const failureProgress = {
      ...progressData,
      sessionPrefetch: {
        ...sessionPrefetch,
        status: PREFETCH_STATUS_ERROR,
        ready: false,
        updatedAt: nowIso,
        errorCode: isAuthError ? "POLLY_AUTH" : "UNKNOWN",
        message: isAuthError
          ? "Audio synthesis unavailable: AWS credentials not configured"
          : "Failed to prepare listening session assets",
      },
    };

    await storage.updateTaskStatus(task.id, task.status ?? "not-started", failureProgress);

    const errorCode = canonicalizeListeningErrorCode(error);
    const classified = classifyListeningRetry({ step: "tts", errorCode });
    if (classified.disposition === "retryable") {
      const retryCount = (sessionPrefetch.retryCount ?? 0) + 1;
      const sessionBatchId = progressData.sessionBatchId ?? "unknown";

      const shouldRetry = await retryPrefetchJob(
        {
          taskId: task.id,
          userId,
          batchId: sessionBatchId,
          errorCode: classified.errorCode,
          currentRetryCount: retryCount - 1,
          skillType: "listening",
        },
        async (retryTaskId, retryUserId) => {
          enqueueListeningOrchestratorJob({
            taskId: retryTaskId,
            userId: retryUserId,
            sectionNo: 1,
            priorityClass: "P2_NEXT_24H",
            priorityScore: 60,
          });
        },
      );

      if (shouldRetry) {
        failureProgress.sessionPrefetch.retryCount = retryCount;
        failureProgress.sessionPrefetch.retryDelayMs = getListeningRetryDelayMs("tts", retryCount - 1);
        failureProgress.sessionPrefetch.errorCode = classified.errorCode;
        await storage.updateTaskStatus(task.id, task.status ?? "not-started", failureProgress);
      } else {
        const trace = createListeningTraceContext({
          userId,
          taskId: task.id,
          sessionBatchId,
        });
        await routeListeningTerminalFailureToDLQ({
          task,
          sectionId: `${task.id}:section-1`,
          sectionNo: 1,
          stepName: "tts",
          errorCode: classified.errorCode,
          attempts: retryCount,
          context: {
            batchId: sessionBatchId,
            message: error?.message ?? null,
          },
          traceId: trace.traceId,
          correlationId: trace.correlationId,
        });
      }
    } else {
      const sessionBatchId = progressData.sessionBatchId ?? "unknown";
      const trace = createListeningTraceContext({
        userId,
        taskId: task.id,
        sessionBatchId,
      });
      await routeListeningTerminalFailureToDLQ({
        task,
        sectionId: `${task.id}:section-1`,
        sectionNo: 1,
        stepName: "tts",
        errorCode: classified.errorCode,
        attempts: Number(sessionPrefetch.retryCount ?? 0),
        context: {
          batchId: sessionBatchId,
          message: error?.message ?? null,
        },
        traceId: trace.traceId,
        correlationId: trace.correlationId,
      });
    }
  } finally {
    if (lockKey && lockOwnerId) {
      await releaseListeningStepLock(lockKey, lockOwnerId);
    }
  }
};
