import {
  users,
  studyPlans,
  weeklyStudyPlans,
  taskProgress,
  taskAttempts,
  listeningSectionState,
  listeningExecutionLock,
  listeningDeadLetter,
  listeningReadinessModel,
  listeningQueueMetric,
  listeningEventOutbox,
  listeningValidationReport,
  listeningReviewQueue,
  listeningReviewAction,
  listeningManifestVersion,
  listeningPublishAudit,
  listeningGovernanceLedger,
  listeningPromptAssignment,
  type User,
  type UpsertUser,
  type StudyPlan,
  type InsertStudyPlan,
  type WeeklyStudyPlan,
  type InsertWeeklyStudyPlan,
  type TaskProgress,
  type InsertTaskProgress,
  type TaskContentUpdate,
  type Question,
  type TaskAttempt,
  type InsertTaskAttempt,
  type ListeningSectionState,
  type InsertListeningSectionState,
  type ListeningExecutionLock,
  type InsertListeningExecutionLock,
  type ListeningDeadLetter,
  type InsertListeningDeadLetter,
  type ListeningReadinessModel,
  type InsertListeningReadinessModel,
  type ListeningQueueMetric,
  type InsertListeningQueueMetric,
  type ListeningEventOutbox,
  type InsertListeningEventOutbox,
  type ListeningValidationReport,
  type InsertListeningValidationReport,
  type ListeningReviewQueue,
  type InsertListeningReviewQueue,
  type ListeningReviewAction,
  type InsertListeningReviewAction,
  type ListeningManifestVersion,
  type InsertListeningManifestVersion,
  type ListeningPublishAudit,
  type InsertListeningPublishAudit,
  type ListeningGovernanceLedger,
  type InsertListeningGovernanceLedger,
} from "@shared/schema";
import { db, schema } from "./db";
import { eq, and, inArray, desc, lte, asc, gte, sql, ilike } from "drizzle-orm";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import { v4 as uuid } from "uuid";
import { isPrivacySafeLogMode, redactSensitive } from "./utils/privacy";

const STORAGE_VERBOSE_LOGS = process.env.NODE_ENV !== "production";

const storageVerboseLog = (...args: unknown[]) => {
  if (!STORAGE_VERBOSE_LOGS) return;
  if (isPrivacySafeLogMode()) {
    console.log(...args.map((arg) => redactSensitive(arg)));
    return;
  }
  console.log(...args);
};

const storageWarnLog = (label: string, payload?: unknown) => {
  if (typeof payload === "undefined") {
    console.warn(label);
    return;
  }
  console.warn(label, isPrivacySafeLogMode() ? redactSensitive(payload) : payload);
};

const storageErrorLog = (label: string, payload?: unknown) => {
  if (typeof payload === "undefined") {
    console.error(label);
    return;
  }
  console.error(label, isPrivacySafeLogMode() ? redactSensitive(payload) : payload);
};

type CreateListeningValidationReportInput =
  Omit<InsertListeningValidationReport, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<InsertListeningValidationReport, "id" | "createdAt" | "updatedAt">>;

type CreateListeningReviewQueueInput =
  Omit<InsertListeningReviewQueue, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<InsertListeningReviewQueue, "id" | "createdAt" | "updatedAt">>;

type CreateListeningReviewActionInput =
  Omit<InsertListeningReviewAction, "id" | "createdAt"> &
  Partial<Pick<InsertListeningReviewAction, "id" | "createdAt">>;

type CreateListeningManifestVersionInput =
  Omit<InsertListeningManifestVersion, "id" | "createdAt" | "publishedAt"> &
  Partial<Pick<InsertListeningManifestVersion, "id" | "createdAt" | "publishedAt">>;

type CreateListeningPublishAuditInput =
  Omit<InsertListeningPublishAudit, "id" | "createdAt"> &
  Partial<Pick<InsertListeningPublishAudit, "id" | "createdAt">>;

type CreateListeningGovernanceLedgerInput =
  Omit<InsertListeningGovernanceLedger, "id" | "createdAt"> &
  Partial<Pick<InsertListeningGovernanceLedger, "id" | "createdAt">>;

