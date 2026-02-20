import express, { type Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { verifyFirebaseAuth, ensureFirebaseUser } from "./firebaseAuth";
import { batchInitializeTaskProgress } from "./controllers/taskProgressController";
import { getTaskProgressById } from "./controllers/getTaskProgressController";
import { v4 as uuidv4 } from 'uuid';
import { generateIELTSPlan, generateIELTSPlan_debugWrapper, generateListeningScriptForTask, generateQuestionsFromScript, generateListeningSessionPackage, generateListeningStudyPlan, generateAdvisorFeedback } from "./openai";
import {
  checkAudioAssetsExist,
  checkAudioExists,
  createSectionAudioAssetMetadata,
  createSectionAudioQaLog,
  generateAudioFromScript,
  getTtsProviderHealth,
  renderSectionAudioAssets,
  resolveSignedAudioProxyRedirect,
} from "./audioService";
import { registerRegenerateRoutes } from "./routes/regenerate";
import {
  DEFAULT_ACCENT,
  DEFAULT_SESSION_MINUTES,
  LISTENING_SESSION_MINUTES,
  NEXT_MIN_MS,
} from "../shared/constants";
import { makeListeningTaskTitle, needsTitleUpdate } from "./services/title";
import { createFollowUpListeningTask, ensureListeningSegments } from "./services/taskFactory";
import {
  buildAvailabilityFromSchedule,
  deriveWeightsFromSkillRatings,
  getIsoDayForDate,
  getDayNameForIsoDay,
  resolveWeekStart,
  type Skill,
  SKILL_ORDER,
  assignSkillsToDays,
} from "./services/planDistributor";
import { getForwardWeekWindows, enumerateDays, addDaysUtc } from "./services/weekWindow";
import { ensureProgressForWeeklyPlan } from "./services/progress";
import { resolveSessionMinutesFromTask } from "./services/sessionDuration";
import { minutesToLabel } from "./utils/time.ts";
import { normalizeAccent } from "./utils/audio.ts";
import { getPrefetchRetryMetricsSnapshot, retryPrefetchJob } from "./services/prefetchRetry";
import { buildTagQualityReport, scoreSegment } from "./services/scoring";
import { buildSessionFeedback } from "./services/feedback";
import { getRecentListeningSummaries } from "./services/perfStore";
import { scoreMixedEngineAttempt } from "./services/listeningScoringBridge";
import {
  buildListeningPerformanceAnalysis,
  persistListeningPerformanceAnalysis,
  publishListeningPerformanceCoachEvents,
} from "./services/listeningPerformanceCoach";
import { ensureSegmentsForTaskProgress, ensureSegmentsForTasks } from "./services/progressSegments";
import { ensureSegmentOrder } from "./services/segmentOrder";
import { validateTranscriptComplete } from "./services/content";
import { runListeningScriptSubsystem } from "./services/listeningScriptSubsystem";
import {
  buildAnchorsForSegments,
  loadAnchors,
  persistAnchors,
  validateAnchorsForSection,
} from "./services/listeningAnchors";
import { buildScriptSubsystemFailureContext } from "./services/listeningFailureContext";
import { persistListeningEventToOutbox } from "./services/listeningEventOutbox";
import {
  dispatchSectionBuildRequested,
  consumePlanCreatedBootstrapEvent,
  enforceSequentialPolicy,
  syncLegacyPrefetchIntoSectionState,
} from "./services/listeningOrchestrator";
import {
  buildSectionManifestFromTask,
  publishSectionManifestEvent,
} from "./services/listeningManifest";
import { runListeningValidationGate } from "./services/listeningValidationGate";
import { buildSectionStepIdempotencyKey, publishListeningEvent } from "./services/listeningEvents";
import {
  LISTENING_EVENT_TOPICS,
  LISTENING_EVENT_TYPES,
  LISTENING_SCORING_TAGS,
  LISTENING_VALIDATION_GATE_STEP,
  createListeningTraceContext,
  listeningReviewActionTypeSchema,
} from "@shared/listening";
import { buildManifestReadiness } from "./services/listeningReadiness";
import { rebuildListeningReadinessFromOutbox } from "./services/listeningReadinessReplay";
import { acquireListeningStepLock, heartbeatListeningStepLock, releaseListeningStepLock } from "./services/listeningLockManager";
import {
  canonicalizeListeningErrorCode,
  classifyListeningRetry,
  getListeningRetryDelayMs,
} from "./services/listeningRetryPolicy";
import { routeListeningTerminalFailureToDLQ, replayListeningDLQItem } from "./services/listeningDeadLetter";
import {
  deriveListeningPriority,
  deriveListeningPrioritySignalsFromSource,
  normalizeListeningPrefetchSource,
} from "./services/listeningPriority";
import { publishDeadLetterMetric, publishQueueDelayMetric } from "./services/listeningTelemetry";
import {
  applyRendererTelemetryUpdate,
  normalizeRendererMode,
  type RendererMode,
  summarizeRendererTelemetry,
} from "./services/listeningRendererTelemetry";
import {
  enqueueListeningOrchestratorJob,
  getListeningOrchestratorQueueSnapshot,
  registerListeningOrchestratorExecutor,
} from "./services/listeningOrchestratorWorker";
import { ensureListeningSessionPrefetchWithDeps } from "./services/listeningSessionPrefetchOrchestrator";
import {
  type ListeningStartupGateMode,
  resolveListeningStartupGateModeForTask,
  resolveListeningStartupGateStrategy,
  resolveStartupGateReadyForMode,
  summarizeStartupGateTelemetry,
} from "./services/listeningRoadmapGRuntime";
import { buildListeningAnalyticsAggregation } from "./services/listeningAnalyticsAggregation";
import {
  evaluateListeningAlerts,
  getListeningAlertEngineSnapshot,
  startListeningAlertScheduler,
} from "./services/listeningAlertEngine";
import {
  getListeningSyntheticProbeSchedulerStatus,
  listRecentListeningSyntheticProbeRuns,
  runListeningSyntheticProbeSuite,
  startListeningSyntheticProbeScheduler,
} from "./services/listeningSyntheticProbes";
import {
  getLatestListeningRolloutAudit,
  isListeningRolloutAuditStorageMissingError,
  recordListeningRolloutAudit,
  type ListeningRolloutActionType,
} from "./services/listeningRolloutAudit";
import { getListeningGovernancePolicyInfo } from "./services/listeningGovernancePolicy";
import { recoverListeningSectionState, transitionListeningSectionState } from "./services/listeningSectionState";
import { recordGovernanceLedgerEntry } from "./services/listeningGovernanceLedger";
import {
  computeGovernanceKpis,
  runGovernanceLedgerIntegrityCheck,
} from "./services/listeningGovernanceCompliance";
import { getListeningRetentionPolicy, runListeningRetentionCleanup } from "./services/listeningRetention";
import {
  createGovernanceException,
  expireGovernanceExceptions,
  listGovernanceExceptions,
  revokeGovernanceException,
} from "./services/listeningGovernanceExceptions";
import {
  createPromptChangeRequest,
  listOverduePostHocPromptChanges,
  listPromptChangeRequests,
  listPromptVersions,
  markPromptChangeRequestPostHocReviewed,
  promotePromptVersion,
  resolvePromptIdForOutputClass,
  rollbackPromptVersionForOutputClass,
  validatePromptTemplateCompatibility,
  type ListeningOutputClass,
} from "./services/listeningPromptRegistry";
import {
  completeGovernanceReviewActionItem,
  generateGovernanceReviewReport,
  hasOutstandingMandatoryReprioritization,
  listGovernanceReviewReports,
} from "./services/listeningGovernanceReview";
import {
  LISTENING_GOVERNANCE_ROLLOUT_PREREQUISITE_RELATIONS,
  LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS,
  checkListeningRelations,
} from "./services/listeningGovernancePrerequisites";
import { getPiiClasses, isPrivacySafeLogMode, redactSensitive } from "./utils/privacy";
import {
  normalizeLegacyQuestionsForApi,
} from "./services/listeningQuestionAdapters";
import { resolveListeningQuestionContract } from "./services/listeningQuestionContractState";
import { regenerateSpecificSegments } from "./services/listeningSegmentPipeline";
import {
  applyReviewAction,
  buildReviewQueueMetrics,
  enqueueValidationReview,
  escalateOverdueReviewItems,
  shouldRouteValidationToReviewQueue,
} from "./services/listeningReviewWorkflow";
import {
  getActiveManifestVersionWithIntegrity,
  publishManifestVersion,
  rollbackManifestVersion,
} from "./services/listeningManifestVersioning";
import {
  listeningSectionBlueprintSchema,
  listeningSectionSegmentSchema,
} from "@shared/listening";
import { pool } from "./db";

const NODE_TIMER_MAX_INTERVAL_MS = 2_147_483_647;

const DEV_AUTH_ALLOWED = process.env.NODE_ENV !== "production";
const LISTENING_RENDERER_DUAL_MODE = process.env.LISTENING_RENDERER_DUAL_MODE === "true";
const LISTENING_DRAFT_TAG_STRICT = process.env.LISTENING_DRAFT_TAG_STRICT === "true";
const LISTENING_STARTUP_GATE_STRATEGY = resolveListeningStartupGateStrategy(
  process.env.LISTENING_STARTUP_GATE_MODE,
);
const LISTENING_STARTUP_GATE_COHORT_PERCENT = Math.max(
  0,
  Math.min(100, Number(process.env.LISTENING_STARTUP_GATE_COHORT_PERCENT ?? 50)),
);
const LISTENING_STARTUP_GATE_COHORT_SEED = String(process.env.LISTENING_STARTUP_GATE_COHORT_SEED ?? "roadmap-g");
const LISTENING_STARTUP_GATE_CONFIG = {
  strategy: LISTENING_STARTUP_GATE_STRATEGY,
  cohortPercent: LISTENING_STARTUP_GATE_COHORT_PERCENT,
  cohortSeed: LISTENING_STARTUP_GATE_COHORT_SEED,
} as const;
const LISTENING_ROLLOUT_MODE_BASE = String(process.env.LISTENING_ROLLOUT_MODE ?? "cohort").toLowerCase();
const LISTENING_ROLLOUT_PERCENT_BASE = Math.max(
  0,
  Math.min(100, Number(process.env.LISTENING_ROLLOUT_PERCENT ?? LISTENING_STARTUP_GATE_COHORT_PERCENT)),
);
const LISTENING_ROLLOUT_SEED_BASE = String(process.env.LISTENING_ROLLOUT_SEED ?? LISTENING_STARTUP_GATE_COHORT_SEED);
const LISTENING_ROLLOUT_FORCE_ROLLBACK_BASE = process.env.LISTENING_ROLLOUT_FORCE_ROLLBACK === "true";
const LISTENING_CANARY_MIN_SAMPLE = Math.max(5, Number(process.env.LISTENING_CANARY_MIN_SAMPLE ?? 20));
const LISTENING_CANARY_MIN_COMPLETION_RATE = Math.max(
  0,
  Math.min(1, Number(process.env.LISTENING_CANARY_MIN_COMPLETION_RATE ?? 0.9)),
);
const LISTENING_CANARY_MAX_STARTUP_P95_MS = Math.max(
  500,
  Number(process.env.LISTENING_CANARY_MAX_STARTUP_P95_MS ?? 30_000),
);
const LISTENING_CANARY_MIN_SCORING_INTEGRITY = Math.max(
  0,
  Math.min(1, Number(process.env.LISTENING_CANARY_MIN_SCORING_INTEGRITY ?? 0.98)),
);
const LISTENING_STARTUP_GATE_BASE_MODE: ListeningStartupGateMode =
  LISTENING_STARTUP_GATE_CONFIG.strategy === "legacy" ? "legacy" : "section_ready";
const LISTENING_ROUTE_AUTOPREFETCH =
  process.env.LISTENING_ROUTE_AUTOPREFETCH === "true";
const LISTENING_STATUS_ETA_SECS = Math.max(
  15,
  Number(process.env.LISTENING_STATUS_ETA_SECS ?? 45),
);
const LISTENING_TELEMETRY_SCHEMA_VERSION = "1.0.0";
const LISTENING_TELEMETRY_RETENTION_DAYS = Math.max(
  7,
  Number(process.env.LISTENING_TELEMETRY_RETENTION_DAYS ?? 30),
);
const LISTENING_TELEMETRY_CLEANUP_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.LISTENING_TELEMETRY_CLEANUP_INTERVAL_MS ?? 6 * 60 * 60 * 1000),
);
const LISTENING_TELEMETRY_MAX_EVENTS = Math.max(
  50,
  Number(process.env.LISTENING_TELEMETRY_MAX_EVENTS ?? 200),
);
const LISTENING_SECTION_RESULTS_MAX = Math.max(
  8,
  Number(process.env.LISTENING_SECTION_RESULTS_MAX ?? 32),
);
const LISTENING_TRANSITION_TIMEOUT_SECS = Math.max(
  20,
  Number(process.env.LISTENING_TRANSITION_TIMEOUT_SECS ?? 90),
);
const LISTENING_RETENTION_CLEANUP_ENABLED = process.env.LISTENING_RETENTION_CLEANUP_ENABLED !== "false";
const LISTENING_RETENTION_CLEANUP_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.LISTENING_RETENTION_CLEANUP_INTERVAL_MS ?? 24 * 60 * 60 * 1000),
);
const LISTENING_GOVERNANCE_INTEGRITY_CHECK_ENABLED =
  process.env.LISTENING_GOVERNANCE_INTEGRITY_CHECK_ENABLED !== "false";
const LISTENING_GOVERNANCE_INTEGRITY_CHECK_INTERVAL_MS = Math.max(
  30 * 60 * 1000,
  Number(process.env.LISTENING_GOVERNANCE_INTEGRITY_CHECK_INTERVAL_MS ?? 6 * 60 * 60 * 1000),
);
const LISTENING_GOVERNANCE_EXCEPTION_SWEEP_INTERVAL_MS = Math.max(
  30 * 60 * 1000,
  Number(process.env.LISTENING_GOVERNANCE_EXCEPTION_SWEEP_INTERVAL_MS ?? 12 * 60 * 60 * 1000),
);
const LISTENING_GOVERNANCE_REVIEW_ENABLED =
  process.env.LISTENING_GOVERNANCE_REVIEW_ENABLED !== "false";
const LISTENING_GOVERNANCE_REVIEW_WINDOW_MS = Math.max(
  24 * 60 * 60 * 1000,
  Number(process.env.LISTENING_GOVERNANCE_REVIEW_INTERVAL_MS ?? 90 * 24 * 60 * 60 * 1000),
);
const LISTENING_GOVERNANCE_REVIEW_TICK_INTERVAL_MS = Math.max(
  30 * 60 * 1000,
  Math.min(
    Math.min(LISTENING_GOVERNANCE_REVIEW_WINDOW_MS, 24 * 60 * 60 * 1000),
    NODE_TIMER_MAX_INTERVAL_MS,
  ),
);
const GOVERNANCE_REASON_CODE_ALLOWLIST = new Set([
  "policy_violation",
  "manual_quality_hold",
  "incident_mitigation",
  "false_positive",
  "content_safety",
  "schema_contract",
  "other",
]);
const PROMPT_OUTPUT_CLASS_ALLOWLIST = new Set<ListeningOutputClass>([
  "scripts",
  "questions",
  "coaching",
]);
const GOVERNANCE_REVIEWER_IDS = new Set(
  String(process.env.LISTENING_GOVERNANCE_REVIEWER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const GOVERNANCE_ADMIN_IDS = new Set(
  String(process.env.LISTENING_GOVERNANCE_ADMIN_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const LISTENING_GOVERNANCE_EMERGENCY_REVIEW_SLA_HOURS = Math.max(
  1,
  Number(process.env.LISTENING_GOVERNANCE_EMERGENCY_REVIEW_SLA_HOURS ?? 24),
);
const LISTENING_PROMPT_PROMOTION_CANARY_MAX_AGE_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.LISTENING_PROMPT_PROMOTION_CANARY_MAX_AGE_HOURS ?? 24 * 30) * 60 * 60 * 1000,
);
const LOG_VERBOSE_NON_PROD = process.env.NODE_ENV !== "production";

const touchedListeningTelemetryTaskIds = new Set<string>();
let listeningTelemetryCleanupTimer: NodeJS.Timeout | null = null;
let listeningRetentionCleanupTimer: NodeJS.Timeout | null = null;
let listeningGovernanceIntegrityTimer: NodeJS.Timeout | null = null;
let listeningGovernanceExceptionSweepTimer: NodeJS.Timeout | null = null;
let listeningGovernanceReviewTimer: NodeJS.Timeout | null = null;
let latestListeningRetentionReport: Record<string, unknown> | null = null;
let latestGovernanceIntegrityReport: Record<string, unknown> | null = null;
let governancePrerequisiteWarningEmitted = false;
let listeningGovernanceReviewSchedulerStartedAtMs: number | null = null;
let listeningGovernanceReviewLastRunAtMs: number | null = null;
let listeningRolloutHydrationMissingTableWarningEmitted = false;
let listeningBoostMissingRelationWarningEmitted = false;
let listeningTaskContentPrefetchFallbackWarningEmitted = false;

type RolloutAuditRecord = {
  actorId: string;
  reason: string;
  incidentTicket: string | null;
  affectedCohorts: string[];
  at: string;
};

type CanaryOverrideRecord = {
  actorId: string;
  reason: string;
  incidentTicket: string;
  at: string;
};

const normalizeCohorts = (value: unknown, fallback: string[] = []) => {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => String(entry ?? "").trim()).filter((entry) => entry.length > 0);
    if (normalized.length) return normalized;
  }
  return fallback;
};

const listeningRolloutRuntime = {
  forceRollback: false,
  rollbackAudit: null as RolloutAuditRecord | null,
  canaryOverride: null as CanaryOverrideRecord | null,
  rolloutModeOverride: null as "legacy" | "cohort" | "new" | null,
  rolloutPercentOverride: null as number | null,
  rolloutSeedOverride: null as string | null,
};

const getEffectiveRolloutMode = () => {
  return String(listeningRolloutRuntime.rolloutModeOverride ?? process.env.LISTENING_ROLLOUT_MODE ?? LISTENING_ROLLOUT_MODE_BASE).toLowerCase();
};

const getEffectiveRolloutPercent = () => {
  const raw = Number(
    listeningRolloutRuntime.rolloutPercentOverride ??
      process.env.LISTENING_ROLLOUT_PERCENT ??
      LISTENING_ROLLOUT_PERCENT_BASE,
  );
  return Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : LISTENING_ROLLOUT_PERCENT_BASE));
};

const getEffectiveRolloutSeed = () => {
  return String(
    listeningRolloutRuntime.rolloutSeedOverride ??
      process.env.LISTENING_ROLLOUT_SEED ??
      LISTENING_ROLLOUT_SEED_BASE,
  );
};

const isForceRollbackEnabled = () => {
  return (
    listeningRolloutRuntime.forceRollback ||
    process.env.LISTENING_ROLLOUT_FORCE_ROLLBACK === "true" ||
    LISTENING_ROLLOUT_FORCE_ROLLBACK_BASE
  );
};

const resolveStartupGateModeForIdentity = (params: {
  taskProgressId?: string | null;
  userId?: string | null;
}): ListeningStartupGateMode => {
  if (isForceRollbackEnabled()) {
    return "legacy";
  }
  const rolloutMode = getEffectiveRolloutMode();
  const rolloutPercent = getEffectiveRolloutPercent();
  const rolloutSeed = getEffectiveRolloutSeed();

  if (rolloutMode === "legacy") {
    return "legacy";
  }
  if (rolloutMode === "new") {
    return "section_ready";
  }
  const taskProgressId = String(params.taskProgressId ?? "").trim();
  const userId = String(params.userId ?? "").trim();
  const cohortTaskKey = userId ? `cohort:${userId}` : taskProgressId;
  if (!cohortTaskKey) {
    return LISTENING_STARTUP_GATE_BASE_MODE;
  }
  const cohortMode = resolveListeningStartupGateModeForTask({
    ...LISTENING_STARTUP_GATE_CONFIG,
    strategy: "cohort",
    cohortPercent: rolloutPercent,
    cohortSeed: rolloutSeed,
  }, {
    taskProgressId: cohortTaskKey,
    userId: userId || null,
  });
  return cohortMode;
};

const resolveAuthIdentity = (req: any) => {
  const candidates = [
    req?.user?.id,
    req?.firebaseUser?.uid,
    req?.user?.firebaseUid,
  ];
  return candidates.map((value) => String(value ?? "").trim()).find((value) => value.length > 0) ?? null;
};

const hasGovernanceRole = (req: any, role: "reviewer" | "admin") => {
  const identity = resolveAuthIdentity(req);
  if (!identity) return false;
  if (role === "admin") {
    return GOVERNANCE_ADMIN_IDS.has(identity);
  }
  return GOVERNANCE_REVIEWER_IDS.has(identity) || GOVERNANCE_ADMIN_IDS.has(identity);
};

const logNonProdVerbose = (...args: unknown[]) => {
  if (!LOG_VERBOSE_NON_PROD) return;
  if (isPrivacySafeLogMode()) {
    console.log(...args.map((arg) => redactSensitive(arg)));
    return;
  }
  console.log(...args);
};

const logPrivacySafe = (
  label: string,
  payload?: unknown,
  options?: { level?: "log" | "warn" | "error"; nonProdOnly?: boolean },
) => {
  if (options?.nonProdOnly && !LOG_VERBOSE_NON_PROD) {
    return;
  }
  const level = options?.level ?? "log";
  const emit = level === "warn" ? console.warn : level === "error" ? console.error : console.log;
  if (typeof payload === "undefined") {
    emit(label);
    return;
  }
  emit(label, isPrivacySafeLogMode() ? redactSensitive(payload) : payload);
};

const isMissingRelationError = (error: unknown) => {
  const pgCode = String((error as any)?.code ?? "");
  if (pgCode === "42P01") return true;
  const message = String((error as any)?.message ?? "");
  return /relation .* does not exist/i.test(message);
};

const logGovernancePrerequisiteWarningOnce = (params: {
  missingRelations: string[];
  checkedRelations: string[];
  jobsDisabled: string[];
  error?: unknown;
}) => {
  if (governancePrerequisiteWarningEmitted) return;
  governancePrerequisiteWarningEmitted = true;
  const error = params.error as any;
  console.warn("[ListeningGovernance][PrerequisitesMissing]", {
    missing_relations: params.missingRelations,
    checked_relations: params.checkedRelations,
    jobs_disabled: params.jobsDisabled,
    error_code: error?.code ?? null,
    error_message: error?.message ?? null,
    remediation: "Run database migrations so governance/rollout tables exist",
  });
};

const runGovernanceSchedulerPrerequisiteSmoke = async () => {
  try {
    const check = await checkListeningRelations(pool, LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS);
    return {
      ...check,
      error: undefined as unknown,
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        ok: false,
        missingRelations: [...LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS],
        checkedRelations: [...LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS],
        error,
      };
    }
    return {
      ok: false,
      missingRelations: [...LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS],
      checkedRelations: [...LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS],
      error,
    };
  }
};

const verifyAuthWithDevOverride = async (req: Request, res: Response, next: NextFunction) => {
  if (DEV_AUTH_ALLOWED) {
    const debugUserId = req.header("x-debug-user-id");
    if (debugUserId) {
      try {
        const user = await storage.getUser(debugUserId);
        if (!user) {
          return res.status(404).json({ message: "Debug user not found" });
        }
        req.user = user;
        const fallbackName = [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined;
        req.firebaseUser = {
          uid: user.firebaseUid || user.id,
          email: user.email ?? undefined,
          name: fallbackName,
        };
        return next();
      } catch (error) {
        console.error("[DevAuth] Failed to attach debug user", error);
        return res.status(500).json({ message: "Failed to attach debug user" });
      }
    }
  }
  return verifyFirebaseAuth(req, res, next);
};

/**
 * Maps onboarding commitment text to numeric minutes
 * Handles formats: "30mins", "1hour", "2hours+", "30 mins", "1 hr", "2 hrs"
 */
function mapToMinutes(value?: string): number {
  if (!value) return 60; // Default to 1 hour if not specified

  const lower = value.toLowerCase().replace(/\s+/g, ''); // Remove spaces

  // Check for specific patterns
  if (lower.includes('30')) return 30;
  if (lower.includes('2')) return 120;
  if (lower.includes('1')) return 60;

  // Default fallback
  return 60;
}

const DEFAULT_ONBOARDING_MINUTES = 30;
type DailyCommitment = '30mins' | '1hour' | '2hours+';
type SchedulePreference = 'weekday' | 'weekend' | 'both';
type LearningStyle = 'ai-guided' | 'self-paced' | 'mixed';
const DEFAULT_STUDY_PREFERENCES: {
  dailyCommitment: DailyCommitment;
  schedule: SchedulePreference;
  style: LearningStyle;
} = {
  dailyCommitment: '30mins',
  schedule: 'both',
  style: 'ai-guided',
};

const isDailyCommitment = (value: unknown): value is DailyCommitment =>
  value === '30mins' || value === '1hour' || value === '2hours+';

const isSchedulePreference = (value: unknown): value is SchedulePreference =>
  value === 'weekday' || value === 'weekend' || value === 'both';

const isLearningStyle = (value: unknown): value is LearningStyle =>
  value === 'ai-guided' || value === 'self-paced' || value === 'mixed';

function normalizeStudyPreferences(preferences?: Record<string, any>) {
  const normalized = { ...(preferences ?? {}) };
  const sessionMinutesCandidate = Number(normalized.sessionMinutes);
  const sessionMinutes =
    Number.isFinite(sessionMinutesCandidate) && sessionMinutesCandidate > 0
      ? Math.round(sessionMinutesCandidate)
      : DEFAULT_ONBOARDING_MINUTES;

  const dailyCommitment: DailyCommitment = isDailyCommitment(normalized.dailyCommitment)
    ? normalized.dailyCommitment
    : DEFAULT_STUDY_PREFERENCES.dailyCommitment;

  const schedule: SchedulePreference = isSchedulePreference(normalized.schedule)
    ? normalized.schedule
    : DEFAULT_STUDY_PREFERENCES.schedule;

  const style: LearningStyle = isLearningStyle(normalized.style)
    ? normalized.style
    : DEFAULT_STUDY_PREFERENCES.style;

  const listeningDurations = normalized.listeningDurations ?? {};
  const weekdayMinutes =
    typeof listeningDurations.weekday === 'number' && listeningDurations.weekday > 0
      ? Math.round(listeningDurations.weekday)
      : sessionMinutes;
  const weekendMinutes =
    typeof listeningDurations.weekend === 'number' && listeningDurations.weekend > 0
      ? Math.round(listeningDurations.weekend)
      : weekdayMinutes;

  return {
    dailyCommitment,
    schedule,
    style,
    sessionMinutes,
    listeningDurations: {
      weekday: weekdayMinutes,
      weekend: weekendMinutes,
    },
  };
}

function normalizeListeningActivity(activity: any) {
  const durationMinutes =
    typeof activity.dayDurationMinutes === "number"
      ? activity.dayDurationMinutes
      : typeof activity.duration === "string"
        ? parseInt(activity.duration.replace(/\D/g, ""), 10) || undefined
        : undefined;

  const resolvedMinutes = durationMinutes ?? 30;

  return {
    ...activity,
    duration: minutesToLabel(resolvedMinutes),
    durationMinutes: resolvedMinutes,
  };
}

/**
 * Helper function to pre-generate scripts for listening tasks
 * Called during plan creation to ensure scripts are ready when users start tasks
 */
const PREFETCH_AUDIO_COUNT = 4;
const TARGET_AUDIO_SECONDS = 360;
const PREFETCH_RETRY_DELAYS = [5_000, 30_000, 120_000];
const PREFETCH_STATUS_IDLE = 'idle' as const;
const PREFETCH_STATUS_QUEUED = 'queued' as const;
const PREFETCH_STATUS_RUNNING = 'running' as const;
const PREFETCH_STATUS_READY = 'ready' as const;
const PREFETCH_STATUS_READY_PARTIAL = 'ready_partial' as const;
const PREFETCH_STATUS_ERROR = 'error' as const;
// `ready_partial` remains recognized for backward compatibility but is not a final-ready state.
const PREFETCH_READY_STATES = new Set([PREFETCH_STATUS_READY]);
const AUDIO_DEBUG = process.env.NODE_ENV !== "production" && process.env.LISTENING_AUDIO_DEBUG === "true";

type NextPartRuntimeStatus = "ready" | "warming" | "queued" | "error" | "none";

const toIsoStringOrNull = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString();
    }
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return null;
};

const getIsoTimeMs = (value: unknown): number | null => {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const trimTelemetryArray = <T>(
  input: unknown,
  getTimestamp: (entry: T) => number | null,
  options: { nowMs: number; retentionDays: number; maxCount: number },
) => {
  if (!Array.isArray(input)) {
    return [] as T[];
  }
  const retentionMs = options.retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = options.nowMs - retentionMs;
  return (input as T[])
    .filter((entry) => {
      const ts = getTimestamp(entry);
      return ts === null || ts >= cutoff;
    })
    .slice(-options.maxCount);
};

const markListeningTelemetryTask = (taskProgressId: string) => {
  if (!taskProgressId) return;
  touchedListeningTelemetryTaskIds.add(taskProgressId);
  if (touchedListeningTelemetryTaskIds.size > 400) {
    const oldest = touchedListeningTelemetryTaskIds.values().next().value;
    if (typeof oldest === "string") {
      touchedListeningTelemetryTaskIds.delete(oldest);
    }
  }
};

const applyListeningTelemetryRetention = (progressData: Record<string, any>) => {
  const nowMs = Date.now();
  const startupTelemetry = (progressData.startupGateTelemetry ?? {}) as Record<string, any>;
  const attemptTelemetry = (progressData.attemptTelemetry ?? {}) as Record<string, any>;
  const telemetryPolicy = (progressData.telemetryPolicy ?? {}) as Record<string, any>;

  const retainedStartupWaits = trimTelemetryArray<Record<string, any>>(
    startupTelemetry.waits,
    (entry) => getIsoTimeMs(entry?.readyAt ?? entry?.startedAt),
    {
      nowMs,
      retentionDays: LISTENING_TELEMETRY_RETENTION_DAYS,
      maxCount: LISTENING_TELEMETRY_MAX_EVENTS,
    },
  );
  const retainedAttemptEvents = trimTelemetryArray<Record<string, any>>(
    attemptTelemetry.events,
    (entry) => getIsoTimeMs(entry?.at),
    {
      nowMs,
      retentionDays: LISTENING_TELEMETRY_RETENTION_DAYS,
      maxCount: LISTENING_TELEMETRY_MAX_EVENTS,
    },
  );
  const retainedSectionResults = trimTelemetryArray<Record<string, any>>(
    progressData.sectionResults,
    (entry) => getIsoTimeMs(entry?.submittedAt),
    {
      nowMs,
      retentionDays: LISTENING_TELEMETRY_RETENTION_DAYS,
      maxCount: LISTENING_SECTION_RESULTS_MAX,
    },
  );

  return {
    ...progressData,
    startupGateTelemetry: {
      ...startupTelemetry,
      version: LISTENING_TELEMETRY_SCHEMA_VERSION,
      waits: retainedStartupWaits,
    },
    attemptTelemetry: {
      ...attemptTelemetry,
      version: LISTENING_TELEMETRY_SCHEMA_VERSION,
      events: retainedAttemptEvents,
    },
    sectionResults: retainedSectionResults,
    telemetryPolicy: {
      ...telemetryPolicy,
      schemaVersion: LISTENING_TELEMETRY_SCHEMA_VERSION,
      retentionDays: LISTENING_TELEMETRY_RETENTION_DAYS,
      minimized: true,
      transitionTimeoutSecs: LISTENING_TRANSITION_TIMEOUT_SECS,
      updatedAt: new Date(nowMs).toISOString(),
    },
  };
};

const updateStartupWaitTelemetry = (
  progressData: Record<string, any>,
  params: { ready: boolean; mode: ListeningStartupGateMode },
) => {
  const nowIso = new Date().toISOString();
  const startupTelemetry = (progressData.startupGateTelemetry ?? {}) as Record<string, any>;
  const waits = Array.isArray(startupTelemetry.waits) ? [...startupTelemetry.waits] : [];
  const waitingStartedAt = toIsoStringOrNull(startupTelemetry.waitingStartedAt);
  let nextWaitingStartedAt = waitingStartedAt;
  let changed = false;

  if (!params.ready && !waitingStartedAt) {
    nextWaitingStartedAt = nowIso;
    changed = true;
  }
  if (params.ready && waitingStartedAt) {
    const startMs = Date.parse(waitingStartedAt);
    const waitMs = Number.isFinite(startMs) ? Math.max(0, Date.now() - startMs) : null;
    waits.push({
      startedAt: waitingStartedAt,
      readyAt: nowIso,
      waitMs,
      mode: params.mode,
    });
    nextWaitingStartedAt = null;
    changed = true;
  }

  if (!changed) {
    return { changed: false, progressData };
  }

  return {
    changed: true,
    progressData: {
      ...progressData,
      startupGateTelemetry: {
        ...startupTelemetry,
        version: LISTENING_TELEMETRY_SCHEMA_VERSION,
        mode: params.mode,
        waitingStartedAt: nextWaitingStartedAt,
        waits: waits.slice(-LISTENING_TELEMETRY_MAX_EVENTS),
        lastObservedAt: nowIso,
      },
    },
  };
};

const applyStartupBoostTelemetry = (
  progressData: Record<string, any>,
  mode: ListeningStartupGateMode,
  source: string,
  enqueued: boolean,
) => {
  const startupTelemetry = (progressData.startupGateTelemetry ?? {}) as Record<string, any>;
  const nowIso = new Date().toISOString();
  const bySource = (startupTelemetry.boostBySource ?? {}) as Record<string, number>;
  return {
    ...progressData,
    startupGateTelemetry: {
      ...startupTelemetry,
      version: LISTENING_TELEMETRY_SCHEMA_VERSION,
      mode,
      boostCount: Number(startupTelemetry.boostCount ?? 0) + 1,
      successfulBoostCount: Number(startupTelemetry.successfulBoostCount ?? 0) + (enqueued ? 1 : 0),
      boostBySource: {
        ...bySource,
        [source]: Number(bySource[source] ?? 0) + 1,
      },
      lastBoostAt: nowIso,
      lastBoostSource: source,
    },
  };
};

const resolveStartupGateReady = (
  mode: ListeningStartupGateMode,
  task: TaskProgressRecord,
  readiness: { partReady: boolean; prefetchStatus?: string | null },
) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const status = String(progressData?.sessionPrefetch?.status ?? readiness.prefetchStatus ?? PREFETCH_STATUS_IDLE);
  return resolveStartupGateReadyForMode({
    mode,
    partReady: readiness.partReady,
    prefetchStatus: status,
    hasAudio: Boolean(task.audioUrl),
  });
};

const mapPrefetchToNextPartStatus = (status: string): NextPartRuntimeStatus => {
  if (status === PREFETCH_STATUS_READY || status === PREFETCH_STATUS_READY_PARTIAL) return "ready";
  if (status === PREFETCH_STATUS_RUNNING) return "warming";
  if (status === PREFETCH_STATUS_ERROR) return "error";
  if (status === PREFETCH_STATUS_IDLE) return "queued";
  return "queued";
};

const toWindowStartMs = (value: unknown, fallbackMs: number) => {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallbackMs;
};

const toWindowEndMs = (value: unknown, fallbackMs: number) => {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallbackMs;
};

const percentile = (values: number[], ratio: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio));
  return sorted[index];
};

// Feature flag for task duration normalization
const NORMALIZE_TASK_DURATION = process.env.NORMALIZE_TASK_DURATION !== 'false'; // Default: true

// Timezone for weekday/weekend calculation (server default)
const PLANNER_TZ = process.env.TZ || 'UTC';

// Type for normalized task
interface NormalizedTask {
  durationMinutes: number;
  duration: string;
  audio?: {
    estimatedDurationSec?: number;
    accent?: string;
  };
  [key: string]: any;
}

interface FormattedListeningEntry {
  dayNumber: number;
  sequenceNumber: number;
  taskTitle: string;
  scriptType: string;
  contextLabel: string;
  topicDomain: string;
  scenarioOverview: string;
  accent?: string;
  estimatedDurationSec: number;
  durationLabel: string;
  dayType: string;
  dayDurationMinutes: number;
  sessionMinutes: number;
  description: string;
  conversationType: string | null;
  assignedDate: string;
}

const resolveSessionDurations = (preferences: any, defaultMinutes: number) => {
  const listeningDurations = (preferences?.listeningDurations ?? {}) as Record<string, any>;
  const weekday = typeof listeningDurations.weekday === "number" ? listeningDurations.weekday : defaultMinutes;
  const weekend = typeof listeningDurations.weekend === "number" ? listeningDurations.weekend : weekday;

  return {
    weekday,
    weekend,
  };
};

/**
 * Normalizes task durations to use user's session preferences instead of script estimatedDurationSec
 * Moves audio metadata to nested object to prevent UI confusion
 */
