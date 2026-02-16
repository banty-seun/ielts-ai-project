import { WeeklyStudyPlan } from "@shared/schema";
import { storage } from "../storage";
import { resolveSessionMinutesFromTask } from "./sessionDuration";
import { ensureListeningSegments } from "./taskFactory";
import { DEFAULT_ACCENT, DEFAULT_SESSION_MINUTES, LISTENING_SESSION_MINUTES } from "../../shared/constants";
import { getIsoDayForDate } from "./planDistributor";
import { v4 as uuidv4 } from "uuid";
import { normalizeAccent } from "../utils/audio.ts";

type PlanEntry = Record<string, any>;

const normalizeTitle = (entry: PlanEntry): string =>
  entry.taskTitle || entry.title || entry.originalTitle || "Listening Practice";

const determinePlanDayType = (entry: PlanEntry, fallbackDayNumber: number): "weekday" | "weekend" => {
  const explicit = typeof entry?.dayType === "string" ? entry.dayType.toLowerCase() : undefined;
  if (explicit === "weekday" || explicit === "weekend") {
    return explicit;
  }

  if (entry?.assignedDate) {
    const parsed = new Date(entry.assignedDate);
    if (!Number.isNaN(parsed.getTime())) {
      const iso = getIsoDayForDate(parsed, entry?.plannerTz || process.env.TZ || "UTC");
      return iso === 6 || iso === 7 ? "weekend" : "weekday";
    }
  }

  const normalizedDay = ((fallbackDayNumber - 1) % 7) + 1;
  return normalizedDay === 6 || normalizedDay === 7 ? "weekend" : "weekday";
};

export async function ensureProgressForWeeklyPlan(params: {
  userId: string;
  weeklyPlan: WeeklyStudyPlan;
  defaultMinutes?: number;
}) {
  const { userId, weeklyPlan, defaultMinutes = DEFAULT_SESSION_MINUTES } = params;
  const planData = (weeklyPlan.planData as any) ?? {};
  const planEntries: PlanEntry[] = Array.isArray(planData.plan) ? planData.plan : [];

  const progressIds: Array<string | null> = [];

  for (let index = 0; index < planEntries.length; index += 1) {
    const entry = planEntries[index];
    const skill = typeof entry?.skill === "string" ? entry.skill : "listening";
    if (skill !== "listening") {
      progressIds.push(null);
      continue;
    }

    const dayNumber =
      typeof entry?.dayNumber === "number" && Number.isFinite(entry.dayNumber)
        ? entry.dayNumber
        : index + 1;

    const taskTitle = normalizeTitle(entry);

    const existing = await storage.findTaskProgressByScope({
      userId,
      weeklyPlanId: weeklyPlan.id,
      dayNumber,
      taskTitle,
      skill,
    });

    const resolvedSessionMinutes = resolveSessionMinutesFromTask(
      {
        duration: entry?.durationMinutes ?? entry?.duration,
        durationMinutes: entry?.durationMinutes,
        progressData: entry?.progressData,
      } as any,
      defaultMinutes,
    );
    const sessionMinutes = Math.max(resolvedSessionMinutes, LISTENING_SESSION_MINUTES);

    const planAccent = typeof entry?.accent === "string" ? entry.accent : undefined;
    const normalizedAccent = normalizeAccent(planAccent ?? DEFAULT_ACCENT);
    const segments = ensureListeningSegments(entry?.progressData?.segments, sessionMinutes, {
      baseTitle: taskTitle,
      accent: normalizedAccent,
    });

    const assignedDate = typeof entry?.assignedDate === "string" ? entry.assignedDate : null;
    const dayType = determinePlanDayType(entry, dayNumber);

    const baseProgressData = {
      ...(entry?.progressData ?? {}),
      sessionDurationMinutes: sessionMinutes,
      segments,
      sessionPrefetch: {
        ...(entry?.progressData?.sessionPrefetch ?? {}),
        source: "ensure-weekly-plan",
        dayType,
        sessionMinutes,
        assignedDate,
        accent: normalizedAccent,
      },
    };

    if (existing) {
      const currentData = (existing.progressData ?? {}) as Record<string, any>;
      const ensuredCurrentSegments = ensureListeningSegments(currentData.segments, sessionMinutes, {
        baseTitle: taskTitle,
        accent: normalizedAccent,
      });
      const merged = {
        ...currentData,
        ...baseProgressData,
        segments: ensuredCurrentSegments,
        sessionPrefetch: {
          ...(currentData.sessionPrefetch ?? {}),
          ...baseProgressData.sessionPrefetch,
        },
      };

      const needsUpdate =
        existing.duration !== sessionMinutes ||
        !Array.isArray(currentData.segments) ||
        currentData.segments.length !== ensuredCurrentSegments.length ||
        ensuredCurrentSegments.some((seg, idx) => {
          const existingSeg = currentData.segments?.[idx];
          if (!existingSeg) return true;
          if (!existingSeg.accent || !existingSeg.voiceId) return true;
          if (typeof existingSeg.estimatedDurationSec !== "number") return true;
          return false;
        });

      if (needsUpdate) {
        await storage.updateTaskProgress(existing.id, {
          duration: sessionMinutes,
          progressData: merged,
        });
      }

      progressIds.push(existing.id);
      continue;
    }

    const created = await storage.createTaskProgress({
      id: uuidv4(),
      userId,
      weeklyPlanId: weeklyPlan.id,
      weekNumber: weeklyPlan.weekNumber,
      dayNumber,
      taskTitle,
      skill,
      accent: normalizedAccent,
      status: "not-started",
      duration: sessionMinutes,
      progressData: baseProgressData,
      startedAt: null,
      completedAt: null,
    });

    progressIds.push(created.id);
  }

  return progressIds;
}