// Interface for storage operations
export interface IStorage {
  // User operations for Replit Auth
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByFirebaseUid(firebaseUid: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateOnboardingStatus(userId: string, completed: boolean): Promise<User>;
  deleteUserDataByEmail(email: string): Promise<void>;
  
  // Study plan operations
  createStudyPlan(studyPlan: InsertStudyPlan): Promise<StudyPlan>;
  getStudyPlan(id: string): Promise<StudyPlan | undefined>;
  getStudyPlansByUserId(userId: string): Promise<StudyPlan[]>;
  
  // Weekly study plan operations
  createWeeklyStudyPlan(weeklyPlan: InsertWeeklyStudyPlan): Promise<WeeklyStudyPlan>;
  getWeeklyStudyPlan(id: string): Promise<WeeklyStudyPlan | undefined>;
  getWeeklyStudyPlansByUserId(userId: string): Promise<WeeklyStudyPlan[]>;
  getWeeklyStudyPlanByWeekAndSkill(userId: string, weekNumber: number, skillFocus: string): Promise<WeeklyStudyPlan | undefined>;
  getWeeklyStudyPlansByWeek(userId: string, weekNumber: number): Promise<WeeklyStudyPlan[]>;
  createOrUpdateWeeklyStudyPlan(userId: string, weekNumber: number, skillFocus: string, weekFocus: string, planData: any): Promise<WeeklyStudyPlan>;
  updateWeeklyStudyPlanPlanData(id: string, planData: any, weekFocus?: string | null): Promise<WeeklyStudyPlan | undefined>;
  
  // Task progress operations
  findTaskProgressByScope(params: {
    userId: string;
    weeklyPlanId: string;
    dayNumber: number;
    taskTitle: string;
    skill: string;
  }): Promise<TaskProgress | undefined>;
  createTaskProgress(taskProgressData: InsertTaskProgress): Promise<TaskProgress>;
  getTaskProgress(id: string): Promise<TaskProgress | undefined>;
  getTaskProgressByUserAndTask(userId: string, weekNumber: number, dayNumber: number): Promise<TaskProgress | undefined>;
  getTaskProgressByWeeklyPlan(weeklyPlanId: string, userId?: string): Promise<TaskProgress[]>;
  getRecentTaskProgressBySkill(userId: string, skill: string, limit: number): Promise<TaskProgress[]>;
  updateTaskStatus(id: string, status: string, progressData?: any): Promise<TaskProgress>;
  updateTaskProgress(id: string, updates: Partial<InsertTaskProgress>): Promise<TaskProgress>;
  markTaskAsInProgress(id: string, progressData?: any): Promise<TaskProgress>;
  markTaskAsCompleted(id: string): Promise<TaskProgress>;
  batchInitializeTaskProgress(
    userId: string,
    weeklyPlanId: string,
    weekNumber: number,
    tasks: Array<{ taskTitle: string; dayNumber: number; initialStatus?: string }>
  ): Promise<TaskProgress[]>;
  deleteTaskProgressByIds(ids: string[]): Promise<void>;
  
  // Task content operations - new methods for AI-generated content
  getTaskWithContent(id: string): Promise<TaskProgress | undefined>;
  updateTaskContent(id: string, contentUpdate: TaskContentUpdate): Promise<TaskProgress>;
  
  // Task attempt operations for AI Coach analytics
  insertTaskAttempt(attempt: TaskAttempt): Promise<void>;
  getTaskProgressById(id: string, userId: string): Promise<TaskProgress | undefined>;
  getListeningSectionStates(taskProgressId: string): Promise<ListeningSectionState[]>;
  getListeningSectionState(taskProgressId: string, sectionId: string): Promise<ListeningSectionState | undefined>;
  upsertListeningSectionState(record: InsertListeningSectionState): Promise<ListeningSectionState>;
  getListeningExecutionLock(lockKey: string): Promise<ListeningExecutionLock | undefined>;
  acquireListeningExecutionLock(record: InsertListeningExecutionLock): Promise<ListeningExecutionLock | undefined>;
  heartbeatListeningExecutionLock(lockKey: string, ownerId: string, expiresAt: Date): Promise<ListeningExecutionLock | undefined>;
  releaseListeningExecutionLock(lockKey: string, ownerId: string): Promise<boolean>;
  insertListeningDeadLetter(record: InsertListeningDeadLetter): Promise<ListeningDeadLetter>;
  listListeningDeadLetters(taskProgressId: string): Promise<ListeningDeadLetter[]>;
  listListeningDeadLettersByUser(userId: string, limit?: number): Promise<ListeningDeadLetter[]>;
  markListeningDeadLetterReplayed(id: string): Promise<ListeningDeadLetter | undefined>;
  markListeningDeadLetterResolved(id: string): Promise<ListeningDeadLetter | undefined>;
  upsertListeningReadinessModel(record: InsertListeningReadinessModel): Promise<ListeningReadinessModel>;
  getListeningReadinessModel(taskProgressId: string, sectionId: string): Promise<ListeningReadinessModel | undefined>;
  insertListeningQueueMetric(record: InsertListeningQueueMetric): Promise<ListeningQueueMetric>;
  listListeningQueueMetricsByUser(userId: string, limit?: number): Promise<ListeningQueueMetric[]>;
  insertListeningEventOutbox(record: InsertListeningEventOutbox): Promise<ListeningEventOutbox>;
  listListeningEventOutboxByTask(taskProgressId: string): Promise<ListeningEventOutbox[]>;
  insertListeningValidationReport(record: CreateListeningValidationReportInput): Promise<ListeningValidationReport>;
  getListeningValidationReport(id: string): Promise<ListeningValidationReport | undefined>;
  listListeningValidationReportsByTask(taskProgressId: string, limit?: number): Promise<ListeningValidationReport[]>;
  insertListeningReviewQueue(record: CreateListeningReviewQueueInput): Promise<ListeningReviewQueue>;
  getListeningReviewQueueById(id: string): Promise<ListeningReviewQueue | undefined>;
  listListeningReviewQueue(params: {
    status?: string;
    severity?: string;
    failureType?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ rows: ListeningReviewQueue[]; total: number }>;
  updateListeningReviewQueue(id: string, updates: Partial<InsertListeningReviewQueue>): Promise<ListeningReviewQueue | undefined>;
  insertListeningReviewAction(record: CreateListeningReviewActionInput): Promise<ListeningReviewAction>;
  listListeningReviewActions(reviewQueueId: string): Promise<ListeningReviewAction[]>;
  insertListeningManifestVersion(record: CreateListeningManifestVersionInput): Promise<ListeningManifestVersion>;
  listListeningManifestVersions(taskProgressId: string): Promise<ListeningManifestVersion[]>;
  getActiveListeningManifestVersion(taskProgressId: string): Promise<ListeningManifestVersion | undefined>;
  activateListeningManifestVersion(taskProgressId: string, versionNo: number): Promise<ListeningManifestVersion | undefined>;
  insertListeningPublishAudit(record: CreateListeningPublishAuditInput): Promise<ListeningPublishAudit>;
  listListeningPublishAudit(params: {
    taskProgressId?: string;
    sectionId?: string;
    correlationId?: string;
    limit?: number;
  }): Promise<ListeningPublishAudit[]>;
  insertListeningGovernanceLedger(record: CreateListeningGovernanceLedgerInput): Promise<ListeningGovernanceLedger>;
  listListeningGovernanceLedger(params: {
    userId?: string;
    taskProgressId?: string;
    sectionId?: string;
    sessionId?: string;
    correlationId?: string;
    limit?: number;
    from?: Date;
    to?: Date;
  }): Promise<ListeningGovernanceLedger[]>;

  runInTransaction<T>(fn: (storage: IStorage) => Promise<T>): Promise<T>;
}

type DrizzleDb = NodePgDatabase<typeof schema>;

export class DatabaseStorage implements IStorage {
  constructor(private readonly orm: DrizzleDb) {}
  // User operations for Replit Auth
  async getUser(id: string): Promise<User | undefined> {
    // First try to find user by primary ID
    const [user] = await this.orm.select().from(users).where(eq(users.id, id));
    
    if (user) {
      return user;
    }
    
    // If not found, try Firebase UID
    const [userByFirebase] = await this.orm.select().from(users).where(eq(users.firebaseUid, id));
    
    if (userByFirebase) {
      storageVerboseLog(`[Storage] User found by Firebase UID instead of primary ID: ${id}`);
      return userByFirebase;
    }
    
    // User not found by either method
    return undefined;
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.orm.select().from(users).where(eq(users.email, email));
    return user;
  }
  
  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await this.orm.select().from(users).where(eq(users.username, username));
    return user;
  }
  
  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await this.orm.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }
  
  async getUserByFirebaseUid(firebaseUid: string): Promise<User | undefined> {
    const [user] = await this.orm.select().from(users).where(eq(users.firebaseUid, firebaseUid));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await this.orm
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }
  
