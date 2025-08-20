import { pgTable, text, varchar, timestamp, jsonb, index, integer, boolean, decimal, uuid } from "drizzle-orm/pg-core";
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
});

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
}

// Task Attempt types for AI Coach analytics
export interface TaskAttemptAnswer {
  questionId: string;
  pickedOptionId: string | null;
  correctOptionId: string | null;
  isCorrect: boolean;
  timeMs?: number;
  replayCountAtAnswer?: number;
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

export const insertStudyPlanSchema = createInsertSchema(studyPlans, {
  skillRatings: z.record(z.string(), z.number()),
  studyPreferences: z.record(z.string(), z.string()),
  plan: z.record(z.string(), z.any()),
});

export const insertWeeklyStudyPlanSchema = createInsertSchema(weeklyStudyPlans, {
  planData: z.record(z.string(), z.any()),
});

export const insertTaskProgressSchema = createInsertSchema(taskProgress, {
  progressData: z.record(z.string(), z.any()).optional(),
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      options: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
      correctAnswer: z.string().optional(),
      explanation: z.string().optional()
    })
  ).optional(),
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
});
