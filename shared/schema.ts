import { pgTable, text, varchar, timestamp, jsonb, index, integer, boolean, decimal, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  username: varchar("username").unique().notNull(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  bio: text("bio"),
  profileImageUrl: varchar("profile_image_url"),
  googleId: varchar("google_id").unique(),  // Google ID for Google authentication
  firebaseUid: varchar("firebase_uid").unique(), // Firebase UID for email/password authentication
  onboardingCompleted: boolean("onboarding_completed").default(false), // Flag to track if onboarding is completed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Study Plans table
export const studyPlans = pgTable("study_plans", {
  id: varchar("id").primaryKey().notNull(), // UUID
  userId: varchar("user_id").references(() => users.id), // Foreign key to user
  fullName: varchar("full_name").notNull(),
  phoneNumber: varchar("phone_number"),
  targetBandScore: decimal("target_band_score", { precision: 3, scale: 1 }).notNull(), // Precision 3, scale 1 allows scores like 8.5
  testDate: timestamp("test_date"),
  notDecided: varchar("not_decided", { length: 5 }).default("false").notNull(),
  skillRatings: jsonb("skill_ratings").notNull(), // Store JSON with ratings for each skill
  immigrationGoal: varchar("immigration_goal").notNull(),
  studyPreferences: jsonb("study_preferences").notNull(), // Store JSON with study preferences
  plan: jsonb("plan").notNull(), // Store the AI-generated plan
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Weekly Study Plans table
export const weeklyStudyPlans = pgTable("weekly_study_plans", {
  id: varchar("id").primaryKey().notNull(), // UUID
  userId: varchar("user_id").references(() => users.id), // Foreign key to user
  weekNumber: integer("week_number").notNull(), // Week number
  skillFocus: varchar("skill_focus").notNull(), // The skill focus (listening, reading, etc.)
  weekFocus: text("week_focus"), // Summary of what this week focuses on
  planData: jsonb("plan_data").notNull(), // Store the detailed AI-generated plan
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Task Progress tracking
export const taskProgress = pgTable("task_progress", {
  id: varchar("id").primaryKey().notNull(), // UUID
  userId: varchar("user_id").references(() => users.id).notNull(), // Foreign key to user
  weeklyPlanId: varchar("weekly_plan_id").references(() => weeklyStudyPlans.id).notNull(), // Foreign key to weekly plan
  weekNumber: integer("week_number").notNull(), // Week number
  dayNumber: integer("day_number").notNull(), // Day number
  taskTitle: varchar("task_title").notNull(), // Task title for easy reference
  skill: varchar("skill", { length: 20 }).default("listening").notNull(), // Task skill type: listening, reading, writing, speaking
  status: varchar("status", { length: 20 }).default("not-started").notNull(), // Status: not-started, in-progress, completed
  progressData: jsonb("progress_data"), // Store any session state for resuming (time left, current question, etc.)
  startedAt: timestamp("started_at"), // When the task was first started
  completedAt: timestamp("completed_at"), // When the task was completed
  
  // New fields for AI-generated content
  scriptText: text("script_text"), // The full AI-generated script for this task
  audioUrl: varchar("audio_url"), // Link to the TTS-generated audio
  questions: jsonb("questions"), // Array of question objects: { question: string, options: string[], correctAnswer: string }
  accent: varchar("accent", { length: 20 }).default("British"), // Accent of the audio (e.g., British, Canadian, etc.)
  duration: integer("duration").default(0), // Length of the audio in seconds
  replayLimit: integer("replay_limit").default(3), // How many times the user can replay the audio
  scriptType: varchar("script_type", { length: 20 }), // Type of script: "dialogue" or "monologue"
  difficulty: varchar("difficulty", { length: 20 }), // Difficulty level: e.g. "Band 6.5"
  
  // IELTS-specific metadata for dynamic titles
  ieltsPart: integer("ielts_part"), // IELTS Part 1-4 (analytics only, never in titles)
  topicDomain: varchar("topic_domain", { length: 100 }), // e.g., 'Office', 'Museum', 'Academic Lecture'
  contextLabel: varchar("context_label", { length: 100 }), // 1-3 word noun phrase for title building
  scenarioOverview: text("scenario_overview"), // 1-2 sentences summarizing the situation
  estimatedDurationSec: integer("estimated_duration_sec"), // Estimated duration in seconds
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("task_progress_unique_scope_idx").on(
    table.userId,
    table.weeklyPlanId,
    table.dayNumber,
    table.taskTitle,
    table.skill,
  ),
]);

// Task Attempts table for AI Coach analytics
export const taskAttempts = pgTable("task_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  answers: jsonb("answers").$type<TaskAttemptAnswer[]>().notNull(),
  score: jsonb("score").$type<{correct: number; total: number; percent: number}>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("task_attempts_task_idx").on(table.taskProgressId),
  index("task_attempts_user_idx").on(table.userId),
]);

// Dedicated durable section lifecycle state for listening orchestration
export const listeningSectionState = pgTable("listening_section_state", {
  id: varchar("id").primaryKey().notNull(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sectionId: varchar("section_id").notNull(),
  sectionNo: integer("section_no").notNull(),
  state: varchar("state", { length: 32 }).notNull(),
  attempt: integer("attempt").default(0).notNull(),
  lastErrorCode: varchar("last_error_code", { length: 64 }),
  idempotencyKey: varchar("idempotency_key").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_section_state_task_idx").on(table.taskProgressId),
  index("listening_section_state_user_idx").on(table.userId),
  uniqueIndex("listening_section_state_task_section_idx").on(table.taskProgressId, table.sectionId),
]);

// Listening step lock table for distributed lock guard across workers.
export const listeningExecutionLock = pgTable("listening_execution_lock", {
  id: varchar("id").primaryKey().notNull(),
  lockKey: varchar("lock_key").notNull(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  stepName: varchar("step_name", { length: 64 }).notNull(),
  ownerId: varchar("owner_id", { length: 64 }).notNull(),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).defaultNow().notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("listening_execution_lock_key_idx").on(table.lockKey),
  index("listening_execution_lock_task_idx").on(table.taskProgressId),
  index("listening_execution_lock_expires_idx").on(table.expiresAt),
]);

// Dead-letter stream persistence for terminal orchestration failures.
export const listeningDeadLetter = pgTable("listening_dead_letter", {
  id: varchar("id").primaryKey().notNull(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sectionId: varchar("section_id").notNull(),
  sectionNo: integer("section_no").notNull(),
  stepName: varchar("step_name", { length: 64 }).notNull(),
  errorCode: varchar("error_code", { length: 64 }).notNull(),
  attempts: integer("attempts").default(0).notNull(),
  context: jsonb("context").notNull(),
  replayedAt: timestamp("replayed_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_dead_letter_task_idx").on(table.taskProgressId),
  index("listening_dead_letter_user_idx").on(table.userId),
  index("listening_dead_letter_created_idx").on(table.createdAt),
]);

// Read model for low-latency section readiness lookups.
export const listeningReadinessModel = pgTable("listening_readiness_model", {
  id: varchar("id").primaryKey().notNull(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sectionId: varchar("section_id").notNull(),
  sectionNo: integer("section_no").notNull(),
  state: varchar("state", { length: 32 }).notNull(),
  partReady: boolean("part_ready").default(false).notNull(),
  manifestStatus: varchar("manifest_status", { length: 32 }).notNull(),
  manifest: jsonb("manifest"),
  lastEventId: varchar("last_event_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("listening_readiness_model_task_section_idx").on(table.taskProgressId, table.sectionId),
  index("listening_readiness_model_user_idx").on(table.userId),
  index("listening_readiness_model_state_idx").on(table.state),
]);

// Queue telemetry by priority/step for starvation and latency monitoring.
export const listeningQueueMetric = pgTable("listening_queue_metric", {
  id: varchar("id").primaryKey().notNull(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sectionNo: integer("section_no").notNull(),
  priorityClass: varchar("priority_class", { length: 16 }).notNull(),
  stepName: varchar("step_name", { length: 64 }).notNull(),
  enqueueToStartMs: integer("enqueue_to_start_ms"),
  startToPublishMs: integer("start_to_publish_ms"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_queue_metric_task_idx").on(table.taskProgressId),
  index("listening_queue_metric_priority_idx").on(table.priorityClass),
  index("listening_queue_metric_created_idx").on(table.createdAt),
]);

// Durable outbox for listening domain events that require replay/audit.
export const listeningEventOutbox = pgTable("listening_event_outbox", {
  id: varchar("id").primaryKey().notNull(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  topic: varchar("topic", { length: 64 }).notNull(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  eventVersion: varchar("event_version", { length: 32 }).notNull(),
  eventId: varchar("event_id", { length: 128 }).notNull(),
  envelope: jsonb("envelope").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_event_outbox_task_idx").on(table.taskProgressId),
  index("listening_event_outbox_event_type_idx").on(table.eventType),
  index("listening_event_outbox_created_idx").on(table.createdAt),
]);

// Validation report persistence for section publish gating.
export const listeningValidationReport = pgTable("listening_validation_report", {
  id: varchar("id").primaryKey().notNull(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sectionId: varchar("section_id").notNull(),
  sectionNo: integer("section_no").notNull(),
  verdict: varchar("verdict", { length: 16 }).notNull(), // PASS | FAIL
  severity: varchar("severity", { length: 16 }).notNull(), // low | medium | high
  topErrorCode: varchar("top_error_code", { length: 64 }),
  report: jsonb("report").notNull(),
  timingArtifact: jsonb("timing_artifact"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_validation_report_task_idx").on(table.taskProgressId),
  index("listening_validation_report_section_idx").on(table.sectionId),
  index("listening_validation_report_verdict_idx").on(table.verdict),
  index("listening_validation_report_created_idx").on(table.createdAt),
]);

// Manual review queue for flagged validation failures.
export const listeningReviewQueue = pgTable("listening_review_queue", {
  id: varchar("id").primaryKey().notNull(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sectionId: varchar("section_id").notNull(),
  sectionNo: integer("section_no").notNull(),
  validationReportId: varchar("validation_report_id").references(() => listeningValidationReport.id),
  status: varchar("status", { length: 24 }).notNull(), // OPEN | IN_REVIEW | APPROVED | REJECTED | REQUEUED | CLOSED
  severity: varchar("severity", { length: 16 }).notNull(), // low | medium | high
  failureType: varchar("failure_type", { length: 64 }).notNull(),
  failureCode: varchar("failure_code", { length: 64 }).notNull(),
  context: jsonb("context"),
  slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_review_queue_task_idx").on(table.taskProgressId),
  index("listening_review_queue_status_idx").on(table.status),
  index("listening_review_queue_severity_idx").on(table.severity),
  index("listening_review_queue_failure_type_idx").on(table.failureType),
  index("listening_review_queue_sla_due_idx").on(table.slaDueAt),
  index("listening_review_queue_created_idx").on(table.createdAt),
]);

// Reviewer action audit on queue items.
export const listeningReviewAction = pgTable("listening_review_action", {
  id: varchar("id").primaryKey().notNull(),
  reviewQueueId: varchar("review_queue_id").notNull().references(() => listeningReviewQueue.id),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sectionId: varchar("section_id").notNull(),
  sectionNo: integer("section_no").notNull(),
  action: varchar("action", { length: 40 }).notNull(), // APPROVE_WITH_OVERRIDE | REJECT | REQUEUE_STEP
  reviewerId: varchar("reviewer_id").notNull(),
  reasonNotes: text("reason_notes").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_review_action_queue_idx").on(table.reviewQueueId),
  index("listening_review_action_task_idx").on(table.taskProgressId),
  index("listening_review_action_action_idx").on(table.action),
  index("listening_review_action_created_idx").on(table.createdAt),
]);

// Immutable manifest package versions for publish/rollback semantics.
export const listeningManifestVersion = pgTable("listening_manifest_version", {
  id: varchar("id").primaryKey().notNull(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sectionId: varchar("section_id").notNull(),
  sectionNo: integer("section_no").notNull(),
  versionNo: integer("version_no").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  manifest: jsonb("manifest").notNull(),
  manifestChecksumSha256: varchar("manifest_checksum_sha256", { length: 128 }).notNull(),
  hashAlgorithm: varchar("hash_algorithm", { length: 32 }).notNull(),
  hashVersion: varchar("hash_version", { length: 16 }).notNull(),
  validationReportId: varchar("validation_report_id").references(() => listeningValidationReport.id),
  generationTraceId: varchar("generation_trace_id", { length: 128 }),
  generationCorrelationId: varchar("generation_correlation_id", { length: 128 }),
  publishedBy: varchar("published_by", { length: 128 }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("listening_manifest_version_task_ver_idx").on(table.taskProgressId, table.versionNo),
  index("listening_manifest_version_task_idx").on(table.taskProgressId),
  index("listening_manifest_version_section_idx").on(table.sectionId),
  index("listening_manifest_version_active_idx").on(table.isActive),
  index("listening_manifest_version_published_idx").on(table.publishedAt),
]);

// Durable publish audit source-of-truth for section releases and overrides.
export const listeningPublishAudit = pgTable("listening_publish_audit", {
  id: varchar("id").primaryKey().notNull(),
  taskProgressId: varchar("task_progress_id").notNull().references(() => taskProgress.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sectionId: varchar("section_id").notNull(),
  sectionNo: integer("section_no").notNull(),
  manifestVersionId: varchar("manifest_version_id").references(() => listeningManifestVersion.id),
  eventType: varchar("event_type", { length: 64 }).notNull(), // PUBLISHED | ROLLBACK | APPROVE_WITH_OVERRIDE | REJECT | REQUEUE_STEP
  actorId: varchar("actor_id", { length: 128 }).notNull(),
  actorType: varchar("actor_type", { length: 32 }).notNull(), // system | reviewer | api
  traceId: varchar("trace_id", { length: 128 }),
  correlationId: varchar("correlation_id", { length: 128 }),
  validationVerdicts: jsonb("validation_verdicts"),
  overrideAction: varchar("override_action", { length: 40 }),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_publish_audit_task_idx").on(table.taskProgressId),
  index("listening_publish_audit_section_idx").on(table.sectionId),
  index("listening_publish_audit_event_idx").on(table.eventType),
  index("listening_publish_audit_corr_idx").on(table.correlationId),
  index("listening_publish_audit_created_idx").on(table.createdAt),
]);

// Immutable governance ledger across policy checks, approvals, overrides, and promotions.
export const listeningGovernanceLedger = pgTable("listening_governance_ledger", {
  id: varchar("id").primaryKey().notNull(),
  taskProgressId: varchar("task_progress_id").references(() => taskProgress.id),
  userId: varchar("user_id").references(() => users.id),
  sectionId: varchar("section_id"),
  sectionNo: integer("section_no"),
  sessionId: varchar("session_id", { length: 128 }),
  attemptId: varchar("attempt_id", { length: 128 }),
  policyVersion: varchar("policy_version", { length: 48 }).notNull(),
  promptVersion: varchar("prompt_version", { length: 64 }),
  promptRegistryId: varchar("prompt_registry_id", { length: 160 }),
  modelId: varchar("model_id", { length: 128 }),
  validatorSetVersion: varchar("validator_set_version", { length: 64 }),
  validationVerdict: varchar("validation_verdict", { length: 24 }),
  actionType: varchar("action_type", { length: 64 }).notNull(),
  actorId: varchar("actor_id", { length: 128 }).notNull(),
  actorType: varchar("actor_type", { length: 32 }).notNull(),
  approverId: varchar("approver_id", { length: 128 }),
  traceId: varchar("trace_id", { length: 128 }),
  correlationId: varchar("correlation_id", { length: 128 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_governance_ledger_user_idx").on(table.userId),
  index("listening_governance_ledger_task_idx").on(table.taskProgressId),
  index("listening_governance_ledger_section_idx").on(table.sectionId),
  index("listening_governance_ledger_session_idx").on(table.sessionId),
  index("listening_governance_ledger_action_idx").on(table.actionType),
  index("listening_governance_ledger_corr_idx").on(table.correlationId),
  index("listening_governance_ledger_created_idx").on(table.createdAt),
]);

// Time-bound governance exceptions for explicit policy bypass paths.
export const listeningGovernanceException = pgTable("listening_governance_exception", {
  id: varchar("id").primaryKey().notNull(),
  scopeType: varchar("scope_type", { length: 64 }).notNull(), // review_override | policy_bypass
  scopeRef: varchar("scope_ref", { length: 160 }),
  riskClass: varchar("risk_class", { length: 64 }).notNull(),
  owner: varchar("owner", { length: 128 }).notNull(),
  createdBy: varchar("created_by", { length: 128 }).notNull(),
  approverId: varchar("approver_id", { length: 128 }).notNull(),
  reasonCode: varchar("reason_code", { length: 64 }).notNull(),
  reasonNotes: text("reason_notes").notNull(),
  incidentTicket: varchar("incident_ticket", { length: 128 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  status: varchar("status", { length: 24 }).notNull().default("active"), // active | revoked | expired
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_governance_exception_scope_idx").on(table.scopeType, table.scopeRef),
  index("listening_governance_exception_risk_idx").on(table.riskClass),
  index("listening_governance_exception_status_idx").on(table.status),
  index("listening_governance_exception_expires_idx").on(table.expiresAt),
  index("listening_governance_exception_created_idx").on(table.createdAt),
]);

// Durable prompt/model registry for auditable prompt version provenance.
export const listeningPromptRegistry = pgTable("listening_prompt_registry", {
  id: varchar("id").primaryKey().notNull(),
  promptId: varchar("prompt_id", { length: 160 }).notNull(),
  version: varchar("version", { length: 64 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(), // draft | approved | deprecated | inactive
  owner: varchar("owner", { length: 128 }).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  modelId: varchar("model_id", { length: 128 }).notNull(),
  modelSettings: jsonb("model_settings").notNull().default({}),
  createdBy: varchar("created_by", { length: 128 }).notNull(),
  template: text("template").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("listening_prompt_registry_prompt_version_idx").on(table.promptId, table.version),
  index("listening_prompt_registry_prompt_idx").on(table.promptId),
  index("listening_prompt_registry_status_idx").on(table.status),
  index("listening_prompt_registry_approved_idx").on(table.approvedAt),
]);

// Canary assignment configuration for prompt experiments.
export const listeningPromptExperiment = pgTable("listening_prompt_experiment", {
  promptId: varchar("prompt_id", { length: 160 }).primaryKey().notNull(),
  enabled: boolean("enabled").notNull().default(false),
  percentage: integer("percentage").notNull().default(0),
  candidateVersion: varchar("candidate_version", { length: 64 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_prompt_experiment_enabled_idx").on(table.enabled),
]);

// Prompt/model change requests with approval evidence and emergency post-hoc review tracking.
export const listeningPromptChangeRequest = pgTable("listening_prompt_change_request", {
  id: varchar("id").primaryKey().notNull(),
  promptId: varchar("prompt_id", { length: 160 }).notNull(),
  version: varchar("version", { length: 64 }).notNull(),
  outputClass: varchar("output_class", { length: 32 }).notNull(), // scripts | questions | coaching
  riskClass: varchar("risk_class", { length: 64 }).notNull(),
  requestedBy: varchar("requested_by", { length: 128 }).notNull(),
  approverId: varchar("approver_id", { length: 128 }),
  status: varchar("status", { length: 32 }).notNull(), // approved | rejected | post_hoc_pending | post_hoc_completed
  stagedTestingEvidence: text("staged_testing_evidence").notNull(),
  expectedImpact: text("expected_impact").notNull(),
  rollbackCriteria: text("rollback_criteria").notNull(),
  qualityGatePassed: boolean("quality_gate_passed").notNull().default(false),
  isEmergency: boolean("is_emergency").notNull().default(false),
  incidentTicket: varchar("incident_ticket", { length: 128 }),
  postHocReviewDueAt: timestamp("post_hoc_review_due_at", { withTimezone: true }),
  postHocReviewedAt: timestamp("post_hoc_reviewed_at", { withTimezone: true }),
  reason: text("reason"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_prompt_change_request_prompt_idx").on(table.promptId, table.version),
  index("listening_prompt_change_request_output_idx").on(table.outputClass),
  index("listening_prompt_change_request_status_idx").on(table.status),
  index("listening_prompt_change_request_post_hoc_due_idx").on(table.postHocReviewDueAt),
  index("listening_prompt_change_request_created_idx").on(table.createdAt),
]);

// Periodic governance review records with action items and rollout block signal.
export const listeningGovernanceReviewReport = pgTable("listening_governance_review_report", {
  id: varchar("id").primaryKey().notNull(),
  windowFrom: timestamp("window_from", { withTimezone: true }).notNull(),
  windowTo: timestamp("window_to", { withTimezone: true }).notNull(),
  kpis: jsonb("kpis").notNull(),
  integrity: jsonb("integrity").notNull(),
  actionItems: jsonb("action_items").notNull().default([]),
  rolloutBlocked: boolean("rollout_blocked").notNull().default(false),
  generatedBy: varchar("generated_by", { length: 128 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_governance_review_window_idx").on(table.windowFrom, table.windowTo),
  index("listening_governance_review_blocked_idx").on(table.rolloutBlocked),
  index("listening_governance_review_created_idx").on(table.createdAt),
]);

// Rollout/canary/rollback audit trail for operational governance.
export const listeningRolloutAudit = pgTable("listening_rollout_audit", {
  id: varchar("id").primaryKey().notNull(),
  actionType: varchar("action_type", { length: 48 }).notNull(), // ROLLBACK_SWITCH | CANARY_OVERRIDE | CANARY_PROMOTION
  actorId: varchar("actor_id", { length: 128 }).notNull(),
  reason: text("reason").notNull(),
  incidentTicket: varchar("incident_ticket", { length: 128 }),
  affectedCohorts: jsonb("affected_cohorts").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_rollout_audit_action_idx").on(table.actionType),
  index("listening_rollout_audit_actor_idx").on(table.actorId),
  index("listening_rollout_audit_created_idx").on(table.createdAt),
]);

// Assignment telemetry for prompt experiments and default execution outcomes.
export const listeningPromptAssignment = pgTable("listening_prompt_assignment", {
  id: varchar("id").primaryKey().notNull(),
  promptId: varchar("prompt_id", { length: 160 }).notNull(),
  version: varchar("version", { length: 64 }).notNull(),
  taskProgressId: varchar("task_progress_id").references(() => taskProgress.id),
  userId: varchar("user_id").references(() => users.id),
  sectionId: varchar("section_id", { length: 128 }),
  assignmentMode: varchar("assignment_mode", { length: 24 }).notNull(), // default | experiment
  assignmentBucket: integer("assignment_bucket"),
  outcome: varchar("outcome", { length: 24 }).notNull(), // success | failed
  reason: varchar("reason", { length: 128 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_prompt_assignment_prompt_idx").on(table.promptId, table.version),
  index("listening_prompt_assignment_task_idx").on(table.taskProgressId),
  index("listening_prompt_assignment_section_idx").on(table.sectionId),
  index("listening_prompt_assignment_created_idx").on(table.createdAt),
]);

// Synthetic critical-path probe run history for reliability dashboards.
export const listeningSyntheticProbeRun = pgTable("listening_synthetic_probe_run", {
  id: varchar("id").primaryKey().notNull(),
  runId: varchar("run_id", { length: 128 }).notNull(),
  probeName: varchar("probe_name", { length: 128 }).notNull(),
  stage: varchar("stage", { length: 64 }).notNull(),
  environment: varchar("environment", { length: 64 }).notNull(),
  success: boolean("success").notNull(),
  statusCode: integer("status_code"),
  failureReason: text("failure_reason"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("listening_synthetic_probe_run_run_idx").on(table.runId),
  index("listening_synthetic_probe_run_stage_idx").on(table.stage),
  index("listening_synthetic_probe_run_env_idx").on(table.environment),
  index("listening_synthetic_probe_run_created_idx").on(table.createdAt),
]);

// Schema for validating the onboarding data
export const onboardingSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  phoneNumber: z.string().optional(),
  targetBandScore: z.number().min(5).max(9),
  testDate: z.date().nullable(),
  notDecided: z.boolean(),
  skillRatings: z.object({
    listening: z.number().min(0).max(9),
    reading: z.number().min(0).max(9),
    writing: z.number().min(0).max(9),
    speaking: z.number().min(0).max(9),
  }),
  immigrationGoal: z.enum(["pr", "study", "work", "family"]),
  studyPreferences: z.object({
    dailyCommitment: z.enum(["30mins", "1hour", "2hours+"]),
    schedule: z.enum(["weekday", "weekend", "both"]),
    style: z.enum(["ai-guided", "self-paced", "mixed"]),
    sessionMinutes: z.number().min(5).max(120).optional(), // Minutes per practice session (5-120)
    listeningDurations: z.object({
      weekday: z.number().min(5).max(180).optional(),
      weekend: z.number().min(5).max(180).optional(),
    }).partial().optional(),
  }),
  weekNumber: z.number().optional(), // Optional week number for weekly plan generation
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type StudyPlan = typeof studyPlans.$inferSelect;
export type InsertStudyPlan = typeof studyPlans.$inferInsert;
export type WeeklyStudyPlan = typeof weeklyStudyPlans.$inferSelect;
export type InsertWeeklyStudyPlan = typeof weeklyStudyPlans.$inferInsert;
export type TaskProgress = typeof taskProgress.$inferSelect;
export type InsertTaskProgress = typeof taskProgress.$inferInsert;
export type TaskContentUpdate = z.infer<typeof taskContentUpdateSchema>;
export type TaskAttemptSelect = typeof taskAttempts.$inferSelect;
export type InsertTaskAttempt = typeof taskAttempts.$inferInsert;
export type ListeningSectionState = typeof listeningSectionState.$inferSelect;
export type InsertListeningSectionState = typeof listeningSectionState.$inferInsert;
export type ListeningExecutionLock = typeof listeningExecutionLock.$inferSelect;
export type InsertListeningExecutionLock = typeof listeningExecutionLock.$inferInsert;
export type ListeningDeadLetter = typeof listeningDeadLetter.$inferSelect;
export type InsertListeningDeadLetter = typeof listeningDeadLetter.$inferInsert;
export type ListeningReadinessModel = typeof listeningReadinessModel.$inferSelect;
export type InsertListeningReadinessModel = typeof listeningReadinessModel.$inferInsert;
export type ListeningQueueMetric = typeof listeningQueueMetric.$inferSelect;
export type InsertListeningQueueMetric = typeof listeningQueueMetric.$inferInsert;
export type ListeningEventOutbox = typeof listeningEventOutbox.$inferSelect;
export type InsertListeningEventOutbox = typeof listeningEventOutbox.$inferInsert;
export type ListeningValidationReport = typeof listeningValidationReport.$inferSelect;
export type InsertListeningValidationReport = typeof listeningValidationReport.$inferInsert;
export type ListeningReviewQueue = typeof listeningReviewQueue.$inferSelect;
export type InsertListeningReviewQueue = typeof listeningReviewQueue.$inferInsert;
export type ListeningReviewAction = typeof listeningReviewAction.$inferSelect;
export type InsertListeningReviewAction = typeof listeningReviewAction.$inferInsert;
export type ListeningManifestVersion = typeof listeningManifestVersion.$inferSelect;
export type InsertListeningManifestVersion = typeof listeningManifestVersion.$inferInsert;
export type ListeningPublishAudit = typeof listeningPublishAudit.$inferSelect;
export type InsertListeningPublishAudit = typeof listeningPublishAudit.$inferInsert;
export type ListeningGovernanceLedger = typeof listeningGovernanceLedger.$inferSelect;
export type InsertListeningGovernanceLedger = typeof listeningGovernanceLedger.$inferInsert;
export type ListeningGovernanceException = typeof listeningGovernanceException.$inferSelect;
export type InsertListeningGovernanceException = typeof listeningGovernanceException.$inferInsert;
export type ListeningPromptRegistry = typeof listeningPromptRegistry.$inferSelect;
export type InsertListeningPromptRegistry = typeof listeningPromptRegistry.$inferInsert;
export type ListeningPromptExperiment = typeof listeningPromptExperiment.$inferSelect;
export type InsertListeningPromptExperiment = typeof listeningPromptExperiment.$inferInsert;
export type ListeningPromptChangeRequest = typeof listeningPromptChangeRequest.$inferSelect;
export type InsertListeningPromptChangeRequest = typeof listeningPromptChangeRequest.$inferInsert;
export type ListeningGovernanceReviewReport = typeof listeningGovernanceReviewReport.$inferSelect;
export type InsertListeningGovernanceReviewReport = typeof listeningGovernanceReviewReport.$inferInsert;
export type ListeningRolloutAudit = typeof listeningRolloutAudit.$inferSelect;
export type InsertListeningRolloutAudit = typeof listeningRolloutAudit.$inferInsert;
export type ListeningPromptAssignment = typeof listeningPromptAssignment.$inferSelect;
export type InsertListeningPromptAssignment = typeof listeningPromptAssignment.$inferInsert;
export type ListeningSyntheticProbeRun = typeof listeningSyntheticProbeRun.$inferSelect;
export type InsertListeningSyntheticProbeRun = typeof listeningSyntheticProbeRun.$inferInsert;

// Question types for type safety
export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  question: string;
  options?: QuestionOption[];
  correctAnswer?: string;
  explanation?: string;
  tags?: string[];
  type?: string;
  text?: string;
  groupId?: string | null;
  optionOrder?: string[];
}

// Task Attempt types for AI Coach analytics
export interface TaskAttemptAnswer {
  questionId: string;
  pickedOptionId: string | null;
  correctOptionId: string | null;
  isCorrect: boolean;
  timeMs?: number;
  replayCountAtAnswer?: number;
  answerChangeCount?: number;
  unanswered?: boolean;
  telemetryVersion?: string;
  explanationShown?: boolean;
}

export interface TaskAttempt {
  id: string;
  taskProgressId: string;
  userId: string;
  startedAt: string;
  submittedAt: string;
  durationMs: number;
  answers: TaskAttemptAnswer[];
  score: { correct: number; total: number; percent: number };
}

// Session state types for listening practice
export type SessionStatus = "running" | "paused" | "completed" | "expired";

export interface SessionAudioResult {
  index: number;
  correct: number;
  total: number;
  timeSpentMs?: number;
}

export interface SessionResult {
  completedAt: number;         // epoch ms
  usedMs: number;               // actual time spent
  scoreOverall: number;         // 0..1 (e.g., 0.75 = 75%)
  audios: SessionAudioResult[];
  advisorHighlights: string[];  // cached AI feedback bullets
}

export interface SessionState {
  status: SessionStatus;
  durationMinutes: number;      // from onboarding for that day
  startedAt?: number;            // epoch ms (set when session starts)
  pausedAt?: number;             // epoch ms (set when paused)
  consumedMs: number;            // accumulated active time
  remainingMs: number;           // server-calculated, source of truth
  currentAudioIndex: number;     // 0-based in the prefetched list
  prefetchedAudios?: any[];      // audio package from session start
  sessionResult?: SessionResult; // populated when completed/expired
  readyForStrike?: boolean;      // true when completed/expired
  lastSyncedAt?: number;         // last server sync timestamp (for drift prevention)
}

export const insertStudyPlanSchema = createInsertSchema(studyPlans, {
  skillRatings: (_schema) => z.record(z.string(), z.number()) as any,
  studyPreferences: (_schema) => z.record(z.string(), z.string()) as any,
  plan: (_schema) => z.record(z.string(), z.any()) as any,
});

export const insertWeeklyStudyPlanSchema = createInsertSchema(weeklyStudyPlans, {
  planData: (_schema) => z.record(z.string(), z.any()) as any,
});

export const insertTaskProgressSchema = createInsertSchema(taskProgress, {
  progressData: (_schema) => z.record(z.string(), z.any()).optional() as any,
  questions: (_schema) =>
    z
      .array(
        z.object({
          id: z.string(),
          question: z.string(),
          options: z
            .array(z.object({ id: z.string(), text: z.string() }))
            .optional(),
          correctAnswer: z.string().optional(),
          explanation: z.string().optional(),
        }),
      )
      .optional() as any,
});

// Task content update schema for the PATCH endpoint
export const taskContentUpdateSchema = z.object({
  scriptText: z.string().optional(),
  audioUrl: z.string().optional(),
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      options: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
      correctAnswer: z.string().optional(),
      explanation: z.string().optional()
    })
  ).optional(),
  accent: z.string().optional(),
  duration: z.number().optional(),
  replayLimit: z.number().optional(),
  scriptType: z.string().optional(),
  difficulty: z.string().optional(),
  ieltsPart: z.number().optional(),
  topicDomain: z.string().optional(),
  contextLabel: z.string().optional(),
  scenarioOverview: z.string().optional(),
  estimatedDurationSec: z.number().optional(),
  taskTitle: z.string().optional(),
});

// AI Advisor feedback types
export interface AdvisorFeedback {
  success: boolean;
  scoreText?: string;
  summary?: string;
  actions?: string[];
  error?: string;
  // Optional additional fields for enhanced feedback
  praise?: string;
  progressSummary?: string;
  suggestion?: string;
  nextTaskPreview?: string;
}
