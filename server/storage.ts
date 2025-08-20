import {
  users,
  studyPlans,
  weeklyStudyPlans,
  taskProgress,
  taskAttempts,
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
  type InsertTaskAttempt
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm/sql";
import { v4 as uuid } from 'uuid';

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
  
  // Task progress operations
  createTaskProgress(taskProgressData: InsertTaskProgress): Promise<TaskProgress>;
  getTaskProgress(id: string): Promise<TaskProgress | undefined>;
  getTaskProgressByUserAndTask(userId: string, weekNumber: number, dayNumber: number): Promise<TaskProgress | undefined>;
  getTaskProgressByWeeklyPlan(weeklyPlanId: string): Promise<TaskProgress[]>;
  updateTaskStatus(id: string, status: string, progressData?: any): Promise<TaskProgress>;
  markTaskAsInProgress(id: string, progressData?: any): Promise<TaskProgress>;
  markTaskAsCompleted(id: string): Promise<TaskProgress>;
  batchInitializeTaskProgress(
    userId: string, 
    weeklyPlanId: string, 
    weekNumber: number, 
    tasks: Array<{ taskTitle: string; dayNumber: number; initialStatus?: string }>
  ): Promise<TaskProgress[]>;
  
  // Task content operations - new methods for AI-generated content
  getTaskWithContent(id: string): Promise<TaskProgress | undefined>;
  updateTaskContent(id: string, contentUpdate: TaskContentUpdate): Promise<TaskProgress>;
  
  // Task attempt operations for AI Coach analytics
  insertTaskAttempt(attempt: TaskAttempt): Promise<void>;
  getTaskProgressById(id: string, userId: string): Promise<TaskProgress | undefined>;
}