  async updateOnboardingStatus(userId: string, completed: boolean): Promise<User> {
    // First, try to find the user by its ID (could be Firebase UID or database ID)
    let userToUpdate = await this.getUser(userId);
    
    // If not found by ID, try looking up by Firebase UID
    if (!userToUpdate) {
      userToUpdate = await this.getUserByFirebaseUid(userId);
      
      if (!userToUpdate) {
        storageErrorLog("[Storage] User not found for onboarding update", { userId });
        throw new Error("User not found for onboarding update");
      }
    }
    
    // Now we have the user, update using the database ID
    storageVerboseLog(`[Storage] Updating onboarding status for user ${userToUpdate.id} to ${completed}`);
    
    const [updatedUser] = await this.orm
      .update(users)
      .set({ 
        onboardingCompleted: completed,
        updatedAt: new Date()
      })
      .where(eq(users.id, userToUpdate.id))
      .returning();
    
    return updatedUser;
  }
  
  async deleteUserDataByEmail(email: string): Promise<void> {
    storageVerboseLog("[Storage] deleteUserDataByEmail lookup started");
    
    // First, verify that the user exists
    const user = await this.getUserByEmail(email);
    
    if (!user) {
      storageErrorLog("[Storage] deleteUserDataByEmail failed: user not found");
      throw new Error("User not found for provided email");
    }
    
    const userId = user.id;
    storageVerboseLog("[Storage] deleteUserDataByEmail transaction started");
    
    // Start a transaction to ensure all or nothing is deleted
    try {
      // Use a transaction to ensure all operations succeed or all fail
      await this.orm.transaction(async (tx) => {
        storageVerboseLog(`[Storage] Deleting dependent listening artifacts for user ${userId}`);
        await tx.delete(listeningReviewAction).where(eq(listeningReviewAction.userId, userId));
        await tx.delete(listeningReviewQueue).where(eq(listeningReviewQueue.userId, userId));
        await tx.delete(listeningValidationReport).where(eq(listeningValidationReport.userId, userId));
        await tx.delete(listeningEventOutbox).where(eq(listeningEventOutbox.userId, userId));
        await tx.delete(listeningQueueMetric).where(eq(listeningQueueMetric.userId, userId));
        await tx.delete(listeningReadinessModel).where(eq(listeningReadinessModel.userId, userId));
        await tx.delete(listeningDeadLetter).where(eq(listeningDeadLetter.userId, userId));
        await tx.delete(listeningManifestVersion).where(eq(listeningManifestVersion.userId, userId));
        await tx.delete(listeningPublishAudit).where(eq(listeningPublishAudit.userId, userId));
        await tx.delete(listeningGovernanceLedger).where(eq(listeningGovernanceLedger.userId, userId));
        await tx.delete(listeningPromptAssignment).where(eq(listeningPromptAssignment.userId, userId));
        await tx.delete(listeningExecutionLock).where(eq(listeningExecutionLock.userId, userId));
        await tx.delete(taskAttempts).where(eq(taskAttempts.userId, userId));

        storageVerboseLog(`[Storage] Deleting task progress records for user ${userId}`);
        await tx.delete(taskProgress).where(eq(taskProgress.userId, userId));
        
        storageVerboseLog(`[Storage] Deleting weekly study plans for user ${userId}`);
        await tx.delete(weeklyStudyPlans).where(eq(weeklyStudyPlans.userId, userId));
        
        storageVerboseLog(`[Storage] Deleting study plans for user ${userId}`);
        await tx.delete(studyPlans).where(eq(studyPlans.userId, userId));
        
        // Delete sessions if needed (if using session-based auth)
        // We're not deleting sessions here because they're not easily linked to a specific user
        // and would require direct SQL which is out of scope for this implementation
        
        storageVerboseLog(`[Storage] Deleting user record for ${userId}`);
        await tx.delete(users).where(eq(users.id, userId));
        
        storageVerboseLog("[Storage] deleteUserDataByEmail completed successfully");
      });
    } catch (error) {
      storageErrorLog("[Storage] deleteUserDataByEmail transaction failed", error);
      throw new Error(`Failed to delete user data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Study plan operations
  async createStudyPlan(studyPlanData: InsertStudyPlan): Promise<StudyPlan> {
    const [studyPlan] = await this.orm
      .insert(studyPlans)
      .values(studyPlanData)
      .returning();
    return studyPlan;
  }
  
  async getStudyPlan(id: string): Promise<StudyPlan | undefined> {
    const [studyPlan] = await this.orm
      .select()
      .from(studyPlans)
      .where(eq(studyPlans.id, id));
    return studyPlan;
  }
  
  async getStudyPlansByUserId(userId: string): Promise<StudyPlan[]> {
    // First try to find the user to get the correct ID
    const user = await this.getUser(userId);
    
    if (user) {
      // Use the database ID for the query
      return this.orm
        .select()
        .from(studyPlans)
        .where(eq(studyPlans.userId, user.id));
    }
    
    // If no user was found, return empty array
    storageVerboseLog(`[Storage] No user found for study plan lookup with ID: ${userId}`);
    return [];
  }
  
  // Weekly study plan operations
  async createWeeklyStudyPlan(weeklyPlanData: InsertWeeklyStudyPlan): Promise<WeeklyStudyPlan> {
    const [weeklyPlan] = await this.orm
      .insert(weeklyStudyPlans)
      .values(weeklyPlanData)
      .returning();
    return weeklyPlan;
  }
  
  async getWeeklyStudyPlan(id: string): Promise<WeeklyStudyPlan | undefined> {
    const [weeklyPlan] = await this.orm
      .select()
      .from(weeklyStudyPlans)
      .where(eq(weeklyStudyPlans.id, id));
    return weeklyPlan;
  }
  
  async getWeeklyStudyPlansByUserId(userId: string): Promise<WeeklyStudyPlan[]> {
    // First try to find the user to get the correct ID
    const user = await this.getUser(userId);
    
    if (user) {
      // Use the database ID for the query
      return this.orm
        .select()
        .from(weeklyStudyPlans)
        .where(eq(weeklyStudyPlans.userId, user.id));
    }
    
    // If no user was found, return empty array
    storageVerboseLog(`[Storage] No user found for weekly plan lookup with ID: ${userId}`);
    return [];
  }
  
  async getWeeklyStudyPlanByWeekAndSkill(userId: string, weekNumber: number, skillFocus: string): Promise<WeeklyStudyPlan | undefined> {
    // First try to find the user to get the correct ID
    const user = await this.getUser(userId);
    
    if (!user) {
      storageVerboseLog(`[Storage] No user found for weekly plan lookup by week and skill with ID: ${userId}`);
      return undefined;
    }
    
    // Use the database ID for the query
    const [weeklyPlan] = await this.orm
      .select()
      .from(weeklyStudyPlans)
      .where(
        and(
          eq(weeklyStudyPlans.userId, user.id),
          eq(weeklyStudyPlans.weekNumber, weekNumber),
          eq(weeklyStudyPlans.skillFocus, skillFocus)
        )
      );
    
    return weeklyPlan;
  }
  
  /**
   * Get all weekly study plans for a specific user and week number across all skills
   * This optimizes Firebase operations by fetching all skills in a single batch
   * 
   * @param userId The user ID
   * @param weekNumber The week number
   * @returns Array of weekly study plans for the specified week
   */
  async getWeeklyStudyPlansByWeek(userId: string, weekNumber: number): Promise<WeeklyStudyPlan[]> {
    // First try to find the user to get the correct ID
    const user = await this.getUser(userId);
    
    if (!user) {
      storageVerboseLog(`[Storage] No user found for weekly plans lookup by week with ID: ${userId}`);
      return [];
    }
    
    // Use the database ID for the query to get all plans for this week
    const weeklyPlans = await this.orm
      .select()
      .from(weeklyStudyPlans)
      .where(
        and(
          eq(weeklyStudyPlans.userId, user.id),
          eq(weeklyStudyPlans.weekNumber, weekNumber)
        )
      );
    
    return weeklyPlans;
  }
  
  async createOrUpdateWeeklyStudyPlan(userId: string, weekNumber: number, skillFocus: string, weekFocus: string, planData: any): Promise<WeeklyStudyPlan> {
    // Find the user first to ensure we have the correct database ID
    const user = await this.getUser(userId);
    
    if (!user) {
      storageErrorLog("[Storage] Failed to create/update weekly plan: user not found", { userId });
      throw new Error("User not found for weekly plan operation");
    }
    
    // Use the correct database ID for all operations
    const databaseUserId = user.id;
    
    // Check if a plan already exists for this user, week, and skill
    const existingPlan = await this.getWeeklyStudyPlanByWeekAndSkill(databaseUserId, weekNumber, skillFocus);
    
    if (existingPlan) {
      // Update the existing plan
      storageVerboseLog(`[Storage] Updating existing weekly plan for user ${databaseUserId}, week ${weekNumber}, skill ${skillFocus}`);
      const [updatedPlan] = await this.orm
        .update(weeklyStudyPlans)
        .set({
          weekFocus: weekFocus,
          planData: planData,
          updatedAt: new Date()
        })
        .where(eq(weeklyStudyPlans.id, existingPlan.id))
        .returning();
      
      return updatedPlan;
    } else {
      // Create a new plan
      storageVerboseLog(`[Storage] Creating new weekly plan for user ${databaseUserId}, week ${weekNumber}, skill ${skillFocus}`);
      const newPlan: InsertWeeklyStudyPlan = {
        id: uuid(),
        userId: databaseUserId,  // Use the database ID, not Firebase UID
        weekNumber: weekNumber,
        skillFocus: skillFocus,
        weekFocus: weekFocus,
        planData: planData
      };
      
      return this.createWeeklyStudyPlan(newPlan);
    }
  }

  async updateWeeklyStudyPlanPlanData(id: string, planData: any, weekFocus?: string | null): Promise<WeeklyStudyPlan | undefined> {
    const updatePayload: Partial<InsertWeeklyStudyPlan> = {
      planData,
      updatedAt: new Date(),
    };
    if (typeof weekFocus === "string") {
      updatePayload.weekFocus = weekFocus;
    }

    const [updated] = await this.orm
      .update(weeklyStudyPlans)
      .set(updatePayload)
      .where(eq(weeklyStudyPlans.id, id))
      .returning();
    return updated;
  }

  // Task progress operations
  async findTaskProgressByScope(params: {
    userId: string;
    weeklyPlanId: string;
    dayNumber: number;
    taskTitle: string;
    skill: string;
  }): Promise<TaskProgress | undefined> {
    const { userId, weeklyPlanId, dayNumber, taskTitle, skill } = params;

    const [existing] = await this.orm
      .select()
      .from(taskProgress)
      .where(
        and(
          eq(taskProgress.userId, userId),
          eq(taskProgress.weeklyPlanId, weeklyPlanId),
          eq(taskProgress.dayNumber, dayNumber),
          eq(taskProgress.taskTitle, taskTitle),
          eq(taskProgress.skill, skill),
        ),
      );

    return existing;
  }

  async createTaskProgress(taskProgressData: InsertTaskProgress): Promise<TaskProgress> {
    storageVerboseLog(`[Storage] Creating task progress for user ${taskProgressData.userId}, week ${taskProgressData.weekNumber}, day ${taskProgressData.dayNumber}`);
    
    // Generate UUID if not provided
    if (!taskProgressData.id) {
      taskProgressData.id = uuid();
    }
    
    const [createdTaskProgress] = await this.orm
      .insert(taskProgress)
      .values(taskProgressData)
      .returning();
      
    return createdTaskProgress;
  }
  
  async getTaskProgress(id: string): Promise<TaskProgress | undefined> {
    const [progress] = await this.orm
      .select()
      .from(taskProgress)
      .where(eq(taskProgress.id, id));
      
    return progress;
  }
  
  async getTaskProgressByUserAndTask(userId: string, weekNumber: number, dayNumber: number): Promise<TaskProgress | undefined> {
    const [progress] = await this.orm
      .select()
      .from(taskProgress)
      .where(
        and(
          eq(taskProgress.userId, userId),
          eq(taskProgress.weekNumber, weekNumber),
          eq(taskProgress.dayNumber, dayNumber)
        )
      );
      
    return progress;
  }
  
  async getTaskProgressByWeeklyPlan(weeklyPlanId: string, userId?: string): Promise<TaskProgress[]> {
    let normalizedUserId: string | undefined;

    if (userId) {
      const user = await this.getUser(userId);
      if (user) {
        normalizedUserId = user.id;
      } else {
        storageWarnLog("[Storage] No user found while filtering task progress", {
          weeklyPlanId,
          userId,
        });
        normalizedUserId = undefined;
      }
    }

    const conditions = [
      eq(taskProgress.weeklyPlanId, weeklyPlanId),
      ...(normalizedUserId ? [eq(taskProgress.userId, normalizedUserId)] : []),
    ];

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    return this.orm
      .select()
      .from(taskProgress)
      .where(whereClause)
      .orderBy(taskProgress.dayNumber);
  }

  async getRecentTaskProgressBySkill(userId: string, skill: string, limit: number): Promise<TaskProgress[]> {
    return this.orm
      .select()
      .from(taskProgress)
      .where(
        and(
          eq(taskProgress.userId, userId),
          eq(taskProgress.skill, skill),
        ),
      )
      .orderBy(desc(taskProgress.completedAt), desc(taskProgress.updatedAt))
      .limit(limit);
  }
  
  async updateTaskStatus(id: string, status: string, progressData?: any): Promise<TaskProgress> {
    storageVerboseLog(`[Storage] Updating task progress ${id} to status: ${status}`);

    const updateData: any = {
      status,
      updatedAt: new Date()
    };

    if (progressData !== undefined) {
      updateData.progressData = progressData;
    }

    if (status === 'not-started') {
      updateData.startedAt = null;
      updateData.completedAt = null;
    } else if (status === 'in-progress') {
      const task = await this.getTaskProgress(id);
      if (task && task.status === 'not-started') {
        updateData.startedAt = new Date();
      }
    } else if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    const [updatedTask] = await this.orm
      .update(taskProgress)
      .set(updateData)
      .where(eq(taskProgress.id, id))
      .returning();

    return updatedTask;
  }

  async updateTaskProgress(id: string, updates: Partial<InsertTaskProgress>): Promise<TaskProgress> {
    storageVerboseLog(`[Storage] Updating task progress ${id}`, updates);

    const updateData: any = {
      ...updates,
      updatedAt: new Date()
    };

    const [updatedTask] = await this.orm
      .update(taskProgress)
      .set(updateData)
      .where(eq(taskProgress.id, id))
      .returning();

    return updatedTask;
  }

  async markTaskAsInProgress(id: string, progressData?: any): Promise<TaskProgress> {
    return this.updateTaskStatus(id, 'in-progress', progressData);
  }

  async markTaskAsCompleted(id: string): Promise<TaskProgress> {
    return this.updateTaskStatus(id, 'completed');
  }
  
  /**
   * Batch initialize multiple task progress records at once
   * This is used when a user first views a weekly plan to create tracking records for all tasks
   * 
   * @param userId The user ID who owns these tasks
   * @param weeklyPlanId The ID of the weekly plan these tasks belong to
   * @param weekNumber The week number of the plan
   * @param tasks Array of tasks to initialize with their titles, day numbers, and optional initial status
   * @returns Array of created task progress records
   */
  async batchInitializeTaskProgress(
    userId: string,
    weeklyPlanId: string,
    weekNumber: number,
    tasks: Array<{ taskTitle: string; dayNumber: number; initialStatus?: string; skill?: string }>
  ): Promise<TaskProgress[]> {
    try {
      storageVerboseLog(`[Storage] Batch initializing ${tasks.length} task progress records for user ${userId}, weekly plan ${weeklyPlanId}`);
      
      // Create an array of task progress records to insert
      const taskProgressRecords: InsertTaskProgress[] = tasks.map(task => ({
        id: uuid(), // Generate a unique ID for each task
        userId,
        weeklyPlanId,
        weekNumber,
        dayNumber: task.dayNumber,
        taskTitle: task.taskTitle,
        skill: task.skill || 'listening', // Default to 'listening' for backwards compatibility
        status: task.initialStatus || 'not-started',
        createdAt: new Date(),
        updatedAt: new Date()
      }));
      
      // Check if tasks already exist to avoid duplicates
      const existingTasks = await this.getTaskProgressByWeeklyPlan(weeklyPlanId, userId);
      const existingTaskMap = new Map<string, boolean>();
      
      for (const task of existingTasks) {
        // Create a unique key for each task based on day number and title
        const taskKey = `${task.dayNumber}-${task.taskTitle}`;
        existingTaskMap.set(taskKey, true);
      }
      
      // Filter out tasks that already exist
      const newTaskRecords = taskProgressRecords.filter(task => {
        const taskKey = `${task.dayNumber}-${task.taskTitle}`;
        return !existingTaskMap.has(taskKey);
      });
      
      if (newTaskRecords.length === 0) {
        storageVerboseLog(`[Storage] No new tasks to initialize - all ${tasks.length} tasks already exist`);
        return existingTasks;
      }
      
      storageVerboseLog(`[Storage] Inserting ${newTaskRecords.length} new task progress records (${existingTasks.length} already exist)`);
      
      // Insert all the new task progress records
      const createdTasks = await this.orm
        .insert(taskProgress)
        .values(newTaskRecords)
        .returning();
        
      storageVerboseLog(`[Storage] Successfully created ${createdTasks.length} task progress records`);
      
      // Return all tasks - both new and existing
      return [...createdTasks, ...existingTasks];
    } catch (error) {
      storageErrorLog("[Storage] Error in batch initializing task progress", error);
      throw error;
    }
  }

  async deleteTaskProgressByIds(ids: string[]): Promise<void> {
    if (!ids.length) {
      return;
    }

    await this.orm
      .delete(taskProgress)
      .where(inArray(taskProgress.id, ids));
  }
  
  // New methods for task content operations
  
  /**
   * Get a task with its content (script, audio URL, questions, etc.)
   * @param id Task ID
   * @returns Task with content or undefined if not found
   */
  async getTaskWithContent(id: string): Promise<TaskProgress | undefined> {
    const [task] = await this.orm
      .select()
      .from(taskProgress)
      .where(eq(taskProgress.id, id));
    
    return task;
  }
  
  /**
   * Update task content with new AI-generated content
   * @param id Task ID
   * @param contentUpdate Content update data
   * @returns Updated task
   */
  async updateTaskContent(id: string, contentUpdate: TaskContentUpdate): Promise<TaskProgress> {
    storageVerboseLog(`[Storage] Updating task content for ${id}`, contentUpdate);

    // Published manifests are immutable in critical path.
    const existingTask = await this.getTaskProgress(id);
    if (existingTask) {
      const sectionNo = Number(((existingTask.progressData ?? {}) as Record<string, any>)?.sessionOrder ?? 1);
      const sectionId = `${id}:section-${sectionNo}`;
      const [sectionStateRow] = await this.orm
        .select()
        .from(listeningSectionState)
        .where(
          and(
            eq(listeningSectionState.taskProgressId, id),
            eq(listeningSectionState.sectionId, sectionId),
          ),
        )
        .limit(1);
      if (sectionStateRow?.state === "PUBLISHED") {
        const activeManifest = await this.getActiveListeningManifestVersion(id);
        if (activeManifest) {
          throw new Error("PUBLISHED_MANIFEST_IMMUTABLE");
        }
      }
    }
    
    // Prepare update object with only the provided fields
    const updateData: Partial<typeof taskProgress.$inferInsert> = {
      updatedAt: new Date()
    };
    
    // Only include fields that are provided in the update
    if (contentUpdate.scriptText !== undefined) {
      updateData.scriptText = contentUpdate.scriptText;
    }
    
    if (contentUpdate.audioUrl !== undefined) {
      updateData.audioUrl = contentUpdate.audioUrl;
    }
    
    if (contentUpdate.questions !== undefined) {
      updateData.questions = contentUpdate.questions;
    }
    
    if (contentUpdate.accent !== undefined) {
      updateData.accent = contentUpdate.accent;
    }
    
    if (contentUpdate.duration !== undefined) {
      updateData.duration = contentUpdate.duration;
    }
    
    if (contentUpdate.replayLimit !== undefined) {
      updateData.replayLimit = contentUpdate.replayLimit;
    }
    
    if (contentUpdate.scriptType !== undefined) {
      updateData.scriptType = contentUpdate.scriptType;
    }
    
    if (contentUpdate.difficulty !== undefined) {
      updateData.difficulty = contentUpdate.difficulty;
    }
    
    if (contentUpdate.ieltsPart !== undefined) {
      updateData.ieltsPart = contentUpdate.ieltsPart;
    }
    
    if (contentUpdate.topicDomain !== undefined) {
      updateData.topicDomain = contentUpdate.topicDomain;
    }
    
    if (contentUpdate.contextLabel !== undefined) {
      updateData.contextLabel = contentUpdate.contextLabel;
    }
    
    if (contentUpdate.scenarioOverview !== undefined) {
      updateData.scenarioOverview = contentUpdate.scenarioOverview;
    }
    
    if (contentUpdate.estimatedDurationSec !== undefined) {
      updateData.estimatedDurationSec = contentUpdate.estimatedDurationSec;
    }

    if (contentUpdate.taskTitle !== undefined) {
      updateData.taskTitle = contentUpdate.taskTitle;
    }
    
    // Perform the update
    const [updatedTask] = await this.orm
      .update(taskProgress)
      .set(updateData)
      .where(eq(taskProgress.id, id))
      .returning();
    
    return updatedTask;
  }
  
  /**
   * Insert a new task attempt for AI Coach analytics
   * @param attempt Task attempt data
   */
  async insertTaskAttempt(attempt: TaskAttempt): Promise<void> {
    storageVerboseLog(`[Storage] Inserting task attempt for task ${attempt.taskProgressId}`, {
      userId: attempt.userId,
      score: attempt.score,
      answerCount: attempt.answers.length
    });
    
    await this.orm.insert(taskAttempts).values({
      id: attempt.id,
      taskProgressId: attempt.taskProgressId,
      userId: attempt.userId,
      startedAt: new Date(attempt.startedAt),
      submittedAt: new Date(attempt.submittedAt),
      durationMs: attempt.durationMs,
      answers: attempt.answers,
      score: attempt.score
    });
  }
  
  /**
   * Get task progress by ID with ownership validation
   * @param id Task progress ID
   * @param userId User ID for ownership check
   * @returns Task progress or undefined if not found/not owned
   */
  async getTaskProgressById(id: string, userId: string): Promise<TaskProgress | undefined> {
    const [task] = await this.orm
      .select()
      .from(taskProgress)
      .where(and(eq(taskProgress.id, id), eq(taskProgress.userId, userId)));
    
    return task || undefined;
  }

  async getListeningSectionStates(taskProgressId: string): Promise<ListeningSectionState[]> {
    return this.orm
      .select()
      .from(listeningSectionState)
      .where(eq(listeningSectionState.taskProgressId, taskProgressId))
      .orderBy(listeningSectionState.sectionNo);
  }

  async getListeningSectionState(taskProgressId: string, sectionId: string): Promise<ListeningSectionState | undefined> {
    const [row] = await this.orm
      .select()
      .from(listeningSectionState)
      .where(
        and(
          eq(listeningSectionState.taskProgressId, taskProgressId),
          eq(listeningSectionState.sectionId, sectionId),
        ),
      );
    return row;
  }

  async upsertListeningSectionState(record: InsertListeningSectionState): Promise<ListeningSectionState> {
    const payload: InsertListeningSectionState = {
      ...record,
      id: record.id ?? uuid(),
      updatedAt: new Date(),
    };

    const [row] = await this.orm
      .insert(listeningSectionState)
      .values(payload)
      .onConflictDoUpdate({
        target: [listeningSectionState.taskProgressId, listeningSectionState.sectionId],
        set: {
          state: payload.state,
          sectionNo: payload.sectionNo,
          attempt: payload.attempt ?? 0,
          lastErrorCode: payload.lastErrorCode ?? null,
          idempotencyKey: payload.idempotencyKey,
          updatedAt: new Date(),
        },
      })
      .returning();

    return row;
  }

  async getListeningExecutionLock(lockKey: string): Promise<ListeningExecutionLock | undefined> {
    const [row] = await this.orm
      .select()
      .from(listeningExecutionLock)
      .where(eq(listeningExecutionLock.lockKey, lockKey));
    return row;
  }

  async acquireListeningExecutionLock(record: InsertListeningExecutionLock): Promise<ListeningExecutionLock | undefined> {
    const now = new Date();
    await this.orm
      .delete(listeningExecutionLock)
      .where(lte(listeningExecutionLock.expiresAt, now));

    const payload: InsertListeningExecutionLock = {
      ...record,
      id: record.id ?? uuid(),
      acquiredAt: record.acquiredAt ?? now,
      heartbeatAt: record.heartbeatAt ?? now,
      createdAt: record.createdAt ?? now,
    };

    const [row] = await this.orm
      .insert(listeningExecutionLock)
      .values(payload)
      .onConflictDoNothing({ target: listeningExecutionLock.lockKey })
      .returning();

    return row;
  }

  async heartbeatListeningExecutionLock(
    lockKey: string,
    ownerId: string,
    expiresAt: Date,
  ): Promise<ListeningExecutionLock | undefined> {
    const [row] = await this.orm
      .update(listeningExecutionLock)
      .set({
        heartbeatAt: new Date(),
        expiresAt,
      })
      .where(and(eq(listeningExecutionLock.lockKey, lockKey), eq(listeningExecutionLock.ownerId, ownerId)))
      .returning();
    return row;
  }

  async releaseListeningExecutionLock(lockKey: string, ownerId: string): Promise<boolean> {
    const rows = await this.orm
      .delete(listeningExecutionLock)
      .where(and(eq(listeningExecutionLock.lockKey, lockKey), eq(listeningExecutionLock.ownerId, ownerId)))
      .returning({ lockKey: listeningExecutionLock.lockKey });
    return rows.length > 0;
  }

  async insertListeningDeadLetter(record: InsertListeningDeadLetter): Promise<ListeningDeadLetter> {
    const payload: InsertListeningDeadLetter = {
      ...record,
      id: record.id ?? uuid(),
      createdAt: record.createdAt ?? new Date(),
    };
    const [row] = await this.orm.insert(listeningDeadLetter).values(payload).returning();
    return row;
  }

  async listListeningDeadLetters(taskProgressId: string): Promise<ListeningDeadLetter[]> {
    return this.orm
      .select()
      .from(listeningDeadLetter)
      .where(eq(listeningDeadLetter.taskProgressId, taskProgressId))
      .orderBy(desc(listeningDeadLetter.createdAt));
  }

  async listListeningDeadLettersByUser(userId: string, limit = 200): Promise<ListeningDeadLetter[]> {
    return this.orm
      .select()
      .from(listeningDeadLetter)
      .where(eq(listeningDeadLetter.userId, userId))
      .orderBy(desc(listeningDeadLetter.createdAt))
      .limit(Math.max(1, Math.min(1000, Number(limit))));
  }

  async markListeningDeadLetterReplayed(id: string): Promise<ListeningDeadLetter | undefined> {
    const [row] = await this.orm
      .update(listeningDeadLetter)
      .set({ replayedAt: new Date() })
      .where(eq(listeningDeadLetter.id, id))
      .returning();
    return row;
  }

  async markListeningDeadLetterResolved(id: string): Promise<ListeningDeadLetter | undefined> {
    const [row] = await this.orm
      .update(listeningDeadLetter)
      .set({ resolvedAt: new Date() })
      .where(eq(listeningDeadLetter.id, id))
      .returning();
    return row;
  }

  async upsertListeningReadinessModel(record: InsertListeningReadinessModel): Promise<ListeningReadinessModel> {
    const payload: InsertListeningReadinessModel = {
      ...record,
      id: record.id ?? uuid(),
      updatedAt: new Date(),
      createdAt: record.createdAt ?? new Date(),
    };
    const [row] = await this.orm
      .insert(listeningReadinessModel)
      .values(payload)
      .onConflictDoUpdate({
        target: [listeningReadinessModel.taskProgressId, listeningReadinessModel.sectionId],
        set: {
          sectionNo: payload.sectionNo,
          state: payload.state,
          partReady: payload.partReady ?? false,
          manifestStatus: payload.manifestStatus,
          manifest: payload.manifest ?? null,
          lastEventId: payload.lastEventId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async getListeningReadinessModel(
    taskProgressId: string,
    sectionId: string,
  ): Promise<ListeningReadinessModel | undefined> {
    const [row] = await this.orm
      .select()
      .from(listeningReadinessModel)
      .where(
        and(
          eq(listeningReadinessModel.taskProgressId, taskProgressId),
          eq(listeningReadinessModel.sectionId, sectionId),
        ),
      );
    return row;
  }

  async insertListeningQueueMetric(record: InsertListeningQueueMetric): Promise<ListeningQueueMetric> {
    const payload: InsertListeningQueueMetric = {
      ...record,
      id: record.id ?? uuid(),
      createdAt: record.createdAt ?? new Date(),
    };
    const [row] = await this.orm.insert(listeningQueueMetric).values(payload).returning();
    return row;
  }

  async listListeningQueueMetricsByUser(userId: string, limit = 500): Promise<ListeningQueueMetric[]> {
    return this.orm
      .select()
      .from(listeningQueueMetric)
      .where(eq(listeningQueueMetric.userId, userId))
      .orderBy(desc(listeningQueueMetric.createdAt))
      .limit(Math.max(1, Math.min(5000, Number(limit))));
  }

  async insertListeningEventOutbox(record: InsertListeningEventOutbox): Promise<ListeningEventOutbox> {
    const payload: InsertListeningEventOutbox = {
      ...record,
      id: record.id ?? uuid(),
      createdAt: record.createdAt ?? new Date(),
    };
    const [row] = await this.orm.insert(listeningEventOutbox).values(payload).returning();
    return row;
  }

  async listListeningEventOutboxByTask(taskProgressId: string): Promise<ListeningEventOutbox[]> {
    return this.orm
      .select()
      .from(listeningEventOutbox)
      .where(eq(listeningEventOutbox.taskProgressId, taskProgressId))
      .orderBy(desc(listeningEventOutbox.createdAt));
  }

  async insertListeningValidationReport(
    record: CreateListeningValidationReportInput,
  ): Promise<ListeningValidationReport> {
    const payload: InsertListeningValidationReport = {
      ...record,
      id: record.id ?? uuid(),
      createdAt: record.createdAt ?? new Date(),
      updatedAt: record.updatedAt ?? new Date(),
    };
    const [row] = await this.orm.insert(listeningValidationReport).values(payload).returning();
    return row;
  }

  async getListeningValidationReport(id: string): Promise<ListeningValidationReport | undefined> {
    const [row] = await this.orm
      .select()
      .from(listeningValidationReport)
      .where(eq(listeningValidationReport.id, id));
    return row;
  }

  async listListeningValidationReportsByTask(
    taskProgressId: string,
    limit = 20,
  ): Promise<ListeningValidationReport[]> {
    return this.orm
      .select()
      .from(listeningValidationReport)
      .where(eq(listeningValidationReport.taskProgressId, taskProgressId))
      .orderBy(desc(listeningValidationReport.createdAt))
      .limit(limit);
  }

  async insertListeningReviewQueue(record: CreateListeningReviewQueueInput): Promise<ListeningReviewQueue> {
    const payload: InsertListeningReviewQueue = {
      ...record,
      id: record.id ?? uuid(),
      createdAt: record.createdAt ?? new Date(),
      updatedAt: record.updatedAt ?? new Date(),
    };
    const [row] = await this.orm.insert(listeningReviewQueue).values(payload).returning();
    return row;
  }

  async getListeningReviewQueueById(id: string): Promise<ListeningReviewQueue | undefined> {
    const [row] = await this.orm
      .select()
      .from(listeningReviewQueue)
      .where(eq(listeningReviewQueue.id, id));
    return row;
  }

  async listListeningReviewQueue(params: {
    status?: string;
    severity?: string;
    failureType?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ rows: ListeningReviewQueue[]; total: number }> {
    const page = Math.max(1, Number(params.page ?? 1));
    const pageSize = Math.max(1, Math.min(100, Number(params.pageSize ?? 20)));
    const conditions: any[] = [];
    if (params.status) conditions.push(eq(listeningReviewQueue.status, params.status));
    if (params.severity) conditions.push(eq(listeningReviewQueue.severity, params.severity));
    if (params.failureType) {
      conditions.push(ilike(listeningReviewQueue.failureType, `%${params.failureType}%`));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.orm
      .select()
      .from(listeningReviewQueue)
      .where(whereClause)
      .orderBy(desc(listeningReviewQueue.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const countRows = await this.orm
      .select({ total: sql<number>`count(*)::int` })
      .from(listeningReviewQueue)
      .where(whereClause);

    return {
      rows,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async updateListeningReviewQueue(
    id: string,
    updates: Partial<InsertListeningReviewQueue>,
  ): Promise<ListeningReviewQueue | undefined> {
    const [row] = await this.orm
      .update(listeningReviewQueue)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(listeningReviewQueue.id, id))
      .returning();
    return row;
  }

  async insertListeningReviewAction(record: CreateListeningReviewActionInput): Promise<ListeningReviewAction> {
    const payload: InsertListeningReviewAction = {
      ...record,
      id: record.id ?? uuid(),
      createdAt: record.createdAt ?? new Date(),
    };
    const [row] = await this.orm.insert(listeningReviewAction).values(payload).returning();
    return row;
  }

  async listListeningReviewActions(reviewQueueId: string): Promise<ListeningReviewAction[]> {
    return this.orm
      .select()
      .from(listeningReviewAction)
      .where(eq(listeningReviewAction.reviewQueueId, reviewQueueId))
      .orderBy(desc(listeningReviewAction.createdAt));
  }

  async insertListeningManifestVersion(
    record: CreateListeningManifestVersionInput,
  ): Promise<ListeningManifestVersion> {
    const payload: InsertListeningManifestVersion = {
      ...record,
      id: record.id ?? uuid(),
      createdAt: record.createdAt ?? new Date(),
      publishedAt: record.publishedAt ?? new Date(),
    };
    const [row] = await this.orm.insert(listeningManifestVersion).values(payload).returning();
    return row;
  }

  async listListeningManifestVersions(taskProgressId: string): Promise<ListeningManifestVersion[]> {
    return this.orm
      .select()
      .from(listeningManifestVersion)
      .where(eq(listeningManifestVersion.taskProgressId, taskProgressId))
      .orderBy(desc(listeningManifestVersion.versionNo));
  }

  async getActiveListeningManifestVersion(
    taskProgressId: string,
  ): Promise<ListeningManifestVersion | undefined> {
    const [row] = await this.orm
      .select()
      .from(listeningManifestVersion)
      .where(
        and(
          eq(listeningManifestVersion.taskProgressId, taskProgressId),
          eq(listeningManifestVersion.isActive, true),
        ),
      )
      .orderBy(desc(listeningManifestVersion.versionNo))
      .limit(1);
    return row;
  }

  async activateListeningManifestVersion(
    taskProgressId: string,
    versionNo: number,
  ): Promise<ListeningManifestVersion | undefined> {
    await this.orm
      .update(listeningManifestVersion)
      .set({ isActive: false })
      .where(eq(listeningManifestVersion.taskProgressId, taskProgressId));

    const [row] = await this.orm
      .update(listeningManifestVersion)
      .set({ isActive: true })
      .where(
        and(
          eq(listeningManifestVersion.taskProgressId, taskProgressId),
          eq(listeningManifestVersion.versionNo, versionNo),
        ),
      )
      .returning();
    return row;
  }

  async insertListeningPublishAudit(record: CreateListeningPublishAuditInput): Promise<ListeningPublishAudit> {
    const payload: InsertListeningPublishAudit = {
      ...record,
      id: record.id ?? uuid(),
      createdAt: record.createdAt ?? new Date(),
    };
    const [row] = await this.orm.insert(listeningPublishAudit).values(payload).returning();
    return row;
  }

  async listListeningPublishAudit(params: {
    taskProgressId?: string;
    sectionId?: string;
    correlationId?: string;
    limit?: number;
  }): Promise<ListeningPublishAudit[]> {
    const conditions: any[] = [];
    if (params.taskProgressId) conditions.push(eq(listeningPublishAudit.taskProgressId, params.taskProgressId));
    if (params.sectionId) conditions.push(eq(listeningPublishAudit.sectionId, params.sectionId));
    if (params.correlationId) conditions.push(eq(listeningPublishAudit.correlationId, params.correlationId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return this.orm
      .select()
      .from(listeningPublishAudit)
      .where(whereClause)
      .orderBy(desc(listeningPublishAudit.createdAt))
      .limit(Math.max(1, Math.min(200, Number(params.limit ?? 100))));
  }

  async insertListeningGovernanceLedger(
    record: CreateListeningGovernanceLedgerInput,
  ): Promise<ListeningGovernanceLedger> {
    const payload: InsertListeningGovernanceLedger = {
      ...record,
      id: record.id ?? uuid(),
      createdAt: record.createdAt ?? new Date(),
    };
    const [row] = await this.orm.insert(listeningGovernanceLedger).values(payload).returning();
    return row;
  }

  async listListeningGovernanceLedger(params: {
    userId?: string;
    taskProgressId?: string;
    sectionId?: string;
    sessionId?: string;
    correlationId?: string;
    limit?: number;
    from?: Date;
    to?: Date;
  }): Promise<ListeningGovernanceLedger[]> {
    const conditions: any[] = [];
    if (params.userId) conditions.push(eq(listeningGovernanceLedger.userId, params.userId));
    if (params.taskProgressId) conditions.push(eq(listeningGovernanceLedger.taskProgressId, params.taskProgressId));
    if (params.sectionId) conditions.push(eq(listeningGovernanceLedger.sectionId, params.sectionId));
    if (params.sessionId) conditions.push(eq(listeningGovernanceLedger.sessionId, params.sessionId));
    if (params.correlationId) conditions.push(eq(listeningGovernanceLedger.correlationId, params.correlationId));
    if (params.from) conditions.push(gte(listeningGovernanceLedger.createdAt, params.from));
    if (params.to) conditions.push(lte(listeningGovernanceLedger.createdAt, params.to));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    return this.orm
      .select()
      .from(listeningGovernanceLedger)
      .where(whereClause)
      .orderBy(desc(listeningGovernanceLedger.createdAt))
      .limit(Math.max(1, Math.min(1000, Number(params.limit ?? 200))));
  }

  async runInTransaction<T>(fn: (storage: IStorage) => Promise<T>): Promise<T> {
    return await db.transaction(async (tx) => {
      const transactionalStorage = new DatabaseStorage(tx);
      return await fn(transactionalStorage);
    });
  }
}

export const storage = new DatabaseStorage(db);