function normalizeTaskDuration(
  task: any,
  options: {
    weekdayDuration: number;
    weekendDuration: number;
    dayNumber?: number;
    date?: Date | string;
  }
): NormalizedTask {
  if (!NORMALIZE_TASK_DURATION) {
    return task; // Feature flag disabled, return as-is
  }

  const { weekdayDuration, weekendDuration, dayNumber, date } = options;

  // Determine if weekend using dayNumber (1=Mon, 7=Sun) or date
  let isWeekend = false;
  if (date) {
    const taskDate = typeof date === 'string' ? new Date(date) : date;
    // Create a date string in the target timezone, then parse to get day of week
    const tzDateStr = taskDate.toLocaleString('en-US', { timeZone: PLANNER_TZ });
    const dayOfWeek = new Date(tzDateStr).getDay(); // 0=Sunday, 6=Saturday
    isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  } else if (dayNumber) {
    const normalizedDay = ((dayNumber - 1) % 7) + 1;
    isWeekend = normalizedDay === 6 || normalizedDay === 7; // Saturday=6, Sunday=7
  }

  // Choose correct duration
  const taskDuration = isWeekend ? weekendDuration : weekdayDuration;

  // Build normalized task
  const normalized: NormalizedTask = {
    ...task,
    // ✅ Force-set correct labels
    durationMinutes: taskDuration,
    duration: `${taskDuration} min`, // force good label
  };

  // Remove legacy fields that could cause confusion
  delete (normalized as any).durationLabel; // old 6-min source
  delete (normalized as any).estimatedDurationSec; // move under audio

  // Move audio metadata to nested object
  normalized.audio = {
    ...(normalized.audio ?? {}),
    estimatedDurationSec: task.estimatedDurationSec ?? normalized.audio?.estimatedDurationSec ?? TARGET_AUDIO_SECONDS,
    accent: task.accent,
  };

  console.log('[normalizeTaskDuration]', {
    outDurationMinutes: normalized.durationMinutes,
    outDuration: normalized.duration,
    audioSec: normalized.audio?.estimatedDurationSec,
  });

  return normalized;
}

const determineDayType = (options: { dayNumber?: number; explicit?: string; assignedDate?: string | Date }) => {
  const explicitLower = typeof options.explicit === "string" ? options.explicit.toLowerCase() : undefined;
  if (explicitLower === "weekday" || explicitLower === "weekend") {
    return explicitLower;
  }

  if (options.assignedDate) {
    const parsed = new Date(options.assignedDate);
    if (!Number.isNaN(parsed.getTime())) {
      const iso = getIsoDayForDate(parsed, PLANNER_TZ);
      return iso === 6 || iso === 7 ? "weekend" : "weekday";
    }
  }

  const normalizedDay = ((Number(options.dayNumber ?? 1) - 1) % 7) + 1;
  return normalizedDay === 6 || normalizedDay === 7 ? "weekend" : "weekday";
};

const isoDayToDayType = (isoDay: number) => (isoDay === 6 || isoDay === 7 ? "weekend" : "weekday");

const resolveWeekWindow = (opts: { weekNumber: number; tz: string; referenceDate?: Date }) => {
  const { weekNumber, tz } = opts;
  const referenceDate = opts.referenceDate ?? new Date();
  const windows = getForwardWeekWindows(referenceDate, tz);

  if (weekNumber === 1) {
    return { start: windows.week1Start, end: windows.week1End };
  }

  if (weekNumber === 2) {
    return { start: windows.week2Start, end: windows.week2End };
  }

  const offsetWeeks = weekNumber - 2;
  const start = addDaysUtc(windows.week2Start, offsetWeeks * 7);
  const end = addDaysUtc(start, 6);
  return { start, end };
};

const mapPackageQuestions = (questions: any[]): TaskQuestion[] => {
  return normalizeLegacyQuestionsForApi(questions);
};

const inferDefaultTagsForGeneratedQuestion = (question: any): string[] => {
  const text = String(question?.question ?? question?.text ?? "").toLowerCase();
  if (/\bmap|route|north|south|east|west|turn|left|right\b/.test(text)) {
    return ["maps", "directions"];
  }
  if (/\bdate|schedule|time|year|month|day\b/.test(text)) {
    return ["dates"];
  }
  if (/\bnumber|price|cost|amount|percent|percentage\b/.test(text)) {
    return ["numbers"];
  }
  if (/\bmatch|pair|statement\b/.test(text)) {
    return ["matching_pair_confusion"];
  }
  if (/\bspell|word\b/.test(text)) {
    return ["spelling_capture"];
  }
  return ["general"];
};

const ensureGeneratedQuestionTags = (questions: any[]): any[] => {
  return (Array.isArray(questions) ? questions : []).map((question) => {
    const providedTags = Array.isArray(question?.tags)
      ? question.tags
          .map((tag: any) => String(tag).toLowerCase())
          .filter((tag: string) => LISTENING_SCORING_TAGS.includes(tag as any))
      : [];
    const tags = providedTags.length > 0 ? providedTags : inferDefaultTagsForGeneratedQuestion(question);
    return {
      ...question,
      tags,
    };
  });
};

const chunkQuestionIds = (ids: string[], segmentCount: number, index: number) => {
  if (!ids.length || segmentCount <= 0) return [];
  const start = Math.floor((index / segmentCount) * ids.length);
  const rawEnd = Math.floor(((index + 1) / segmentCount) * ids.length);
  const end = Math.max(start + 1, rawEnd);
  return ids.slice(start, end);
};

const deriveSegmentAssignments = (task: TaskProgressRecord) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const segments = Array.isArray(progressData.segments) ? progressData.segments : [];
  const existingAssignments = progressData.segmentAssignments ?? {};

  if (!segments.length) {
    return { assignments: existingAssignments, changed: false };
  }

  const questions = Array.isArray(task.questions) ? task.questions : [];
  const questionIds = questions.map((q: any, idx: number) => String(q?.id ?? `q${idx + 1}`)).filter(Boolean);

  if (!questionIds.length) {
    return { assignments: existingAssignments, changed: false };
  }

  let changed = false;
  const assignments: Record<string, string[]> = { ...existingAssignments };

  segments.forEach((segment, index) => {
    const segId = segment?.id ?? `segment-${index + 1}`;
    if (!Array.isArray(assignments[segId]) || !assignments[segId].length) {
      assignments[segId] = chunkQuestionIds(questionIds, segments.length, index);
      changed = true;
    }
  });

  return { assignments, changed };
};

const buildSegmentInputsFromTask = (task: TaskProgressRecord) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const roadmapSegments = Array.isArray(progressData?.listeningSegments?.data)
    ? progressData.listeningSegments.data
    : [];

  if (roadmapSegments.length > 0) {
    return roadmapSegments
      .map((segment: any) => ({
        segmentNo: Number(segment?.segment_no),
        transcript: String(segment?.transcript_text ?? ""),
        accent: segment?.accent_plan?.accent ?? task.accent ?? DEFAULT_ACCENT,
        voiceId: segment?.accent_plan?.voice_hint,
        secondaryAccents: Array.isArray(segment?.accent_plan?.secondary_accents)
          ? segment.accent_plan.secondary_accents.filter((accent: unknown) => typeof accent === "string")
          : Array.isArray(segment?.secondary_accents)
            ? segment.secondary_accents.filter((accent: unknown) => typeof accent === "string")
            : [],
      }))
      .filter((segment: any) => Number.isFinite(segment.segmentNo) && segment.segmentNo > 0 && segment.transcript.trim().length > 0)
      .slice(0, 3);
  }

  if (typeof task.scriptText === "string" && task.scriptText.trim().length > 0) {
    return [
      {
        segmentNo: 1,
        transcript: task.scriptText,
        accent: task.accent ?? DEFAULT_ACCENT,
      },
    ];
  }

  return [];
};

const resolveSectionFallbackAccentsFromTask = (task: TaskProgressRecord) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const segmentPlan = Array.isArray(progressData?.listeningSegments?.data)
    ? progressData.listeningSegments.data
    : [];
  const accentPlanFallbacks = Array.isArray(progressData?.listeningSegments?.accent_plan?.secondary_accents)
    ? progressData.listeningSegments.accent_plan.secondary_accents
    : [];

  const segmentAccents = segmentPlan
    .map((segment: any) => segment?.accent_plan?.accent)
    .filter((accent: unknown): accent is string => typeof accent === "string" && accent.trim().length > 0);

  return [...accentPlanFallbacks, ...segmentAccents]
    .filter((accent: unknown): accent is string => typeof accent === "string" && accent.trim().length > 0)
    .filter((accent, index, arr) => arr.indexOf(accent) === index);
};

const mergeRenderedAssetsIntoSegments = (
  currentSegments: any[],
  sectionAssets: Array<{
    segment_no: number;
    accent: string;
    voice_id?: string | null;
    url: string;
    duration_seconds: number;
  }>,
) => {
  const byPart = new Map(sectionAssets.map((asset) => [Number(asset.segment_no), asset]));
  if (!Array.isArray(currentSegments) || currentSegments.length === 0) {
    return sectionAssets.map((asset, index) => ({
      id: `segment-${asset.segment_no}`,
      ieltsPart: asset.segment_no,
      type: index % 2 === 0 ? "dialogue" : "monologue",
      title: `Part ${asset.segment_no}`,
      transcript: null,
      audioUrl: asset.url,
      estimatedDurationSec: asset.duration_seconds,
      accent: asset.accent,
      voiceId: asset.voice_id ?? null,
    }));
  }

  return (Array.isArray(currentSegments) ? currentSegments : []).map((segment: any, index: number) => {
    const segmentNo = Number(segment?.ieltsPart ?? segment?.segmentNo ?? index + 1);
    const rendered = byPart.get(segmentNo);
    if (!rendered) {
      return segment;
    }

    return {
      ...segment,
      audioUrl: rendered.url,
      accent: rendered.accent,
      voiceId: rendered.voice_id ?? segment?.voiceId,
      estimatedDurationSec: rendered.duration_seconds,
    };
  });
};

const joinSegmentTranscripts = (segments: Array<{ segment_no: number; transcript_text: string }>) => {
  return [...segments]
    .sort((a, b) => a.segment_no - b.segment_no)
    .map((segment) => segment.transcript_text.trim())
    .join("\n\n");
};

const attemptTargetedSegmentRegeneration = async (params: {
  taskId: string;
  userId: string;
  segmentNos: number[];
  userLevel: number;
  targetBand: number;
}) => {
  const task = await storage.getTaskProgress(params.taskId);
  if (!task || task.userId !== params.userId) {
    return { ok: false as const, reason: "TASK_NOT_FOUND" };
  }

  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const blueprintParsed = listeningSectionBlueprintSchema.safeParse(progressData?.listeningBlueprint?.data);
  const rawSegments = Array.isArray(progressData?.listeningSegments?.data)
    ? progressData.listeningSegments.data
    : [];
  const existingSegments = rawSegments
    .map((segment: unknown) => listeningSectionSegmentSchema.safeParse(segment))
    .filter((parsed: any) => parsed.success)
    .map((parsed: any) => parsed.data);

  const requestedSegmentNos = Array.from(
    new Set(
      params.segmentNos
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );

  if (!blueprintParsed.success || existingSegments.length === 0 || requestedSegmentNos.length === 0) {
    return { ok: false as const, reason: "NO_TARGETABLE_ARTIFACTS" };
  }

  const regenerated = await regenerateSpecificSegments({
    task,
    blueprint: blueprintParsed.data,
    existingSegments,
    segmentNos: requestedSegmentNos,
    userLevel: params.userLevel,
    targetBand: params.targetBand,
  });
  if (!regenerated.ok) {
    return {
      ok: false as const,
      reason: regenerated.errorCode ?? "SEGMENT_TARGETED_REGEN_FAILED",
      details: regenerated.details ?? [],
    };
  }

  const ttsDurationsBySegmentNo = Array.isArray(progressData.segments)
    ? progressData.segments.reduce((acc: Record<number, number>, segment: any) => {
        const partNo = Number(segment?.ieltsPart);
        const duration = Number(segment?.estimatedDurationSec);
        if (Number.isFinite(partNo) && Number.isFinite(duration) && duration > 0) {
          acc[partNo] = duration;
        }
        return acc;
      }, {})
    : {};
  const anchors = buildAnchorsForSegments({
    task,
    segments: regenerated.segments,
  });
  const anchorValidation = validateAnchorsForSection({
    task,
    anchors,
    segments: regenerated.segments,
    ttsDurationsBySegmentNo,
  });
  await persistAnchors(task, anchors, anchorValidation);

  const scriptText = joinSegmentTranscripts(regenerated.segments);
  const estimatedDurationSec = regenerated.segments.reduce(
    (sum, segment) => sum + segment.predicted_duration_seconds,
    0,
  );
  await storage.updateTaskContent(task.id, {
    scriptText,
    estimatedDurationSec,
  });

  return {
    ok: true as const,
    scriptText,
    estimatedDurationSec,
    segmentNos: requestedSegmentNos,
  };
};

const buildMistakeHistogram = (segmentResults: Array<Record<string, any>>) => {
  const histogram: Record<string, { correct: number; total: number }> = {};
  segmentResults.forEach((result) => {
    const tagStats = (result?.tagStats ?? {}) as Record<string, { correct?: number; total?: number }>;
    Object.entries(tagStats).forEach(([tag, stats]) => {
      if (!histogram[tag]) {
        histogram[tag] = { correct: 0, total: 0 };
      }
      histogram[tag].correct += Number(stats.correct ?? 0);
      histogram[tag].total += Number(stats.total ?? 0);
    });
  });
  return histogram;
};

const buildTimingDistribution = (values: number[]) => {
  if (!values.length) {
    return {
      count: 0,
      minMs: null,
      maxMs: null,
      p50Ms: null,
      p90Ms: null,
      avgMs: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: pick(0.5),
    p90Ms: pick(0.9),
    avgMs: Math.round(total / sorted.length),
  };
};

const buildCoachOutcomesFromSectionResults = (sectionResults: Array<Record<string, any>>) => {
  return sectionResults.flatMap((section) => {
    const perQuestion = Array.isArray(section?.perQuestion) ? section.perQuestion : [];
    const sectionNo =
      Number.isFinite(Number(section?.sectionNo)) && Number(section?.sectionNo) > 0
        ? Math.round(Number(section.sectionNo))
        : 1;
    return perQuestion.map((entry: any) => ({
      questionId: String(entry?.questionId ?? ""),
      questionNo:
        Number.isFinite(Number(entry?.questionNo)) && Number(entry?.questionNo) > 0
          ? Math.round(Number(entry.questionNo))
          : Number(String(entry?.questionId ?? "").replace(/[^\d]/g, "")) || null,
      sectionNo,
      sectionId: String(section?.sectionId ?? ""),
      isCorrect: Boolean(entry?.correct),
      responseTimeMs:
        Number.isFinite(Number(entry?.responseTimeMs)) && Number(entry?.responseTimeMs) > 0
          ? Math.round(Number(entry?.responseTimeMs))
          : null,
      answerChangeCount:
        Number.isFinite(Number(entry?.answerChangeCount)) && Number(entry?.answerChangeCount) > 0
          ? Math.round(Number(entry?.answerChangeCount))
          : 0,
      replayCount:
        Number.isFinite(Number(entry?.replayCount)) && Number(entry?.replayCount) > 0
          ? Math.round(Number(entry?.replayCount))
          : 0,
      unanswered: Boolean(entry?.unanswered),
    }));
  });
};

const COACH_GROUNDED_FAILURE_CODES = new Set([
  "UNGROUNDED_CLAIM",
  "EVIDENCE_MISSING",
]);

const enqueueCoachGovernanceReviewIfNeeded = async (params: {
  task: TaskProgressRecord;
  analysis: any;
  actorId: string;
  attemptId: string;
  traceId?: string | null;
  correlationId?: string | null;
}) => {
  const fallbackReason = String(
    params.analysis?.fallback?.reason_code ?? params.analysis?.governance?.fallback_reason ?? "",
  )
    .trim()
    .toUpperCase();
  if (!COACH_GROUNDED_FAILURE_CODES.has(fallbackReason)) {
    return null;
  }

  const sectionNo = Number(((params.task.progressData ?? {}) as any)?.sessionOrder ?? 1);
  const now = new Date();
  const queue = await storage.insertListeningReviewQueue({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.task.id,
    sectionNo: Number.isFinite(sectionNo) && sectionNo > 0 ? Math.round(sectionNo) : 1,
    validationReportId: null,
    status: "OPEN",
    severity: "high",
    failureType: "coaching_governance",
    failureCode: fallbackReason,
    context: {
      route: "performance_coach",
      failure_reason: fallbackReason,
      analysis_version: params.analysis?.analysis_version ?? null,
      source_analysis_id: params.analysis?.closed_loop?.source_analysis_id ?? null,
      fallback_used: Boolean(params.analysis?.fallback?.used),
      review_options: ["HOLD", "REQUEUE", "FORCE_REGENERATE"],
    },
    slaDueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });

  await storage.insertListeningPublishAudit({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.task.id,
    sectionNo: Number.isFinite(sectionNo) && sectionNo > 0 ? Math.round(sectionNo) : 1,
    eventType: "COACH_REVIEW_QUEUED",
    actorId: params.actorId,
    actorType: "api",
    traceId: params.traceId ?? null,
    correlationId: params.correlationId ?? null,
    payload: {
      review_queue_id: queue.id,
      failure_code: fallbackReason,
      attempt_id: params.attemptId,
    },
  });

  await recordGovernanceLedgerEntry({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.task.id,
    sectionNo: Number.isFinite(sectionNo) && sectionNo > 0 ? Math.round(sectionNo) : 1,
    sessionId: String(((params.task.progressData ?? {}) as any)?.sessionBatchId ?? params.task.id),
    attemptId: params.attemptId,
    policyVersion: getListeningGovernancePolicyInfo().policyVersion,
    validatorSetVersion: getListeningGovernancePolicyInfo().validatorSetVersion,
    validationVerdict: "FAIL",
    actionType: `COACH_${fallbackReason}_REVIEW_QUEUED`,
    actorId: params.actorId,
    actorType: "api",
    traceId: params.traceId ?? null,
    correlationId: params.correlationId ?? null,
    metadata: {
      review_queue_id: queue.id,
      failure_code: fallbackReason,
      source: "performance_coach",
    },
  });

  return queue.id;
};

const deriveRendererMode = (params: {
  requested?: unknown;
  fallbackDualEnabled?: boolean;
  mixedScoring?: boolean;
}): RendererMode => {
  if (params.mixedScoring) return "dual";
  if (params.requested === "dual" || params.requested === "legacy") {
    return params.requested;
  }
  return params.fallbackDualEnabled ? "dual" : "legacy";
};

// Legacy function kept for backward compatibility - delegates to centralized retry
const schedulePrefetchRetry = async (taskId: string, userId: string, retryCount: number, batchId?: string, errorCode?: string) => {
  await retryPrefetchJob(
    {
      taskId,
      userId,
      batchId: batchId ?? 'unknown',
      errorCode,
      currentRetryCount: retryCount,
      skillType: 'listening',
    },
    async (retryTaskId, retryUserId) => {
      enqueueListeningOrchestratorJob({
        taskId: retryTaskId,
        userId: retryUserId,
        sectionNo: 1,
        priorityClass: "P2_NEXT_24H",
        priorityScore: 60,
      });
    }
  );
};

const enqueueListeningPrefetch = async (
  task: TaskProgressRecord,
  userId: string,
  options?: { source?: string },
) => {
  if (!task.weeklyPlanId || (task.skill && task.skill.toLowerCase() !== 'listening')) {
    return;
  }

  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const sessionPrefetch = progressData.sessionPrefetch ?? {};
  const status = sessionPrefetch.status ?? PREFETCH_STATUS_IDLE;
  const source = normalizeListeningPrefetchSource(options?.source);
  const sourceSignals = deriveListeningPrioritySignalsFromSource(source);

  if (status === PREFETCH_STATUS_QUEUED || status === PREFETCH_STATUS_RUNNING) {
    return;
  }

  const batchId = typeof progressData.sessionBatchId === 'string' && progressData.sessionBatchId.length > 0
    ? progressData.sessionBatchId
    : uuidv4();
  const nowIso = new Date().toISOString();
  const priority = deriveListeningPriority({
    sessionStartAt: task.startedAt ?? task.createdAt ?? null,
    dashboardOpenBoost: sourceSignals.dashboardOpenBoost,
    startClickBoost: sourceSignals.startClickBoost,
    readinessGap: Number(sessionPrefetch.ready ? 0 : 1),
  });

  const queuedProgress = {
    ...progressData,
    sessionBatchId: batchId,
    queuePriority: {
      score: priority.score,
      class: priority.priorityClass,
      components: priority.components,
      source,
      enqueueAt: nowIso,
    },
    sessionPrefetch: {
      ...sessionPrefetch,
      batchId,
      status: PREFETCH_STATUS_QUEUED,
      ready: false,
      retryCount: sessionPrefetch.retryCount ?? 0,
      startedAt: sessionPrefetch.startedAt ?? nowIso,
      updatedAt: nowIso,
      message: 'Preparing listening session assets',
    },
  };

  await storage.updateTaskStatus(task.id, task.status ?? 'not-started', queuedProgress);
  task.progressData = queuedProgress;
  const dispatch = dispatchSectionBuildRequested({
    task,
    sectionNo: 1,
  });
  const planCreatedEvent = publishListeningEvent({
    topic: LISTENING_EVENT_TOPICS.PLAN_EVENTS,
    eventType: LISTENING_EVENT_TYPES.SESSION_PLAN_CREATED,
    eventVersion: "1.0.0",
    producer: "listening-api",
    traceId: dispatch.trace.traceId,
    correlationId: dispatch.trace.correlationId,
    idempotencyKey: buildSectionStepIdempotencyKey(task.id, 1, "plan_created"),
    userId: task.userId,
    payload: {
      task_id: task.id,
      weekly_plan_id: task.weeklyPlanId,
    },
  });
  await consumePlanCreatedBootstrapEvent({
    rawEvent: planCreatedEvent,
    task,
    retryContext: {
      taskId: task.id,
      userId: task.userId,
      batchId: batchId,
      currentRetryCount: Number((queuedProgress.sessionPrefetch as any)?.retryCount ?? 0),
    },
  });
  console.log("[ListeningOrchestrator][Dispatch]", {
    taskId: task.id,
    sectionId: dispatch.sectionId,
    sectionNo: dispatch.sectionNo,
    traceId: dispatch.trace.traceId,
    correlationId: dispatch.trace.correlationId,
    priorityClass: priority.priorityClass,
    priorityScore: priority.score,
    priorityComponents: priority.components,
    source,
  });
  const queueResult = enqueueListeningOrchestratorJob({
    taskId: task.id,
    userId,
    sectionNo: 1,
    priorityClass: priority.priorityClass,
    priorityScore: priority.score,
    correlationId: dispatch.trace.correlationId,
    traceId: dispatch.trace.traceId,
  });
  console.log("[ListeningWorker][Enqueue]", {
    taskId: task.id,
    sectionNo: 1,
    deduped: queueResult.deduped,
  });
};

const getNextPartStatusForTask = async (task: TaskProgressRecord, userId: string) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const batchId = typeof progressData.sessionBatchId === "string" ? progressData.sessionBatchId : null;
  const currentOrder =
    typeof progressData.sessionOrder === "number" && Number.isFinite(progressData.sessionOrder)
      ? Number(progressData.sessionOrder)
      : null;

  if (!task.weeklyPlanId || !batchId || currentOrder === null) {
    return {
      status: "none" as NextPartRuntimeStatus,
      phase: "idle",
      etaSecs: null as number | null,
      progressId: null as string | null,
      message: "No linked next part.",
      final: true,
      prefetchStatus: PREFETCH_STATUS_IDLE,
    };
  }

  const planTasks = await storage.getTaskProgressByWeeklyPlan(task.weeklyPlanId, userId);
  const candidates = planTasks
    .filter((candidate) => {
      if (candidate.id === task.id) return false;
      const candidateProgressData = (candidate.progressData ?? {}) as Record<string, any>;
      if (candidateProgressData.sessionBatchId !== batchId) return false;
      const order = Number(candidateProgressData.sessionOrder ?? 0);
      if (!Number.isFinite(order)) return false;
      return order > currentOrder;
    })
    .sort((a, b) => {
      const ao = Number(((a.progressData ?? {}) as Record<string, any>).sessionOrder ?? 0);
      const bo = Number(((b.progressData ?? {}) as Record<string, any>).sessionOrder ?? 0);
      return ao - bo;
    });

  if (!candidates.length) {
    return {
      status: "none" as NextPartRuntimeStatus,
      phase: "idle",
      etaSecs: null as number | null,
      progressId: null as string | null,
      message: "Final part in this session.",
      final: true,
      prefetchStatus: PREFETCH_STATUS_READY,
    };
  }

  const nextTask = candidates[0] as TaskProgressRecord;
  const readiness = await buildManifestReadiness(nextTask);
  const nextProgressData = (nextTask.progressData ?? {}) as Record<string, any>;
  const nextPrefetch = nextProgressData.sessionPrefetch ?? {};
  const nextPrefetchStatus = String(nextPrefetch.status ?? readiness.prefetchStatus ?? PREFETCH_STATUS_IDLE);
  const status = readiness.partReady ? "ready" : mapPrefetchToNextPartStatus(nextPrefetchStatus);
  const phase = readiness.prefetchPhase ?? (status === "ready" ? "ready" : status);
  const etaSecs =
    status === "warming" || status === "queued" ? LISTENING_STATUS_ETA_SECS : null;

  return {
    status,
    phase,
    etaSecs,
    progressId: nextTask.id,
    message:
      status === "ready"
        ? "Next part is ready."
        : typeof nextPrefetch.message === "string" && nextPrefetch.message.trim().length > 0
          ? nextPrefetch.message
          : "Preparing next part.",
    retryCount: Number(nextPrefetch.retryCount ?? 0),
    final: false,
    prefetchStatus: nextPrefetchStatus,
  };
};

const cleanupTouchedListeningTelemetryTasks = async () => {
  const ids = Array.from(touchedListeningTelemetryTaskIds);
  if (!ids.length) return;

  for (const taskId of ids) {
    try {
      const task = await storage.getTaskProgress(taskId);
      if (!task) {
        touchedListeningTelemetryTaskIds.delete(taskId);
        continue;
      }
      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const retained = applyListeningTelemetryRetention(progressData);
      const before = JSON.stringify(progressData);
      const after = JSON.stringify(retained);
      if (before !== after) {
        await storage.updateTaskProgress(task.id, { progressData: retained });
      }
      touchedListeningTelemetryTaskIds.delete(taskId);
    } catch (error) {
      console.warn("[ListeningTelemetry][Cleanup][Skipped]", { taskId, error });
    }
  }
};

const runListeningSessionPrefetchFromWorker = async (taskId: string, userId: string) => {
  await ensureListeningSessionPrefetchWithDeps(taskId, userId, {
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
  });
};

registerListeningOrchestratorExecutor(async (job) => {
  await runListeningSessionPrefetchFromWorker(job.taskId, job.userId);
});

async function preGenerateScriptsForListeningTasks(
  userId: string, 
  weeklyPlanId: string, 
  weekNumber: number, 
  listeningTasks: any[], 
  userLevel: number, 
  targetBand: number
) {
  logNonProdVerbose(`[Script Pre-Generation] Starting script generation for ${listeningTasks.length} listening tasks`);
  
  const scriptGenerationPromises = listeningTasks.map(async (task, index) => {
    try {
      // Create a minimal task object for script generation
      const taskForScript = {
        taskTitle: task.title,
        weekNumber: weekNumber,
        accent: normalizeAccent(task.accent),
        progressData: { description: task.description }
      };

      // Generate the script
      const scriptResult = await generateListeningScriptForTask(taskForScript as any, userLevel, targetBand);
      
      if (scriptResult.success) {
        const generatedTitle = makeListeningTaskTitle({
          scriptType: scriptResult.scriptType === 'dialogue' || scriptResult.scriptType === 'monologue'
            ? scriptResult.scriptType
            : undefined,
          contextLabel: scriptResult.contextLabel,
          topicDomain: scriptResult.topicDomain,
          scenarioOverview: scriptResult.scenarioOverview
        });

        logNonProdVerbose(
          `[Script Pre-Generation] Generated script for "${task.title}" → "${generatedTitle}": ${scriptResult.scriptText?.split(' ').length} words`,
        );
        return {
          taskTitle: task.title,
          generatedTitle,
          scriptText: scriptResult.scriptText,
          accent: scriptResult.accent,
          scriptType: scriptResult.scriptType,
          difficulty: scriptResult.difficulty,
          topicDomain: scriptResult.topicDomain,
          contextLabel: scriptResult.contextLabel,
          scenarioOverview: scriptResult.scenarioOverview,
          estimatedDurationSec: scriptResult.estimatedDurationSec,
          ieltsPart: scriptResult.ieltsPart
        };
      } else {
        console.error(`[Script Pre-Generation] Failed to generate script for "${task.title}":`, scriptResult.error);
        return null;
      }
    } catch (error) {
      console.error(`[Script Pre-Generation] Error generating script for "${task.title}":`, error);
      return null;
    }
  });

  // Wait for all script generations to complete
  const scriptResults = await Promise.allSettled(scriptGenerationPromises);
  const successfulScripts = scriptResults
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => (result as PromiseFulfilledResult<any>).value);

  logNonProdVerbose(
    `[Script Pre-Generation] Successfully generated ${successfulScripts.length}/${listeningTasks.length} scripts`,
  );
  return successfulScripts;
}
import { onboardingSchema, type TaskProgress as TaskProgressRecord, type Question as TaskQuestion } from "@shared/schema";

