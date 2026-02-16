import type { IStorage } from "../storage";

export interface RecentSessionSummary {
  taskId: string;
  scorePercent?: number | null;
  histogram?: Record<string, { correct: number; total: number }> | null;
  accent?: string | null;
  challengeTags?: string[] | null;
  sectionTagHistogram?: Record<string, Record<string, { correct: number; total: number }>> | null;
  contextExposure?: {
    scriptType: string | null;
    topicDomain: string | null;
    contextLabel: string | null;
  } | null;
}

export async function getRecentListeningSummaries(storage: IStorage, userId: string, limit = 5): Promise<RecentSessionSummary[]> {
  const records = await storage.getRecentTaskProgressBySkill(userId, "listening", limit);
  return records
    .map((task) => {
      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const summary = progressData.sessionSummary ?? null;
      const sectionResults = Array.isArray(progressData.sectionResults) ? progressData.sectionResults : [];
      const sectionTagHistogram: Record<string, Record<string, { correct: number; total: number }>> = {};
      sectionResults.forEach((section: any) => {
        const sectionNo =
          Number.isFinite(Number(section?.sectionNo)) && Number(section?.sectionNo) > 0
            ? Math.round(Number(section.sectionNo))
            : null;
        if (!sectionNo) return;
        const sectionKey = String(sectionNo);
        const tagStats = (section?.tagStats ?? {}) as Record<string, { correct: number; total: number }>;
        Object.entries(tagStats).forEach(([tag, stats]) => {
          const sectionBucket = sectionTagHistogram[sectionKey] ?? {};
          const current = sectionBucket[tag] ?? { correct: 0, total: 0 };
          current.correct += Number(stats?.correct ?? 0);
          current.total += Number(stats?.total ?? 0);
          sectionBucket[tag] = current;
          sectionTagHistogram[sectionKey] = sectionBucket;
        });
      });
      return {
        taskId: task.id,
        scorePercent: typeof summary?.scorePercent === "number" ? summary.scorePercent : null,
        histogram: summary?.mistakeHistogram ?? null,
        accent: typeof task.accent === "string" && task.accent.trim().length > 0 ? task.accent : null,
        challengeTags: Array.isArray(summary?.focusNext) ? summary.focusNext : null,
        sectionTagHistogram: Object.keys(sectionTagHistogram).length ? sectionTagHistogram : null,
        contextExposure: {
          scriptType: typeof task.scriptType === "string" && task.scriptType.trim().length ? task.scriptType : null,
          topicDomain: typeof task.topicDomain === "string" && task.topicDomain.trim().length ? task.topicDomain : null,
          contextLabel: typeof task.contextLabel === "string" && task.contextLabel.trim().length ? task.contextLabel : null,
        },
      };
    })
    .filter(
      (item) =>
        item.scorePercent !== null ||
        item.histogram ||
        item.accent ||
        item.challengeTags ||
        item.sectionTagHistogram ||
        item.contextExposure,
    );
}
