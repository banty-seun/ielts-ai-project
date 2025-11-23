import type { IStorage } from "../storage";

export interface RecentSessionSummary {
  taskId: string;
  scorePercent?: number | null;
  histogram?: Record<string, { correct: number; total: number }> | null;
}

export async function getRecentListeningSummaries(storage: IStorage, userId: string, limit = 5): Promise<RecentSessionSummary[]> {
  const records = await storage.getRecentTaskProgressBySkill(userId, "listening", limit);
  return records
    .map((task) => {
      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const summary = progressData.sessionSummary ?? null;
      return {
        taskId: task.id,
        scorePercent: typeof summary?.scorePercent === "number" ? summary.scorePercent : null,
        histogram: summary?.mistakeHistogram ?? null,
      };
    })
    .filter((item) => item.scorePercent !== null || item.histogram);
}