export async function registerRoutes(app: express.Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);
  app.use((req: any, _res: any, next: NextFunction) => {
    if (!isPrivacySafeLogMode()) {
      return next();
    }
    const payload = redactSensitive({
      method: req.method,
      path: req.path,
      userId: req.user?.id ?? req.firebaseUser?.uid ?? null,
      pii_classes: getPiiClasses(),
    });
    console.log("[PrivacySafeRequestLog]", payload);
    return next();
  });

  const governanceSchedulerPrereq = await runGovernanceSchedulerPrerequisiteSmoke();
  const hasCriticalGovernanceRolloutPrereqs =
    LISTENING_GOVERNANCE_ROLLOUT_PREREQUISITE_RELATIONS.filter((relation) =>
      governanceSchedulerPrereq.missingRelations.includes(relation),
    ).length === 0;
  const disableGovernanceSchedulers = !governanceSchedulerPrereq.ok;
  if (disableGovernanceSchedulers) {
    logGovernancePrerequisiteWarningOnce({
      missingRelations: governanceSchedulerPrereq.missingRelations,
      checkedRelations: governanceSchedulerPrereq.checkedRelations,
      jobsDisabled: [
        "governance_rollout_startup_hydration",
        "retention_cleanup",
        "governance_integrity_check",
        "governance_exception_sweep",
        "governance_review_scheduler",
      ],
      error: governanceSchedulerPrereq.error,
    });
  }

  if (!hasCriticalGovernanceRolloutPrereqs) {
    if (!listeningRolloutHydrationMissingTableWarningEmitted) {
      console.warn("[ListeningRollout][HydrationSkippedMissingPrerequisites]", {
        message:
          "Governance/rollout prerequisite tables missing. Apply migrations for listening_governance_ledger and listening_rollout_audit.",
        missing_relations: governanceSchedulerPrereq.missingRelations,
      });
      listeningRolloutHydrationMissingTableWarningEmitted = true;
    }
  } else {
    try {
      const latestPromotion = await getLatestListeningRolloutAudit("CANARY_PROMOTION");
      if (latestPromotion) {
        const metadata = (latestPromotion.metadata ?? {}) as Record<string, any>;
        const mode = String(metadata.mode ?? "").toLowerCase();
        if (mode === "legacy" || mode === "cohort" || mode === "new") {
          listeningRolloutRuntime.rolloutModeOverride = mode as "legacy" | "cohort" | "new";
          process.env.LISTENING_ROLLOUT_MODE = mode;
        }
        const percent = Number(metadata.percent ?? NaN);
        if (Number.isFinite(percent)) {
          listeningRolloutRuntime.rolloutPercentOverride = Math.max(0, Math.min(100, percent));
          process.env.LISTENING_ROLLOUT_PERCENT = String(listeningRolloutRuntime.rolloutPercentOverride);
        }
        const seed = String(metadata.seed ?? "").trim();
        if (seed) {
          listeningRolloutRuntime.rolloutSeedOverride = seed;
          process.env.LISTENING_ROLLOUT_SEED = seed;
        }
      }

      const latestRollback = await getLatestListeningRolloutAudit("ROLLBACK_SWITCH");
      if (latestRollback) {
        const metadata = (latestRollback.metadata ?? {}) as Record<string, any>;
        listeningRolloutRuntime.forceRollback = Boolean(metadata.enabled);
        process.env.LISTENING_ROLLOUT_FORCE_ROLLBACK = listeningRolloutRuntime.forceRollback ? "true" : "false";
        listeningRolloutRuntime.rollbackAudit = {
          actorId: latestRollback.actorId,
          reason: latestRollback.reason,
          incidentTicket: latestRollback.incidentTicket ?? null,
          affectedCohorts: normalizeCohorts(latestRollback.affectedCohorts, [getEffectiveRolloutMode()]),
          at: new Date(latestRollback.createdAt).toISOString(),
        };
      }

      const latestOverride = await getLatestListeningRolloutAudit("CANARY_OVERRIDE");
      if (latestOverride) {
        const metadata = (latestOverride.metadata ?? {}) as Record<string, any>;
        const enabled = metadata.enabled !== false;
        if (enabled) {
          listeningRolloutRuntime.canaryOverride = {
            actorId: latestOverride.actorId,
            reason: latestOverride.reason,
            incidentTicket: latestOverride.incidentTicket ?? "unknown_ticket",
            at: new Date(latestOverride.createdAt).toISOString(),
          };
        }
      }
    } catch (error: any) {
      if (isListeningRolloutAuditStorageMissingError(error)) {
        if (!listeningRolloutHydrationMissingTableWarningEmitted) {
          console.warn("[ListeningRollout][HydrationSkippedMissingTable]", {
            message:
              "Rollout audit storage missing (listening_rollout_audit). Apply drizzle/0009_add_listening_rollout_observability_ops.sql.",
          });
          listeningRolloutHydrationMissingTableWarningEmitted = true;
        }
      } else {
        console.warn("[ListeningRollout][HydrationSkipped]", {
          message: error?.message ?? "rollout_audit_unavailable",
        });
      }
    }
  }

  startListeningAlertScheduler();
  startListeningSyntheticProbeScheduler();
  if (process.env.LISTENING_SYNTHETIC_PROBE_RUN_ON_START === "true") {
    void runListeningSyntheticProbeSuite({
      persist: true,
    });
  }

  if (!listeningTelemetryCleanupTimer) {
    listeningTelemetryCleanupTimer = setInterval(() => {
      void cleanupTouchedListeningTelemetryTasks();
    }, LISTENING_TELEMETRY_CLEANUP_INTERVAL_MS);
    if (typeof listeningTelemetryCleanupTimer.unref === "function") {
      listeningTelemetryCleanupTimer.unref();
    }
  }
  if (LISTENING_RETENTION_CLEANUP_ENABLED && !disableGovernanceSchedulers && !listeningRetentionCleanupTimer) {
    listeningRetentionCleanupTimer = setInterval(() => {
      void runListeningRetentionCleanup({ dryRun: false })
        .then((report) => {
          latestListeningRetentionReport = report as unknown as Record<string, unknown>;
        })
        .catch((error) => {
          console.warn("[ListeningRetention][Cleanup][Skipped]", error);
        });
    }, LISTENING_RETENTION_CLEANUP_INTERVAL_MS);
    if (typeof listeningRetentionCleanupTimer.unref === "function") {
      listeningRetentionCleanupTimer.unref();
    }
  }
  if (LISTENING_GOVERNANCE_INTEGRITY_CHECK_ENABLED && !disableGovernanceSchedulers && !listeningGovernanceIntegrityTimer) {
    listeningGovernanceIntegrityTimer = setInterval(() => {
      void runGovernanceLedgerIntegrityCheck({})
        .then(async (report) => {
          latestGovernanceIntegrityReport = report as unknown as Record<string, unknown>;
          if (!report.ok) {
            console.error("[ListeningGovernance][IntegrityAlert]", report);
            await recordGovernanceLedgerEntry({
              policyVersion: getListeningGovernancePolicyInfo().policyVersion,
              validatorSetVersion: getListeningGovernancePolicyInfo().validatorSetVersion,
              actionType: "GOVERNANCE_INTEGRITY_ALERT",
              actorId: "system",
              actorType: "system",
              metadata: report as unknown as Record<string, unknown>,
            });
          }
        })
        .catch((error) => {
          console.warn("[ListeningGovernance][IntegrityCheck][Skipped]", error);
        });
    }, LISTENING_GOVERNANCE_INTEGRITY_CHECK_INTERVAL_MS);
    if (typeof listeningGovernanceIntegrityTimer.unref === "function") {
      listeningGovernanceIntegrityTimer.unref();
    }
  }
  if (!disableGovernanceSchedulers && !listeningGovernanceExceptionSweepTimer) {
    listeningGovernanceExceptionSweepTimer = setInterval(() => {
      void expireGovernanceExceptions().catch((error) => {
        console.warn("[ListeningGovernance][ExceptionSweep][Skipped]", error);
      });
    }, LISTENING_GOVERNANCE_EXCEPTION_SWEEP_INTERVAL_MS);
    if (typeof listeningGovernanceExceptionSweepTimer.unref === "function") {
      listeningGovernanceExceptionSweepTimer.unref();
    }
  }
  if (LISTENING_GOVERNANCE_REVIEW_ENABLED && !disableGovernanceSchedulers && !listeningGovernanceReviewTimer) {
    listeningGovernanceReviewSchedulerStartedAtMs = Date.now();
    listeningGovernanceReviewTimer = setInterval(() => {
      const nowMs = Date.now();
      const baselineMs =
        listeningGovernanceReviewLastRunAtMs ?? listeningGovernanceReviewSchedulerStartedAtMs ?? nowMs;
      if (nowMs - baselineMs < LISTENING_GOVERNANCE_REVIEW_WINDOW_MS) {
        return;
      }
      const now = new Date(nowMs);
      const windowFrom = new Date(nowMs - LISTENING_GOVERNANCE_REVIEW_WINDOW_MS);
      void generateGovernanceReviewReport({
        generatedBy: "system",
        windowFrom,
        windowTo: now,
      })
        .then(() => {
          listeningGovernanceReviewLastRunAtMs = nowMs;
        })
        .catch((error) => {
          console.warn("[ListeningGovernance][ReviewScheduler][Skipped]", error);
        });
    }, LISTENING_GOVERNANCE_REVIEW_TICK_INTERVAL_MS);
    if (typeof listeningGovernanceReviewTimer.unref === "function") {
      listeningGovernanceReviewTimer.unref();
    }
  }

  const verifyManifestIntegrityForTask = async (task: TaskProgressRecord, actorId: string) => {
    const active = await getActiveManifestVersionWithIntegrity(task.id);
    if (!active) {
      return { ok: true as const };
    }
    if (active.integrity.ok) {
      return { ok: true as const };
    }

    await storage.insertListeningPublishAudit({
      taskProgressId: task.id,
      userId: task.userId,
      sectionId: task.id,
      sectionNo: active.active.sectionNo,
      manifestVersionId: active.active.id,
      eventType: "MANIFEST_INTEGRITY_ALERT",
      actorId,
      actorType: "api",
      payload: {
        error_code: active.integrity.error_code,
        expected: active.integrity.expected ?? null,
        computed: active.integrity.computed ?? null,
      },
    });

    return {
      ok: false as const,
      error_code: active.integrity.error_code,
    };
  };

  const loadListeningTasksForUser = async (userId: string) => {
    const plans = await storage.getWeeklyStudyPlansByUserId(userId);
    const rows: TaskProgressRecord[] = [];
    for (const plan of plans) {
      const tasks = await storage.getTaskProgressByWeeklyPlan(plan.id, userId);
      for (const task of tasks) {
        if (String(task.skill ?? "").toLowerCase() === "listening") {
          rows.push(task as TaskProgressRecord);
        }
      }
    }
    return rows;
  };

  const resolveStartupGateModeForTaskRecord = async (task: TaskProgressRecord) => {
    const progressData = (task.progressData ?? {}) as Record<string, any>;
    const locked = String(progressData?.rolloutState?.assignedMode ?? "").trim();
    if (locked === "legacy" || locked === "section_ready") {
      return locked as ListeningStartupGateMode;
    }
    const assignedMode = resolveStartupGateModeForIdentity({
      taskProgressId: task.id,
      userId: task.userId,
    });
    const nextProgressData = {
      ...progressData,
      rolloutState: {
        ...(progressData.rolloutState ?? {}),
        assignedMode,
        assignedAt: new Date().toISOString(),
        cohortPercent: getEffectiveRolloutPercent(),
        cohortSeed: getEffectiveRolloutSeed(),
      },
    };
    await storage.updateTaskProgress(task.id, { progressData: nextProgressData });
    task.progressData = nextProgressData;
    return assignedMode;
  };

  // Signed audio proxy endpoint for signed delivery mode.
  app.options('/api/listening/audio/signed', (_req: any, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Range');
    return res.status(204).send();
  });

  app.get('/api/listening/audio/signed', async (req: any, res) => {
    const token = typeof req.query?.token === 'string' ? req.query.token : '';
    if (!token) {
      return res.status(400).json({ success: false, message: 'token is required' });
    }

    const redirectUrl = resolveSignedAudioProxyRedirect(token);
    if (!redirectUrl) {
      return res.status(403).json({ success: false, message: 'invalid_or_expired_token' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Location');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    return res.redirect(302, redirectUrl);
  });

  // Auth user endpoint (Firebase auth with dev override)
  app.get('/api/auth/user', verifyAuthWithDevOverride, ensureFirebaseUser, (req: any, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    return res.status(200).json(user);
  });

  app.get('/api/listening/tts/health', verifyFirebaseAuth, ensureFirebaseUser, async (_req: any, res) => {
    try {
      const health = await getTtsProviderHealth();
      const statusCode = health.ok ? 200 : 503;
      return res.status(statusCode).json({
        success: health.ok,
        health,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error?.message ?? 'Failed to evaluate TTS health',
      });
    }
  });

  // =====================================================================
  // Task Progress API Endpoints
  // =====================================================================
  
  // Get task progress for a weekly plan (Firebase Auth version)
  app.get('/api/firebase/task-progress/weekly-plan/:weeklyPlanId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { weeklyPlanId } = req.params;
      
      console.log(`[Task Progress API] GET task progress by weekly plan: ${weeklyPlanId} for user ${userId}`);
      
      // Fetch the weekly plan first to verify user has access
      const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
      
      if (!weeklyPlan) {
        return res.status(404).json({
          success: false,
          message: "Weekly plan not found"
        });
      }
      
      // Ensure the user owns this weekly plan
      if (weeklyPlan.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this weekly plan"
        });
      }
      
      // Get all task progress records for this weekly plan
      const taskProgressRecords = await storage.getTaskProgressByWeeklyPlan(weeklyPlanId, userId);
      
      console.log(`[Task Progress API] Found ${taskProgressRecords.length} task progress records for weekly plan ${weeklyPlanId}`);
      
      const ensuredRecords = await ensureSegmentsForTasks(taskProgressRecords);
      return res.status(200).json({
        success: true,
        taskProgress: ensuredRecords
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error fetching task progress by weekly plan:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch task progress',
        message: error.message
      });
    }
  });
  
  // Create a task progress record (Firebase Auth version)
  app.post('/api/firebase/task-progress', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { weeklyPlanId, weekNumber, dayNumber, taskTitle } = req.body;
      
      // Enhanced debugging logs for task creation
      console.log('[Task Progress API] POST task progress request:', {
        endpoint: '/api/firebase/task-progress',
        method: 'POST',
        userId,
        weeklyPlanId,
        weekNumber,
        dayNumber,
        taskTitle: taskTitle ? (typeof taskTitle === 'string' ? taskTitle.substring(0, 30) + '...' : 'non-string') : 'missing'
      });
      
      // Validate required fields
      if (!weeklyPlanId || !weekNumber || dayNumber === undefined || !taskTitle) {
        console.error('[Task Progress API] Missing required fields:', {
          weeklyPlanId: !!weeklyPlanId,
          weekNumber: !!weekNumber,
          dayNumber: dayNumber !== undefined,
          taskTitle: !!taskTitle
        });
        
        return res.status(400).json({
          success: false,
          message: "Missing required fields: weeklyPlanId, weekNumber, dayNumber, taskTitle are required"
        });
      }
      
      // Validate weekly plan exists before creating progress
      const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
      
      if (!weeklyPlan) {
        console.error('[Task Progress API] Weekly plan not found:', { weeklyPlanId });
        return res.status(404).json({
          success: false,
          message: "Weekly plan not found. Cannot create task progress for non-existent plan."
        });
      }
      
      // Check if a task progress record already exists
      const existingProgress = await storage.getTaskProgressByUserAndTask(
        userId,
        weekNumber,
        dayNumber
      );
      
      if (existingProgress) {
        console.log('[Task Progress API] Existing progress found:', {
          id: existingProgress.id,
          status: existingProgress.status
        });
        
        return res.status(200).json({
          success: true,
          message: "Task progress record already exists",
          taskProgress: existingProgress
        });
      }
      
      // Create a new task progress record
      const taskProgressData = {
        id: uuidv4(),
        userId,
        weeklyPlanId,
        weekNumber,
        dayNumber,
        taskTitle,
        status: 'not-started',
        progressData: null,
        startedAt: null,
        completedAt: null,
      };
      
      const createdTaskProgress = await storage.createTaskProgress(taskProgressData);
      
      console.log('[Task Progress API] Task progress created successfully:', {
        id: createdTaskProgress.id,
        status: createdTaskProgress.status
      });
      
      return res.status(201).json({
        success: true,
        message: "Task progress record created successfully",
        taskProgress: createdTaskProgress
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error creating task progress:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to create task progress record"
      });
    }
  });

  app.post('/api/task-progress/start', verifyAuthWithDevOverride, ensureFirebaseUser, async (req: any, res) => {
    const parseMinutes = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.round(value);
      }

      if (typeof value === 'string') {
        const match = value.match(/(\d+(\.\d+)?)/);
        if (match) {
          const parsed = Number(match[1]);
          if (Number.isFinite(parsed) && parsed > 0) {
            return Math.round(parsed);
          }
        }
      }

      return null;
    };

    try {
      const userId = req.user.id;
      const {
        weeklyPlanId,
        weekNumber,
        dayNumber,
        skill = 'listening',
        taskTitle,
        planEntry,
      } = req.body ?? {};

      console.log('[START][server] auth header present?', Boolean(req.headers.authorization));

      if (!weeklyPlanId || typeof weeklyPlanId !== 'string') {
        return res.status(400).json({ message: 'weeklyPlanId is required' });
      }

      if (typeof dayNumber !== 'number' || Number.isNaN(dayNumber)) {
        return res.status(400).json({ message: 'dayNumber is required' });
      }

      const normalizedTitle = typeof taskTitle === 'string' ? taskTitle.trim() : '';
      if (!normalizedTitle) {
        return res.status(400).json({ message: 'taskTitle is required' });
      }

      const normalizedSkill = typeof skill === 'string' ? skill.toLowerCase() : 'listening';

      const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
      if (!weeklyPlan) {
        return res.status(404).json({ message: 'Weekly plan not found' });
      }

      if (weeklyPlan.userId !== userId) {
        return res.status(403).json({ message: 'You do not have access to this weekly plan' });
      }

      const resolvedWeekNumber =
        typeof weekNumber === 'number' && Number.isFinite(weekNumber)
          ? weekNumber
          : weeklyPlan.weekNumber;

      const existing = await storage.findTaskProgressByScope({
        userId,
        weeklyPlanId,
        dayNumber,
        taskTitle: normalizedTitle,
        skill: normalizedSkill,
      });

      if (existing) {
        const durationMinutes = resolveSessionMinutesFromTask(existing, DEFAULT_SESSION_MINUTES);
        const currentData = (existing.progressData ?? {}) as Record<string, any>;
        const planAccent = typeof planEntry?.accent === 'string' ? planEntry.accent : undefined;
        const resolvedAccent = normalizeAccent(
          planAccent ??
            (currentData.segments?.[0]?.accent as string | undefined) ??
            existing.accent ??
            DEFAULT_ACCENT,
        );
        const ensuredSegments = ensureListeningSegments(currentData.segments, durationMinutes, {
          baseTitle: normalizedTitle,
          accent: resolvedAccent,
        });

        const segmentsNeedingUpdate =
          !Array.isArray(currentData.segments) ||
          currentData.segments.length !== ensuredSegments.length ||
          ensuredSegments.some((seg, idx) => {
            const existingSeg = currentData.segments?.[idx];
            if (!existingSeg) return true;
            if (!existingSeg.accent || !existingSeg.voiceId) return true;
            if (typeof existingSeg.estimatedDurationSec !== 'number') return true;
            return false;
          });
        const updated = {
          ...currentData,
          sessionDurationMinutes: durationMinutes,
          segments: ensuredSegments,
        };

        if (segmentsNeedingUpdate || existing.duration !== durationMinutes) {
          await storage.updateTaskProgress(existing.id, {
            duration: durationMinutes,
            progressData: updated,
          });
        }
        existing.progressData = updated;
        console.log(
          `[TaskProgress] start: user=${userId} plan=${weeklyPlanId} day=${dayNumber} title=\"${normalizedTitle}\" id=${existing.id}`,
        );
        return res.status(200).json({
          id: existing.id,
          duration: durationMinutes,
          progressData: existing.progressData ?? null,
        });
      }

      const dayType = determineDayType({
        dayNumber,
        explicit: planEntry?.dayType,
        assignedDate: planEntry?.assignedDate,
      });

      const planProgressData =
        planEntry && typeof planEntry.progressData === 'object'
          ? planEntry.progressData
          : undefined;

      const planDurationMinutes =
        parseMinutes(planEntry?.durationMinutes) ??
        parseMinutes(planEntry?.duration) ??
        parseMinutes(planEntry?.sessionMinutes);

      const planTaskStub =
        planProgressData || planDurationMinutes
          ? ({
              duration: planDurationMinutes ?? undefined,
              progressData: planProgressData,
            } as any)
          : undefined;

      let sessionMinutes = resolveSessionMinutesFromTask(planTaskStub, 0);

      const studyPlans = await storage.getStudyPlansByUserId(userId);
      const latestPlan = studyPlans.length > 0 ? studyPlans[studyPlans.length - 1] : null;
      const normalizedPreferences = normalizeStudyPreferences(
        (latestPlan?.studyPreferences as Record<string, any>) ?? undefined,
      );

      const preferenceMinutes =
        dayType === 'weekend'
          ? normalizedPreferences.listeningDurations.weekend
          : normalizedPreferences.listeningDurations.weekday;

      if (!sessionMinutes || sessionMinutes <= 0) {
        sessionMinutes = preferenceMinutes && preferenceMinutes > 0 ? preferenceMinutes : DEFAULT_SESSION_MINUTES;
      }
      sessionMinutes = Math.max(sessionMinutes, LISTENING_SESSION_MINUTES);

      const planAccent = typeof planEntry?.accent === 'string' ? planEntry.accent : undefined;
      const resolvedAccent = normalizeAccent(planAccent ?? DEFAULT_ACCENT);
      const segments = ensureListeningSegments(planProgressData?.segments, sessionMinutes, {
        baseTitle: normalizedTitle,
        accent: resolvedAccent,
      });

      const progressData: Record<string, any> = {
        ...(planProgressData ?? {}),
        sessionDurationMinutes: sessionMinutes,
        segments,
      };

      progressData.sessionPrefetch = {
        ...(progressData.sessionPrefetch ?? {}),
        dayType,
        source: 'start-endpoint',
        sessionMinutes,
        assignedDate: planEntry?.assignedDate ?? null,
        accent: resolvedAccent,
      };

      const newProgress = await storage.createTaskProgress({
        id: uuidv4(),
        userId,
        weeklyPlanId,
        weekNumber: resolvedWeekNumber,
        dayNumber,
        taskTitle: normalizedTitle,
        skill: normalizedSkill,
        accent: resolvedAccent,
        status: 'in-progress',
        progressData,
        duration: sessionMinutes,
        startedAt: new Date(),
      });

      console.log(
        `[TaskProgress] start: user=${userId} plan=${weeklyPlanId} day=${dayNumber} title="${normalizedTitle}" id=${newProgress.id}`,
      );

      return res.status(201).json({
        id: newProgress.id,
        duration: sessionMinutes,
        progressData,
      });
    } catch (error: any) {
      console.error('[TaskProgress] Error starting task progress:', error);
      return res.status(500).json({
        message: 'Failed to start task progress',
        error: error?.message ?? 'unknown_error',
      });
    }
  });

  app.post('/api/task-progress/:id/segment/:segmentId/submit', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id, segmentId } = req.params;
      const { answers } = req.body ?? {};

      if (!Array.isArray(answers)) {
        return res.status(400).json({ message: 'answers array is required' });
      }

      const task = await storage.getTaskProgress(id);
      if (!task) {
        return res.status(404).json({ message: 'Task progress not found' });
      }
      if (task.userId !== userId) {
        return res.status(403).json({ message: 'Access denied for this task' });
      }

      let progressData = (task.progressData ?? {}) as Record<string, any>;
      const segments = Array.isArray(progressData.segments) ? progressData.segments : [];
      if (!segments.length) {
        return res.status(400).json({ message: 'No segment metadata found for this task' });
      }

      const segment = segments.find((seg: any, idx: number) => seg?.id === segmentId || String(idx) === segmentId);
      if (!segment) {
        return res.status(404).json({ message: 'Segment not found on this task' });
      }

      const { assignments, changed } = deriveSegmentAssignments(task);
      await ensureSegmentOrder(task, assignments);
      progressData = (task.progressData ?? progressData) as Record<string, any>;
      const questionIds: string[] = assignments[segment.id] ?? [];
      if (!questionIds.length) {
        return res.status(400).json({ message: 'No questions mapped to this segment yet' });
      }

      const rawQuestions = Array.isArray(task.questions) ? task.questions : [];
      const mapById = new Map(rawQuestions.map((q: any, index: number) => [String(q?.id ?? `q${index + 1}`), q]));
      const segmentQuestions = questionIds
        .map((qid) => mapById.get(String(qid)))
        .filter(Boolean) as TaskQuestion[];

      if (!segmentQuestions.length) {
        return res.status(400).json({ message: 'Segment question bank missing' });
      }

      const segmentAnswers = questionIds.map((questionId: string) => {
        const response = answers.find((a: any) => String(a?.questionId) === String(questionId));
        return {
          questionId: String(questionId),
          choiceId: response?.choiceId ?? response?.pickedOptionId ?? null,
        };
      });
      const answerPayloadByQuestionId = new Map<string, Record<string, any>>();
      answers.forEach((answer: any) => {
        const questionId = String(answer?.questionId ?? "");
        if (!questionId) return;
        answerPayloadByQuestionId.set(questionId, answer);
      });

      const scored = scoreSegment({
        questions: segmentQuestions,
        answers: segmentAnswers,
      });
      const detailByQuestionId = new Map(
        scored.detail.map((detail) => [String(detail.questionId), detail]),
      );
      const questionById = new Map(
        segmentQuestions.map((question, index) => [String(question.id ?? `q${index + 1}`), question]),
      );

      const perQuestionOutcomes = questionIds.map((questionId, index) => {
        const detail = detailByQuestionId.get(String(questionId));
        const payload = answerPayloadByQuestionId.get(String(questionId)) ?? {};
        const question = questionById.get(String(questionId));
        const choiceId = segmentAnswers.find((answer) => String(answer.questionId) === String(questionId))?.choiceId ?? null;
        const answered = typeof choiceId === "string" ? choiceId.trim().length > 0 : Boolean(choiceId);
        const responseTimeMs = Number(payload?.responseTimeMs ?? payload?.timeMs ?? 0);
        const answerChangeCount = Number(payload?.answerChangeCount ?? 0);
        const replayCount = Number(payload?.replayCount ?? payload?.replayCountAtAnswer ?? 0);
        const tags = Array.isArray(question?.tags)
          ? question.tags.map((tag) => String(tag).toLowerCase()).filter(Boolean)
          : [];
        const status = !answered ? "unanswered" : detail?.isCorrect ? "correct" : "incorrect";

        return {
          questionId: String(questionId),
          order: index + 1,
          status,
          correct: Boolean(detail?.isCorrect),
          selectedOptionId: answered && typeof choiceId === "string" ? choiceId : null,
          correctOptionId: detail?.correctOptionId ?? null,
          responseTimeMs: Number.isFinite(responseTimeMs) && responseTimeMs > 0 ? Math.round(responseTimeMs) : null,
          answerChangeCount: Number.isFinite(answerChangeCount) && answerChangeCount > 0 ? Math.round(answerChangeCount) : 0,
          replayCount: Number.isFinite(replayCount) && replayCount > 0 ? Math.round(replayCount) : 0,
          unanswered: !answered,
          challengeTags: tags,
        };
      });

      const nextIndex = segments.findIndex((seg: any) => seg?.id === segment.id) + 1;
      const segmentResults = Array.isArray(progressData.segmentResults)
        ? progressData.segmentResults.filter((res: any) => res?.segmentId !== segment.id)
        : [];
      const submittedAt = new Date().toISOString();
      const attempted = perQuestionOutcomes.filter((item) => item.status !== "unanswered").length;
      const unanswered = perQuestionOutcomes.filter((item) => item.status === "unanswered").length;
      const incorrect = Math.max(0, attempted - scored.correct);
      const accuracy = scored.total ? Number(((scored.correct / scored.total) * 100).toFixed(2)) : 0;
      const responseTimes = perQuestionOutcomes
        .map((item) => Number(item.responseTimeMs ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0);
      const totalResponseMs = responseTimes.reduce((sum, value) => sum + value, 0);
      const timingSummary = {
        totalResponseMs,
        averageResponseMs: responseTimes.length ? Math.round(totalResponseMs / responseTimes.length) : null,
        maxResponseMs: responseTimes.length ? Math.max(...responseTimes) : null,
        sectionElapsedMs:
          typeof req.body?.sectionElapsedMs === "number" && req.body.sectionElapsedMs > 0
            ? Math.round(req.body.sectionElapsedMs)
            : null,
      };
      const sectionNo = Number(
        segment?.ieltsPart ??
          segment?.segmentNo ??
          segments.findIndex((seg: any) => seg?.id === segment.id) + 1,
      );
      const sectionResult = {
        version: LISTENING_TELEMETRY_SCHEMA_VERSION,
        sectionId: String(segment.id),
        sectionNo: Number.isFinite(sectionNo) && sectionNo > 0 ? sectionNo : 1,
        submittedAt,
        acknowledged: false,
        acknowledgedAt: null,
        attempted,
        correct: scored.correct,
        incorrect,
        unanswered,
        accuracy,
        challengeTags: scored.mistakeTags,
        tagStats: scored.tagStats,
        timingSummary,
        perQuestion: perQuestionOutcomes,
      };
      const sectionResults = Array.isArray(progressData.sectionResults)
        ? progressData.sectionResults.filter((result: any) => String(result?.sectionId ?? "") !== String(segment.id))
        : [];
      sectionResults.push(sectionResult);
      const attemptTelemetry = (progressData.attemptTelemetry ?? {}) as Record<string, any>;
      const attemptEvents = Array.isArray(attemptTelemetry.events) ? [...attemptTelemetry.events] : [];
      const rolloutState = (progressData.rolloutState ?? {}) as Record<string, any>;
      const rolloutMode = String(
        rolloutState.assignedMode ??
          resolveStartupGateModeForIdentity({ taskProgressId: task.id, userId: task.userId }),
      );
      attemptEvents.push({
        at: submittedAt,
        eventType: "section_submitted",
        sectionId: String(segment.id),
        sectionNo: sectionResult.sectionNo,
        attempted,
        correct: scored.correct,
        incorrect,
        unanswered,
        answerChanges: perQuestionOutcomes.reduce((sum, item) => sum + Number(item.answerChangeCount ?? 0), 0),
        replayCount: perQuestionOutcomes.reduce((sum, item) => sum + Number(item.replayCount ?? 0), 0),
        timingSummary,
        rollout: {
          mode: rolloutMode,
          percent: getEffectiveRolloutPercent(),
          seed: getEffectiveRolloutSeed(),
          forceRollback: isForceRollbackEnabled(),
        },
      });

      segmentResults.push({
        segmentId: segment.id,
        correct: scored.correct,
        total: scored.total,
        mistakeTags: scored.mistakeTags,
        tagStats: scored.tagStats,
        attempted,
        incorrect,
        unanswered,
        accuracy,
        timingSummary,
        submittedAt,
      });

      const aggregation = buildListeningAnalyticsAggregation({
        sectionResults: sectionResults.slice(-LISTENING_SECTION_RESULTS_MAX),
        schemaVersion: LISTENING_TELEMETRY_SCHEMA_VERSION,
        source: "segment_submit",
        previousAggregation: (progressData.analyticsAggregation ?? {}) as Record<string, any>,
      });
      const updatedProgressData = applyListeningTelemetryRetention({
        ...progressData,
        segmentResults,
        sectionResults: sectionResults.slice(-LISTENING_SECTION_RESULTS_MAX),
        segmentAssignments: assignments,
        analytics: aggregation.analytics,
        analyticsAggregation: aggregation.aggregation,
        sectionResultState: {
          pendingSectionId: String(segment.id),
          updatedAt: submittedAt,
        },
        attemptTelemetry: {
          ...attemptTelemetry,
          version: LISTENING_TELEMETRY_SCHEMA_VERSION,
          events: attemptEvents.slice(-LISTENING_TELEMETRY_MAX_EVENTS),
        },
      });

      await storage.updateTaskProgress(id, {
        progressData: updatedProgressData,
        status: 'in-progress',
      });
      markListeningTelemetryTask(id);

      return res.status(200).json({
        success: true,
        segmentId: segment.id,
        sectionId: sectionResult.sectionId,
        sectionNo: sectionResult.sectionNo,
        attempted,
        correct: scored.correct,
        incorrect,
        unanswered,
        total: scored.total,
        percent: scored.total ? Math.round((scored.correct / scored.total) * 100) : 0,
        accuracy,
        timingSummary,
        mistakeTags: scored.mistakeTags,
        tagStats: scored.tagStats,
        challengeTags: scored.mistakeTags,
        questionOutcomes: perQuestionOutcomes,
        sectionResult,
        nextSegmentIndex: Math.min(nextIndex, segments.length),
        updatedAssignments: changed ? assignments : undefined,
      });
    } catch (error: any) {
      console.error('[TaskProgress][segmentSubmit] error', error);
      return res.status(500).json({
        success: false,
        message: error?.message ?? 'Failed to submit segment answers',
      });
    }
  });

  app.post('/api/task-progress/:id/segment/:segmentId/acknowledge', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id, segmentId } = req.params;
      const task = await storage.getTaskProgress(id);
      if (!task) {
        return res.status(404).json({ success: false, message: "Task progress not found" });
      }
      if (task.userId !== userId) {
        return res.status(403).json({ success: false, message: "Access denied for this task" });
      }

      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const sectionResults = Array.isArray(progressData.sectionResults)
        ? progressData.sectionResults
        : [];
      if (!sectionResults.length) {
        return res.status(404).json({ success: false, message: "No section result found to acknowledge" });
      }

      const nowIso = new Date().toISOString();
      let found = false;
      const nextSectionResults = sectionResults.map((result: any) => {
        if (String(result?.sectionId ?? "") !== String(segmentId)) {
          return result;
        }
        found = true;
        return {
          ...result,
          acknowledged: true,
          acknowledgedAt: nowIso,
        };
      });
      if (!found) {
        return res.status(404).json({ success: false, message: "Section result not found" });
      }

      const retained = applyListeningTelemetryRetention({
        ...progressData,
        sectionResults: nextSectionResults,
        sectionResultState: {
          ...(progressData.sectionResultState ?? {}),
          pendingSectionId:
            String((progressData.sectionResultState ?? {}).pendingSectionId ?? "") === String(segmentId)
              ? null
              : (progressData.sectionResultState ?? {}).pendingSectionId ?? null,
          updatedAt: nowIso,
        },
      });
      await storage.updateTaskProgress(id, { progressData: retained });
      markListeningTelemetryTask(id);

      return res.status(200).json({
        success: true,
        sectionId: String(segmentId),
        acknowledgedAt: nowIso,
      });
    } catch (error: any) {
      console.error("[TaskProgress][segmentAcknowledge] error", error);
      return res.status(500).json({
        success: false,
        message: error?.message ?? "Failed to acknowledge section result",
      });
    }
  });

  app.post('/api/task-progress/:id/finalize', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const mixedAnswers = Array.isArray(req.body?.answers) ? req.body.answers : [];
      const task = await storage.getTaskProgress(id);
      if (!task) {
        return res.status(404).json({ message: 'Task progress not found' });
      }
      if (task.userId !== userId) {
        return res.status(403).json({ message: 'Access denied for this task' });
      }

      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const segmentResults = Array.isArray(progressData.segmentResults) ? progressData.segmentResults : [];
      let totals = { correct: 0, total: 0 };
      let scorePercent = 0;
      let histogram: Record<string, { correct: number; total: number }> = {};
      let mixedEngineOutcomes: any[] | null = null;

      const contract = resolveListeningQuestionContract(task as any);
      const canUseMixedScoring = contract.ok && mixedAnswers.length > 0;
      const rendererMode = deriveRendererMode({
        requested: req.body?.rendererMode,
        fallbackDualEnabled: LISTENING_RENDERER_DUAL_MODE,
        mixedScoring: canUseMixedScoring,
      });
      if (canUseMixedScoring) {
        const mixed = scoreMixedEngineAttempt({
          answerKey: contract.answerKey,
          answers: mixedAnswers.map((answer: any) => ({
            question_id: String(answer?.question_id ?? ""),
            value: answer?.value ?? null,
          })),
        });
        totals = { correct: mixed.correct, total: mixed.total };
        scorePercent = mixed.percent;
        histogram = mixed.histogram;
        mixedEngineOutcomes = mixed.outcomes;
      } else {
        if (!segmentResults.length) {
          return res.status(400).json({ message: 'No segment submissions to finalize' });
        }
        histogram = buildMistakeHistogram(segmentResults);
        totals = segmentResults.reduce(
          (acc, seg) => {
            acc.correct += Number(seg.correct ?? 0);
            acc.total += Number(seg.total ?? 0);
            return acc;
          },
          { correct: 0, total: 0 },
        );
        scorePercent = totals.total ? Math.round((totals.correct / totals.total) * 100) : 0;
      }

      const recentSessions = await getRecentListeningSummaries(storage, userId, 5);
      const feedback = buildSessionFeedback({
        histogram,
        recentSessions: recentSessions.filter((session) => session.taskId !== task.id),
      });

      const sessionSummary = {
        scorePercent,
        strengths: feedback.strengths,
        focusNext: feedback.focusNext,
        mistakeHistogram: histogram,
        updatedAt: new Date().toISOString(),
        correct: totals.correct,
        total: totals.total,
        trend: feedback.trend,
      };

      const sectionResults = Array.isArray(progressData.sectionResults) ? progressData.sectionResults : [];
      const aggregation = buildListeningAnalyticsAggregation({
        sectionResults,
        schemaVersion: LISTENING_TELEMETRY_SCHEMA_VERSION,
        source: "finalize",
        previousAggregation: (progressData.analyticsAggregation ?? {}) as Record<string, any>,
      });
      const analytics = aggregation.analytics;
      const updatedProgressData = applyListeningTelemetryRetention({
        ...applyRendererTelemetryUpdate(progressData, {
          mode: rendererMode,
          completionAttempt: true,
          completed: true,
          taskProgressId: id,
        }),
        segmentResults,
        sessionSummary,
        sectionResults,
        sectionResultState: {
          ...(progressData.sectionResultState ?? {}),
          pendingSectionId: null,
          updatedAt: new Date().toISOString(),
        },
        analytics,
        analyticsAggregation: aggregation.aggregation,
        mixedEngineOutcomes: mixedEngineOutcomes ?? progressData.mixedEngineOutcomes ?? null,
      });

      const finalizedTask = await storage.updateTaskProgress(id, {
        progressData: updatedProgressData,
        status: 'completed',
        completedAt: new Date(),
      });
      await recordGovernanceLedgerEntry({
        taskProgressId: finalizedTask.id,
        userId: finalizedTask.userId,
        sectionId: finalizedTask.id,
        sectionNo: Number(((finalizedTask.progressData ?? {}) as any)?.sessionOrder ?? 1),
        sessionId: String(((finalizedTask.progressData ?? {}) as any)?.sessionBatchId ?? finalizedTask.id),
        attemptId: String(req.body?.attemptId ?? `finalize:${finalizedTask.id}`),
        policyVersion: getListeningGovernancePolicyInfo().policyVersion,
        validatorSetVersion: getListeningGovernancePolicyInfo().validatorSetVersion,
        validationVerdict: "PASS",
        actionType: "SESSION_FINALIZED",
        actorId: userId,
        actorType: "api",
        traceId: req.header("x-trace-id") ?? null,
        correlationId: req.header("x-correlation-id") ?? null,
      });
      markListeningTelemetryTask(id);

      let performanceCoach: any = null;
      try {
        const coachAttemptId =
          String(req.body?.attemptId ?? "").trim() ||
          `finalize:${task.id}:${new Date(sessionSummary.updatedAt).getTime()}`;
        const coachAnalysis = await buildListeningPerformanceAnalysis({
          task: finalizedTask,
          attemptId: coachAttemptId,
          score: {
            correct: totals.correct,
            total: totals.total,
            percent: scorePercent,
          },
          outcomes: buildCoachOutcomesFromSectionResults(sectionResults),
        });
        await persistListeningPerformanceAnalysis({
          task: finalizedTask,
          analysis: coachAnalysis,
        });
        await publishListeningPerformanceCoachEvents({
          task: finalizedTask,
          analysis: coachAnalysis,
          traceId: req.header("x-trace-id") ?? undefined,
          correlationId: req.header("x-correlation-id") ?? undefined,
        });
        const coachReviewQueueId = await enqueueCoachGovernanceReviewIfNeeded({
          task: finalizedTask as TaskProgressRecord,
          analysis: coachAnalysis,
          actorId: userId,
          attemptId: coachAttemptId,
          traceId: req.header("x-trace-id") ?? null,
          correlationId: req.header("x-correlation-id") ?? null,
        });
        performanceCoach = coachReviewQueueId
          ? {
              ...coachAnalysis,
              review_queue_id: coachReviewQueueId,
            }
          : coachAnalysis;
      } catch (coachError: any) {
        console.error("[TaskProgress][finalize][PerformanceCoach] error", {
          taskId: id,
          message: coachError?.message ?? "unknown",
        });
      }

      return res.status(200).json({
        success: true,
        scorePercent,
        strengths: feedback.strengths,
        focusNext: feedback.focusNext,
        trend: feedback.trend,
        analytics,
        performanceCoach,
      });
    } catch (error: any) {
      console.error('[TaskProgress][finalize] error', error);
      return res.status(500).json({
        success: false,
        message: error?.message ?? 'Failed to finalize session',
      });
    }
  });

  app.post('/api/task-progress/:id/finalize-mixed', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
      const task = await storage.getTaskProgress(id);
      if (!task) {
        return res.status(404).json({ message: 'Task progress not found' });
      }
      if (task.userId !== userId) {
        return res.status(403).json({ message: 'Access denied for this task' });
      }

      const contract = resolveListeningQuestionContract(task as any);
      if (!contract.ok) {
        return res.status(400).json({ message: contract.error });
      }

      const scored = scoreMixedEngineAttempt({
        answerKey: contract.answerKey,
        answers: answers.map((answer: any) => ({
          question_id: String(answer?.question_id ?? ""),
          value: answer?.value ?? null,
        })),
      });

      const recentSessions = await getRecentListeningSummaries(storage, userId, 5);
      const feedback = buildSessionFeedback({
        histogram: scored.histogram,
        recentSessions: recentSessions.filter((session) => session.taskId !== task.id),
      });

      const sessionSummary = {
        scorePercent: scored.percent,
        strengths: feedback.strengths,
        focusNext: feedback.focusNext,
        mistakeHistogram: scored.histogram,
        updatedAt: new Date().toISOString(),
        correct: scored.correct,
        total: scored.total,
        trend: feedback.trend,
      };

      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const rendererMode = deriveRendererMode({
        requested: req.body?.rendererMode,
        fallbackDualEnabled: true,
        mixedScoring: true,
      });
      const sectionResults = Array.isArray(progressData.sectionResults) ? progressData.sectionResults : [];
      const aggregation = buildListeningAnalyticsAggregation({
        sectionResults,
        schemaVersion: LISTENING_TELEMETRY_SCHEMA_VERSION,
        source: "finalize_mixed",
        previousAggregation: (progressData.analyticsAggregation ?? {}) as Record<string, any>,
      });
      const analytics = aggregation.analytics;
      const updatedProgressData = applyListeningTelemetryRetention({
        ...applyRendererTelemetryUpdate(progressData, {
          mode: rendererMode,
          completionAttempt: true,
          completed: true,
          taskProgressId: id,
        }),
        sessionSummary,
        sectionResults,
        sectionResultState: {
          ...(progressData.sectionResultState ?? {}),
          pendingSectionId: null,
          updatedAt: new Date().toISOString(),
        },
        analytics,
        analyticsAggregation: aggregation.aggregation,
        mixedEngineOutcomes: scored.outcomes,
      });

      const finalizedTask = await storage.updateTaskProgress(id, {
        progressData: updatedProgressData,
        status: 'completed',
        completedAt: new Date(),
      });
      await recordGovernanceLedgerEntry({
        taskProgressId: finalizedTask.id,
        userId: finalizedTask.userId,
        sectionId: finalizedTask.id,
        sectionNo: Number(((finalizedTask.progressData ?? {}) as any)?.sessionOrder ?? 1),
        sessionId: String(((finalizedTask.progressData ?? {}) as any)?.sessionBatchId ?? finalizedTask.id),
        attemptId: String(req.body?.attemptId ?? `finalize-mixed:${finalizedTask.id}`),
        policyVersion: getListeningGovernancePolicyInfo().policyVersion,
        validatorSetVersion: getListeningGovernancePolicyInfo().validatorSetVersion,
        validationVerdict: "PASS",
        actionType: "SESSION_FINALIZED_MIXED",
        actorId: userId,
        actorType: "api",
        traceId: req.header("x-trace-id") ?? null,
        correlationId: req.header("x-correlation-id") ?? null,
      });
      markListeningTelemetryTask(id);

      let performanceCoach: any = null;
      try {
        const coachAttemptId =
          String(req.body?.attemptId ?? "").trim() ||
          `finalize-mixed:${task.id}:${new Date(sessionSummary.updatedAt).getTime()}`;
        const mixedOutcomeMap = new Map(
          scored.outcomes.map((outcome) => [String(outcome.questionId), outcome]),
        );
        const sectionOutcomeRows = buildCoachOutcomesFromSectionResults(sectionResults);
        const fallbackOutcomeRows =
          sectionOutcomeRows.length > 0
            ? sectionOutcomeRows
            : scored.outcomes.map((outcome) => ({
                questionId: String(outcome.questionId),
                isCorrect: Boolean(outcome.isCorrect),
                responseTimeMs: null,
                answerChangeCount: 0,
                replayCount: 0,
                unanswered: !Boolean(outcome.isCorrect),
              }));
        const mergedOutcomes = fallbackOutcomeRows.map((row) => {
          const mixed = mixedOutcomeMap.get(String(row.questionId));
          if (!mixed) return row;
          return {
            ...row,
            isCorrect: Boolean(mixed.isCorrect),
            unanswered: !Boolean(mixed.isCorrect),
          };
        });

        const coachAnalysis = await buildListeningPerformanceAnalysis({
          task: finalizedTask,
          attemptId: coachAttemptId,
          score: {
            correct: scored.correct,
            total: scored.total,
            percent: scored.percent,
          },
          outcomes: mergedOutcomes,
        });
        await persistListeningPerformanceAnalysis({
          task: finalizedTask,
          analysis: coachAnalysis,
        });
        await publishListeningPerformanceCoachEvents({
          task: finalizedTask,
          analysis: coachAnalysis,
          traceId: req.header("x-trace-id") ?? undefined,
          correlationId: req.header("x-correlation-id") ?? undefined,
        });
        const coachReviewQueueId = await enqueueCoachGovernanceReviewIfNeeded({
          task: finalizedTask as TaskProgressRecord,
          analysis: coachAnalysis,
          actorId: userId,
          attemptId: coachAttemptId,
          traceId: req.header("x-trace-id") ?? null,
          correlationId: req.header("x-correlation-id") ?? null,
        });
        performanceCoach = coachReviewQueueId
          ? {
              ...coachAnalysis,
              review_queue_id: coachReviewQueueId,
            }
          : coachAnalysis;
      } catch (coachError: any) {
        console.error("[TaskProgress][finalize-mixed][PerformanceCoach] error", {
          taskId: id,
          message: coachError?.message ?? "unknown",
        });
      }

      return res.status(200).json({
        success: true,
        scorePercent: scored.percent,
        strengths: feedback.strengths,
        focusNext: feedback.focusNext,
        trend: feedback.trend,
        analytics,
        performanceCoach,
      });
    } catch (error: any) {
      console.error('[TaskProgress][finalizeMixed] error', error);
      return res.status(500).json({
        success: false,
        message: error?.message ?? 'Failed to finalize mixed-engine session',
      });
    }
  });

  app.post('/api/task-progress/:id/analytics/rebuild', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const task = await storage.getTaskProgress(id);
      if (!task) {
        return res.status(404).json({ success: false, message: 'Task progress not found' });
      }
      if (task.userId !== userId) {
        return res.status(403).json({ success: false, message: 'Access denied for this task' });
      }
      if (String(task.skill ?? "").toLowerCase() !== "listening") {
        return res.status(400).json({ success: false, message: 'Analytics rebuild is available for listening tasks only' });
      }

      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const sectionResults = Array.isArray(progressData.sectionResults) ? progressData.sectionResults : [];
      const aggregation = buildListeningAnalyticsAggregation({
        sectionResults,
        schemaVersion: LISTENING_TELEMETRY_SCHEMA_VERSION,
        source: "manual_rebuild",
        previousAggregation: (progressData.analyticsAggregation ?? {}) as Record<string, any>,
      });
      const analytics = aggregation.analytics;
      const rebuiltAt = new Date().toISOString();
      const retained = applyListeningTelemetryRetention({
        ...progressData,
        analytics,
        analyticsAggregation: aggregation.aggregation,
      });

      await storage.updateTaskProgress(id, {
        progressData: retained,
      });
      markListeningTelemetryTask(id);

      return res.status(200).json({
        success: true,
        analytics,
        aggregation: aggregation.aggregation,
        skipped: aggregation.skipped,
        rebuiltAt,
        sectionCount: sectionResults.length,
      });
    } catch (error: any) {
      console.error('[TaskProgress][analytics-rebuild] error', error);
      return res.status(500).json({
        success: false,
        message: error?.message ?? 'Failed to rebuild analytics',
      });
    }
  });

  app.get('/api/task-progress/:id/review', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const task = await storage.getTaskProgress(id);
      if (!task) {
        return res.status(404).json({ message: 'Task progress not found' });
      }
      if (task.userId !== userId) {
        return res.status(403).json({ message: 'Access denied for this task' });
      }

      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const sessionSummary = progressData.sessionSummary ?? null;
      const mixedEngineOutcomes = Array.isArray(progressData.mixedEngineOutcomes)
        ? progressData.mixedEngineOutcomes
        : [];

      return res.status(200).json({
        success: true,
        sessionSummary,
        mixedEngineOutcomes,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error?.message ?? 'Failed to load review data',
      });
    }
  });
  
  // Mark task as in progress (Firebase Auth version)
  app.patch('/api/firebase/task-progress/:id/start', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { progressData } = req.body;
      
      console.log(`[Task Progress API] PATCH start task: ${id} for user ${userId}`);
      
      // Get the task progress record
      const taskProgressRecord = await storage.getTaskProgress(id);
      
      if (!taskProgressRecord) {
        return res.status(404).json({
          success: false,
          message: "Task progress record not found"
        });
      }
      
      // Ensure the user owns this task progress record
      if (taskProgressRecord.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this task progress record"
        });
      }
      
      // Mark the task as in progress
      const updatedTaskProgress = await storage.markTaskAsInProgress(id, progressData);
      const ensured = await ensureSegmentsForTaskProgress(updatedTaskProgress);
      
      console.log('[Task Progress API] Task successfully marked as in progress:', {
        id: updatedTaskProgress.id,
        status: updatedTaskProgress.status
      });
      
      return res.status(200).json({
        success: true,
        message: "Task marked as in progress",
        taskProgress: ensured
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error marking task as in progress:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to mark task as in progress"
      });
    }
  });
  
  // Mark task as completed (Firebase Auth version)
  app.patch('/api/firebase/task-progress/:id/complete', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      
      console.log(`[Task Progress API] PATCH complete task: ${id} for user ${userId}`);
      
      // Get the task progress record
      const taskProgressRecord = await storage.getTaskProgress(id);
      
      if (!taskProgressRecord) {
        return res.status(404).json({
          success: false,
          message: "Task progress record not found"
        });
      }
      
      // Ensure the user owns this task progress record
      if (taskProgressRecord.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this task progress record"
        });
      }
      
      // Mark the task as completed
      const updatedTaskProgress = await storage.markTaskAsCompleted(id);
      const ensured = await ensureSegmentsForTaskProgress(updatedTaskProgress);
      
      return res.status(200).json({
        success: true,
        message: "Task marked as completed",
        taskProgress: ensured
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error marking task as completed:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to mark task as completed"
      });
    }
  });
  
  // Batch initialize task progress records (Firebase Auth version)
  app.post('/api/firebase/task-progress/batch-initialize', verifyFirebaseAuth, ensureFirebaseUser, batchInitializeTaskProgress);
  
  // Generate listening script for a specific task (Firebase Auth version)
  app.post('/api/task/:taskId/generate-script', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskId } = req.params;
      
      logPrivacySafe(
        "[Script Generation API] Generate request",
        {
          taskId,
          userId,
        },
        { nonProdOnly: true },
      );
      
      // Get the task from database
      const task = await storage.getTaskProgress(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }
      
      // Verify task belongs to the authenticated user
      if (task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied - task does not belong to user"
        });
      }
      
      // Check if script already exists to prevent duplicate generation
      if (task.scriptText && task.scriptText.trim().length > 0) {
        return res.status(400).json({
          success: false,
          message: "Script already exists for this task",
          data: {
            hasScript: true,
            scriptLength: task.scriptText.length,
            accent: normalizeAccent(task.accent ?? undefined),
            duration: task.duration
          }
        });
      }
      
      // Get user's onboarding data to determine skill level and target
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      // Get study plan to extract skill ratings and target band
      const studyPlans = await storage.getStudyPlansByUserId(userId);
      const latestPlan = studyPlans[0]; // Assume most recent plan
      
      if (!latestPlan) {
        return res.status(400).json({
          success: false,
          message: "No study plan found - onboarding required"
        });
      }
      
      const skillRatings = latestPlan.skillRatings as Record<string, number>;
      const userLevel = skillRatings?.listening || 1; // Default to 1 if not found
      const targetBand = parseFloat(latestPlan.targetBandScore) || 7; // Default to 7 if not found
      
      logPrivacySafe(
        "[Script Generation API] Learner profile loaded",
        {
          taskId,
          userLevel,
          targetBand,
        },
        { nonProdOnly: true },
      );
      
      // Roadmap C subsystem: blueprint -> segments -> anchors -> continuity.
      // Keep legacy fallback for migration safety.
      const roadmapCResult = await runListeningScriptSubsystem({
        task,
        userLevel,
        targetBand,
        sectionNo: Number(((task.progressData ?? {}) as any)?.sessionOrder ?? 1),
      });

      let scriptResult:
        | {
            success: true;
            scriptText: string;
            accent: string;
            scriptType: string;
            ieltsPart?: number;
            topicDomain?: string;
            contextLabel?: string;
            scenarioOverview?: string;
            estimatedDurationSec?: number;
            difficulty?: string;
          }
        | {
            success: false;
            error?: string;
            errorCode?: string;
            retryable?: boolean;
          };

      if (roadmapCResult.ok) {
        scriptResult = {
          success: true,
          scriptText: roadmapCResult.scriptText,
          accent: task.accent ?? "British",
          scriptType: task.scriptType ?? "dialogue",
          ieltsPart: task.ieltsPart ?? undefined,
          topicDomain: task.topicDomain ?? undefined,
          contextLabel: task.contextLabel ?? undefined,
          scenarioOverview: task.scenarioOverview ?? undefined,
          estimatedDurationSec: roadmapCResult.estimatedDurationSec,
          difficulty: roadmapCResult.difficulty,
        };
      } else {
        const sectionNo = Number(((task.progressData ?? {}) as any)?.sessionOrder ?? 1);
        const sectionId = `${task.id}:section-${sectionNo}`;
        const trace = createListeningTraceContext({
          requestId: req.header("x-request-id") ?? undefined,
          traceId: req.header("x-trace-id") ?? undefined,
          correlationId: req.header("x-correlation-id") ?? undefined,
          userId,
          taskId: task.id,
          sessionBatchId: ((task.progressData ?? {}) as any)?.sessionBatchId,
        });
        const stage = (roadmapCResult as any).stage ?? "script_subsystem";
        const failureContext = buildScriptSubsystemFailureContext({
          stage,
          errorCode: roadmapCResult.errorCode,
          retryable: (roadmapCResult as any).retryable,
          details: (roadmapCResult as any).details,
          continuity: (roadmapCResult as any).continuity,
          anchorValidation: (roadmapCResult as any).anchorValidation,
        });
        const stepFailedEvent = publishListeningEvent({
          topic: LISTENING_EVENT_TOPICS.SECTION_EVENTS,
          eventType: LISTENING_EVENT_TYPES.SECTION_STEP_FAILED,
          eventVersion: "1.0.0",
          producer: "listening-script-subsystem",
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          idempotencyKey: buildSectionStepIdempotencyKey(task.id, sectionNo, `step_failed_${stage}`),
          userId: task.userId,
          payload: {
            task_id: task.id,
            section_id: sectionId,
            section_no: sectionNo,
            step_name: stage,
            ...failureContext,
          },
        });
        await persistListeningEventToOutbox({
          taskProgressId: task.id,
          userId: task.userId,
          topic: LISTENING_EVENT_TOPICS.SECTION_EVENTS,
          event: stepFailedEvent,
        });
        await transitionListeningSectionState({
          task: task as TaskProgressRecord,
          sectionId,
          sectionNo,
          toState: "FAILED",
          eventId: stepFailedEvent.event_id,
          idempotencyKey: buildSectionStepIdempotencyKey(task.id, sectionNo, `failed_${stage}`),
          errorCode: roadmapCResult.errorCode,
        });

        const shouldTerminalFail =
          roadmapCResult.errorCode === "BLUEPRINT_QUALITY_FAILED" ||
          stage === "continuity" ||
          stage === "anchors" ||
          (roadmapCResult as any).retryable === false;
        if (shouldTerminalFail) {
          await routeListeningTerminalFailureToDLQ({
            task: task as TaskProgressRecord,
            sectionId,
            sectionNo,
            stepName: stage,
            errorCode: String(roadmapCResult.errorCode ?? "UNKNOWN"),
            attempts: Number(((task.progressData ?? {}) as any)?.sessionPrefetch?.retryCount ?? 0),
            context: {
              ...failureContext,
            },
            traceId: trace.traceId,
            correlationId: trace.correlationId,
          });
          return res.status(500).json({
            success: false,
            message: "Script subsystem quality gate failed",
            errorCode: roadmapCResult.errorCode,
            details: (roadmapCResult as any).details,
            retryable: false,
          });
        }

        console.warn("[RoadmapC][ScriptSubsystem][FallbackToLegacy]", {
          taskId,
          errorCode: roadmapCResult.errorCode,
          retryable: roadmapCResult.retryable,
          details: roadmapCResult.details,
        });
        const legacy = await generateListeningScriptForTask(task, userLevel, targetBand);
        scriptResult = legacy.success
          ? (legacy as any)
          : {
              success: false,
              error: legacy.error,
              errorCode: roadmapCResult.errorCode,
              retryable: (roadmapCResult as any).retryable ?? true,
            };
      }

      if (!scriptResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to generate script",
          error: scriptResult.error,
          errorCode: scriptResult.errorCode,
          retryable: scriptResult.retryable ?? true,
        });
      }
      
      // Generate dynamic title if needed
      let updatedTitle = task.taskTitle;
      if (needsTitleUpdate(task.taskTitle) && scriptResult.contextLabel) {
        updatedTitle = makeListeningTaskTitle({
          scriptType: scriptResult.scriptType === 'dialogue' || scriptResult.scriptType === 'monologue'
            ? scriptResult.scriptType
            : undefined,
          contextLabel: scriptResult.contextLabel,
          topicDomain: scriptResult.topicDomain,
          scenarioOverview: scriptResult.scenarioOverview
        });
        logPrivacySafe(
          "[Script Generation API] Title updated",
          {
            taskId,
            previousTitle: task.taskTitle,
            updatedTitle,
          },
          { nonProdOnly: true },
        );
      }
      
      const sessionMinutesRaw = resolveSessionMinutesFromTask(task);
      const sessionMinutes = Math.max(sessionMinutesRaw, LISTENING_SESSION_MINUTES);
      // Update the task with generated content, metadata, and refreshed title
      const updateData = {
        scriptText: scriptResult.scriptText!,
        accent: scriptResult.accent!,
        scriptType: scriptResult.scriptType!,
        difficulty: scriptResult.difficulty!,
        duration: sessionMinutes,
        ieltsPart: scriptResult.ieltsPart,
        topicDomain: scriptResult.topicDomain,
        contextLabel: scriptResult.contextLabel,
        scenarioOverview: scriptResult.scenarioOverview,
        estimatedDurationSec: scriptResult.estimatedDurationSec,
        taskTitle: updatedTitle
      };
      
      const updatedTask = await storage.updateTaskContent(taskId, updateData);
      
      // Note: Task title is updated in the task progress table via updateTaskContent
      // The title is part of the task progress record, not the weekly plan
      
      // Update task status to indicate script is generated
      await storage.updateTaskStatus(taskId, "script-generated");
      
      logPrivacySafe(
        "[Script Generation API] Script generated",
        {
          taskId,
          scriptLength: scriptResult.scriptText?.length ?? 0,
        },
        { nonProdOnly: true },
      );
      
      res.json({
        success: true,
        message: "Script generated successfully",
        data: {
          taskId: taskId,
          scriptText: scriptResult.scriptText,
          accent: scriptResult.accent,
          scriptType: scriptResult.scriptType,
          difficulty: scriptResult.difficulty,
          estimatedDuration: scriptResult.estimatedDurationSec,
          wordCount: scriptResult.scriptText!.split(/\s+/).length,
          status: "script-generated"
        }
      });
      
    } catch (error) {
      logPrivacySafe(
        "[Script Generation API] Error",
        {
          taskId: req.params?.taskId ?? null,
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { level: "error" },
      );
      res.status(500).json({
        success: false,
        message: "Internal server error during script generation",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Generate audio from script for a specific task (Firebase Auth version)
  app.post('/api/task/:taskId/generate-audio', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskId } = req.params;
      
      if (AUDIO_DEBUG) {
        logPrivacySafe(
          "[Audio Generation API][Start]",
          {
            taskId,
            userId,
          },
          { nonProdOnly: true },
        );
      }
      
      // Get the task from database
      const task = await storage.getTaskProgress(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }
      
      // Verify task belongs to the authenticated user
      if (task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied - task does not belong to user"
        });
      }
      
      if (AUDIO_DEBUG) {
        logPrivacySafe("[AUDIO INVESTIGATION] Script text analysis", {
          taskId,
          hasScriptText: !!task.scriptText,
          scriptTextType: typeof task.scriptText,
          scriptTextLength: task.scriptText ? task.scriptText.length : 0,
          scriptTextTrimmedLength: task.scriptText ? task.scriptText.trim().length : 0,
          scriptTextWordCount: task.scriptText ? task.scriptText.trim().split(/\s+/).length : 0,
          isEmptyOrWhitespace: !task.scriptText || task.scriptText.trim().length === 0,
        });
      }
      
      // Check if task has script text
      if (!task.scriptText || task.scriptText.trim().length === 0) {
        if (AUDIO_DEBUG) {
          logPrivacySafe(
            "[AUDIO INVESTIGATION] Missing script text",
            { taskId },
            { level: "error", nonProdOnly: true },
          );
        }
        return res.status(400).json({
          success: false,
          message: "No script available for audio generation. Generate script first."
        });
      }
      
      // Additional validation for meaningful content
      const trimmedScript = task.scriptText.trim();
      if (trimmedScript.length < 10) {
        if (AUDIO_DEBUG) {
          logPrivacySafe(
            "[AUDIO INVESTIGATION] Script text is short",
            {
              taskId,
              scriptTextLength: trimmedScript.length,
            },
            { level: "warn", nonProdOnly: true },
          );
        }
      }

      const scriptValidation = validateTranscriptComplete(trimmedScript);
      if (!scriptValidation.ok) {
        console.warn('[Audio Generation API] Script failed validation, aborting audio generation', {
          taskId,
          reason: scriptValidation.reason,
        });
        return res.status(500).json({
          success: false,
          retryable: true,
          message: "Script is incomplete, regenerating content before audio",
          reason: scriptValidation.reason,
        });
      }
      
      // Check if audio already exists to prevent duplicate generation
      if (task.audioUrl && task.audioUrl.trim().length > 0) {
        if (AUDIO_DEBUG) {
          logPrivacySafe(
            "[AUDIO INVESTIGATION] Existing audio URL present",
            {
              taskId,
              hasAudioUrl: true,
            },
            { nonProdOnly: true },
          );
        }
        const audioExists = await checkAudioExists(task.audioUrl);
        if (audioExists) {
          return res.status(409).json({
            success: false,
            message: "Audio already exists for this task",
            data: {
              hasAudio: true,
              audioUrl: task.audioUrl,
              duration: task.duration,
              accent: normalizeAccent(task.accent ?? undefined)
            }
          });
        }
      }
      
      // Use accent from task or default to British
      const accent = normalizeAccent(task.accent ?? undefined);
      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const segmentInputs = buildSegmentInputsFromTask(task as TaskProgressRecord);
      const sectionFallbackAccents = resolveSectionFallbackAccentsFromTask(task as TaskProgressRecord);
      const sectionNo = Number(progressData?.sessionOrder ?? 1);
      const promptVersion =
        typeof progressData?.listeningSegments?.prompt?.version === "string"
          ? progressData.listeningSegments.prompt.version
          : "legacy-v1";
      const correlationId =
        typeof req.headers?.["x-correlation-id"] === "string" && req.headers["x-correlation-id"].trim().length > 0
          ? req.headers["x-correlation-id"].trim()
          : `audio-${taskId}`;

      if (AUDIO_DEBUG) {
        logPrivacySafe("[Audio Generation API][RenderStart]", {
          taskId,
          accent,
          sectionNo,
          promptVersion,
          segmentCount: segmentInputs.length,
        });
      }
      if (AUDIO_DEBUG) {
        logPrivacySafe(
          "[AUDIO INVESTIGATION] Render input summary",
          {
            taskId,
            scriptTextLength: trimmedScript.length,
            sectionNo,
          },
          { nonProdOnly: true },
        );
      }

      const render = await renderSectionAudioAssets({
        userId,
        taskId,
        weekNumber: Number(task.weekNumber ?? 1),
        sectionNo,
        sessionId: String(progressData?.sessionBatchId ?? taskId),
        correlationId,
        promptVersion,
        sectionAccent: accent,
        sectionFallbackAccents,
        segmentInputs,
      });

      const renderedAssets = createSectionAudioAssetMetadata({
        render,
        sectionNo,
      });
      const sectionQa = createSectionAudioQaLog({
        render,
        sectionNo,
      });
      const batchVerification = await checkAudioAssetsExist(renderedAssets.map((asset) => asset.url));

      if (!render.success || renderedAssets.length === 0 || !batchVerification.ok) {
        const failed = render.results.find((entry) => entry.status === "failed");
        return res.status(500).json({
          success: false,
          message: "Failed to generate audio",
          error: failed?.errorMessage ?? "No assets were generated",
          errorCode: failed?.errorCode ?? "AUDIO_RENDER_FAILED",
          verification: batchVerification,
        });
      }

      const legacyAudio = renderedAssets[0];
      
      const sessionMinutesRaw = resolveSessionMinutesFromTask(task);
      const sessionMinutes = Math.max(sessionMinutesRaw, LISTENING_SESSION_MINUTES);
      // Update the task with generated audio URL and duration
      const updateData = {
        audioUrl: legacyAudio.url,
        duration: sessionMinutes,
        accent: legacyAudio.accent,
      };
      
      await storage.updateTaskContent(taskId, updateData);

      const currentSegments = Array.isArray(progressData?.segments) ? progressData.segments : [];
      const mergedSegments = mergeRenderedAssetsIntoSegments(currentSegments, renderedAssets);
      const nextProgressData = {
        ...progressData,
        sectionAudioAssets: renderedAssets,
        sectionAudioQa: sectionQa,
        audioPolicy: {
          mode: renderedAssets[0]?.url_mode ?? "public",
          expiresAt: renderedAssets[0]?.url_expires_at ?? null,
          promptVersion,
        },
        segments: mergedSegments,
      };
      await storage.updateTaskProgress(taskId, { progressData: nextProgressData });
      
      // Update task status to indicate audio is ready
      await storage.updateTaskStatus(taskId, "audio-ready");
      
      if (AUDIO_DEBUG) {
        logPrivacySafe("[Audio Generation API][Success]", {
          taskId,
          sectionNo,
          assetCount: renderedAssets.length,
        });
      }
      
      res.json({
        success: true,
        message: "Audio generated successfully",
        data: {
          taskId: taskId,
          audioUrl: legacyAudio.url,
          duration: legacyAudio.duration_seconds,
          accent: legacyAudio.accent,
          audioAssets: renderedAssets,
          scriptLength: task.scriptText.length,
          status: "audio-ready"
        }
      });
      
    } catch (error) {
      console.error("[Audio Generation API][Error]", {
        taskId: req.params?.taskId,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json({
        success: false,
        message: "Internal server error during audio generation",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Generate a listening session package (prefetch 4 audios + questions)
  app.post('/api/listening/session-package', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const {
        activityType,
        scenario,
        sessionDurationMinutes,
        targetBand,
        userLevel,
        accent,
      } = req.body ?? {};

      if (activityType !== "dialogue" && activityType !== "monologue") {
        return res.status(400).json({
          success: false,
          message: "activityType must be 'dialogue' or 'monologue'",
        });
      }

      if (typeof scenario !== "string" || scenario.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "scenario is required",
        });
      }

      const durationMinutes =
        typeof sessionDurationMinutes === "number"
          ? sessionDurationMinutes
          : parseInt(String(sessionDurationMinutes), 10);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return res.status(400).json({
          success: false,
          message: "sessionDurationMinutes must be a positive number",
        });
      }

      const targetBandNum =
        typeof targetBand === "number" ? targetBand : parseFloat(String(targetBand));
      if (!Number.isFinite(targetBandNum)) {
        return res.status(400).json({
          success: false,
          message: "targetBand must be a number",
        });
      }

      const userLevelNum =
        typeof userLevel === "number" ? userLevel : parseFloat(String(userLevel));
      if (!Number.isFinite(userLevelNum)) {
        return res.status(400).json({
          success: false,
          message: "userLevel must be a number",
        });
      }

      const normalizedAccent = typeof accent === "string" ? normalizeAccent(accent) : undefined;

      console.log("[Session Package API] Generating package", {
        userId: req.user?.id,
        activityType,
        scenario,
        sessionDurationMinutes: durationMinutes,
        targetBand: targetBandNum,
        userLevel: userLevelNum,
        accent: normalizedAccent,
      });

      const packageData = await generateListeningSessionPackage({
        activityType,
        scenario,
        sessionDurationMinutes: durationMinutes,
        targetBand: targetBandNum,
        userLevel: userLevelNum,
        accent: normalizedAccent,
        prefetchCount: PREFETCH_AUDIO_COUNT,
      });

      return res.status(200).json({
        success: true,
        data: packageData,
      });
    } catch (error: any) {
      console.error('[Session Package API] Error generating session package:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to generate listening session package",
        error: error?.message ?? 'Unknown error'
      });
    }
  });

  // Generate or refresh a listening weekly plan for the given week
  app.post('/api/firebase/weekly-plan/generate-listening', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const rawWeekNumber = req.body?.weekNumber;
      const weekNumber = Number.isInteger(rawWeekNumber)
        ? rawWeekNumber
        : Number.isFinite(Number(rawWeekNumber))
          ? Number(rawWeekNumber)
          : 1;

      if (!Number.isFinite(weekNumber) || weekNumber < 1) {
        return res.status(400).json({
          success: false,
          message: "weekNumber must be a positive integer"
        });
      }

      const studyPlans = await storage.getStudyPlansByUserId(userId);
      if (!studyPlans.length) {
        return res.status(400).json({
          success: false,
          message: "No study plan found. Complete onboarding first."
        });
      }

      const latestPlan = studyPlans[studyPlans.length - 1];
      const skillRatings = (latestPlan.skillRatings as Record<string, number>) ?? {};

      const storedPreferences = normalizeStudyPreferences((latestPlan.studyPreferences as any) ?? {});
      const sessionMinutes = storedPreferences.sessionMinutes;
      const weekdayDuration = storedPreferences.listeningDurations.weekday;
      const weekendDuration = storedPreferences.listeningDurations.weekend;

      console.log('[Weekly Plan] Session config:', {
        sessionMinutes,
        listeningDurations: {
          weekday: weekdayDuration,
          weekend: weekendDuration
        },
        source: 'normalized'
      });

      const planRequest = {
        fullName: latestPlan.fullName,
        phoneNumber: latestPlan.phoneNumber ?? undefined,
        targetBandScore: Number(latestPlan.targetBandScore) || 7,
        testDate: latestPlan.testDate ?? null,
        notDecided: latestPlan.notDecided === 'true',
        skillRatings: {
          listening: Number(skillRatings.listening ?? 1),
          reading: Number(skillRatings.reading ?? 1),
          writing: Number(skillRatings.writing ?? 1),
          speaking: Number(skillRatings.speaking ?? 1),
        },
        immigrationGoal: latestPlan.immigrationGoal,
        studyPreferences: storedPreferences,
        weekNumber,
      };

      const listeningPlan = await generateListeningStudyPlan(planRequest as any);
      if ((listeningPlan as any)?.success === false) {
        return res.status(500).json({
          success: false,
          message: "Failed to generate listening weekly plan",
          reason: (listeningPlan as any).reason ?? 'unknown'
        });
      }

      const weekFocus = (listeningPlan as any).weekFocus || `Listening focus for week ${weekNumber}`;
      const planEntries = Array.isArray((listeningPlan as any).plan) ? (listeningPlan as any).plan : [];
      const defaultSessionMinutes = sessionMinutes;
      const weekdayMinutes = weekdayDuration;
      const weekendMinutes = weekendDuration;
      const getSessionConfigForDay = (opts: { dayNumber: number; dayType?: string; assignedDate?: Date }) => {
        const resolvedType = determineDayType({
          dayNumber: opts.dayNumber,
          explicit: opts.dayType,
          assignedDate: opts.assignedDate,
        });
        const minutes = resolvedType === 'weekend' ? weekendMinutes : weekdayMinutes;
        return {
          minutes,
          dayType: resolvedType,
        };
      };
      const planQueue = [...planEntries];
      const weekWindow = resolveWeekWindow({ weekNumber, tz: PLANNER_TZ, referenceDate: new Date() });
      const windowDays = enumerateDays(weekWindow.start, weekWindow.end);
      const availability = buildAvailabilityFromSchedule(storedPreferences.schedule);
      const assignments = assignSkillsToDays(windowDays, {
        tz: PLANNER_TZ,
        today: new Date(),
        availability,
        weights: { listening: 1 },
      });

      const formattedEntries: FormattedListeningEntry[] = assignments
        .map((assignment, idx): FormattedListeningEntry | null => {
          const entry = planQueue.shift();
          if (!entry) {
            return null;
          }

          const isoDay = getIsoDayForDate(assignment.date, PLANNER_TZ);
          const sessionConfig = getSessionConfigForDay({
            dayNumber: isoDay,
            assignedDate: assignment.date,
          });
          const sessionMinutesForDay = sessionConfig.minutes;
          const scriptType =
            entry.activityType === 'monologue'
              ? 'monologue'
              : entry.activityType === 'dialogue'
                ? 'dialogue'
                : 'dialogue';

          const contextLabel = entry.conversationType ?? entry.scenario ?? 'Listening Practice';
          const topicDomain = entry.scenario ?? entry.conversationType ?? 'Listening Practice';
          const scenarioOverview = entry.description ?? `${contextLabel} listening task`;
          const normalizedAccent = normalizeAccent(entry.accent);
          const estimatedDurationSec = Math.round(sessionMinutesForDay * 60);
          const durationLabel = `${sessionMinutesForDay} min`;
          const sequenceNumber = idx + 1;

          const taskTitle = makeListeningTaskTitle({
            scriptType,
            contextLabel,
            topicDomain,
            scenarioOverview,
          });

          return {
            dayNumber: isoDay,
            sequenceNumber,
            taskTitle,
            scriptType,
            contextLabel,
            topicDomain,
            scenarioOverview,
            accent: normalizedAccent,
            estimatedDurationSec,
            durationLabel,
            dayType: sessionConfig.dayType,
            dayDurationMinutes: sessionMinutesForDay,
            sessionMinutes: sessionMinutesForDay,
            description: scenarioOverview,
            conversationType: entry.conversationType ?? null,
            assignedDate: assignment.date.toISOString(),
          };
        })
        .filter((entry): entry is FormattedListeningEntry => Boolean(entry));

      if (!formattedEntries.length) {
        return res.status(400).json({
          success: false,
          message: "No available days remain for this week based on your schedule",
        });
      }
      const normalizedPlanEntries = formattedEntries.map((entry: any) => {
        const baseTask = {
          originalTitle: entry.taskTitle,
          title: entry.taskTitle,
          skill: 'listening',
          dayNumber: entry.dayNumber,
          contextType: entry.scriptType,
          topicDomain: entry.topicDomain,
          accent: entry.accent ?? 'British',
          description: entry.description ?? '',
          audio: {
            estimatedDurationSec: entry.estimatedDurationSec ?? 360,
            accent: entry.accent ?? 'British',
          },
        };

        const normalized = normalizeTaskDuration(baseTask, {
          weekdayDuration: weekdayMinutes,
          weekendDuration: weekendMinutes,
          dayNumber: entry.dayNumber,
          date: new Date(entry.assignedDate),
        });

        normalized.durationMinutes = typeof normalized.durationMinutes === 'number'
          ? normalized.durationMinutes
          : entry.dayDurationMinutes ?? weekdayMinutes;

        normalized.duration = `${normalized.durationMinutes} min`;
        (normalized as any).assignedDate = entry.assignedDate;
        (normalized as any).planDayIndex = entry.dayNumber;
        (normalized as any).sequenceNumber = entry.sequenceNumber;
        (normalized as any).dayLabel = `Day ${entry.sequenceNumber}`;
        (normalized as any).dayType = entry.dayType;

        delete (normalized as any).durationLabel;
        delete (normalized as any).estimatedDurationSec;

        return normalized;
      });

      const planData = {
        weekFocus,
        plan: normalizedPlanEntries,
      };

      const weeklyPlan = await storage.createOrUpdateWeeklyStudyPlan(
        userId,
        weekNumber,
        'listening',
        weekFocus,
        planData,
      );

      const existingTasks = await storage.getTaskProgressByWeeklyPlan(weeklyPlan.id, userId);
      const usedTaskIds = new Set<string>();

      let updatedCount = 0;
      let createdCount = 0;

      for (let i = 0; i < formattedEntries.length; i++) {
        const entry = formattedEntries[i];
        const normalizedEntry = normalizedPlanEntries[i]; // Get corresponding normalized entry

        const candidate = existingTasks.find(
          (task) => task.dayNumber === entry.dayNumber && !usedTaskIds.has(task.id),
        );

        if (candidate) {
          usedTaskIds.add(candidate.id);
          const candidateProgressData = (candidate.progressData ?? {}) as Record<string, any>;
          const existingSegments = Array.isArray(candidateProgressData.segments)
            ? candidateProgressData.segments
            : [];
          const segments = ensureListeningSegments(existingSegments, normalizedEntry.durationMinutes, {
            baseTitle: entry.taskTitle,
            accent: entry.accent,
          });

          await storage.updateTaskContent(candidate.id, {
            taskTitle: entry.taskTitle,
            accent: entry.accent,
            scriptType: entry.scriptType,
            topicDomain: entry.topicDomain,
            contextLabel: entry.contextLabel,
            scenarioOverview: entry.scenarioOverview,
            estimatedDurationSec: undefined, // ⛔️ stop using top-level seconds
            duration: normalizedEntry.durationMinutes, // ✅ minutes for timer
            replayLimit: 3,
          });

          const mergedProgressData = {
            ...candidateProgressData,
            sessionDurationMinutes: normalizedEntry.durationMinutes,
            segments,
            assignedDate: entry.assignedDate,
            sessionPrefetch: {
              ...candidateProgressData.sessionPrefetch,
              // Preserve critical fields to prevent re-queuing
              status: candidateProgressData.sessionPrefetch?.status,
              batchId: candidateProgressData.sessionPrefetch?.batchId,
              total: PREFETCH_AUDIO_COUNT,
              ready: Boolean(candidateProgressData.sessionPrefetch?.ready),
              activityType: entry.scriptType,
              scenario: entry.contextLabel,
              accent: entry.accent,
              sessionMinutes: normalizedEntry.durationMinutes,
              dayType: entry.dayType,
              updatedAt: candidateProgressData.sessionPrefetch?.updatedAt,
              assignedDate: entry.assignedDate,
            },
          };
          await storage.updateTaskStatus(candidate.id, 'not-started', mergedProgressData);
          updatedCount += 1;
        } else {
          const segments = ensureListeningSegments(undefined, normalizedEntry.durationMinutes, {
            baseTitle: entry.taskTitle,
            accent: entry.accent,
          });

          const insertData = {
            id: uuidv4(),
            userId,
            weeklyPlanId: weeklyPlan.id,
            weekNumber,
            dayNumber: entry.dayNumber,
            taskTitle: entry.taskTitle,
            skill: 'listening' as const,
            status: 'not-started' as const,
            startedAt: null,
            completedAt: null,
            accent: entry.accent,
            replayLimit: 3,
            scriptType: entry.scriptType,
            difficulty: null,
            topicDomain: entry.topicDomain,
            contextLabel: entry.contextLabel,
            scenarioOverview: entry.scenarioOverview,
            estimatedDurationSec: undefined, // ⛔️ stop using top-level seconds
            duration: normalizedEntry.durationMinutes, // ✅ minutes
            progressData: {
              sessionDurationMinutes: normalizedEntry.durationMinutes,
              segments,
              assignedDate: entry.assignedDate,
              sessionPrefetch: {
                total: PREFETCH_AUDIO_COUNT,
                ready: false,
                activityType: entry.scriptType,
                scenario: entry.contextLabel,
                accent: entry.accent,
                sessionMinutes: normalizedEntry.durationMinutes,
                dayType: entry.dayType,
              },
            },
          };

          await storage.createTaskProgress(insertData);
          createdCount += 1;
        }
      }

      const isCurrentWeek = weekNumber === 1;
      const currentIsoDay = getIsoDayForDate(new Date(), PLANNER_TZ);
      const staleTasks = existingTasks.filter((task) => {
        if (usedTaskIds.has(task.id)) {
          return false;
        }
        if (isCurrentWeek && typeof task.dayNumber === 'number') {
          return task.dayNumber >= currentIsoDay;
        }
        return true;
      });
      if (staleTasks.length > 0) {
        await storage.deleteTaskProgressByIds(staleTasks.map((task) => task.id));
      }

      return res.status(200).json({
        success: true,
        weeklyPlanId: weeklyPlan.id,
        weekNumber,
        weekFocus,
        tasksCreated: createdCount,
        tasksUpdated: updatedCount,
        tasksDeleted: staleTasks.length,
      });
    } catch (error: any) {
      console.error('[Weekly Plan API] Error generating listening plan:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to generate listening weekly plan",
        error: error?.message ?? 'Unknown error',
      });
    }
  });

  // =====================================================================
  // Plan Generation Endpoints
  // =====================================================================
  
  // Generate IELTS study plan based on onboarding data (Firebase Auth version)
  app.post('/api/plan/generate', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const payload = req.body;
      
      // Use the database user ID from the ensureFirebaseUser middleware
      const user = req.user;
      // Always use the database ID, not Firebase UID for database operations
      const userId = user.id;
      
      // Avoid PII-heavy request logging in production.
      logPrivacySafe(
        "[Plan API] Onboarding payload received",
        { userId },
        { nonProdOnly: true },
      );
      logNonProdVerbose(
        "[Plan API] Onboarding payload summary:",
        redactSensitive({
          firstName: payload.firstName,
          targetBandScore: payload.targetBandScore,
          testDate: payload.testDate,
        }),
      );
      
      // Preprocess the date format if it's a string
      if (payload.testDate && typeof payload.testDate === 'string') {
        try {
          payload.testDate = new Date(payload.testDate);
          logNonProdVerbose('[Plan API] Converted testDate from string to Date:', payload.testDate);
        } catch (e) {
          console.error('[Plan API] Error parsing test date:', e);
          payload.testDate = null;
        }
      }
      
      // Ensure study preferences are present before validation
      payload.studyPreferences = normalizeStudyPreferences(payload.studyPreferences);
      
      // Validate request data with detailed error reporting
      const validation = onboardingSchema.safeParse(payload);
      
      if (!validation.success) {
        const formattedErrors = validation.error.flatten();
        console.error('[Plan API] Onboarding validation failed:', {
          fieldErrors: formattedErrors.fieldErrors,
          formErrors: formattedErrors.formErrors
        });
        return res.status(400).json({ 
          success: false, 
          message: "Invalid onboarding data", 
          errors: formattedErrors
        });
      }
      
      const onboardingData = {
        ...validation.data,
        studyPreferences: normalizeStudyPreferences(validation.data.studyPreferences),
      };

      try {
        // Check debug mode flag
        const debugFlagEnabled = process.env.ENABLE_PLAN_DEBUG === "1";
        if (debugFlagEnabled) {
          logNonProdVerbose("[PlanGen][ROUTE] Debug mode enabled");
          const report = await generateIELTSPlan_debugWrapper(onboardingData);

          await storage.updateOnboardingStatus(userId, true);

          return res.status(200).json({
            success: true,
            message: "Debug diagnostics completed",
            debug: report,
          });
        }

        logNonProdVerbose('[Plan API] Calling OpenAI to generate IELTS plan...');
        const plan = await generateIELTSPlan(onboardingData);

        // Map onboarding text to numeric minutes
        const sessionMinutes = mapToMinutes(onboardingData.studyPreferences.dailyCommitment);
        // Check if listeningDurations already has numeric values or needs mapping
        const existingListening = onboardingData.studyPreferences.listeningDurations;
        const listeningDurations = {
          weekday: typeof existingListening?.weekday === 'number'
            ? existingListening.weekday
            : sessionMinutes,
          weekend: typeof existingListening?.weekend === 'number'
            ? existingListening.weekend
            : sessionMinutes,
        };

        logNonProdVerbose('[SESSION][config] Mapped onboarding to minutes:', {
          dailyCommitment: onboardingData.studyPreferences.dailyCommitment,
          sessionMinutes,
          listeningDurations
        });

        const studyPlanId = uuidv4();
        const studyPlanData = {
          id: studyPlanId,
          userId: userId,
          fullName: onboardingData.fullName,
          phoneNumber: onboardingData.phoneNumber || "",
          targetBandScore: onboardingData.targetBandScore.toString(),
          testDate: onboardingData.testDate,
          notDecided: onboardingData.notDecided ? "true" : "false",
          skillRatings: onboardingData.skillRatings,
          immigrationGoal: onboardingData.immigrationGoal,
          studyPreferences: {
            ...onboardingData.studyPreferences,
            sessionMinutes, // Add numeric sessionMinutes
            listeningDurations, // Add numeric listening durations
          },
          plan,
        };

        await storage.runInTransaction(async (txStorage) => {
          logNonProdVerbose("[Plan API] Saving main study plan to database (transaction)...");
          await txStorage.createStudyPlan(studyPlanData);

          if (plan.weeklyPlans && Array.isArray(plan.weeklyPlans)) {
            logNonProdVerbose("[Plan API] Processing weekly plans for persistence...");

            for (const weeklyPlan of plan.weeklyPlans) {
              const weekNumber = weeklyPlan.week;
              const skillActivities: {
                listening: any[];
                reading: any[];
                writing: any[];
                speaking: any[];
                [key: string]: any[];
              } = {
                listening: [],
                reading: [],
                writing: [],
                speaking: [],
              };

              if (weeklyPlan.days && Array.isArray(weeklyPlan.days)) {
                for (const day of weeklyPlan.days) {
                  if (day.activities && Array.isArray(day.activities)) {
                    for (const activity of day.activities) {
                      const skill = activity.skill?.toLowerCase();
                      if (skill && skill in skillActivities) {
                        const dayName =
                          ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][day.day - 1] ||
                          `Day ${day.day}`;

                        const normalizedActivity =
                          skill === "listening" ? normalizeListeningActivity(activity) : activity;

                        const durationLabel =
                          typeof normalizedActivity.duration === "string"
                            ? normalizedActivity.duration
                            : typeof activity.duration === "string"
                              ? activity.duration
                              : "30 min";

                        const durationMinutes =
                          skill === "listening" && typeof normalizedActivity.durationMinutes === "number"
                            ? normalizedActivity.durationMinutes
                            : undefined;

                        const accentCandidate =
                          typeof normalizedActivity.accent === "string" && normalizedActivity.accent.length > 0
                            ? normalizedActivity.accent
                            : typeof activity.accent === "string" && activity.accent.length > 0
                              ? activity.accent
                              : undefined;

                        const baseActivity = {
                          title: normalizedActivity.title || activity.title,
                          day: dayName,
                          duration: durationLabel,
                          status: "not-started",
                          skill,
                          accent: normalizeAccent(accentCandidate),
                          description: normalizedActivity.description || activity.description,
                          contextType: normalizedActivity.contextType || "general",
                          resources: normalizedActivity.resources || activity.resources,
                        } as any;

                        if (durationMinutes !== undefined) {
                          baseActivity.durationMinutes = durationMinutes;
                        }

                        skillActivities[skill].push(baseActivity);
                      }
                    }
                  }
                }
              }

              const tz = PLANNER_TZ;
              const availability = buildAvailabilityFromSchedule(onboardingData.studyPreferences.schedule);
              const weights = deriveWeightsFromSkillRatings(onboardingData.skillRatings ?? {}, onboardingData.targetBandScore ?? 7);
              const nowDate = new Date();
              const windowRange = resolveWeekWindow({
                weekNumber,
                tz,
                referenceDate: nowDate,
              });
              const rawDays = enumerateDays(windowRange.start, windowRange.end);
              const assignments = assignSkillsToDays(rawDays, {
                tz,
                today: nowDate,
                availability,
                weights,
              });

              const distributedActivities: Record<Skill, any[]> = {
                listening: [],
                reading: [],
                writing: [],
                speaking: [],
              };

              const skillQueues: Record<Skill, any[]> = {
                listening: [...skillActivities.listening],
                reading: [...skillActivities.reading],
                writing: [...skillActivities.writing],
                speaking: [...skillActivities.speaking],
              };

              assignments.forEach((assignment, sequenceIndex) => {
                let targetSkill: Skill = assignment.skill;
                if (!skillQueues[targetSkill]?.length) {
                  const fallback = SKILL_ORDER.find((skill) => skillQueues[skill]?.length);
                  if (!fallback) {
                    return;
                  }
                  targetSkill = fallback;
                }

                const queue = skillQueues[targetSkill];
                const activity = queue.shift();
                if (!activity) {
                  return;
                }

                const isoDay = getIsoDayForDate(assignment.date, tz);
                const assignedActivity = {
                  ...activity,
                  dayNumber: isoDay,
                  day: `Day ${sequenceIndex + 1}`,
                  sequenceNumber: sequenceIndex + 1,
                  assignedDate: assignment.date.toISOString(),
                };
                distributedActivities[targetSkill].push(assignedActivity);
              });

              for (const [skillFocus, activities] of Object.entries(distributedActivities)) {
                if (activities.length === 0) {
                  continue;
                }

                const weekFocus = weeklyPlan.goals?.join(", ") || `Week ${weekNumber} focus`;
                const planData = {
                  weekFocus,
                  plan: activities,
                  progressMetrics: weeklyPlan.progressMetrics || [],
                };

                console.log(`[Plan API] Saving weekly plan: Week ${weekNumber} - ${skillFocus}`);
                const createdWeeklyPlan = await txStorage.createOrUpdateWeeklyStudyPlan(
                  userId,
                  weekNumber,
                  skillFocus,
                  weekFocus,
                  planData,
                );

                if (skillFocus === "listening") {
                  const userLevel = onboardingData.skillRatings.listening || 1;
                  const targetBand = onboardingData.targetBandScore || 7;

                  console.log(
                    `[Plan API] Pre-generating scripts for ${activities.length} listening tasks`,
                  );
                  const generatedScripts = await preGenerateScriptsForListeningTasks(
                    userId,
                    createdWeeklyPlan.id,
                    weekNumber,
                    activities,
                    userLevel,
                    targetBand,
                  );

                  if (generatedScripts.length > 0) {
                    const planWithGeneratedMetadata = Array.isArray(planData.plan)
                      ? planData.plan.map((task: any) => {
                          const sourceTitle = task.originalTitle || task.title;
                          const script = generatedScripts.find((s: any) => s.taskTitle === sourceTitle);
                          if (!script) {
                            return task;
                          }

                          const nextTitle = script.generatedTitle || task.title;
                          const scriptMinutes =
                            typeof script.estimatedDurationSec === 'number'
                              ? Math.max(1, Math.round(script.estimatedDurationSec / 60))
                              : undefined;
                          const existingMinutes =
                            typeof task.durationMinutes === 'number'
                              ? task.durationMinutes
                              : typeof task.duration === 'string' && /\d+/.test(task.duration)
                                ? parseInt(task.duration.replace(/\D/g, ''), 10)
                                : undefined;
                          const resolvedMinutes = existingMinutes ?? scriptMinutes ?? DEFAULT_SESSION_MINUTES;
                          const resolvedLabel =
                            typeof task.duration === 'string' && task.duration.trim().length > 0
                              ? task.duration
                              : `${resolvedMinutes} min`;

                          return {
                            ...task,
                            originalTitle: sourceTitle,
                            title: nextTitle,
                            accent: script.accent || task.accent,
                            contextType: script.scriptType || task.contextType,
                            description: script.scenarioOverview || task.description,
                            topicDomain: script.topicDomain || task.topicDomain,
                            contextLabel: script.contextLabel || task.contextLabel,
                            durationMinutes: resolvedMinutes,
                            duration: resolvedLabel,
                          };
                        })
                      : planData.plan;

                    const updatedPlanData = {
                      ...planData,
                      plan: planWithGeneratedMetadata,
                      preGeneratedScripts: generatedScripts,
                    };

                    await txStorage.createOrUpdateWeeklyStudyPlan(
                      userId,
                      weekNumber,
                      skillFocus,
                      weekFocus,
                      updatedPlanData,
                    );
                    logNonProdVerbose(
                      `[Plan API] Stored ${generatedScripts.length} pre-generated scripts in weekly plan`,
                    );
                  }
                }
              }
            }
          }

          await txStorage.updateOnboardingStatus(userId, true);
        });

        logNonProdVerbose("[Plan API] Study plan and weekly plans saved successfully");

        // Return success with plan ID
        return res.status(200).json({
          success: true,
          planId: studyPlanId,
          message: "Study plan generated and saved successfully",
          plan
        });
      } catch (aiError: any) {
        console.error('[Plan API] Error generating IELTS plan with OpenAI:', aiError);
        return res.status(500).json({
          success: false,
          message: "Failed to generate IELTS plan",
          error: typeof aiError === 'object' ? aiError.message || "Unknown OpenAI error" : String(aiError)
        });
      }
    } catch (error: any) {
      console.error('[Plan API] Error in plan generation endpoint:', error);
      return res.status(500).json({
        success: false,
        message: "Server error while processing plan generation",
        error: error.message
      });
    }
  });
  
  // Get weekly study plan by week number (Firebase Auth version)
  app.get('/api/plan/weekly/:weekNumber', verifyAuthWithDevOverride, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { weekNumber } = req.params;
      const weekNum = parseInt(weekNumber);
      
      if (isNaN(weekNum) || weekNum < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid week number. Must be a positive integer."
        });
      }
      
      logPrivacySafe(
        "[Weekly Plan API] Request received",
        {
          week: weekNum,
          userId,
        },
        { nonProdOnly: true },
      );
      
      // Fetch all weekly plans for this user and week
      const weeklyPlans = await storage.getWeeklyStudyPlansByWeek(userId, weekNum);
      
      if (weeklyPlans.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No study plans found for week ${weekNum}`,
          week: weekNum,
          skills: {}
        });
      }
      
      // Group plans by skill
      const skillsData: { [key: string]: any } = {};
      for (const plan of weeklyPlans) {
        let planData = plan.planData;
        if (plan.skillFocus === 'listening') {
          try {
            const progressIds = await ensureProgressForWeeklyPlan({
              userId,
              weeklyPlan: plan,
            });
            const progressRows = await storage.getTaskProgressByWeeklyPlan(plan.id, userId);
            const progressById = new Map(progressRows.map((row) => [row.id, row]));
            const parsedPlan = (plan.planData as any) ?? {};
            if (Array.isArray(parsedPlan.plan)) {
              planData = {
                ...parsedPlan,
                plan: parsedPlan.plan.map((entry: any, index: number) => ({
                  ...entry,
                  progressId: progressIds[index] ?? entry?.progressId ?? null,
                  performanceCoachStatus: (() => {
                    const progressId = progressIds[index] ?? entry?.progressId ?? null;
                    if (!progressId) return null;
                    const progress = progressById.get(progressId);
                    const coach = ((progress?.progressData ?? {}) as Record<string, any>)?.performanceCoach ?? {};
                    const latest = coach.latest ?? null;
                    const adoptedRecommendations = Array.isArray(coach.adoptedRecommendations)
                      ? coach.adoptedRecommendations
                      : [];
                    if (!latest && !adoptedRecommendations.length) return null;
                    return {
                      recommendationAdopted: Boolean(latest?.closed_loop?.recommendation_adopted) || adoptedRecommendations.length > 0,
                      trendImpact: latest?.closed_loop?.trend_impact ?? latest?.trend?.direction ?? null,
                      loopBreakMetric: latest?.closed_loop?.loop_break_metric ?? null,
                      sourceAnalysisId: latest?.closed_loop?.source_analysis_id ?? null,
                    };
                  })(),
                })),
              };
            }
          } catch (ensureErr) {
            console.error('[Weekly Plan API] ensureProgressForWeeklyPlan failed:', ensureErr);
          }
        }

        skillsData[plan.skillFocus] = {
          id: plan.id,
          weekNumber: plan.weekNumber,
          skillFocus: plan.skillFocus,
          weekFocus: plan.weekFocus,
          planData,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt
        };
      }
      
      logNonProdVerbose(`[Weekly Plan API] Found ${weeklyPlans.length} plans for week ${weekNum}`);
      
      return res.status(200).json({
        success: true,
        week: weekNum,
        skills: skillsData
      });
    } catch (error: any) {
      console.error('[Weekly Plan API] Error fetching weekly plans:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch weekly plans",
        error: error.message
      });
    }
  });

  // Get user onboarding data (Firebase Auth version)
  app.get('/api/user/onboarding', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      
      logPrivacySafe(
        "[User Onboarding API] Request received",
        { userId },
        { nonProdOnly: true },
      );
      
      // Get the most recent study plan for this user
      const studyPlans = await storage.getStudyPlansByUserId(userId);
      
      if (studyPlans.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No onboarding data found. Please complete onboarding first."
        });
      }
      
      // Get the most recent study plan
      const latestPlan = studyPlans[0]; // Assuming getStudyPlansByUserId returns in descending order
      
      logNonProdVerbose("[User Onboarding API] Onboarding data found");
      
      return res.status(200).json({
        success: true,
        data: {
          fullName: latestPlan.fullName,
          phoneNumber: latestPlan.phoneNumber,
          targetBandScore: parseFloat(latestPlan.targetBandScore),
          testDate: latestPlan.testDate,
          notDecided: latestPlan.notDecided === 'true',
          skillRatings: latestPlan.skillRatings,
          immigrationGoal: latestPlan.immigrationGoal,
          studyPreferences: latestPlan.studyPreferences,
          createdAt: latestPlan.createdAt,
          updatedAt: latestPlan.updatedAt
        }
      });
    } catch (error: any) {
      console.error('[User Onboarding API] Error fetching onboarding data:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch onboarding data",
        error: error.message
      });
    }
  });

  app.get('/api/task-progress/:id', verifyAuthWithDevOverride, ensureFirebaseUser, (req: any, res) => {
    req.params.progressId = req.params.id;
    return getTaskProgressById(req, res);
  });

  // Get a specific task progress by ID (Firebase Auth version)
  app.get('/api/firebase/task-progress/:progressId', verifyFirebaseAuth, ensureFirebaseUser, getTaskProgressById);
  
  // Get onboarding status (Firebase Auth version)
  app.get('/api/firebase/auth/onboarding-status', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      logPrivacySafe(
        "[Onboarding API] Status request received",
        { userId },
        { nonProdOnly: true },
      );
      
      // Get the user from the database
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      // Get the latest study plan to include preferences
      let preferences: any = {};
      
      try {
        const studyPlans = await storage.getStudyPlansByUserId(userId);
        const latestPlan = studyPlans.length > 0 ? studyPlans[studyPlans.length - 1] : null;
        if (latestPlan && latestPlan.studyPreferences) {
          const prefs = latestPlan.studyPreferences as any;
          const durations = resolveSessionDurations(prefs, prefs.sessionMinutes ?? DEFAULT_SESSION_MINUTES);
          preferences = {
            sessionMinutes: prefs.sessionMinutes ?? DEFAULT_SESSION_MINUTES,
            dailyCommitment: prefs.dailyCommitment,
            schedule: prefs.schedule,
            style: prefs.style,
            listeningDurations: {
              weekday: durations.weekday,
              weekend: durations.weekend,
            }
          };
        } else {
          preferences = {
            sessionMinutes: DEFAULT_SESSION_MINUTES,
            listeningDurations: {
              weekday: DEFAULT_SESSION_MINUTES,
              weekend: DEFAULT_SESSION_MINUTES,
            }
          };
        }
        logNonProdVerbose('[SESSION][config]', {
          sessionMinutes: preferences.sessionMinutes,
          listeningDurations: preferences.listeningDurations,
        });
      } catch (error) {
        console.warn('[Onboarding API] Could not fetch study preferences:', error);
        preferences = {
          sessionMinutes: DEFAULT_SESSION_MINUTES,
          listeningDurations: {
            weekday: DEFAULT_SESSION_MINUTES,
            weekend: DEFAULT_SESSION_MINUTES,
          }
        };
      }
      
      // Return the onboarding status with preferences
      return res.status(200).json({
        success: true,
        onboardingCompleted: user.onboardingCompleted || false,
        userId: user.id,
        firebaseUid: user.firebaseUid,
        preferences,
        source: 'database'
      });
    } catch (error: any) {
      console.error('[Onboarding API] Error fetching onboarding status:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch onboarding status",
        error: error.message
      });
    }
  });
  
  // Complete onboarding (Firebase Auth version)
  app.post('/api/firebase/auth/complete-onboarding', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      logPrivacySafe(
        "[Onboarding API] Complete onboarding request received",
        { userId },
        { nonProdOnly: true },
      );
      
      // Update the user's onboarding status
      const updatedUser = await storage.updateOnboardingStatus(userId, true);
      
      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      // Return success
      return res.status(200).json({
        success: true,
        message: "Onboarding marked complete",
        userId: updatedUser.id
      });
    } catch (error: any) {
      console.error('[Onboarding API] Error completing onboarding:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to complete onboarding",
        error: error.message
      });
    }
  });
  
  // Get task content (Firebase Auth version)
  app.get('/api/firebase/task-content/:id', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      
      // 4) Server route tracing
      logPrivacySafe(
        "[Task Content API] Request received",
        {
          taskId: id,
          userId,
        },
        { nonProdOnly: true },
      );
      
      // Get the task with all its content
      let taskWithContent = await storage.getTaskWithContent(id);
      
      // 4) Log found task status
      logPrivacySafe(
        "[Task Content API] Task lookup result",
        {
          taskId: id,
          found: Boolean(taskWithContent),
          status: taskWithContent?.status ?? null,
          hasScript: Boolean(taskWithContent?.scriptText),
          hasAudio: Boolean(taskWithContent?.audioUrl),
        },
        { nonProdOnly: true },
      );
      
      if (!taskWithContent) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }
      
      // Ensure the user owns this task
      if (taskWithContent.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this task content"
        });
      }

      const integrityCheck = await verifyManifestIntegrityForTask(taskWithContent as TaskProgressRecord, userId);
      if (!integrityCheck.ok) {
        return res.status(409).json({
          success: false,
          message: "Published manifest integrity check failed",
          errorCode: integrityCheck.error_code,
        });
      }
      
      const progressData = (taskWithContent.progressData ?? {}) as Record<string, any>;
      const sessionPrefetch = progressData.sessionPrefetch ?? {};

      if (taskWithContent.skill && taskWithContent.skill.toLowerCase() === 'listening') {
        const trace = createListeningTraceContext({
          requestId: req.header("x-request-id") ?? undefined,
          traceId: req.header("x-trace-id") ?? undefined,
          correlationId: req.header("x-correlation-id") ?? undefined,
          userId,
          taskId: taskWithContent.id,
          sessionBatchId: progressData.sessionBatchId,
        });
        logPrivacySafe("[Task Content API][Trace]", {
          taskId: id,
          userId,
          trace_id: trace.traceId,
          correlation_id: trace.correlationId,
        }, { nonProdOnly: true });

        const startupGateMode = await resolveStartupGateModeForTaskRecord(taskWithContent as TaskProgressRecord);
        const readiness = await buildManifestReadiness(taskWithContent);
        const startupReady = resolveStartupGateReady(startupGateMode, taskWithContent as TaskProgressRecord, readiness);
        const shouldAutoPrefetch =
          startupGateMode === "legacy" || LISTENING_ROUTE_AUTOPREFETCH;
        if (
          shouldAutoPrefetch &&
          !startupReady &&
          readiness.prefetchStatus !== PREFETCH_STATUS_QUEUED &&
          readiness.prefetchStatus !== PREFETCH_STATUS_RUNNING
        ) {
          try {
          await enqueueListeningPrefetch(taskWithContent, userId, {
            source: "task_content_auto",
          });
          } catch (error) {
            if (!isMissingRelationError(error)) {
              throw error;
            }
            if (!listeningTaskContentPrefetchFallbackWarningEmitted) {
              listeningTaskContentPrefetchFallbackWarningEmitted = true;
              console.warn("[Task Content API][Listening][PrefetchFallback]", {
                taskId: taskWithContent.id,
                userId,
                code: (error as any)?.code ?? null,
                message: (error as any)?.message ?? null,
                remediation:
                  "Apply listening migrations and rerun npm run guard:listening-schema",
              });
            }
          }
        }

        const refreshedTask = await storage.getTaskWithContent(id);
        if (refreshedTask) {
          taskWithContent = refreshedTask;
        }

        const refreshedReadiness = await buildManifestReadiness(taskWithContent);
        const refreshedReady = resolveStartupGateReady(
          startupGateMode,
          taskWithContent as TaskProgressRecord,
          refreshedReadiness,
        );
        const latestPrefetch = ((taskWithContent.progressData ?? {}) as Record<string, any>).sessionPrefetch ?? {};
        const startupTelemetryUpdate = updateStartupWaitTelemetry(
          (taskWithContent.progressData ?? {}) as Record<string, any>,
          { ready: refreshedReady, mode: startupGateMode },
        );
        if (startupTelemetryUpdate.changed) {
          const retainedProgressData = applyListeningTelemetryRetention(startupTelemetryUpdate.progressData);
          await storage.updateTaskProgress(taskWithContent.id, {
            progressData: retainedProgressData,
          });
          taskWithContent.progressData = retainedProgressData;
          markListeningTelemetryTask(taskWithContent.id);
        }

        const minimalTaskContent = {
          id,
          taskTitle: taskWithContent.taskTitle,
          weekNumber: taskWithContent.weekNumber,
          dayNumber: taskWithContent.dayNumber,
          skill: taskWithContent.skill,
          scriptText: null,
          audioUrl: taskWithContent.audioUrl ?? null,
          questions: refreshedReady ? (taskWithContent.questions ?? []) : [],
          progressData: taskWithContent.progressData,
        };

        return res.status(200).json({
          success: true,
          ready: refreshedReady,
          phase: refreshedReadiness.prefetchPhase,
          etaSecs:
            refreshedReadiness.prefetchPhase === 'queued' || refreshedReadiness.prefetchPhase === 'warming'
              ? LISTENING_STATUS_ETA_SECS
              : null,
          startup_gate_mode: startupGateMode,
          startup_gate: {
            mode: startupGateMode,
            ready: refreshedReady,
            autoPrefetch: shouldAutoPrefetch,
          },
          session: {
            status: refreshedReadiness.prefetchPhase,
            retryCount: latestPrefetch.retryCount ?? 0,
            message: latestPrefetch.message ?? 'Preparing listening session assets',
            errorCode: latestPrefetch.errorCode ?? null,
          },
          manifest_status: refreshedReadiness.manifestStatus,
          part_ready: refreshedReadiness.partReady,
          manifest: refreshedReadiness.manifest,
          taskSummary: {
            id,
            title: taskWithContent.taskTitle,
            activityType: latestPrefetch.activityType ?? taskWithContent.scriptType ?? 'dialogue',
            scenario: latestPrefetch.scenario ?? taskWithContent.contextLabel ?? taskWithContent.topicDomain ?? 'Listening Practice',
            sessionMinutes: latestPrefetch.sessionMinutes ?? null,
          },
          taskContent: minimalTaskContent,
        });
      }

      // STEP 1: Auto-generate script if missing (for listening tasks only)
      if (!taskWithContent.scriptText && taskWithContent.taskTitle && 
          taskWithContent.skill && taskWithContent.skill.toLowerCase() === 'listening') {
        
        logNonProdVerbose(`[Pipeline Stage 1] Starting script generation for listening task ${id}`);
        
        try {
          // Generate script using OpenAI
          const scriptResult = await generateListeningScriptForTask(
            taskWithContent,
            5, // Default user level if not available
            7.0 // Default target band if not available
          );
          
          if (scriptResult && scriptResult.success && scriptResult.scriptText && scriptResult.scriptText.trim().length > 0) {
            // Generate dynamic title if needed
            let updatedTitle = taskWithContent.taskTitle;
            if (needsTitleUpdate(taskWithContent.taskTitle) && scriptResult.contextLabel) {
              updatedTitle = makeListeningTaskTitle({
                scriptType: scriptResult.scriptType === 'dialogue' || scriptResult.scriptType === 'monologue'
                  ? scriptResult.scriptType
                  : undefined,
                contextLabel: scriptResult.contextLabel,
                topicDomain: scriptResult.topicDomain,
                scenarioOverview: scriptResult.scenarioOverview
              });
              logNonProdVerbose(`[Pipeline Stage 1] Updated title from "${taskWithContent.taskTitle}" to "${updatedTitle}"`);
            }
            
            // Update task with generated script and metadata
            await storage.updateTaskContent(id, {
              scriptText: scriptResult.scriptText,
              scriptType: scriptResult.scriptType || 'dialogue',
              difficulty: scriptResult.difficulty || 'intermediate',
              accent: scriptResult.accent,
              ieltsPart: scriptResult.ieltsPart,
              topicDomain: scriptResult.topicDomain,
              contextLabel: scriptResult.contextLabel,
              scenarioOverview: scriptResult.scenarioOverview,
              estimatedDurationSec: scriptResult.estimatedDurationSec,
              taskTitle: updatedTitle
            });
            
            // Update the task object with new metadata (but not scriptText for API response)
            taskWithContent.taskTitle = updatedTitle;
            taskWithContent.scriptType = scriptResult.scriptType || 'dialogue';
            taskWithContent.difficulty = scriptResult.difficulty || 'intermediate';
            taskWithContent.accent = scriptResult.accent || null;
            taskWithContent.ieltsPart = scriptResult.ieltsPart || null;
            taskWithContent.topicDomain = scriptResult.topicDomain || null;
            taskWithContent.contextLabel = scriptResult.contextLabel || null;
            taskWithContent.scenarioOverview = scriptResult.scenarioOverview || null;
            taskWithContent.estimatedDurationSec = scriptResult.estimatedDurationSec || null;
            
            logNonProdVerbose(
              `[Pipeline Stage 1] ✅ Script generation completed for task ${id} (${scriptResult.scriptText.length} chars)`,
            );
          } else {
            console.error(`[Pipeline Stage 1] ❌ Script generation failed for task ${id}: ${scriptResult?.error || 'Unknown error'}`);
          }
        } catch (scriptError) {
          console.error(`[Pipeline Stage 1] ❌ Script generation error for task ${id}:`, scriptError);
        }
      } else if (taskWithContent.scriptText) {
        logNonProdVerbose(
          `[Pipeline Stage 1] ✅ Script already exists for task ${id} (${taskWithContent.scriptText.length} chars)`,
        );
      }

      // STEP 2: Auto-generate questions if missing (when scriptText exists and skill is listening)
      if (taskWithContent.scriptText && taskWithContent.skill && 
          taskWithContent.skill.toLowerCase() === 'listening' && !taskWithContent.questions) {
        
        logNonProdVerbose(`[Pipeline Stage 2] Starting question generation for task ${id}`);
        
        try {
          const questionResult = await generateQuestionsFromScript(
            taskWithContent.scriptText,
            taskWithContent.taskTitle || "IELTS Listening Practice",
            taskWithContent.difficulty || "intermediate"
          );
          
          if (questionResult.success && questionResult.questions && questionResult.questions.length > 0) {
            const taggedQuestions = ensureGeneratedQuestionTags(questionResult.questions as any);
            const tagQuality = buildTagQualityReport(taggedQuestions as any);
            let shouldPersistQuestions = true;
            if (!tagQuality.ok) {
              console.warn("[Pipeline Stage 2][TagQuality][DraftWarning]", {
                taskId: id,
                taxonomyVersion: tagQuality.taxonomyVersion,
                issues: tagQuality.issues,
              });
              if (LISTENING_DRAFT_TAG_STRICT) {
                console.error("[Pipeline Stage 2][TagQuality][DraftFailure]", {
                  taskId: id,
                  taxonomyVersion: tagQuality.taxonomyVersion,
                  issues: tagQuality.issues,
                });
                taskWithContent.questions = [];
                shouldPersistQuestions = false;
              }
            }
            if (shouldPersistQuestions) {
              // Update task with generated questions
              await storage.updateTaskContent(id, {
                questions: taggedQuestions
              });

              // Update the task object to return the new questions
              taskWithContent.questions = taggedQuestions;

              logNonProdVerbose(
                `[Pipeline Stage 2] ✅ Question generation completed for task ${id} (${taggedQuestions.length} questions)`,
              );
            }
          } else {
            console.warn(`[Pipeline Stage 2] ❌ Question generation failed for task ${id}: ${questionResult.error}`);
            // Set empty array as fallback instead of null
            taskWithContent.questions = [];
          }
        } catch (questionError) {
          console.error(`[Pipeline Stage 2] ❌ Question generation error for task ${id}:`, questionError);
          // Set empty array as fallback instead of null
          taskWithContent.questions = [];
        }
      } else if (taskWithContent.questions) {
        logNonProdVerbose(
          `[Pipeline Stage 2] ✅ Questions already exist for task ${id} (${Array.isArray(taskWithContent.questions) ? taskWithContent.questions.length : 'unknown'} questions)`,
        );
      }

      // STEP 3: Auto-generate audio if missing (when scriptText exists and skill is listening)
      if (taskWithContent.scriptText && taskWithContent.skill && 
          taskWithContent.skill.toLowerCase() === 'listening' && !taskWithContent.audioUrl) {
        
        if (AUDIO_DEBUG) {
          logNonProdVerbose("[Pipeline Stage 3][Audio][Start]", { taskId: id });
        }
        
        try {
          const scriptValidation = validateTranscriptComplete(taskWithContent.scriptText);
          if (!scriptValidation.ok) {
            console.warn(`[Pipeline Stage 3] Skipping audio generation for task ${id} due to incomplete script`, {
              reason: scriptValidation.reason,
            });
          } else {
            const accent = taskWithContent.accent || "British";
            const audioResult = await generateAudioFromScript(
              taskWithContent.scriptText,
              accent,
              userId,
              id,
              taskWithContent.weekNumber,
              {
                sessionId: String((taskWithContent.progressData as any)?.sessionBatchId ?? id),
                sectionNo: Number((taskWithContent.progressData as any)?.sessionOrder ?? 1),
                correlationId: `task-content-${id}`,
                sectionFallbackAccents: resolveSectionFallbackAccentsFromTask(taskWithContent as TaskProgressRecord),
              },
            );
            
            if (audioResult.success && audioResult.audioUrl && audioResult.duration) {
              const sessionMinutes = resolveSessionMinutesFromTask(taskWithContent);
              // Update task with audio URL (duration remains session-based)
              await storage.updateTaskContent(id, {
                audioUrl: audioResult.audioUrl,
                duration: sessionMinutes,
                accent: accent
              });
              
              // Update the task object to return the new audio info
              taskWithContent.audioUrl = audioResult.audioUrl;
              taskWithContent.duration = sessionMinutes;
              taskWithContent.accent = accent;
              
              if (AUDIO_DEBUG) {
                logNonProdVerbose("[Pipeline Stage 3][Audio][Success]", {
                  taskId: id,
                  durationSec: audioResult.duration,
                });
              }
            } else {
              console.warn("[Pipeline Stage 3][Audio][Failed]", {
                taskId: id,
                reason: audioResult.error ?? "unknown",
              });
            }
          }
        } catch (audioError) {
          console.error("[Pipeline Stage 3][Audio][Error]", {
            taskId: id,
            message: audioError instanceof Error ? audioError.message : "unknown",
          });
        }
      } else if (taskWithContent.audioUrl) {
        if (AUDIO_DEBUG) {
          logNonProdVerbose("[Pipeline Stage 3][Audio][SkipExisting]", {
            taskId: id,
            durationSec: taskWithContent.duration || "unknown",
          });
        }
      }
      
      let rendererPayload: any = null;
      let answerKey: any = null;
      let blockPlan: any = null;
      let rendererIssues: string[] = [];

      // Normalize questions via explicit adapter layer
      if (taskWithContent.questions) {
        const normalizedQuestions = normalizeLegacyQuestionsForApi(taskWithContent.questions);
        taskWithContent.questions = normalizedQuestions.map((q) => ({
          ...q,
          text: q.question,
          type: q.type ?? "multiple-choice",
          options: Array.isArray(q.options)
            ? q.options.map((opt) => ({
                id: opt.id,
                label: opt.text,
                text: opt.text,
              }))
            : [],
        }));

        if (normalizedQuestions.length > 0) {
          try {
            const contract = resolveListeningQuestionContract(taskWithContent as any);
            if (!contract.ok) {
              rendererIssues.push(contract.error);
            } else {
              rendererPayload = contract.rendererPayload;
              answerKey = contract.answerKey;
              blockPlan = contract.blockPlan;
              rendererIssues = contract.issues;
              if (contract.changed) {
                await storage.updateTaskProgress(taskWithContent.id, {
                  progressData: contract.nextProgressData,
                });
                taskWithContent.progressData = contract.nextProgressData;
              }
            }
          } catch (error: any) {
            rendererIssues.push(error?.message ?? "RENDERER_MIGRATION_FAILED");
          }
        }
      }

      // Remove scriptText from API response (keep it in DB but don't expose to client)
      if (taskWithContent.scriptText !== undefined) {
        taskWithContent.scriptText = null;
      }
      
      // Log final payload keys before response
      logNonProdVerbose(`[Task Content API] Final response payload keys for ${id}:`, {
        hasTaskContent: !!taskWithContent,
        hasScriptText: false, // Explicitly removed from response
        hasAudioUrl: !!taskWithContent.audioUrl,
        questionsCount: Array.isArray(taskWithContent.questions) ? taskWithContent.questions.length : 0,
        ieltsPart: taskWithContent.ieltsPart,
      });
      
      return res.status(200).json({
        success: true,
        taskContent: {
          ...taskWithContent,
          questionContract: LISTENING_RENDERER_DUAL_MODE ? {
            mode: "dual",
            renderer: rendererPayload,
            answerKey,
            blockPlan,
          } : {
            mode: "legacy",
          },
        },
        rendererTelemetry: {
          mode: LISTENING_RENDERER_DUAL_MODE ? "dual" : "legacy",
          rendererIssues,
        },
      });
    } catch (error: any) {
      console.error('[Task Content API] Error fetching task content:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch task content"
      });
    }
  });
  
  // Get all weekly plans for a specific week (Firebase Auth version)
  app.get('/api/firebase/weekly-plans/week/:weekNumber', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const weekNumber = parseInt(req.params.weekNumber, 10);
      
      console.log(`[Weekly Plans API] GET weekly plans for week ${weekNumber} for user ${userId}`);
      
      // Validate week number
      if (isNaN(weekNumber) || weekNumber < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid week number. Week number must be a positive integer."
        });
      }
      
      // Get all weekly plans for this week
      const plans = await storage.getWeeklyStudyPlansByWeek(userId, weekNumber);
      const enrichedPlans = await Promise.all(
        plans.map(async (plan) => {
          if (plan.skillFocus !== "listening") {
            return plan;
          }
          try {
            const progressIds = await ensureProgressForWeeklyPlan({
              userId,
              weeklyPlan: plan,
            });
            const progressRows = await storage.getTaskProgressByWeeklyPlan(plan.id, userId);
            const progressById = new Map(progressRows.map((row) => [row.id, row]));
            const parsedPlan = (plan.planData as any) ?? {};
            const nextPlanData = Array.isArray(parsedPlan.plan)
              ? {
                  ...parsedPlan,
                  plan: parsedPlan.plan.map((entry: any, index: number) => {
                    const progressId = progressIds[index] ?? entry?.progressId ?? null;
                    const progress = progressId ? progressById.get(progressId) : null;
                    const coach = ((progress?.progressData ?? {}) as Record<string, any>)?.performanceCoach ?? {};
                    const latest = coach.latest ?? null;
                    const adoptedRecommendations = Array.isArray(coach.adoptedRecommendations)
                      ? coach.adoptedRecommendations
                      : [];
                    return {
                      ...entry,
                      progressId,
                      performanceCoachStatus:
                        latest || adoptedRecommendations.length
                          ? {
                              recommendationAdopted:
                                Boolean(latest?.closed_loop?.recommendation_adopted) || adoptedRecommendations.length > 0,
                              trendImpact: latest?.closed_loop?.trend_impact ?? latest?.trend?.direction ?? null,
                              loopBreakMetric: latest?.closed_loop?.loop_break_metric ?? null,
                              sourceAnalysisId: latest?.closed_loop?.source_analysis_id ?? null,
                            }
                          : null,
                    };
                  }),
                }
              : parsedPlan;

            return {
              ...plan,
              planData: nextPlanData,
            };
          } catch (err) {
            console.error("[Weekly Plans API] Failed to enrich listening plan", {
              planId: plan.id,
              message: (err as any)?.message ?? "unknown",
            });
            return plan;
          }
        }),
      );
      
      console.log(`[Weekly Plans API] Found ${plans.length} weekly plans for week ${weekNumber}`);
      
      return res.status(200).json({
        success: true,
        plans: enrichedPlans,
        weekNumber
      });
    } catch (error: any) {
      console.error(`[Weekly Plans API] Error fetching weekly plans for week:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch weekly plans",
        error: error.message
      });
    }
  });

  // POST task attempt submission for AI Coach analytics
  app.post('/api/firebase/task-progress/:id/attempt', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const { startedAt, submittedAt, durationMs, answers } = req.body ?? {};
      if (!startedAt || !submittedAt || typeof durationMs !== 'number' || !Array.isArray(answers)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid attempt payload. Required fields: startedAt, submittedAt, durationMs, answers' 
        });
      }

      // Load task content for correctness calculation with ownership validation
      const task = await storage.getTaskProgressById(id, userId);
      if (!task) {
        return res.status(404).json({ 
          success: false, 
          message: 'Task not found or access denied' 
        });
      }

      logPrivacySafe(
        "[Task Attempt API] Attempt submission received",
        {
          taskId: id,
          userId,
          answersCount: answers.length,
          durationMs,
        },
        { nonProdOnly: true },
      );

      // Normalize server questions to calculate correctness
      const LETTERS = ['A', 'B', 'C', 'D'];
      const parseSectionNo = (input: unknown) => {
        if (typeof input === "number" && Number.isFinite(input) && input > 0) {
          return Math.round(input);
        }
        if (typeof input !== "string" || !input.trim()) return 0;
        const explicit = input.match(/(?:section|part|sec|s)[\s\-_]*([1-9]\d*)/i);
        if (explicit?.[1]) {
          const parsed = Number(explicit[1]);
          if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return 0;
      };
      const normalizedQs = (Array.isArray(task.questions) ? task.questions : []).map((q: any, qi: number) => {
        const options = Array.isArray(q.options)
          ? q.options.map((opt: any, oi: number) =>
              typeof opt === 'string' 
                ? { id: `option${oi+1}`, text: opt } 
                : { id: opt?.id ?? `option${oi+1}`, text: opt?.text ?? '' }
            )
          : [];
        
        const letter = (q?.correctAnswer ?? '').toString().trim().toUpperCase();
        const idx = LETTERS.indexOf(letter);
        const correctOptionId = idx >= 0 && options[idx] ? options[idx].id : null;
        const fallbackSectionNo = Number(((task.progressData ?? {}) as any)?.sessionOrder ?? 1) || 1;
        const sectionNo =
          parseSectionNo(q?.sectionNo ?? q?.section_no ?? q?.sectionId ?? q?.section_id ?? q?.groupId ?? q?.id) ||
          fallbackSectionNo;
        const questionNo =
          Number.isFinite(Number(q?.questionNo)) && Number(q.questionNo) > 0
            ? Math.round(Number(q.questionNo))
            : Number(String(q?.id ?? `q${qi+1}`).replace(/[^\d]/g, "")) || qi + 1;

        return {
          id: q?.id ?? `q${qi+1}`,
          text: q?.text ?? q?.question ?? '',
          options,
          correctOptionId,
          questionNo,
          sectionNo,
          explanation: q?.explanation ?? '',
        };
      });

      const byId = new Map(normalizedQs.map(q => [q.id, q]));

      // Add type for attempt answer details
      type AttemptAnswerDetail = {
        questionId: string;
        questionNo: number;
        sectionNo: number;
        isCorrect: boolean;
        pickedOptionId: string | null;
        pickedOptionText: string | null;
        correctOptionId: string;
        correctOptionText: string;
        responseTimeMs: number | null;
        answerChangeCount: number;
        replayCount: number;
        unanswered: boolean;
        explanation?: string;
      };

      // Calculate detailed results per question with resolved option text
      const detailed: AttemptAnswerDetail[] = answers.map((a: any) => {
        const q = byId.get(a.questionId);
        const correctOptionId = q?.correctOptionId ?? '';
        const rawPicked = a?.pickedOptionId ?? a?.choiceId ?? null;
        const pickedOptionId = typeof rawPicked === "string" && rawPicked.trim().length > 0 ? rawPicked : null;
        const unanswered = !pickedOptionId;
        const responseTimeMs = Number(a?.responseTimeMs ?? a?.timeMs ?? 0);
        const answerChangeCount = Number(a?.answerChangeCount ?? 0);
        const replayCount = Number(a?.replayCount ?? a?.replayCountAtAnswer ?? 0);
        
        // Find the actual option objects to get their text
        const pickedOption = pickedOptionId ? q?.options?.find((opt: any) => opt.id === pickedOptionId) : null;
        const correctOption = correctOptionId ? q?.options?.find((opt: any) => opt.id === correctOptionId) : null;
        
        const isCorrect = !!(pickedOptionId && correctOptionId && pickedOptionId === correctOptionId);
        
        return {
          questionId: String(a.questionId),
          questionNo: Number(q?.questionNo ?? 0) || Number(String(a.questionId).replace(/[^\d]/g, "")) || 0,
          sectionNo: Number(q?.sectionNo ?? 0) || Number(((task.progressData ?? {}) as any)?.sessionOrder ?? 1) || 1,
          isCorrect,
          pickedOptionId,
          pickedOptionText: pickedOption?.text ?? null,
          correctOptionId,
          correctOptionText: correctOption?.text ?? '',
          responseTimeMs: Number.isFinite(responseTimeMs) && responseTimeMs > 0 ? Math.round(responseTimeMs) : null,
          answerChangeCount: Number.isFinite(answerChangeCount) && answerChangeCount > 0 ? Math.round(answerChangeCount) : 0,
          replayCount: Number.isFinite(replayCount) && replayCount > 0 ? Math.round(replayCount) : 0,
          unanswered,
          explanation: q?.explanation ?? undefined,
        };
      });

      const correct = detailed.filter(d => d.isCorrect).length;
      const total = detailed.length;
      const percent = total ? Math.round((correct / total) * 100) : 0;

      const attempt = {
        id: crypto.randomUUID(),
        taskProgressId: id,
        userId,
        startedAt,
        submittedAt,
        durationMs,
        answers: detailed.map(d => ({
          questionId: d.questionId,
          pickedOptionId: d.pickedOptionId,
          correctOptionId: d.correctOptionId,
          isCorrect: d.isCorrect,
          timeMs: d.responseTimeMs ?? undefined,
          replayCountAtAnswer: d.replayCount,
          answerChangeCount: d.answerChangeCount,
          unanswered: d.unanswered,
          telemetryVersion: LISTENING_TELEMETRY_SCHEMA_VERSION,
        })), // Keep simpler structure for database storage
        score: { correct, total, percent },
      };

      // Persist attempt to database
      await storage.insertTaskAttempt(attempt);
      await recordGovernanceLedgerEntry({
        taskProgressId: id,
        userId,
        sectionId: id,
        sectionNo: Number(((task.progressData ?? {}) as any)?.sessionOrder ?? 1),
        sessionId: String(((task.progressData ?? {}) as any)?.sessionBatchId ?? id),
        attemptId: attempt.id,
        policyVersion: getListeningGovernancePolicyInfo().policyVersion,
        validatorSetVersion: getListeningGovernancePolicyInfo().validatorSetVersion,
        validationVerdict: "PASS",
        actionType: "ATTEMPT_SUBMITTED",
        actorId: userId,
        actorType: "api",
        traceId: req.header("x-trace-id") ?? null,
        correlationId: req.header("x-correlation-id") ?? null,
      });
      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const attemptTelemetry = (progressData.attemptTelemetry ?? {}) as Record<string, any>;
      const events = Array.isArray(attemptTelemetry.events) ? [...attemptTelemetry.events] : [];
      const rolloutState = (progressData.rolloutState ?? {}) as Record<string, any>;
      const rolloutMode = String(
        rolloutState.assignedMode ??
          resolveStartupGateModeForIdentity({ taskProgressId: task.id, userId: task.userId }),
      );
      events.push({
        at: submittedAt,
        eventType: "legacy_attempt_submitted",
        durationMs,
        totalQuestions: total,
        correct,
        unanswered: detailed.filter((answer) => answer.unanswered).length,
        answerChanges: detailed.reduce((sum, answer) => sum + Number(answer.answerChangeCount ?? 0), 0),
        replayCount: detailed.reduce((sum, answer) => sum + Number(answer.replayCount ?? 0), 0),
        timing: buildTimingDistribution(
          detailed
            .map((answer) => Number(answer.responseTimeMs ?? 0))
            .filter((value) => Number.isFinite(value) && value > 0),
        ),
        rollout: {
          mode: rolloutMode,
          percent: getEffectiveRolloutPercent(),
          seed: getEffectiveRolloutSeed(),
          forceRollback: isForceRollbackEnabled(),
        },
      });
      const retained = applyListeningTelemetryRetention({
        ...progressData,
        attemptTelemetry: {
          ...attemptTelemetry,
          version: LISTENING_TELEMETRY_SCHEMA_VERSION,
          events: events.slice(-LISTENING_TELEMETRY_MAX_EVENTS),
        },
      });
      const updatedTaskForCoach = await storage.updateTaskProgress(id, { progressData: retained });
      markListeningTelemetryTask(id);

      let performanceCoach: any = null;
      try {
        const coachAnalysis = await buildListeningPerformanceAnalysis({
          task: updatedTaskForCoach,
          attemptId: attempt.id,
          score: attempt.score,
          outcomes: detailed.map((item) => ({
            questionId: item.questionId,
            questionNo: item.questionNo,
            sectionNo: item.sectionNo,
            isCorrect: item.isCorrect,
            responseTimeMs: item.responseTimeMs,
            answerChangeCount: item.answerChangeCount,
            replayCount: item.replayCount,
            unanswered: item.unanswered,
          })),
        });
        await persistListeningPerformanceAnalysis({
          task: updatedTaskForCoach,
          analysis: coachAnalysis,
        });
        await publishListeningPerformanceCoachEvents({
          task: updatedTaskForCoach,
          analysis: coachAnalysis,
          traceId: req.header("x-trace-id") ?? undefined,
          correlationId: req.header("x-correlation-id") ?? undefined,
        });
        const coachReviewQueueId = await enqueueCoachGovernanceReviewIfNeeded({
          task: updatedTaskForCoach as TaskProgressRecord,
          analysis: coachAnalysis,
          actorId: userId,
          attemptId: attempt.id,
          traceId: req.header("x-trace-id") ?? null,
          correlationId: req.header("x-correlation-id") ?? null,
        });
        performanceCoach = coachReviewQueueId
          ? {
              ...coachAnalysis,
              review_queue_id: coachReviewQueueId,
            }
          : coachAnalysis;
      } catch (coachError: any) {
        console.error("[Task Attempt API][PerformanceCoach] error", {
          taskId: id,
          attemptId: attempt.id,
          message: coachError?.message ?? "unknown",
        });
      }

      logPrivacySafe(
        "[Task Attempt API] Attempt persisted",
        {
          attemptId: attempt.id,
          score: attempt.score,
          detailedCount: detailed.length,
        },
        { nonProdOnly: true },
      );

      return res.json({
        success: true,
        attemptId: attempt.id,
        score: attempt.score,
        detailed,
        performanceCoach,
      });

    } catch (err: any) {
      console.error('[POST /task-progress/:id/attempt] error', err);
      return res.status(500).json({ 
        success: false, 
        message: err?.message ?? 'Server error processing attempt submission' 
      });
    }
  });

  // ========== SESSION MANAGEMENT ENDPOINTS ==========

  app.post('/api/listening/readiness/boost', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    let startupGateMode: ListeningStartupGateMode = LISTENING_STARTUP_GATE_BASE_MODE;
    let taskProgressIdForFallback = String(req.body?.taskProgressId ?? "").trim();
    try {
      const userId = req.user.id;
      const taskProgressId = String(req.body?.taskProgressId ?? "").trim();
      taskProgressIdForFallback = taskProgressId;
      const sourceRaw = String(req.body?.source ?? "session_open").trim().toLowerCase();
      const source = sourceRaw || "session_open";

      if (!taskProgressId) {
        return res.status(400).json({ success: false, message: "taskProgressId is required" });
      }

      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ success: false, message: "Task progress not found" });
      }
      if (String(task.skill ?? "").toLowerCase() !== "listening") {
        return res.status(400).json({ success: false, message: "Boost is available for listening tasks only" });
      }

      startupGateMode = await resolveStartupGateModeForTaskRecord(task as TaskProgressRecord);
      const readinessBefore = await buildManifestReadiness(task as TaskProgressRecord);
      const readyBefore = resolveStartupGateReady(startupGateMode, task as TaskProgressRecord, readinessBefore);
      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const prefetchStatus = String(progressData?.sessionPrefetch?.status ?? readinessBefore.prefetchStatus ?? PREFETCH_STATUS_IDLE);

      let enqueued = false;
      if (
        !readyBefore &&
        prefetchStatus !== PREFETCH_STATUS_QUEUED &&
        prefetchStatus !== PREFETCH_STATUS_RUNNING &&
        prefetchStatus !== PREFETCH_STATUS_READY
      ) {
        await enqueueListeningPrefetch(task as TaskProgressRecord, userId, {
          source,
        });
        enqueued = true;
      }

      const refreshedTask = (await storage.getTaskProgress(task.id)) as TaskProgressRecord | undefined;
      const activeTask = refreshedTask ?? (task as TaskProgressRecord);
      const readiness = await buildManifestReadiness(activeTask);
      const startupReady = resolveStartupGateReady(startupGateMode, activeTask, readiness);

      const boostedProgressData = applyStartupBoostTelemetry(
        (activeTask.progressData ?? {}) as Record<string, any>,
        startupGateMode,
        source,
        enqueued,
      );
      const startupWait = updateStartupWaitTelemetry(boostedProgressData, {
        ready: startupReady,
        mode: startupGateMode,
      });
      const retained = applyListeningTelemetryRetention(
        startupWait.changed ? startupWait.progressData : boostedProgressData,
      );
      await storage.updateTaskProgress(activeTask.id, { progressData: retained });
      markListeningTelemetryTask(activeTask.id);

      return res.status(200).json({
        success: true,
        enqueued,
        ready: startupReady,
        phase: readiness.prefetchPhase,
        etaSecs:
          readiness.prefetchPhase === "queued" || readiness.prefetchPhase === "warming"
            ? LISTENING_STATUS_ETA_SECS
            : null,
        startup_gate_mode: startupGateMode,
      });
    } catch (error: any) {
      if (isMissingRelationError(error)) {
        if (!listeningBoostMissingRelationWarningEmitted) {
          listeningBoostMissingRelationWarningEmitted = true;
          console.warn("[ListeningBoost][SchemaFallback]", {
            taskProgressId: taskProgressIdForFallback,
            startupGateMode,
            code: error?.code ?? null,
            message: error?.message ?? null,
            remediation:
              "Apply listening migrations and rerun npm run guard:listening-schema",
          });
        }
        return res.status(200).json({
          success: true,
          degraded: true,
          enqueued: false,
          ready: false,
          phase: "queued",
          etaSecs: LISTENING_STATUS_ETA_SECS,
          startup_gate_mode: startupGateMode,
          message: "Listening readiness boost temporarily unavailable; retrying with fallback mode.",
        });
      }
      console.error("[ListeningBoost][Error]", error);
      return res.status(500).json({
        success: false,
        message: error?.message ?? "Failed to apply listening readiness boost",
      });
    }
  });

  app.get('/api/listening/readiness/boost-effectiveness/:taskProgressId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId } = req.params;
      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ success: false, message: "Task progress not found" });
      }
      if (String(task.skill ?? "").toLowerCase() !== "listening") {
        return res.status(400).json({ success: false, message: "Boost telemetry is available for listening tasks only" });
      }

      const startupGateMode = await resolveStartupGateModeForTaskRecord(task as TaskProgressRecord);
      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const startupTelemetry = (progressData.startupGateTelemetry ?? {}) as Record<string, any>;
      const summary = summarizeStartupGateTelemetry(startupTelemetry);

      return res.status(200).json({
        success: true,
        startup_gate_mode: startupGateMode,
        telemetry: summary,
      });
    } catch (error: any) {
      console.error("[ListeningBoostEffectiveness][Error]", error);
      return res.status(500).json({
        success: false,
        message: error?.message ?? "Failed to load boost effectiveness telemetry",
      });
    }
  });

  app.post('/api/listening/readiness/rebuild/:taskProgressId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId } = req.params;
      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ ok: false, message: "Task progress not found" });
      }
      if (String(task.skill ?? "").toLowerCase() !== "listening") {
        return res.status(400).json({ ok: false, message: "Readiness rebuild is available for listening tasks only" });
      }

      const rebuilt = await rebuildListeningReadinessFromOutbox(taskProgressId);
      if (!rebuilt.ok) {
        return res.status(404).json({ ok: false, message: rebuilt.message });
      }
      const refreshedTask = await storage.getTaskWithContent(taskProgressId);
      const readiness = refreshedTask ? await buildManifestReadiness(refreshedTask as TaskProgressRecord) : null;

      return res.status(200).json({
        ok: true,
        rebuilt,
        readiness,
      });
    } catch (error: any) {
      console.error("[ListeningReadiness][Rebuild][Error]", error);
      return res.status(500).json({
        ok: false,
        message: error?.message ?? "Failed to rebuild listening readiness model",
      });
    }
  });

  app.get('/api/listening/ops/dashboard', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const limit = Math.max(100, Math.min(5000, Number(req.query.limit ?? 1000)));
      const now = new Date();
      const governanceWindowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const tasks = await loadListeningTasksForUser(userId);
      const queueMetrics = await storage.listListeningQueueMetricsByUser(userId, limit);
      const deadLetters = await storage.listListeningDeadLettersByUser(userId, Math.min(limit, 1000));
      const retryMetrics = getPrefetchRetryMetricsSnapshot();
      const queueSnapshot = getListeningOrchestratorQueueSnapshot();
      const probeRows = await listRecentListeningSyntheticProbeRuns({ limit: 200 });
      const probeScheduler = getListeningSyntheticProbeSchedulerStatus();
      const governanceKpis = await computeGovernanceKpis({
        userId,
        from: governanceWindowStart,
        to: now,
      });

      const stageRows = queueMetrics.filter((row) => String(row.stepName ?? "").startsWith("span:"));
      const stageLatency: Record<string, { count: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; successRatio: number | null; failureRatio: number | null }> = {};
      const stageNames = new Set<string>();
      for (const row of stageRows) {
        const stage = String(row.stepName).replace(/^span:/, "");
        stageNames.add(stage);
      }
      for (const stage of stageNames) {
        const rows = stageRows.filter((row) => String(row.stepName) === `span:${stage}`);
        const durations = rows
          .map((row) => Number(row.enqueueToStartMs))
          .filter((value) => Number.isFinite(value) && value >= 0);
        const successCount = rows.filter((row) => {
          const metadata = (row.metadata ?? {}) as Record<string, any>;
          return metadata.success !== false;
        }).length;
        stageLatency[stage] = {
          count: rows.length,
          p50Ms: percentile(durations, 0.5),
          p95Ms: percentile(durations, 0.95),
          p99Ms: percentile(durations, 0.99),
          successRatio: rows.length > 0 ? Number((successCount / rows.length).toFixed(4)) : null,
          failureRatio: rows.length > 0 ? Number((((rows.length - successCount) / rows.length).toFixed(4))) : null,
        };
      }
      const queueDelayValues = queueMetrics
        .map((row) => Number(row.enqueueToStartMs))
        .filter((value) => Number.isFinite(value) && value >= 0);

      const statusDistribution: Record<string, number> = {};
      const firstSectionTasks = tasks.filter((task) => {
        const pd = (task.progressData ?? {}) as Record<string, any>;
        return Number(pd?.sessionOrder ?? 1) === 1;
      });
      let warmStartReady = 0;
      for (const task of firstSectionTasks) {
        const pd = (task.progressData ?? {}) as Record<string, any>;
        const status = String(pd?.sessionPrefetch?.status ?? PREFETCH_STATUS_IDLE);
        statusDistribution[status] = Number(statusDistribution[status] ?? 0) + 1;
        if (status === PREFETCH_STATUS_READY) {
          warmStartReady += 1;
        }
      }

      const perSectionPublish: Record<string, { published: number; total: number; ratio: number | null }> = {};
      for (const sectionNo of [1, 2, 3, 4]) {
        const scoped = tasks.filter((task) => {
          const pd = (task.progressData ?? {}) as Record<string, any>;
          return Number(pd?.sessionOrder ?? 1) === sectionNo;
        });
        const published = scoped.filter((task) => Boolean((task.progressData as any)?.sectionManifest)).length;
        perSectionPublish[`S${sectionNo}`] = {
          published,
          total: scoped.length,
          ratio: scoped.length > 0 ? Number((published / scoped.length).toFixed(4)) : null,
        };
      }

      const failureByStage: Record<string, number> = {};
      for (const item of deadLetters) {
        const key = String(item.stepName ?? "unknown_stage");
        failureByStage[key] = Number(failureByStage[key] ?? 0) + 1;
      }

      const traceSamples = queueMetrics
        .map((row) => (row.metadata ?? {}) as Record<string, any>)
        .map((metadata) => ({
          trace_id: metadata.trace_id ?? null,
          request_id: metadata.request_id ?? null,
          session_id: metadata.correlation_session_id ?? null,
          section_id: metadata.section_id ?? null,
        }))
        .filter((sample) => sample.trace_id || sample.request_id)
        .slice(0, 20);
      const traceQueryBase = process.env.LISTENING_TRACE_QUERY_URL ?? "/ops/traces";
      const logQueryBase = process.env.LISTENING_LOG_QUERY_URL ?? "/ops/logs";
      const traceLinks = traceSamples.map((sample) => {
        const traceId = sample.trace_id ? encodeURIComponent(sample.trace_id) : "";
        const requestId = sample.request_id ? encodeURIComponent(sample.request_id) : "";
        const sessionId = sample.session_id ? encodeURIComponent(sample.session_id) : "";
        return {
          ...sample,
          trace_link: sample.trace_id ? `${traceQueryBase}?trace_id=${traceId}` : null,
          log_link:
            sample.trace_id || sample.request_id || sample.session_id
              ? `${logQueryBase}?trace_id=${traceId}&request_id=${requestId}&session_id=${sessionId}`
              : null,
        };
      });

      const probeSummaryByStage: Record<string, { total: number; failures: number }> = {};
      for (const row of probeRows) {
        const stage = String(row.stage ?? "unknown");
        if (!probeSummaryByStage[stage]) {
          probeSummaryByStage[stage] = { total: 0, failures: 0 };
        }
        probeSummaryByStage[stage].total += 1;
        if (!row.success) probeSummaryByStage[stage].failures += 1;
      }

      return res.status(200).json({
        ok: true,
        generated_at: new Date().toISOString(),
        queue: {
          depth: queueSnapshot.length,
          delay_p50_ms: percentile(queueDelayValues, 0.5),
          delay_p95_ms: percentile(queueDelayValues, 0.95),
          delay_p99_ms: percentile(queueDelayValues, 0.99),
          stage_latency: stageLatency,
        },
        readiness: {
          first_section_warm_start_success_ratio:
            firstSectionTasks.length > 0 ? Number((warmStartReady / firstSectionTasks.length).toFixed(4)) : null,
          section_prefetch_status_distribution: statusDistribution,
          per_section_publish_completeness: perSectionPublish,
        },
        reliability: {
          retry_ratio:
            retryMetrics.executed > 0
              ? Number((retryMetrics.failed / Math.max(1, retryMetrics.executed)).toFixed(4))
              : null,
          retry_metrics: retryMetrics,
          terminal_failure_rate_by_stage: failureByStage,
          dlq_depth: deadLetters.filter((item) => !item.resolvedAt).length,
        },
        trace_query: {
          ids: traceSamples,
          links: traceLinks,
          trace_base_url: traceQueryBase,
          log_base_url: logQueryBase,
        },
        synthetic_probes: {
          schedule: probeScheduler.configuredSchedule,
          environment: probeScheduler.environment,
          scheduler: probeScheduler,
          stage_summary: probeSummaryByStage,
          latest_runs: probeRows.slice(0, 30),
        },
        governance: {
          window: {
            from: governanceWindowStart.toISOString(),
            to: now.toISOString(),
          },
          kpis: governanceKpis,
        },
      });
    } catch (error: any) {
      console.error("[ListeningOpsDashboard][Error]", error);
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to compute listening dashboard metrics" });
    }
  });

  app.get('/api/listening/ops/alerts/snapshot', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const queueMetrics = await storage.listListeningQueueMetricsByUser(userId, 1000);
      const deadLetters = await storage.listListeningDeadLettersByUser(userId, 500);
      const retryMetrics = getPrefetchRetryMetricsSnapshot();
      const runEvaluation = String(req.query.evaluate ?? "false").toLowerCase() === "true";
      const evaluated = runEvaluation ? await evaluateListeningAlerts() : null;
      const engine = getListeningAlertEngineSnapshot();

      const failuresByStage: Record<string, number> = {};
      for (const item of deadLetters) {
        const key = String(item.stepName ?? "unknown_stage");
        failuresByStage[key] = Number(failuresByStage[key] ?? 0) + 1;
      }
      const topFailingStage =
        Object.entries(failuresByStage).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const providerCounts: Record<string, number> = {};
      for (const [errorCode, count] of Object.entries(retryMetrics.byErrorCode)) {
        const normalized = String(errorCode).toUpperCase();
        const provider =
          normalized.includes("POLLY") || normalized.includes("AWS")
            ? "polly"
            : normalized.includes("OPENAI")
              ? "openai"
              : normalized.includes("TTS")
                ? "tts"
                : "unknown";
        providerCounts[provider] = Number(providerCounts[provider] ?? 0) + Number(count);
      }
      const topFailingProvider =
        Object.entries(providerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const correlationIds = queueMetrics
        .map((row) => (row.metadata ?? {}) as Record<string, any>)
        .map((metadata) => ({
          trace_id: metadata.trace_id ?? null,
          request_id: metadata.request_id ?? null,
          correlation_id: metadata.correlation_session_id ?? null,
        }))
        .filter((entry) => entry.trace_id || entry.request_id || entry.correlation_id)
        .slice(0, 20);

      return res.status(200).json({
        ok: true,
        severity_tiers: engine.severityTiers,
        suppression: {
          dedupe_window_minutes: engine.dedupeWindowMinutes,
          suppression_window_minutes: engine.suppressionWindowMinutes,
        },
        engine,
        evaluation: evaluated,
        alert_payload: {
          top_failing_stage: topFailingStage,
          top_failing_provider: topFailingProvider,
          correlation_ids: correlationIds,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to build alert snapshot" });
    }
  });

  app.get('/api/listening/ops/probes', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const limit = Math.max(1, Math.min(1000, Number(req.query.limit ?? 200)));
      const rows = await listRecentListeningSyntheticProbeRuns({ limit });
      const byRun: Record<string, any> = {};
      for (const row of rows) {
        if (!byRun[row.runId]) {
          byRun[row.runId] = {
            run_id: row.runId,
            environment: row.environment,
            created_at: row.createdAt,
            total: 0,
            failed: 0,
            results: [],
          };
        }
        byRun[row.runId].total += 1;
        if (!row.success) byRun[row.runId].failed += 1;
        byRun[row.runId].results.push(row);
      }
      const runs = Object.values(byRun)
        .sort((a: any, b: any) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)))
        .slice(0, 50);
      return res.status(200).json({
        ok: true,
        scheduler: getListeningSyntheticProbeSchedulerStatus(),
        runs,
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to load synthetic probe runs" });
    }
  });

  app.post('/api/listening/ops/probes/run', verifyFirebaseAuth, ensureFirebaseUser, async (_req: any, res) => {
    try {
      const report = await runListeningSyntheticProbeSuite({
        persist: true,
      });
      return res.status(200).json({
        ok: true,
        report,
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to run synthetic probes" });
    }
  });

  app.get('/api/listening/rollout/status', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    const userId = req.user.id;
    const mode = resolveStartupGateModeForIdentity({ userId });
    return res.status(200).json({
      ok: true,
      rollout_mode: getEffectiveRolloutMode(),
      rollout_percent: getEffectiveRolloutPercent(),
      rollout_seed: getEffectiveRolloutSeed(),
      env_force_rollback: process.env.LISTENING_ROLLOUT_FORCE_ROLLBACK === "true",
      runtime_force_rollback: listeningRolloutRuntime.forceRollback,
      resolved_mode_for_user: mode,
      canary_override: listeningRolloutRuntime.canaryOverride,
      last_rollback_action: listeningRolloutRuntime.rollbackAudit,
    });
  });

  app.get('/api/listening/rollout/canary-scorecard', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const nowMs = Date.now();
      const fromMs = toWindowStartMs(req.query.from, nowMs - 7 * 24 * 60 * 60 * 1000);
      const toMs = toWindowEndMs(req.query.to, nowMs);
      const tasks = await loadListeningTasksForUser(userId);
      const scoped = tasks.filter((task) => {
        const createdAtMs = Date.parse(String(task.createdAt ?? ""));
        return Number.isFinite(createdAtMs) && createdAtMs >= fromMs && createdAtMs <= toMs;
      });

      const summarizeGroup = (groupTasks: TaskProgressRecord[]) => {
        const startupWaits: number[] = [];
        let completed = 0;
        let scoringIntegrityPass = 0;
        for (const task of groupTasks) {
          const pd = (task.progressData ?? {}) as Record<string, any>;
          const startupTelemetry = summarizeStartupGateTelemetry((pd.startupGateTelemetry ?? {}) as Record<string, any>);
          const p95 = Number(startupTelemetry.waitStats?.p90Ms ?? startupTelemetry.waitStats?.p50Ms ?? NaN);
          if (Number.isFinite(p95) && p95 >= 0) startupWaits.push(Math.round(p95));
          if (String(task.status ?? "").toLowerCase() === "completed") completed += 1;

          const sectionResults = Array.isArray(pd.sectionResults) ? pd.sectionResults : [];
          const integrityOk = sectionResults.every((section: any) => {
            const attempted = Number(section?.attempted ?? 0);
            const correct = Number(section?.correct ?? 0);
            const incorrect = Number(section?.incorrect ?? 0);
            const unanswered = Number(section?.unanswered ?? 0);
            return attempted >= 0 && attempted === correct + incorrect + unanswered;
          });
          if (integrityOk) scoringIntegrityPass += 1;
        }
        return {
          sample_size: groupTasks.length,
          completion_rate:
            groupTasks.length > 0 ? Number((completed / groupTasks.length).toFixed(4)) : null,
          startup_latency_p95_ms: percentile(startupWaits, 0.95),
          scoring_integrity_rate:
            groupTasks.length > 0 ? Number((scoringIntegrityPass / groupTasks.length).toFixed(4)) : null,
        };
      };

      const byMode = {
        legacy: [] as TaskProgressRecord[],
        section_ready: [] as TaskProgressRecord[],
      };
      for (const task of scoped) {
        const pd = (task.progressData ?? {}) as Record<string, any>;
        const telemetryMode = String(pd?.startupGateTelemetry?.mode ?? "").trim();
        const resolvedMode =
          telemetryMode === "legacy" || telemetryMode === "section_ready"
            ? (telemetryMode as ListeningStartupGateMode)
            : resolveStartupGateModeForIdentity({ taskProgressId: task.id, userId: task.userId });
        byMode[resolvedMode].push(task);
      }

      const legacy = summarizeGroup(byMode.legacy);
      const canary = summarizeGroup(byMode.section_ready);

      return res.status(200).json({
        ok: true,
        window: {
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
        },
        cohorts: {
          baseline_legacy: legacy,
          canary_new: canary,
        },
      });
    } catch (error: any) {
      console.error("[ListeningCanary][Scorecard][Error]", error);
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to compute canary scorecard" });
    }
  });

  app.post('/api/listening/rollout/canary/override', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "admin")) {
        return res.status(403).json({ ok: false, message: "Admin role is required for canary override" });
      }
      const enabled = Boolean(req.body?.enabled);
      if (!enabled) {
        listeningRolloutRuntime.canaryOverride = null;
        await recordListeningRolloutAudit({
          actionType: "CANARY_OVERRIDE",
          actorId: req.user.id,
          reason: String(req.body?.reason ?? "override_disabled"),
          incidentTicket: String(req.body?.incidentTicket ?? "").trim() || null,
          affectedCohorts: [getEffectiveRolloutMode()],
          metadata: {
            enabled: false,
          },
        });
        return res.status(200).json({ ok: true, override: null });
      }

      const reason = String(req.body?.reason ?? "").trim();
      const incidentTicket = String(req.body?.incidentTicket ?? "").trim();
      if (!reason) {
        return res.status(400).json({ ok: false, message: "reason is required when override is enabled" });
      }
      if (!incidentTicket) {
        return res.status(400).json({ ok: false, message: "incidentTicket is required when override is enabled" });
      }

      listeningRolloutRuntime.canaryOverride = {
        actorId: req.user.id,
        reason,
        incidentTicket,
        at: new Date().toISOString(),
      };
      await recordListeningRolloutAudit({
        actionType: "CANARY_OVERRIDE",
        actorId: req.user.id,
        reason,
        incidentTicket,
        affectedCohorts: [getEffectiveRolloutMode()],
        metadata: {
          enabled: true,
        },
      });
      console.warn("[ListeningRollout][CanaryOverride]", listeningRolloutRuntime.canaryOverride);
      return res.status(200).json({ ok: true, override: listeningRolloutRuntime.canaryOverride });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to update canary override" });
    }
  });

  const evaluateCanaryPromotionGate = async (params: {
    userId: string;
    fromMs: number;
    toMs: number;
  }) => {
    const tasks = await loadListeningTasksForUser(params.userId);
    const scoped = tasks.filter((task) => {
      const createdAtMs = Date.parse(String(task.createdAt ?? ""));
      return Number.isFinite(createdAtMs) && createdAtMs >= params.fromMs && createdAtMs <= params.toMs;
    });
    const canary = scoped.filter((task) => {
      const pd = (task.progressData ?? {}) as Record<string, any>;
      const telemetryMode = String(pd?.startupGateTelemetry?.mode ?? "").trim();
      if (telemetryMode === "section_ready") return true;
      if (telemetryMode === "legacy") return false;
      return resolveStartupGateModeForIdentity({ taskProgressId: task.id, userId: task.userId }) === "section_ready";
    });
    const completed = canary.filter((task) => String(task.status ?? "").toLowerCase() === "completed").length;
    const startupValues = canary
      .map((task) => summarizeStartupGateTelemetry((((task.progressData ?? {}) as Record<string, any>).startupGateTelemetry ?? {}) as Record<string, any>))
      .map((summary) => Number(summary.waitStats?.p90Ms ?? NaN))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const integrityPass = canary.filter((task) => {
      const sectionResults = Array.isArray(((task.progressData ?? {}) as any).sectionResults)
        ? (((task.progressData ?? {}) as any).sectionResults as any[])
        : [];
      return sectionResults.every((section) => {
        const attempted = Number(section?.attempted ?? 0);
        const correct = Number(section?.correct ?? 0);
        const incorrect = Number(section?.incorrect ?? 0);
        const unanswered = Number(section?.unanswered ?? 0);
        return attempted >= 0 && attempted === correct + incorrect + unanswered;
      });
    }).length;

    const completionRate = canary.length > 0 ? completed / canary.length : 0;
    const startupP95 = percentile(startupValues, 0.95);
    const integrityRate = canary.length > 0 ? integrityPass / canary.length : 0;
    const checks = {
      sample_size: {
        pass: canary.length >= LISTENING_CANARY_MIN_SAMPLE,
        actual: canary.length,
        threshold: LISTENING_CANARY_MIN_SAMPLE,
      },
      completion_rate: {
        pass: completionRate >= LISTENING_CANARY_MIN_COMPLETION_RATE,
        actual: Number(completionRate.toFixed(4)),
        threshold: LISTENING_CANARY_MIN_COMPLETION_RATE,
      },
      startup_latency_p95_ms: {
        pass: startupP95 === null ? false : startupP95 <= LISTENING_CANARY_MAX_STARTUP_P95_MS,
        actual: startupP95,
        threshold: LISTENING_CANARY_MAX_STARTUP_P95_MS,
      },
      scoring_integrity_rate: {
        pass: integrityRate >= LISTENING_CANARY_MIN_SCORING_INTEGRITY,
        actual: Number(integrityRate.toFixed(4)),
        threshold: LISTENING_CANARY_MIN_SCORING_INTEGRITY,
      },
    };
    const failedChecks = Object.entries(checks).filter(([, value]) => !value.pass).map(([key]) => key);
    const autoPromotable = failedChecks.length === 0;
    const override = listeningRolloutRuntime.canaryOverride;
    const promotable = autoPromotable || Boolean(override);
    return {
      checks,
      failedChecks,
      autoPromotable,
      promotable,
      override,
    };
  };

  app.get('/api/listening/rollout/canary/promotion-check', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const nowMs = Date.now();
      const fromMs = toWindowStartMs(req.query.from, nowMs - 7 * 24 * 60 * 60 * 1000);
      const toMs = toWindowEndMs(req.query.to, nowMs);
      const evaluation = await evaluateCanaryPromotionGate({
        userId,
        fromMs,
        toMs,
      });

      return res.status(200).json({
        ok: true,
        window: {
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
        },
        checks: evaluation.checks,
        failed_checks: evaluation.failedChecks,
        auto_promotable: evaluation.autoPromotable,
        promotable: evaluation.promotable,
        blocked: !evaluation.promotable,
        override: evaluation.override,
      });
    } catch (error: any) {
      console.error("[ListeningCanary][PromotionCheck][Error]", error);
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to evaluate canary promotion gate" });
    }
  });

  app.post('/api/listening/rollout/canary/promote', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "admin")) {
        return res.status(403).json({ ok: false, message: "Admin role is required for canary promotion" });
      }
      const blockedByGovernanceReview = await hasOutstandingMandatoryReprioritization();
      if (blockedByGovernanceReview) {
        return res.status(409).json({
          ok: false,
          message: "Canary promotion blocked: mandatory governance backlog reprioritization is still open",
        });
      }
      const userId = req.user.id;
      const mode = String(req.body?.mode ?? "").trim().toLowerCase();
      const reason = String(req.body?.reason ?? "").trim();
      const incidentTicket = String(req.body?.incidentTicket ?? "").trim();
      const expectedImpact = String(req.body?.expectedImpact ?? "").trim();
      const rollbackCriteria = String(req.body?.rollbackCriteria ?? "").trim();
      const isEmergency = req.body?.isEmergency === true;
      const percentRaw = Number(req.body?.percent ?? getEffectiveRolloutPercent());
      const percent = Math.max(0, Math.min(100, Number.isFinite(percentRaw) ? percentRaw : getEffectiveRolloutPercent()));
      const seed = String(req.body?.seed ?? getEffectiveRolloutSeed()).trim() || getEffectiveRolloutSeed();
      if (!["legacy", "cohort", "new"].includes(mode)) {
        return res.status(400).json({ ok: false, message: "mode must be one of: legacy, cohort, new" });
      }
      if (!reason) {
        return res.status(400).json({ ok: false, message: "reason is required" });
      }
      if (!expectedImpact || !rollbackCriteria) {
        return res.status(400).json({ ok: false, message: "expectedImpact and rollbackCriteria are required" });
      }
      if (isEmergency && !incidentTicket) {
        return res.status(400).json({ ok: false, message: "incidentTicket is required for emergency promotion" });
      }
      const postHocReviewDueAt = isEmergency
        ? new Date(Date.now() + LISTENING_GOVERNANCE_EMERGENCY_REVIEW_SLA_HOURS * 60 * 60 * 1000).toISOString()
        : null;

      const nowMs = Date.now();
      const fromMs = toWindowStartMs(req.body?.from, nowMs - 7 * 24 * 60 * 60 * 1000);
      const toMs = toWindowEndMs(req.body?.to, nowMs);
      const evaluation = await evaluateCanaryPromotionGate({
        userId,
        fromMs,
        toMs,
      });
      if (!evaluation.promotable) {
        return res.status(409).json({
          ok: false,
          message: "Canary promotion blocked by health gates",
          failed_checks: evaluation.failedChecks,
          checks: evaluation.checks,
        });
      }

      listeningRolloutRuntime.rolloutModeOverride = mode as "legacy" | "cohort" | "new";
      listeningRolloutRuntime.rolloutPercentOverride = percent;
      listeningRolloutRuntime.rolloutSeedOverride = seed;
      process.env.LISTENING_ROLLOUT_MODE = mode;
      process.env.LISTENING_ROLLOUT_PERCENT = String(percent);
      process.env.LISTENING_ROLLOUT_SEED = seed;

      await recordListeningRolloutAudit({
        actionType: "CANARY_PROMOTION",
        actorId: req.user.id,
        reason,
        incidentTicket: incidentTicket || null,
        affectedCohorts: [mode],
        metadata: {
          mode,
          percent,
          seed,
          expected_impact: expectedImpact,
          rollback_criteria: rollbackCriteria,
          emergency_change: isEmergency,
          post_hoc_review_due_at: postHocReviewDueAt,
          approver_id: req.user.id,
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
          failed_checks: evaluation.failedChecks,
          override_used: Boolean(evaluation.override),
        },
      });

      return res.status(200).json({
        ok: true,
        mode,
        percent,
        seed,
        expected_impact: expectedImpact,
        rollback_criteria: rollbackCriteria,
        emergency_change: isEmergency,
        post_hoc_review_due_at: postHocReviewDueAt,
        checks: evaluation.checks,
        failed_checks: evaluation.failedChecks,
        override_used: Boolean(evaluation.override),
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to promote canary rollout" });
    }
  });

  app.post('/api/listening/rollout/rollback-switch', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "admin")) {
        return res.status(403).json({ ok: false, message: "Admin role is required for rollback switch" });
      }
      const enabled = Boolean(req.body?.enabled);
      const reason = String(req.body?.reason ?? "").trim();
      const expectedImpact = String(req.body?.expectedImpact ?? "").trim();
      const rollbackCriteria = String(req.body?.rollbackCriteria ?? "").trim();
      const isEmergency = req.body?.isEmergency === true;
      const incidentTicketRaw = req.body?.incidentTicket;
      const incidentTicket =
        typeof incidentTicketRaw === "string" && incidentTicketRaw.trim().length > 0
          ? incidentTicketRaw.trim()
          : null;
      const affectedCohorts = Array.isArray(req.body?.affectedCohorts)
        ? req.body.affectedCohorts.map((value: any) => String(value)).filter((value: string) => value.length > 0)
        : [getEffectiveRolloutMode()];

      if (enabled && !reason) {
        return res.status(400).json({ ok: false, message: "reason is required when enabling rollback switch" });
      }
      if (enabled && (!expectedImpact || !rollbackCriteria)) {
        return res.status(400).json({ ok: false, message: "expectedImpact and rollbackCriteria are required" });
      }
      if (enabled && isEmergency && !incidentTicket) {
        return res.status(400).json({ ok: false, message: "incidentTicket is required for emergency rollback" });
      }
      const postHocReviewDueAt = enabled && isEmergency
        ? new Date(Date.now() + LISTENING_GOVERNANCE_EMERGENCY_REVIEW_SLA_HOURS * 60 * 60 * 1000).toISOString()
        : null;

      listeningRolloutRuntime.forceRollback = enabled;
      process.env.LISTENING_ROLLOUT_FORCE_ROLLBACK = enabled ? "true" : "false";
      if (enabled) {
        listeningRolloutRuntime.rollbackAudit = {
          actorId: req.user.id,
          reason,
          incidentTicket,
          affectedCohorts,
          at: new Date().toISOString(),
        };
      }
      await recordListeningRolloutAudit({
        actionType: "ROLLBACK_SWITCH",
        actorId: req.user.id,
        reason: reason || (enabled ? "rollback_enabled" : "rollback_disabled"),
        incidentTicket,
        affectedCohorts,
        metadata: {
          enabled,
          rollout_mode: getEffectiveRolloutMode(),
          rollout_percent: getEffectiveRolloutPercent(),
          expected_impact: expectedImpact || null,
          rollback_criteria: rollbackCriteria || null,
          emergency_change: isEmergency,
          post_hoc_review_due_at: postHocReviewDueAt,
          approver_id: req.user.id,
        },
      });

      console.warn("[ListeningRollout][RollbackSwitch]", {
        enabled,
        actor_id: req.user.id,
        reason,
        incident_ticket: incidentTicket,
        affected_cohorts: affectedCohorts,
        timestamp: new Date().toISOString(),
      });

      return res.status(200).json({
        ok: true,
        runtime_force_rollback: listeningRolloutRuntime.forceRollback,
        audit: listeningRolloutRuntime.rollbackAudit,
        post_hoc_review_due_at: postHocReviewDueAt,
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to update rollback switch" });
    }
  });

  app.get('/api/listening/rollout/post-rollback-report', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const nowMs = Date.now();
      const latestRollback = await getLatestListeningRolloutAudit("ROLLBACK_SWITCH");
      const defaultSinceMs = latestRollback?.createdAt
        ? Date.parse(String(latestRollback.createdAt))
        : nowMs - 24 * 60 * 60 * 1000;
      const sinceMs = toWindowStartMs(req.query.since, defaultSinceMs);
      const tasks = await loadListeningTasksForUser(userId);
      const scoped = tasks.filter((task) => {
        const createdAtMs = Date.parse(String(task.createdAt ?? ""));
        return Number.isFinite(createdAtMs) && createdAtMs >= sinceMs;
      });
      const impactedTasks = scoped.filter((task) => {
        const pd = (task.progressData ?? {}) as Record<string, any>;
        const assigned = String(pd?.rolloutState?.assignedMode ?? "").trim();
        return assigned ? assigned === "legacy" : resolveStartupGateModeForIdentity({
          taskProgressId: task.id,
          userId: task.userId,
        }) === "legacy";
      });
      const estimatedImpactedUsers = new Set(impactedTasks.map((task) => String(task.userId))).size;
      const estimatedImpactedSessions = impactedTasks.length;
      const rollbackAudit = latestRollback
        ? {
            actorId: latestRollback.actorId,
            reason: latestRollback.reason,
            incidentTicket: latestRollback.incidentTicket ?? null,
            affectedCohorts: normalizeCohorts(latestRollback.affectedCohorts, [getEffectiveRolloutMode()]),
            at: new Date(latestRollback.createdAt).toISOString(),
          }
        : listeningRolloutRuntime.rollbackAudit;

      return res.status(200).json({
        ok: true,
        generated_at: new Date().toISOString(),
        rollback: {
          runtime_force_rollback: listeningRolloutRuntime.forceRollback,
          audit: rollbackAudit,
        },
        impact_estimate: {
          users: estimatedImpactedUsers,
          sessions: estimatedImpactedSessions,
          since: new Date(sinceMs).toISOString(),
        },
        recovery_verification_steps: [
          "Confirm new listening sessions resolve to legacy startup gate mode.",
          "Verify section manifests remain integrity-valid for in-flight sessions.",
          "Run synthetic probe suite and confirm no critical-path failures.",
          "Confirm publish success and DLQ growth return to baseline.",
          "Document incident timeline and attach rollback reason/ticket to incident review.",
        ],
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to generate post-rollback report" });
    }
  });

  app.get('/api/session/next-part-status/:taskProgressId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId } = req.params;
      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ success: false, message: "Task progress not found" });
      }
      const startupGateMode = await resolveStartupGateModeForTaskRecord(task as TaskProgressRecord);

      const status = await getNextPartStatusForTask(task as TaskProgressRecord, userId);

      return res.status(200).json({
        success: true,
        status: status.status,
        phase: status.phase,
        etaSecs: status.etaSecs,
        progressId: status.progressId,
        message: status.message,
        retryCount: status.retryCount ?? 0,
        final: status.final,
        transition_timeout_secs: LISTENING_TRANSITION_TIMEOUT_SECS,
        startup_gate_mode: startupGateMode,
      });
    } catch (error: any) {
      console.error("[SessionNextPartStatus][Error]", error);
      return res.status(500).json({ success: false, message: error?.message ?? "Failed to load next-part status" });
    }
  });

  // Start or resume a session for a task
  app.post('/api/session/start', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId, durationMinutes } = req.body;

      if (!taskProgressId || !durationMinutes) {
        return res.status(400).json({
          success: false,
          message: 'taskProgressId and durationMinutes are required'
        });
      }

      // Get task progress
      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied or task not found'
        });
      }

      const now = Date.now();
      const progressData = task.progressData as any || {};
      let sessionState: import('@shared/schema').SessionState = progressData.sessionState;

      // Initialize or resume session
      if (!sessionState || !sessionState.startedAt) {
        // New session
        sessionState = {
          status: "running",
          durationMinutes,
          startedAt: now,
          consumedMs: 0,
          remainingMs: durationMinutes * 60_000,
          currentAudioIndex: 0,
          lastSyncedAt: now
        };
      } else if (sessionState.status === "paused") {
        // Resume from pause
        sessionState.status = "running";
        sessionState.pausedAt = undefined;
        sessionState.lastSyncedAt = now;
      }

      // Update task
      await storage.updateTaskProgress(taskProgressId, {
        progressData: { ...progressData, sessionState },
        status: "in-progress",
        startedAt: task.startedAt || new Date()
      });

      console.log('[Session Start]', { userId, taskProgressId, status: sessionState.status });
      const readiness = await buildManifestReadiness(task as TaskProgressRecord);
      const startupGateMode = await resolveStartupGateModeForTaskRecord(task as TaskProgressRecord);

      return res.json({
        success: true,
        sessionState,
        manifest_status: readiness.manifestStatus,
        part_ready: readiness.partReady,
        manifest: readiness.manifest,
        startup_gate_mode: startupGateMode,
      });

    } catch (err: any) {
      console.error('[POST /session/start] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error starting session'
      });
    }
  });

  // Pause a running session
  app.post('/api/session/pause', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId } = req.body;

      if (!taskProgressId) {
        return res.status(400).json({
          success: false,
          message: 'taskProgressId is required'
        });
      }

      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied or task not found'
        });
      }

      const now = Date.now();
      const progressData = task.progressData as any || {};
      const sessionState: import('@shared/schema').SessionState = progressData.sessionState;
      const readiness = await buildManifestReadiness(task as TaskProgressRecord);
      const startupGateMode = await resolveStartupGateModeForTaskRecord(task as TaskProgressRecord);

      if (!sessionState) {
        return res.status(400).json({
          success: false,
          message: 'No active session found'
        });
      }

      // Calculate consumed time
      if (sessionState.status === "running") {
        const activeTime = now - (sessionState.pausedAt || sessionState.startedAt || now);
        sessionState.consumedMs += activeTime;
        sessionState.remainingMs = (sessionState.durationMinutes * 60_000) - sessionState.consumedMs;
        sessionState.status = "paused";
        sessionState.pausedAt = now;
        sessionState.lastSyncedAt = now;
      }

      await storage.updateTaskProgress(taskProgressId, {
        progressData: { ...progressData, sessionState }
      });

      console.log('[Session Pause]', { userId, taskProgressId, remainingMs: sessionState.remainingMs });

      return res.json({
        success: true,
        sessionState,
        manifest_status: readiness.manifestStatus,
        part_ready: readiness.partReady,
        manifest: readiness.manifest,
        startup_gate_mode: startupGateMode,
      });

    } catch (err: any) {
      console.error('[POST /session/pause] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error pausing session'
      });
    }
  });

  // Resume a paused session
  app.post('/api/session/resume', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId } = req.body;

      if (!taskProgressId) {
        return res.status(400).json({
          success: false,
          message: 'taskProgressId is required'
        });
      }

      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied or task not found'
        });
      }

      const now = Date.now();
      const progressData = task.progressData as any || {};
      const sessionState: import('@shared/schema').SessionState = progressData.sessionState;
      const readiness = await buildManifestReadiness(task as TaskProgressRecord);
      const startupGateMode = await resolveStartupGateModeForTaskRecord(task as TaskProgressRecord);

      if (!sessionState || sessionState.status !== "paused") {
        return res.status(400).json({
          success: false,
          message: 'No paused session found'
        });
      }

      sessionState.status = "running";
      sessionState.pausedAt = undefined;
      sessionState.lastSyncedAt = now;

      await storage.updateTaskProgress(taskProgressId, {
        progressData: { ...progressData, sessionState }
      });

      console.log('[Session Resume]', { userId, taskProgressId, remainingMs: sessionState.remainingMs });

      return res.json({
        success: true,
        sessionState,
        manifest_status: readiness.manifestStatus,
        part_ready: readiness.partReady,
        manifest: readiness.manifest,
        startup_gate_mode: startupGateMode,
      });

    } catch (err: any) {
      console.error('[POST /session/resume] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error resuming session'
      });
    }
  });

  // Finish a session (natural completion or expiry)
  app.post('/api/session/finish', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId, sessionResult, isExpired } = req.body;

      if (!taskProgressId || !sessionResult) {
        return res.status(400).json({
          success: false,
          message: 'taskProgressId and sessionResult are required'
        });
      }

      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied or task not found'
        });
      }

      const now = Date.now();
      const progressData = task.progressData as any || {};
      const sessionState: import('@shared/schema').SessionState = progressData.sessionState;
      const readiness = await buildManifestReadiness(task as TaskProgressRecord);
      const startupGateMode = await resolveStartupGateModeForTaskRecord(task as TaskProgressRecord);

      if (!sessionState) {
        return res.status(400).json({
          success: false,
          message: 'No active session found'
        });
      }

      // Update session state
      sessionState.status = isExpired ? "expired" : "completed";
      sessionState.sessionResult = sessionResult;
      sessionState.readyForStrike = true;
      sessionState.lastSyncedAt = now;

      const rendererMode = deriveRendererMode({
        requested: req.body?.rendererMode,
        fallbackDualEnabled: LISTENING_RENDERER_DUAL_MODE,
      });
      const mergedProgressData = applyRendererTelemetryUpdate(progressData, {
        mode: rendererMode,
        completionAttempt: true,
        completed: !isExpired,
        taskProgressId,
      });

      await storage.updateTaskProgress(taskProgressId, {
        progressData: { ...mergedProgressData, sessionState },
        status: "completed",
        completedAt: new Date()
      });

      console.log('[Session Finish]', { userId, taskProgressId, status: sessionState.status });

      return res.json({
        success: true,
        sessionState,
        manifest_status: readiness.manifestStatus,
        part_ready: readiness.partReady,
        manifest: readiness.manifest,
        startup_gate_mode: startupGateMode,
      });

    } catch (err: any) {
      console.error('[POST /session/finish] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error finishing session'
      });
    }
  });

  // Sync session state (for drift prevention)
  app.get('/api/session/sync/:taskProgressId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId } = req.params;

      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied or task not found'
        });
      }

      const now = Date.now();
      const progressData = task.progressData as any || {};
      const sessionState: import('@shared/schema').SessionState = progressData.sessionState;
      const readiness = await buildManifestReadiness(task as TaskProgressRecord);
      const startupGateMode = await resolveStartupGateModeForTaskRecord(task as TaskProgressRecord);

      if (!sessionState) {
        return res.json({
          success: true,
          sessionState: null,
          manifest_status: readiness.manifestStatus,
          part_ready: readiness.partReady,
          manifest: readiness.manifest,
          startup_gate_mode: startupGateMode,
        });
      }

      // Update remaining time if running
      if (sessionState.status === "running" && sessionState.startedAt) {
        const activeTime = now - (sessionState.pausedAt || sessionState.startedAt);
        sessionState.consumedMs += activeTime;
        sessionState.remainingMs = Math.max(0, (sessionState.durationMinutes * 60_000) - sessionState.consumedMs);
        sessionState.lastSyncedAt = now;

        // Auto-expire if time ran out
        if (sessionState.remainingMs <= 0) {
          sessionState.status = "expired";
        }

        // Update in DB
        await storage.updateTaskProgress(taskProgressId, {
          progressData: { ...progressData, sessionState }
        });
      }

      return res.json({
        success: true,
        sessionState,
        manifest_status: readiness.manifestStatus,
        part_ready: readiness.partReady,
        manifest: readiness.manifest,
        startup_gate_mode: startupGateMode,
      });

    } catch (err: any) {
      console.error('[GET /session/sync] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error syncing session'
      });
    }
  });

  // Get AI advisor feedback for a completed audio
  app.post('/api/session/advisor', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const { audioIndex, questions, scriptExcerpt } = req.body;

      if (audioIndex === undefined || !Array.isArray(questions)) {
        return res.status(400).json({
          success: false,
          message: 'audioIndex and questions array are required'
        });
      }

      const feedback = await generateAdvisorFeedback({
        audioIndex,
        questions,
        scriptExcerpt
      });

      if (!feedback.success) {
        return res.status(500).json(feedback);
      }

      return res.json(feedback);

    } catch (err: any) {
      console.error('[POST /session/advisor] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error generating advisor feedback'
      });
    }
  });

  // Get latest full-session performance coach analysis for a listening task
  app.get('/api/session/performance-analysis/:taskProgressId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId } = req.params;
      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({
          success: false,
          message: 'Task not found or access denied',
        });
      }

      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const coach = (progressData.performanceCoach ?? {}) as Record<string, any>;

      return res.status(200).json({
        success: true,
        analysis: coach.latest ?? null,
        closedLoop: coach.closedLoop ?? null,
        updatedAt: coach.updatedAt ?? null,
        version: coach.version ?? null,
      });
    } catch (err: any) {
      console.error('[GET /session/performance-analysis] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error loading performance analysis',
      });
    }
  });

  // Create next listening task during a session (Firebase Auth version)
  app.post('/api/session/next-listening-task', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { progressId, taskId, remainingMs } = req.body;
      const startupGateModeForRequest = resolveStartupGateModeForIdentity({
        taskProgressId: String(progressId ?? taskId ?? ""),
        userId,
      });
      
      // Validate remaining time
      if (remainingMs < NEXT_MIN_MS) {
        console.log('[NEXT][server]', { userId, fromProgressId: progressId, remainingMs, ok: false, reason: 'time_exhausted' });
        return res.status(200).json({
          ok: false,
          reason: 'time_exhausted',
          startup_gate_mode: startupGateModeForRequest,
        });
      }
      
      // Verify user owns the progressId
      const currentTask = await storage.getTaskProgress(progressId);
      if (!currentTask || currentTask.userId !== userId) {
        return res.status(403).json({
          ok: false,
          reason: 'access_denied'
        });
      }
      
      const currentProgressData = (currentTask.progressData ?? {}) as Record<string, any>;
      const currentTaskStartupGateMode = await resolveStartupGateModeForTaskRecord(currentTask as TaskProgressRecord);
      const batchId =
        typeof currentProgressData.sessionBatchId === 'string'
          ? currentProgressData.sessionBatchId
          : null;
      const currentOrder =
        typeof currentProgressData.sessionOrder === 'number'
          ? currentProgressData.sessionOrder
          : null;

      if (batchId && currentOrder !== null && currentTask.weeklyPlanId) {
        const planTasks = await storage.getTaskProgressByWeeklyPlan(currentTask.weeklyPlanId, userId);
        const previousSectionMissing = planTasks.some((task) => {
          const pd = (task.progressData ?? {}) as Record<string, any>;
          if (pd?.sessionBatchId !== batchId) return false;
          const order = Number(pd?.sessionOrder ?? 0);
          if (!Number.isFinite(order) || order <= 0) return false;
          if (order >= currentOrder + 1) return false;
          const status = (pd?.sessionPrefetch?.status ?? PREFETCH_STATUS_IDLE) as string;
          return !PREFETCH_READY_STATES.has(status as any);
        });
        if (previousSectionMissing) {
          console.warn("[NEXT][order_violation]", {
            userId,
            progressId,
            requestedSectionNo: currentOrder + 1,
          });
          return res.status(409).json({
            ok: false,
            reason: "section_order_violation",
            error: {
              code: "SECTION_ORDER_VIOLATION",
              requested_section_no: currentOrder + 1,
            },
          });
        }
      }

      if (batchId && currentTask.weeklyPlanId) {
        const planTasks = await storage.getTaskProgressByWeeklyPlan(currentTask.weeklyPlanId, userId);
        const nextPrefetched = planTasks
          .filter((task) => {
            if (task.id === currentTask.id) return false;
            const pd = (task.progressData ?? {}) as Record<string, any>;
            if (pd?.sessionBatchId !== batchId) return false;
            if (typeof pd?.sessionOrder !== 'number') return false;
            if (currentOrder !== null && pd.sessionOrder <= currentOrder) return false;
            if (task.status !== 'not-started') return false;

            // Filter by readiness: only fully ready status is eligible in critical path.
            const sessionPrefetch = pd?.sessionPrefetch ?? {};
            const status = sessionPrefetch.status ?? PREFETCH_STATUS_IDLE;
            const ready = status === PREFETCH_STATUS_READY && Boolean(task.audioUrl);

            return ready;
          })
          .sort((a, b) => {
            const ao = ((a.progressData ?? {}) as any)?.sessionOrder ?? 0;
            const bo = ((b.progressData ?? {}) as any)?.sessionOrder ?? 0;
            return ao - bo;
          })[0];

        if (nextPrefetched) {
          const readiness = await buildManifestReadiness(nextPrefetched as TaskProgressRecord);
          console.log('[NEXT][server]', {
            userId,
            fromProgressId: progressId,
            remainingMs,
            ok: true,
            progressId: nextPrefetched.id,
            source: 'prefetch',
          });

          return res.status(200).json({
            ok: true,
            progressId: nextPrefetched.id,
            taskId: nextPrefetched.id,
            manifest_status: readiness.manifestStatus,
            part_ready: readiness.partReady,
            manifest: readiness.manifest,
            startup_gate_mode: currentTaskStartupGateMode,
            transition_timeout_secs: LISTENING_TRANSITION_TIMEOUT_SECS,
          });
        }

        // No ready task found - return warming state
        const hasWarmingTasks = planTasks.some((task) => {
          const pd = (task.progressData ?? {}) as Record<string, any>;
          if (pd?.sessionBatchId !== batchId) return false;
          const sessionPrefetch = pd?.sessionPrefetch ?? {};
          const status = sessionPrefetch.status ?? PREFETCH_STATUS_IDLE;
          return status === PREFETCH_STATUS_QUEUED || status === PREFETCH_STATUS_RUNNING;
        });

        if (hasWarmingTasks) {
          console.log('[NEXT][server]', {
            userId,
            fromProgressId: progressId,
            remainingMs,
            ok: false,
            reason: 'warming',
          });

          return res.status(200).json({
            ok: false,
            reason: 'warming',
            phase: 'warming',
            message: 'Preparing next task in session',
            etaSecs: LISTENING_STATUS_ETA_SECS,
            manifest_status: "warming",
            part_ready: false,
            manifest: null,
            startup_gate_mode: currentTaskStartupGateMode,
            transition_timeout_secs: LISTENING_TRANSITION_TIMEOUT_SECS,
          });
        }
      }

      // Create follow-up task
      const result = await createFollowUpListeningTask({
        userId,
        from: { progressId, taskId }
      });
      
      console.log('[NEXT][server]', { userId, fromProgressId: progressId, remainingMs, ok: true, ...result });
      const newTask = await storage.getTaskProgress(result.progressId);
      if (newTask) {
        const requestedSectionNo = Number(((newTask.progressData ?? {}) as any).sessionOrder ?? 1);
        const ordering = await enforceSequentialPolicy(newTask as TaskProgressRecord, requestedSectionNo);
        if (!ordering.ok) {
          return res.status(409).json({
            ok: false,
            reason: "section_order_violation",
            error: ordering.error,
          });
        }
        const dispatch = dispatchSectionBuildRequested({
          task: newTask as TaskProgressRecord,
          sectionNo: requestedSectionNo,
        });
        console.log("[NEXT][dispatch]", {
          progressId: result.progressId,
          sectionId: dispatch.sectionId,
          sectionNo: dispatch.sectionNo,
          traceId: dispatch.trace.traceId,
          correlationId: dispatch.trace.correlationId,
        });
        const nextPriority = deriveListeningPriority({
          sessionStartAt: newTask.startedAt ?? newTask.createdAt ?? null,
          dashboardOpenBoost: false,
          startClickBoost: true,
          readinessGap: 1,
        });
        enqueueListeningOrchestratorJob({
          taskId: result.progressId,
          userId,
          sectionNo: requestedSectionNo,
          priorityClass: nextPriority.priorityClass,
          priorityScore: nextPriority.score,
          correlationId: dispatch.trace.correlationId,
          traceId: dispatch.trace.traceId,
        });
      }
      
      const newTaskReadiness = newTask
        ? await buildManifestReadiness(newTask as TaskProgressRecord)
        : { manifestStatus: "warming", partReady: false, manifest: null };
      const newTaskStartupGateMode = newTask
        ? await resolveStartupGateModeForTaskRecord(newTask as TaskProgressRecord)
        : resolveStartupGateModeForIdentity({
            taskProgressId: result.progressId,
            userId,
          });
      return res.status(200).json({
        ok: true,
        progressId: result.progressId,
        taskId: result.taskId,
        manifest_status: newTaskReadiness.manifestStatus,
        part_ready: newTaskReadiness.partReady,
        manifest: newTaskReadiness.manifest,
        startup_gate_mode: newTaskStartupGateMode,
        transition_timeout_secs: LISTENING_TRANSITION_TIMEOUT_SECS,
      });
      
    } catch (error: any) {
      console.error('[NEXT][server] Error creating next task:', error);
      return res.status(500).json({
        ok: false,
        reason: 'server_error',
        message: error.message
      });
    }
  });

  app.get('/api/listening/sections/:sectionId/questions.json', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { sectionId } = req.params;
      const task = await storage.getTaskProgress(sectionId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ message: "Section not found" });
      }
      const integrityCheck = await verifyManifestIntegrityForTask(task as TaskProgressRecord, userId);
      if (!integrityCheck.ok) {
        return res.status(409).json({
          message: "Manifest integrity mismatch",
          errorCode: integrityCheck.error_code,
        });
      }

      const sectionNo = Number(((task.progressData ?? {}) as any)?.sessionOrder ?? 1);
      const normalizedQuestions = normalizeLegacyQuestionsForApi(task.questions ?? []);
      let rendererPayload = null;
      if (normalizedQuestions.length) {
        const contract = resolveListeningQuestionContract(task as any);
        if (contract.ok) {
          rendererPayload = contract.rendererPayload;
          if (contract.changed) {
            await storage.updateTaskProgress(task.id, {
              progressData: contract.nextProgressData,
            });
          }
        }
      }

      return res.status(200).json({
        section_id: sectionId,
        section_no: sectionNo,
        contract_mode: LISTENING_RENDERER_DUAL_MODE ? "dual" : "legacy",
        questions: normalizedQuestions,
        renderer: LISTENING_RENDERER_DUAL_MODE ? rendererPayload : null,
      });
    } catch (error: any) {
      return res.status(500).json({ message: error?.message ?? "Failed to load section questions" });
    }
  });

  app.get('/api/listening/sections/:sectionId/anchors.json', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { sectionId } = req.params;
      const task = await storage.getTaskProgress(sectionId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ message: "Section not found" });
      }
      const integrityCheck = await verifyManifestIntegrityForTask(task as TaskProgressRecord, userId);
      if (!integrityCheck.ok) {
        return res.status(409).json({
          message: "Manifest integrity mismatch",
          errorCode: integrityCheck.error_code,
        });
      }

      const anchors = loadAnchors(task);
      return res.status(200).json({
        section_id: sectionId,
        section_no: Number(((task.progressData ?? {}) as any)?.sessionOrder ?? 1),
        anchors,
      });
    } catch (error: any) {
      return res.status(500).json({ message: error?.message ?? "Failed to load section anchors" });
    }
  });

  app.get('/api/listening/sections/:sectionId/answer-key.json', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { sectionId } = req.params;
      const task = await storage.getTaskProgress(sectionId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ message: "Section not found" });
      }
      const integrityCheck = await verifyManifestIntegrityForTask(task as TaskProgressRecord, userId);
      if (!integrityCheck.ok) {
        return res.status(409).json({
          message: "Manifest integrity mismatch",
          errorCode: integrityCheck.error_code,
        });
      }
      const sectionNo = Number(((task.progressData ?? {}) as any)?.sessionOrder ?? 1);
      const normalizedQuestions = normalizeLegacyQuestionsForApi(task.questions ?? []);
      let answerKey = null;
      if (normalizedQuestions.length) {
        const contract = resolveListeningQuestionContract(task as any);
        if (contract.ok) {
          answerKey = contract.answerKey;
          if (contract.changed) {
            await storage.updateTaskProgress(task.id, {
              progressData: contract.nextProgressData,
            });
          }
        }
      }

      return res.status(200).json({
        section_id: sectionId,
        section_no: sectionNo,
        answer_key: answerKey,
      });
    } catch (error: any) {
      return res.status(500).json({ message: error?.message ?? "Failed to load answer key" });
    }
  });

  app.get('/api/listening/sections/:sectionId/tag-quality.json', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { sectionId } = req.params;
      const task = await storage.getTaskProgress(sectionId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ message: "Section not found" });
      }
      const integrityCheck = await verifyManifestIntegrityForTask(task as TaskProgressRecord, userId);
      if (!integrityCheck.ok) {
        return res.status(409).json({
          message: "Manifest integrity mismatch",
          errorCode: integrityCheck.error_code,
        });
      }

      const normalizedQuestions = normalizeLegacyQuestionsForApi(task.questions ?? []);
      const quality = buildTagQualityReport(normalizedQuestions as any);
      const contract = resolveListeningQuestionContract(task as any);

      return res.status(200).json({
        section_id: sectionId,
        taxonomy_version: quality.taxonomyVersion,
        quality,
        adapter_issues: contract.ok ? contract.issues : [contract.error],
      });
    } catch (error: any) {
      return res.status(500).json({ message: error?.message ?? "Failed to load tag quality report" });
    }
  });

  app.post('/api/listening/renderer-telemetry', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const taskProgressId = String(req.body?.taskProgressId ?? "");
      const eventType = String(req.body?.eventType ?? "");
      const mode = normalizeRendererMode(req.body?.mode);
      const error = Boolean(req.body?.error);
      const details = req.body?.details && typeof req.body.details === "object" ? req.body.details : undefined;

      if (!taskProgressId || !eventType) {
        return res.status(400).json({ success: false, message: "taskProgressId and eventType are required" });
      }
      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ success: false, message: "Task progress not found" });
      }

      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const updatedProgressData = applyRendererTelemetryUpdate(progressData, {
        mode,
        eventType,
        error,
        taskProgressId,
        details,
      });
      await storage.updateTaskProgress(taskProgressId, {
        progressData: updatedProgressData,
      });

      return res.status(200).json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error?.message ?? "Failed to store renderer telemetry" });
    }
  });

  app.get('/api/listening/renderer-metrics', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const plans = await storage.getWeeklyStudyPlansByUserId(userId);
      const tasks: TaskProgressRecord[] = [];
      for (const plan of plans) {
        const planTasks = await storage.getTaskProgressByWeeklyPlan(plan.id, userId);
        planTasks.forEach((task) => tasks.push(task as TaskProgressRecord));
      }
      const listeningProgressData = tasks
        .filter((task) => String(task.skill ?? "").toLowerCase() === "listening")
        .map((task) => (task.progressData ?? {}) as Record<string, any>);
      const summary = summarizeRendererTelemetry(listeningProgressData);

      return res.status(200).json({
        success: true,
        summary,
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error?.message ?? "Failed to compute renderer metrics" });
    }
  });

  app.get('/api/listening/dlq/:taskId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.firebaseUser?.uid || req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const { taskId } = req.params;
      const task = await storage.getTaskProgress(taskId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ message: "Task not found" });
      }

      const items = await storage.listListeningDeadLetters(taskId);
      return res.status(200).json({
        ok: true,
        items: items.map((item) => ({
          id: item.id,
          section: item.sectionNo,
          step: item.stepName,
          error_code: item.errorCode,
          attempts: item.attempts,
          context: item.context,
          replayed_at: item.replayedAt,
          resolved_at: item.resolvedAt,
          created_at: item.createdAt,
        })),
      });
    } catch (error: any) {
      console.error("[ListeningDLQ][List][Error]", error);
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to fetch DLQ items" });
    }
  });

  app.post('/api/listening/dlq/:id/replay', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.firebaseUser?.uid || req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const { id } = req.params;
      const replayed = await replayListeningDLQItem(id);
      if (!replayed) {
        return res.status(404).json({ ok: false, message: "DLQ item not found" });
      }

      const task = await storage.getTaskProgress(replayed.taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ ok: false, message: "Task not found" });
      }

      const replayPriority = deriveListeningPriority({
        sessionStartAt: task.startedAt ?? task.createdAt ?? null,
        startClickBoost: true,
        readinessGap: 1,
      });
      enqueueListeningOrchestratorJob({
        taskId: task.id,
        userId,
        sectionNo: replayed.sectionNo,
        priorityClass: replayPriority.priorityClass,
        priorityScore: replayPriority.score,
      });
      await publishDeadLetterMetric({
        taskProgressId: replayed.taskProgressId,
        userId,
        sectionNo: replayed.sectionNo,
        action: "replayed",
        errorCode: replayed.errorCode,
        attempts: replayed.attempts,
        priorityClass: replayPriority.priorityClass,
        metadata: {
          deadletter_id: replayed.id,
          step_name: replayed.stepName,
        },
      });

      return res.status(200).json({
        ok: true,
        deadletter_id: replayed.id,
        task_id: replayed.taskProgressId,
        section_no: replayed.sectionNo,
        step: replayed.stepName,
      });
    } catch (error: any) {
      console.error("[ListeningDLQ][Replay][Error]", error);
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to replay DLQ item" });
    }
  });

  app.get('/api/listening/orchestrator/queue', verifyFirebaseAuth, ensureFirebaseUser, async (_req: any, res) => {
    return res.status(200).json({
      ok: true,
      items: getListeningOrchestratorQueueSnapshot(),
    });
  });

  app.get('/api/listening/review-queue', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      await escalateOverdueReviewItems();
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 20);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const severity = typeof req.query.severity === "string" ? req.query.severity : undefined;
      const failureType = typeof req.query.failureType === "string" ? req.query.failureType : undefined;
      const result = await storage.listListeningReviewQueue({
        page,
        pageSize,
        status,
        severity,
        failureType,
      });
      return res.status(200).json({
        ok: true,
        page: Math.max(1, Number(page)),
        pageSize: Math.max(1, Math.min(100, Number(pageSize))),
        total: result.total,
        items: result.rows,
      });
    } catch (error: any) {
      console.error("[ListeningReviewQueue][List][Error]", error);
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to fetch review queue" });
    }
  });

  app.get('/api/listening/review-queue/metrics', verifyFirebaseAuth, ensureFirebaseUser, async (_req: any, res) => {
    try {
      if (!hasGovernanceRole(_req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      await escalateOverdueReviewItems();
      const metrics = await buildReviewQueueMetrics();
      return res.status(200).json({ ok: true, metrics });
    } catch (error: any) {
      console.error("[ListeningReviewQueue][Metrics][Error]", error);
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to compute review queue metrics" });
    }
  });

  app.post('/api/listening/review-queue/:id/action', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required for governance actions" });
      }
      const reviewerId = String(req.body?.reviewerId ?? req.user?.id ?? "");
      const action = listeningReviewActionTypeSchema.parse(req.body?.action);
      const reasonNotes = String(req.body?.reasonNotes ?? "").trim();
      const reasonCodeRaw = String(req.body?.reasonCode ?? "").trim().toLowerCase();
      const reasonCode = reasonCodeRaw.length > 0 ? reasonCodeRaw : "other";
      const incidentTicket =
        typeof req.body?.incidentTicket === "string" && req.body.incidentTicket.trim().length > 0
          ? req.body.incidentTicket.trim()
          : null;
      const exceptionOwnerRaw = String(req.body?.exceptionOwner ?? "").trim();
      const exceptionOwner = exceptionOwnerRaw.length > 0 ? exceptionOwnerRaw : null;
      const exceptionExpiresAtRaw = typeof req.body?.exceptionExpiresAt === "string" ? req.body.exceptionExpiresAt : null;
      const exceptionExpiresAt =
        exceptionExpiresAtRaw && Number.isFinite(Date.parse(exceptionExpiresAtRaw))
          ? new Date(exceptionExpiresAtRaw)
          : null;
      const metadata =
        req.body?.metadata && typeof req.body.metadata === "object"
          ? {
              ...req.body.metadata,
              reason_code: reasonCode,
              incident_ticket: incidentTicket,
              exception_owner: exceptionOwner,
              exception_expires_at: exceptionExpiresAt ? exceptionExpiresAt.toISOString() : null,
            }
          : {
              reason_code: reasonCode,
              incident_ticket: incidentTicket,
              exception_owner: exceptionOwner,
              exception_expires_at: exceptionExpiresAt ? exceptionExpiresAt.toISOString() : null,
            };
      const queueItemId = String(req.params.id);

      if (!reviewerId) {
        return res.status(400).json({ ok: false, message: "reviewerId is required" });
      }
      if (!reasonNotes) {
        return res.status(400).json({ ok: false, message: "reasonNotes is required" });
      }
      if (!GOVERNANCE_REASON_CODE_ALLOWLIST.has(reasonCode)) {
        return res.status(400).json({ ok: false, message: "reasonCode is invalid" });
      }
      if ((action === "APPROVE_WITH_EXCEPTION" || action === "APPROVE_WITH_OVERRIDE") && (!exceptionOwner || !exceptionExpiresAt)) {
        return res.status(400).json({
          ok: false,
          message: "exceptionOwner and exceptionExpiresAt are required for approve_with_exception",
        });
      }
      if (
        (action === "APPROVE_WITH_EXCEPTION" || action === "APPROVE_WITH_OVERRIDE") &&
        exceptionExpiresAt &&
        exceptionExpiresAt.getTime() <= Date.now()
      ) {
        return res.status(400).json({
          ok: false,
          message: "exceptionExpiresAt must be in the future",
        });
      }

      const applied = await applyReviewAction({
        reviewQueueId: queueItemId,
        action,
        reviewerId,
        reasonNotes,
        metadata,
        traceId: req.header("x-trace-id") ?? undefined,
        correlationId: req.header("x-correlation-id") ?? undefined,
      });

      const queueItem = applied.reviewQueue;
      const task = await storage.getTaskProgress(queueItem?.taskProgressId ?? "");
      if (!task) {
        return res.status(404).json({ ok: false, message: "Task not found for queue item" });
      }
      let governanceExceptionId: string | null = null;
      if (action === "APPROVE_WITH_EXCEPTION" || action === "APPROVE_WITH_OVERRIDE") {
        const exception = await createGovernanceException({
          scopeType: "review_override",
          scopeRef: queueItemId,
          riskClass: "learning_content",
          owner: exceptionOwner!,
          createdBy: reviewerId,
          approverId: reviewerId,
          reasonCode,
          reasonNotes,
          incidentTicket,
          expiresAt: exceptionExpiresAt!,
          metadata: {
            task_progress_id: queueItem?.taskProgressId ?? task.id,
            section_id: queueItem?.sectionId ?? task.id,
            section_no: queueItem?.sectionNo ?? 1,
          },
        });
        governanceExceptionId = exception.id;
      }
      await recordGovernanceLedgerEntry({
        taskProgressId: queueItem?.taskProgressId ?? task.id,
        userId: task.userId,
        sectionId: queueItem?.sectionId ?? task.id,
        sectionNo: queueItem?.sectionNo ?? 1,
        sessionId: req.header("x-correlation-id") ?? null,
        policyVersion: getListeningGovernancePolicyInfo().policyVersion,
        validatorSetVersion: getListeningGovernancePolicyInfo().validatorSetVersion,
        actionType: `REVIEW_${action}`,
        actorId: reviewerId,
        actorType: "reviewer",
        approverId: reviewerId,
        traceId: req.header("x-trace-id") ?? null,
        correlationId: req.header("x-correlation-id") ?? null,
        metadata: {
          reason_notes: reasonNotes,
          reason_code: reasonCode,
          incident_ticket: incidentTicket,
          governance_exception_id: governanceExceptionId,
          review_queue_id: queueItemId,
        },
      });

      if (action === "APPROVE_WITH_EXCEPTION" || action === "APPROVE_WITH_OVERRIDE") {
        const validationRows = queueItem?.validationReportId
          ? await storage.getListeningValidationReport(queueItem.validationReportId)
          : undefined;
        const reviewValidationReportId = validationRows?.id ?? null;
        const reviewValidationMetadata = {
          validation_step: LISTENING_VALIDATION_GATE_STEP,
          validation_report_id: reviewValidationReportId,
          timing_artifact_ref: reviewValidationReportId
            ? {
                validation_report_id: reviewValidationReportId,
                section_id: queueItem?.sectionId ?? task.id,
                section_no: queueItem?.sectionNo ?? 1,
              }
            : null,
          validation_verdict: "FAIL",
          override_action: action,
        };
        const manifestDraft = buildSectionManifestFromTask(task as TaskProgressRecord, {
          validationReportId: validationRows?.id ?? null,
          validationVerdict: "FAIL",
          traceId: req.header("x-trace-id") ?? null,
          correlationId: req.header("x-correlation-id") ?? null,
        });
        const publishedVersion = await publishManifestVersion({
          task,
          manifest: manifestDraft,
          validationReportId: validationRows?.id ?? null,
          publishedBy: reviewerId,
          traceId: req.header("x-trace-id") ?? undefined,
          correlationId: req.header("x-correlation-id") ?? undefined,
        });
        const publishIdempotencyKey = buildSectionStepIdempotencyKey(
          req.header("x-correlation-id") ?? `review-${queueItemId}`,
          queueItem?.sectionNo ?? 1,
          "publish",
        );
        const published = await publishSectionManifestEvent({
          task,
          traceId: req.header("x-trace-id") ?? `review-${queueItemId}`,
          correlationId: req.header("x-correlation-id") ?? `review-${queueItemId}`,
          idempotencyKey: publishIdempotencyKey,
          manifest: publishedVersion.manifest,
        });
        await transitionListeningSectionState({
          task,
          sectionId: queueItem?.sectionId ?? task.id,
          sectionNo: queueItem?.sectionNo ?? 1,
          toState: "VALIDATED",
          eventId: req.header("x-trace-id") ?? `review-${queueItemId}`,
          idempotencyKey: buildSectionStepIdempotencyKey(
            req.header("x-correlation-id") ?? `review-${queueItemId}`,
            queueItem?.sectionNo ?? 1,
            "validation",
          ),
          metadata: reviewValidationMetadata,
        });
        await transitionListeningSectionState({
          task,
          sectionId: queueItem?.sectionId ?? task.id,
          sectionNo: queueItem?.sectionNo ?? 1,
          toState: "PUBLISHED",
          eventId: req.header("x-trace-id") ?? `review-${queueItemId}`,
          idempotencyKey: publishIdempotencyKey,
        });
        await storage.updateTaskProgress(task.id, {
          progressData: {
            ...(task.progressData ?? {}),
            sectionManifest: publishedVersion.manifest,
            sectionManifestVersion: publishedVersion.version.versionNo,
            reviewOverride: {
              action,
              reviewerId,
              reasonNotes,
              at: new Date().toISOString(),
            },
            manifestPublishedEvent: published.event,
          },
        });
      } else if (action === "REJECT") {
        await transitionListeningSectionState({
          task,
          sectionId: queueItem?.sectionId ?? task.id,
          sectionNo: queueItem?.sectionNo ?? 1,
          toState: "FAILED",
          eventId: req.header("x-trace-id") ?? `review-${queueItemId}`,
          idempotencyKey: buildSectionStepIdempotencyKey(
            req.header("x-correlation-id") ?? `review-${queueItemId}`,
            queueItem?.sectionNo ?? 1,
            "review_reject",
          ),
          errorCode: queueItem?.failureCode ?? "REJECTED_BY_REVIEWER",
        });
      } else if (action === "REQUEUE" || action === "REQUEUE_STEP") {
        await transitionListeningSectionState({
          task,
          sectionId: queueItem?.sectionId ?? task.id,
          sectionNo: queueItem?.sectionNo ?? 1,
          toState: "PLANNED",
          eventId: req.header("x-trace-id") ?? `review-${queueItemId}`,
          idempotencyKey: buildSectionStepIdempotencyKey(
            req.header("x-correlation-id") ?? `review-${queueItemId}`,
            queueItem?.sectionNo ?? 1,
            "review_requeue",
          ),
        });
        const priority = deriveListeningPriority({
          sessionStartAt: task.startedAt ?? task.createdAt ?? null,
          startClickBoost: true,
          readinessGap: 1,
        });
        enqueueListeningOrchestratorJob({
          taskId: task.id,
          userId: task.userId,
          sectionNo: queueItem?.sectionNo ?? 1,
          priorityClass: priority.priorityClass,
          priorityScore: priority.score,
          traceId: req.header("x-trace-id") ?? undefined,
          correlationId: req.header("x-correlation-id") ?? undefined,
        });
      } else if (action === "FORCE_REGENERATE") {
        await transitionListeningSectionState({
          task,
          sectionId: queueItem?.sectionId ?? task.id,
          sectionNo: queueItem?.sectionNo ?? 1,
          toState: "PLANNED",
          eventId: req.header("x-trace-id") ?? `review-${queueItemId}`,
          idempotencyKey: buildSectionStepIdempotencyKey(
            req.header("x-correlation-id") ?? `review-${queueItemId}`,
            queueItem?.sectionNo ?? 1,
            "force_regenerate",
          ),
        });
        const priority = deriveListeningPriority({
          sessionStartAt: task.startedAt ?? task.createdAt ?? null,
          startClickBoost: true,
          readinessGap: 1,
        });
        enqueueListeningOrchestratorJob({
          taskId: task.id,
          userId: task.userId,
          sectionNo: queueItem?.sectionNo ?? 1,
          priorityClass: priority.priorityClass,
          priorityScore: priority.score,
          traceId: req.header("x-trace-id") ?? undefined,
          correlationId: req.header("x-correlation-id") ?? undefined,
        });
      } else if (action === "HOLD") {
        await transitionListeningSectionState({
          task,
          sectionId: queueItem?.sectionId ?? task.id,
          sectionNo: queueItem?.sectionNo ?? 1,
          toState: "REVIEW_REQUIRED",
          eventId: req.header("x-trace-id") ?? `review-${queueItemId}`,
          idempotencyKey: buildSectionStepIdempotencyKey(
            req.header("x-correlation-id") ?? `review-${queueItemId}`,
            queueItem?.sectionNo ?? 1,
            "hold",
          ),
          errorCode: queueItem?.failureCode ?? "MANUAL_HOLD",
        });
      }

      return res.status(200).json({
        ok: true,
        queue: applied.reviewQueue,
        action: applied.reviewAction,
      });
    } catch (error: any) {
      console.error("[ListeningReviewQueue][Action][Error]", error);
      return res.status(400).json({ ok: false, message: error?.message ?? "Failed to apply review action" });
    }
  });

  app.get('/api/listening/publish/:taskId/versions', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const task = await storage.getTaskProgress(String(req.params.taskId));
      if (!task || task.userId !== req.user.id) {
        return res.status(404).json({ ok: false, message: "Task not found" });
      }
      const versions = await storage.listListeningManifestVersions(task.id);
      return res.status(200).json({
        ok: true,
        versions: versions.map((version) => ({
          id: version.id,
          version_no: version.versionNo,
          is_active: version.isActive,
          checksum: version.manifestChecksumSha256,
          hash_algorithm: version.hashAlgorithm,
          hash_version: version.hashVersion,
          published_by: version.publishedBy,
          published_at: version.publishedAt,
          validation_report_id: version.validationReportId,
          generation_trace_id: version.generationTraceId,
          generation_correlation_id: version.generationCorrelationId,
        })),
      });
    } catch (error: any) {
      console.error("[ListeningPublish][Versions][Error]", error);
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to fetch manifest versions" });
    }
  });

  app.post('/api/listening/publish/:taskId/rollback', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "admin")) {
        return res.status(403).json({ ok: false, message: "Admin role is required for rollback" });
      }
      const task = await storage.getTaskProgress(String(req.params.taskId));
      if (!task || task.userId !== req.user.id) {
        return res.status(404).json({ ok: false, message: "Task not found" });
      }
      const versionNo = Number(req.body?.versionNo);
      const reason = String(req.body?.reason ?? "").trim();
      const reasonCodeRaw = String(req.body?.reasonCode ?? "").trim().toLowerCase();
      const reasonCode = reasonCodeRaw.length > 0 ? reasonCodeRaw : "other";
      if (!Number.isFinite(versionNo) || versionNo <= 0) {
        return res.status(400).json({ ok: false, message: "Valid versionNo is required" });
      }
      if (!reason || !GOVERNANCE_REASON_CODE_ALLOWLIST.has(reasonCode)) {
        return res.status(400).json({ ok: false, message: "reason and valid reasonCode are required" });
      }
      const rolledBack = await rollbackManifestVersion({
        task,
        versionNo,
        actorId: req.user.id,
        traceId: req.header("x-trace-id") ?? undefined,
        correlationId: req.header("x-correlation-id") ?? undefined,
      });
      await storage.updateTaskProgress(task.id, {
        progressData: {
          ...(task.progressData ?? {}),
          sectionManifest: rolledBack.manifest,
          sectionManifestVersion: rolledBack.versionNo,
          rollbackInfo: {
            by: req.user.id,
            versionNo,
            reason,
            reasonCode,
            at: new Date().toISOString(),
          },
        },
      });
      return res.status(200).json({ ok: true, active_version: rolledBack.versionNo });
    } catch (error: any) {
      console.error("[ListeningPublish][Rollback][Error]", error);
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to rollback manifest version" });
    }
  });

  app.get('/api/listening/publish/audit', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      const taskProgressId = typeof req.query.taskProgressId === "string" ? req.query.taskProgressId : undefined;
      const sectionId = typeof req.query.sectionId === "string" ? req.query.sectionId : undefined;
      const correlationId = typeof req.query.correlationId === "string" ? req.query.correlationId : undefined;
      const limit = Number(req.query.limit ?? 100);

      if (taskProgressId) {
        const task = await storage.getTaskProgress(taskProgressId);
        if (!task || task.userId !== req.user.id) {
          return res.status(404).json({ ok: false, message: "Task not found" });
        }
      }

      const records = await storage.listListeningPublishAudit({
        taskProgressId,
        sectionId,
        correlationId,
        limit,
      });
      return res.status(200).json({ ok: true, records });
    } catch (error: any) {
      console.error("[ListeningPublish][Audit][Error]", error);
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to fetch publish audit" });
    }
  });

  app.get('/api/listening/governance/ledger', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      const userId =
        hasGovernanceRole(req, "admin") && typeof req.query.userId === "string"
          ? req.query.userId
          : req.user.id;
      const taskProgressId = typeof req.query.taskProgressId === "string" ? req.query.taskProgressId : undefined;
      const sectionId = typeof req.query.sectionId === "string" ? req.query.sectionId : undefined;
      const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
      const correlationId = typeof req.query.correlationId === "string" ? req.query.correlationId : undefined;
      const limit = Math.max(1, Math.min(1000, Number(req.query.limit ?? 200)));
      const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
      const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;

      const rows = await storage.listListeningGovernanceLedger({
        userId,
        taskProgressId,
        sectionId,
        sessionId,
        correlationId,
        limit,
        from: from && !Number.isNaN(from.getTime()) ? from : undefined,
        to: to && !Number.isNaN(to.getTime()) ? to : undefined,
      });
      return res.status(200).json({ ok: true, records: rows });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to fetch governance ledger" });
    }
  });

  app.get('/api/listening/governance/policy', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    if (!hasGovernanceRole(req, "reviewer")) {
      return res.status(403).json({ ok: false, message: "Reviewer role is required" });
    }
    return res.status(200).json({
      ok: true,
      policy: getListeningGovernancePolicyInfo(),
    });
  });

  app.get('/api/listening/governance/kpis', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
      const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
      const metrics = await computeGovernanceKpis({
        userId: req.user.id,
        from: from && !Number.isNaN(from.getTime()) ? from : undefined,
        to: to && !Number.isNaN(to.getTime()) ? to : undefined,
      });
      return res.status(200).json({ ok: true, metrics });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to compute governance KPIs" });
    }
  });

  app.get('/api/listening/governance/exceptions', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      await expireGovernanceExceptions();
      const status =
        req.query.status === "active" || req.query.status === "revoked" || req.query.status === "expired"
          ? req.query.status
          : undefined;
      const scopeType = typeof req.query.scopeType === "string" ? req.query.scopeType : undefined;
      const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 100)));
      const records = await listGovernanceExceptions({
        status,
        scopeType,
        limit,
      });
      return res.status(200).json({ ok: true, records });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to list governance exceptions" });
    }
  });

  app.post('/api/listening/governance/exceptions/:id/revoke', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "admin")) {
        return res.status(403).json({ ok: false, message: "Admin role is required" });
      }
      const id = String(req.params.id ?? "");
      const reason = String(req.body?.reason ?? "").trim();
      const revoked = await revokeGovernanceException({
        id,
        revokedBy: req.user.id,
        reason: reason || undefined,
      });
      if (!revoked) {
        return res.status(404).json({ ok: false, message: "Exception not found" });
      }
      return res.status(200).json({ ok: true, record: revoked });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to revoke governance exception" });
    }
  });

  app.get('/api/listening/governance/prompts/:promptId/versions', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      const promptId = String(req.params.promptId ?? "").trim();
      if (!promptId) {
        return res.status(400).json({ ok: false, message: "promptId is required" });
      }
      const versions = await listPromptVersions(promptId);
      return res.status(200).json({ ok: true, versions });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to list prompt versions" });
    }
  });

  app.get('/api/listening/governance/prompts/change-requests', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      const promptId = typeof req.query.promptId === "string" ? req.query.promptId : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 100)));
      const requests = await listPromptChangeRequests({
        promptId,
        status,
        limit,
      });
      const overduePostHoc = await listOverduePostHocPromptChanges();
      return res.status(200).json({
        ok: true,
        requests,
        overdue_post_hoc_count: overduePostHoc.length,
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to list prompt change requests" });
    }
  });

  app.post('/api/listening/governance/prompts/promote', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "admin")) {
        return res.status(403).json({ ok: false, message: "Admin role is required" });
      }
      const outputClassRaw = String(req.body?.outputClass ?? "").trim().toLowerCase();
      if (!PROMPT_OUTPUT_CLASS_ALLOWLIST.has(outputClassRaw as ListeningOutputClass)) {
        return res.status(400).json({ ok: false, message: "outputClass must be scripts, questions, or coaching" });
      }
      const outputClass = outputClassRaw as ListeningOutputClass;
      const promptIdRaw = String(req.body?.promptId ?? "").trim();
      const promptId = promptIdRaw || resolvePromptIdForOutputClass(outputClass);
      const version = String(req.body?.version ?? "").trim();
      const stagedTestingEvidence = String(req.body?.stagedTestingEvidence ?? "").trim();
      const expectedImpact = String(req.body?.expectedImpact ?? "").trim();
      const rollbackCriteria = String(req.body?.rollbackCriteria ?? "").trim();
      const qualityGatePassed = req.body?.qualityGatePassed === true;
      const isEmergency = req.body?.isEmergency === true;
      const incidentTicket =
        typeof req.body?.incidentTicket === "string" && req.body.incidentTicket.trim().length > 0
          ? req.body.incidentTicket.trim()
          : null;
      if (!version || !stagedTestingEvidence || !expectedImpact || !rollbackCriteria) {
        return res.status(400).json({
          ok: false,
          message: "version, stagedTestingEvidence, expectedImpact, and rollbackCriteria are required",
        });
      }
      if (!qualityGatePassed) {
        return res.status(400).json({ ok: false, message: "qualityGatePassed must be true for promotion" });
      }
      if (isEmergency && !incidentTicket) {
        return res.status(400).json({ ok: false, message: "incidentTicket is required for emergency changes" });
      }
      const latestCanaryPromotion = await getLatestListeningRolloutAudit("CANARY_PROMOTION");
      const canaryMetadata = (latestCanaryPromotion?.metadata ?? {}) as Record<string, any>;
      const canaryFailedChecks = Array.isArray(canaryMetadata?.failed_checks)
        ? canaryMetadata.failed_checks.map((value: any) => String(value)).filter(Boolean)
        : [];
      const canaryPromotedAtMs = latestCanaryPromotion?.createdAt
        ? new Date(latestCanaryPromotion.createdAt).getTime()
        : Number.NaN;
      const canaryPromotionFresh =
        Number.isFinite(canaryPromotedAtMs) &&
        Date.now() - Number(canaryPromotedAtMs) <= LISTENING_PROMPT_PROMOTION_CANARY_MAX_AGE_MS;
      if (!isEmergency) {
        if (!latestCanaryPromotion) {
          return res.status(409).json({
            ok: false,
            message: "Prompt promotion blocked: canary promotion evidence is required first",
          });
        }
        if (!canaryPromotionFresh) {
          return res.status(409).json({
            ok: false,
            message: "Prompt promotion blocked: latest canary promotion evidence is stale",
            canary_promotion_at: latestCanaryPromotion.createdAt,
          });
        }
        if (canaryFailedChecks.length > 0) {
          return res.status(409).json({
            ok: false,
            message: "Prompt promotion blocked: latest canary promotion has failed health checks",
            failed_checks: canaryFailedChecks,
          });
        }
      }
      const versions = await listPromptVersions(promptId);
      const selected = versions.find((item) => item.version === version);
      if (!selected) {
        return res.status(404).json({ ok: false, message: "Prompt version not found" });
      }
      const compatibility = validatePromptTemplateCompatibility({
        outputClass,
        template: selected.template,
      });
      if (!compatibility.ok) {
        return res.status(409).json({
          ok: false,
          message: "Prompt version is not compatible with output class",
          issues: compatibility.issues,
        });
      }
      await promotePromptVersion({
        promptId,
        version,
        qualityGatePassed,
      });
      const postHocReviewDueAt = isEmergency
        ? new Date(Date.now() + LISTENING_GOVERNANCE_EMERGENCY_REVIEW_SLA_HOURS * 60 * 60 * 1000)
        : null;
      const riskClass =
        outputClass === "coaching" ? "personalized_coaching" : outputClass === "questions" ? "scoring_feedback" : "learning_content";
      const changeRequest = await createPromptChangeRequest({
        promptId,
        version,
        outputClass,
        riskClass,
        requestedBy: req.user.id,
        approverId: req.user.id,
        status: isEmergency ? "post_hoc_pending" : "approved",
        stagedTestingEvidence,
        expectedImpact,
        rollbackCriteria,
        qualityGatePassed: true,
        isEmergency,
        incidentTicket,
        postHocReviewDueAt,
        metadata: {
          compatibility_issues: compatibility.issues,
          canary_audit_id: latestCanaryPromotion?.id ?? null,
          canary_mode: String(canaryMetadata?.mode ?? ""),
          canary_failed_checks: canaryFailedChecks,
          canary_override_used: Boolean(canaryMetadata?.override_used),
          canary_promotion_at: latestCanaryPromotion?.createdAt
            ? new Date(latestCanaryPromotion.createdAt).toISOString()
            : null,
        },
      });
      await recordGovernanceLedgerEntry({
        policyVersion: getListeningGovernancePolicyInfo().policyVersion,
        validatorSetVersion: getListeningGovernancePolicyInfo().validatorSetVersion,
        promptVersion: version,
        promptRegistryId: `${promptId}@${version}`,
        modelId: selected.model_id,
        actionType: `PROMPT_PROMOTED_${outputClass.toUpperCase()}`,
        actorId: req.user.id,
        actorType: "api",
        approverId: req.user.id,
        metadata: {
          prompt_id: promptId,
          output_class: outputClass,
          staged_testing_evidence: stagedTestingEvidence,
          expected_impact: expectedImpact,
          rollback_criteria: rollbackCriteria,
          emergency_change: isEmergency,
          incident_ticket: incidentTicket,
          post_hoc_review_due_at: postHocReviewDueAt ? postHocReviewDueAt.toISOString() : null,
          change_request_id: changeRequest.id,
          canary_audit_id: latestCanaryPromotion?.id ?? null,
          canary_mode: String(canaryMetadata?.mode ?? ""),
          canary_failed_checks: canaryFailedChecks,
          canary_override_used: Boolean(canaryMetadata?.override_used),
          canary_promotion_at: latestCanaryPromotion?.createdAt
            ? new Date(latestCanaryPromotion.createdAt).toISOString()
            : null,
        },
      });
      return res.status(200).json({
        ok: true,
        prompt_id: promptId,
        version,
        output_class: outputClass,
        emergency_change: isEmergency,
        post_hoc_review_due_at: postHocReviewDueAt ? postHocReviewDueAt.toISOString() : null,
        change_request_id: changeRequest.id,
        canary_audit_id: latestCanaryPromotion?.id ?? null,
      });
    } catch (error: any) {
      return res.status(400).json({ ok: false, message: error?.message ?? "Failed to promote prompt version" });
    }
  });

  app.post('/api/listening/governance/prompts/rollback', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "admin")) {
        return res.status(403).json({ ok: false, message: "Admin role is required" });
      }
      const outputClassRaw = String(req.body?.outputClass ?? "").trim().toLowerCase();
      if (!PROMPT_OUTPUT_CLASS_ALLOWLIST.has(outputClassRaw as ListeningOutputClass)) {
        return res.status(400).json({ ok: false, message: "outputClass must be scripts, questions, or coaching" });
      }
      const outputClass = outputClassRaw as ListeningOutputClass;
      const reason = String(req.body?.reason ?? "").trim();
      const reasonCodeRaw = String(req.body?.reasonCode ?? "").trim().toLowerCase();
      const reasonCode = reasonCodeRaw.length > 0 ? reasonCodeRaw : "other";
      const impactedCohorts = Array.isArray(req.body?.impactedCohorts)
        ? req.body.impactedCohorts.map((value: any) => String(value ?? "").trim()).filter(Boolean)
        : [getEffectiveRolloutMode()];
      if (!reason || !GOVERNANCE_REASON_CODE_ALLOWLIST.has(reasonCode)) {
        return res.status(400).json({ ok: false, message: "reason and valid reasonCode are required" });
      }
      const rollback = await rollbackPromptVersionForOutputClass({
        outputClass,
        actorId: req.user.id,
      });
      await recordGovernanceLedgerEntry({
        policyVersion: getListeningGovernancePolicyInfo().policyVersion,
        validatorSetVersion: getListeningGovernancePolicyInfo().validatorSetVersion,
        promptVersion: rollback.toVersion,
        promptRegistryId: `${rollback.promptId}@${rollback.toVersion}`,
        actionType: `PROMPT_ROLLBACK_${outputClass.toUpperCase()}`,
        actorId: req.user.id,
        actorType: "api",
        approverId: req.user.id,
        metadata: {
          output_class: outputClass,
          from_version: rollback.fromVersion,
          to_version: rollback.toVersion,
          reason,
          reason_code: reasonCode,
          impacted_cohorts: impactedCohorts,
          compatibility: rollback.compatibility,
        },
      });
      return res.status(200).json({
        ok: true,
        rollback: {
          output_class: outputClass,
          prompt_id: rollback.promptId,
          from_version: rollback.fromVersion,
          to_version: rollback.toVersion,
        },
      });
    } catch (error: any) {
      return res.status(400).json({ ok: false, message: error?.message ?? "Failed to rollback prompt version" });
    }
  });

  app.post('/api/listening/governance/prompts/change-requests/:id/post-hoc-review', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      const id = String(req.params.id ?? "");
      const reason = String(req.body?.reason ?? "").trim();
      const updated = await markPromptChangeRequestPostHocReviewed({
        id,
        reviewedBy: req.user.id,
        reason: reason || undefined,
      });
      if (!updated) {
        return res.status(404).json({ ok: false, message: "Change request not found" });
      }
      await recordGovernanceLedgerEntry({
        policyVersion: getListeningGovernancePolicyInfo().policyVersion,
        validatorSetVersion: getListeningGovernancePolicyInfo().validatorSetVersion,
        actionType: "PROMPT_CHANGE_POST_HOC_REVIEW_COMPLETED",
        actorId: req.user.id,
        actorType: "reviewer",
        approverId: req.user.id,
        metadata: {
          change_request_id: id,
          reason: reason || null,
        },
      });
      return res.status(200).json({ ok: true, record: updated });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to complete post-hoc review" });
    }
  });

  app.post('/api/listening/governance/integrity-check', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      const from = typeof req.body?.from === "string" ? new Date(req.body.from) : undefined;
      const to = typeof req.body?.to === "string" ? new Date(req.body.to) : undefined;
      const report = await runGovernanceLedgerIntegrityCheck({
        from: from && !Number.isNaN(from.getTime()) ? from : undefined,
        to: to && !Number.isNaN(to.getTime()) ? to : undefined,
      });
      latestGovernanceIntegrityReport = report as unknown as Record<string, unknown>;
      return res.status(report.ok ? 200 : 409).json({ ok: report.ok, report });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to run governance integrity check" });
    }
  });

  app.post('/api/listening/governance/review/generate', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      const now = new Date();
      const from = typeof req.body?.from === "string" ? new Date(req.body.from) : null;
      const to = typeof req.body?.to === "string" ? new Date(req.body.to) : now;
      const fallbackFrom = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
      const report = await generateGovernanceReviewReport({
        generatedBy: req.user.id,
        windowFrom: from && !Number.isNaN(from.getTime()) ? from : fallbackFrom,
        windowTo: !Number.isNaN(to.getTime()) ? to : now,
      });
      return res.status(200).json({ ok: true, report });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to generate governance review report" });
    }
  });

  app.get('/api/listening/governance/review/reports', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 20)));
      const reports = await listGovernanceReviewReports(limit);
      return res.status(200).json({ ok: true, reports });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to list governance review reports" });
    }
  });

  app.post('/api/listening/governance/review/reports/:reportId/action-items/:actionItemId/complete', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "reviewer")) {
        return res.status(403).json({ ok: false, message: "Reviewer role is required" });
      }
      const reportId = String(req.params.reportId ?? "");
      const actionItemId = String(req.params.actionItemId ?? "");
      const updated = await completeGovernanceReviewActionItem({
        reportId,
        actionItemId,
        completedBy: req.user.id,
      });
      if (!updated) {
        return res.status(404).json({ ok: false, message: "Review report not found" });
      }
      return res.status(200).json({ ok: true, report: updated });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to complete governance action item" });
    }
  });

  app.get('/api/listening/governance/retention-policy', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    if (!hasGovernanceRole(req, "reviewer")) {
      return res.status(403).json({ ok: false, message: "Reviewer role is required" });
    }
    return res.status(200).json({
      ok: true,
      retention: getListeningRetentionPolicy(),
      latest_integrity_report: latestGovernanceIntegrityReport,
      latest_cleanup_report: latestListeningRetentionReport,
    });
  });

  app.post('/api/listening/governance/retention/cleanup', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      if (!hasGovernanceRole(req, "admin")) {
        return res.status(403).json({ ok: false, message: "Admin role is required" });
      }
      const dryRun = req.body?.dryRun !== false;
      const report = await runListeningRetentionCleanup({ dryRun });
      return res.status(200).json({ ok: true, report });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: error?.message ?? "Failed to run retention cleanup" });
    }
  });

  // Register regenerate routes for SSE-S3 audio fixing
  registerRegenerateRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