export class DatabaseStorage implements IStorage {
  // User operations for Replit Auth
  async getUser(id: string): Promise<User | undefined> {
    // First try to find user by primary ID
    const [user] = await db.select().from(users).where(eq(users.id, id));
    
    if (user) {
      return user;
    }
    
    // If not found, try Firebase UID
    const [userByFirebase] = await db.select().from(users).where(eq(users.firebaseUid, id));
    
    if (userByFirebase) {
      console.log(`[Storage] User found by Firebase UID instead of primary ID: ${id}`);
      return userByFirebase;
    }
    
    // User not found by either method
    return undefined;
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }
  
  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }
  
  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }
  
  async getUserByFirebaseUid(firebaseUid: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
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
        console.error(`[Storage] User not found for onboarding update with ID or Firebase UID: ${userId}`);
        throw new Error(`User not found with ID or Firebase UID: ${userId}`);
      }
    }
    
    // Now we have the user, update using the database ID
    console.log(`[Storage] Updating onboarding status for user ${userToUpdate.id} to ${completed}`);
    
    const [updatedUser] = await db
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
    console.log(`[Storage] Looking up user by email: ${email}`);
    
    // First, verify that the user exists
    const user = await this.getUserByEmail(email);
    
    if (!user) {
      console.error(`[Storage] No user found with email: ${email}`);
      throw new Error(`User not found with email: ${email}`);
    }
    
    const userId = user.id;
    console.log(`[Storage] Found user with ID: ${userId}, preparing to delete all related data`);
    
    // Start a transaction to ensure all or nothing is deleted
    try {
      // Use a transaction to ensure all operations succeed or all fail
      await db.transaction(async (tx) => {
        console.log(`[Storage] Deleting task progress records for user ${userId}`);
        await tx.delete(taskProgress).where(eq(taskProgress.userId, userId));
        
        console.log(`[Storage] Deleting weekly study plans for user ${userId}`);
        await tx.delete(weeklyStudyPlans).where(eq(weeklyStudyPlans.userId, userId));
        
        console.log(`[Storage] Deleting study plans for user ${userId}`);
        await tx.delete(studyPlans).where(eq(studyPlans.userId, userId));
        
        // Delete sessions if needed (if using session-based auth)
        // We're not deleting sessions here because they're not easily linked to a specific user
        // and would require direct SQL which is out of scope for this implementation
        
        console.log(`[Storage] Deleting user record for ${userId}`);
        await tx.delete(users).where(eq(users.id, userId));
        
        console.log(`[Storage] All data for user with email ${email} has been deleted successfully`);
      });
    } catch (error) {
      console.error(`[Storage] Transaction failed while deleting user data for ${email}:`, error);
      throw new Error(`Failed to delete user data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Study plan operations
  async createStudyPlan(studyPlanData: InsertStudyPlan): Promise<StudyPlan> {
    const [studyPlan] = await db
      .insert(studyPlans)
      .values(studyPlanData)
      .returning();
    return studyPlan;
  }
  
  async getStudyPlan(id: string): Promise<StudyPlan | undefined> {
    const [studyPlan] = await db
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
      return db
        .select()
        .from(studyPlans)
        .where(eq(studyPlans.userId, user.id));
    }
    
    // If no user was found, return empty array
    console.log(`[Storage] No user found for study plan lookup with ID: ${userId}`);
    return [];
  }
  
  // Weekly study plan operations
  async createWeeklyStudyPlan(weeklyPlanData: InsertWeeklyStudyPlan): Promise<WeeklyStudyPlan> {
    const [weeklyPlan] = await db
      .insert(weeklyStudyPlans)
      .values(weeklyPlanData)
      .returning();
    return weeklyPlan;
  }
  
  async getWeeklyStudyPlan(id: string): Promise<WeeklyStudyPlan | undefined> {
    const [weeklyPlan] = await db
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
      return db
        .select()
        .from(weeklyStudyPlans)
        .where(eq(weeklyStudyPlans.userId, user.id));
    }
    
    // If no user was found, return empty array
    console.log(`[Storage] No user found for weekly plan lookup with ID: ${userId}`);
    return [];
  }
  
  async getWeeklyStudyPlanByWeekAndSkill(userId: string, weekNumber: number, skillFocus: string): Promise<WeeklyStudyPlan | undefined> {
    // First try to find the user to get the correct ID
    const user = await this.getUser(userId);
    
    if (!user) {
      console.log(`[Storage] No user found for weekly plan lookup by week and skill with ID: ${userId}`);
      return undefined;
    }
    
    // Use the database ID for the query
    const [weeklyPlan] = await db
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
      console.log(`[Storage] No user found for weekly plans lookup by week with ID: ${userId}`);
      return [];
    }
    
    // Use the database ID for the query to get all plans for this week
    const weeklyPlans = await db
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
      console.error(`[Storage] Failed to create/update weekly plan: No user found with ID: ${userId}`);
      throw new Error(`User not found with ID: ${userId}`);
    }
    
    // Use the correct database ID for all operations
    const databaseUserId = user.id;
    
    // Check if a plan already exists for this user, week, and skill
    const existingPlan = await this.getWeeklyStudyPlanByWeekAndSkill(databaseUserId, weekNumber, skillFocus);
    
    if (existingPlan) {
      // Update the existing plan
      console.log(`[Storage] Updating existing weekly plan for user ${databaseUserId}, week ${weekNumber}, skill ${skillFocus}`);
      const [updatedPlan] = await db
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
      console.log(`[Storage] Creating new weekly plan for user ${databaseUserId}, week ${weekNumber}, skill ${skillFocus}`);
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

  // Task progress operations
  async createTaskProgress(taskProgressData: InsertTaskProgress): Promise<TaskProgress> {
    console.log(`[Storage] Creating task progress for user ${taskProgressData.userId}, week ${taskProgressData.weekNumber}, day ${taskProgressData.dayNumber}`);
    
    // Generate UUID if not provided
    if (!taskProgressData.id) {
      taskProgressData.id = uuid();
    }
    
    const [createdTaskProgress] = await db
      .insert(taskProgress)
      .values(taskProgressData)
      .returning();
      
    return createdTaskProgress;
  }
  
  async getTaskProgress(id: string): Promise<TaskProgress | undefined> {
    const [progress] = await db
      .select()
      .from(taskProgress)
      .where(eq(taskProgress.id, id));
      
    return progress;
  }
  
  async getTaskProgressByUserAndTask(userId: string, weekNumber: number, dayNumber: number): Promise<TaskProgress | undefined> {
    const [progress] = await db
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
  
  async getTaskProgressByWeeklyPlan(weeklyPlanId: string): Promise<TaskProgress[]> {
    return db
      .select()
      .from(taskProgress)
      .where(eq(taskProgress.weeklyPlanId, weeklyPlanId))
      .orderBy(taskProgress.dayNumber);
  }
  
  async updateTaskStatus(id: string, status: string, progressData?: any): Promise<TaskProgress> {
    console.log(`[Storage] Updating task progress ${id} to status: ${status}`);
    
    const updateData: any = {
      status,
      updatedAt: new Date()
    };
    
    if (progressData) {
      updateData.progressData = progressData;
    }
    
    // If status is 'in-progress' and task hasn't been started yet, set startedAt
    if (status === 'in-progress') {
      const task = await this.getTaskProgress(id);
      if (task && task.status === 'not-started') {
        updateData.startedAt = new Date();
      }
    }
    
    // If status is 'completed', set completedAt
    if (status === 'completed') {
      updateData.completedAt = new Date();
    }
    
    const [updatedTask] = await db
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
      console.log(`[Storage] Batch initializing ${tasks.length} task progress records for user ${userId}, weekly plan ${weeklyPlanId}`);
      
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
      const existingTasks = await this.getTaskProgressByWeeklyPlan(weeklyPlanId);
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
        console.log(`[Storage] No new tasks to initialize - all ${tasks.length} tasks already exist`);
        return existingTasks;
      }
      
      console.log(`[Storage] Inserting ${newTaskRecords.length} new task progress records (${existingTasks.length} already exist)`);
      
      // Insert all the new task progress records
      const createdTasks = await db
        .insert(taskProgress)
        .values(newTaskRecords)
        .returning();
        
      console.log(`[Storage] Successfully created ${createdTasks.length} task progress records`);
      
      // Return all tasks - both new and existing
      return [...createdTasks, ...existingTasks];
    } catch (error) {
      console.error('[Storage] Error in batch initializing task progress:', error);
      throw error;
    }
  }
  
  // New methods for task content operations
  
  /**
   * Get a task with its content (script, audio URL, questions, etc.)
   * @param id Task ID
   * @returns Task with content or undefined if not found
   */
  async getTaskWithContent(id: string): Promise<TaskProgress | undefined> {
    const [task] = await db
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
    console.log(`[Storage] Updating task content for ${id}`, contentUpdate);
    
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
    
    // Perform the update
    const [updatedTask] = await db
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
    console.log(`[Storage] Inserting task attempt for task ${attempt.taskProgressId}`, {
      userId: attempt.userId,
      score: attempt.score,
      answerCount: attempt.answers.length
    });
    
    await db.insert(taskAttempts).values({
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
    const [task] = await db
      .select()
      .from(taskProgress)
      .where(and(eq(taskProgress.id, id), eq(taskProgress.userId, userId)));
    
    return task || undefined;
  }
}

export const storage = new DatabaseStorage();
