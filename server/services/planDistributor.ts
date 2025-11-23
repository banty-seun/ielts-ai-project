export type Skill = "listening" | "reading" | "writing" | "speaking";

export interface Availability {
  weekdays?: boolean;
  weekends?: boolean;
  days?: number[]; // ISO day numbers 1 (Mon) - 7 (Sun)
}

export interface DistributionPrefs {
  tz: string;
  today: Date;
  availability: Availability;
  weights?: Partial<Record<Skill, number>>;
}

export interface Assignment {
  date: Date; // UTC date representing start of the eligible day in tz
  skill: Skill;
}

const SKILL_ORDER: Skill[] = ["listening", "reading", "writing", "speaking"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (tz: string) => {
  if (!formatterCache.has(tz)) {
    formatterCache.set(
      tz,
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: false,
      }),
    );
  }
  return formatterCache.get(tz)!;
};

export const toZonedDate = (date: Date, tz: string): Date => {
  const formatter = getFormatter(tz);
  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return new Date(
    Date.UTC(
      lookup("year"),
      lookup("month") - 1,
      lookup("day"),
      lookup("hour"),
      lookup("minute"),
      lookup("second"),
    ),
  );
};

export const startOfDayUtc = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const addDaysUtc = (date: Date, days: number): Date => {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

const getIsoDayFromUtc = (date: Date): number => {
  const dow = date.getUTCDay();
  return dow === 0 ? 7 : dow;
};

const isWeekendIso = (isoDay: number): boolean => isoDay === 6 || isoDay === 7;

const buildSkillQueue = (weights?: Partial<Record<Skill, number>>): Skill[] => {
  const queue: Skill[] = [];
  SKILL_ORDER.forEach((skill) => {
    const weight = Math.max(0, Math.floor(weights?.[skill] ?? 1));
    for (let i = 0; i < weight; i += 1) {
      queue.push(skill);
    }
  });

  return queue.length ? queue : [...SKILL_ORDER];
};

const formatForLog = (date: Date, tz: string): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
};

const isEligibleDay = (isoDay: number, availability: Availability): boolean => {
  if (Array.isArray(availability.days) && availability.days.length > 0) {
    return availability.days.includes(isoDay);
  }

  const allowWeekdays = availability.weekdays !== false;
  const allowWeekends = availability.weekends !== false;

  return isWeekendIso(isoDay) ? allowWeekends : allowWeekdays;
};

export function buildAssignments(prefs: DistributionPrefs): Assignment[] {
  const tz = prefs.tz || "UTC";
  const zonedToday = toZonedDate(prefs.today ?? new Date(), tz);
  const startDay = startOfDayUtc(zonedToday);
  const isoDay = getIsoDayFromUtc(startDay);
  const weekEnd = addDaysUtc(startDay, 7 - isoDay);

  const eligibleDays: Date[] = [];
  let cursor = startDay;
  while (cursor.getTime() <= weekEnd.getTime()) {
    const cursorIso = getIsoDayFromUtc(cursor);
    if (isEligibleDay(cursorIso, prefs.availability ?? {})) {
      eligibleDays.push(new Date(cursor.getTime()));
    }
    cursor = addDaysUtc(cursor, 1);
  }

  if (!eligibleDays.length) {
    console.log("[Distributor] assignments: []");
    return [];
  }

  const queue = buildSkillQueue(prefs.weights);
  const assignments: Assignment[] = [];

  eligibleDays.forEach((day, index) => {
    const skill = queue[index % queue.length];
    assignments.push({
      date: new Date(day.getTime()),
      skill,
    });
  });

  console.log(
    "[Distributor] assignments:",
    assignments.map((assignment) => ({
      date: formatForLog(assignment.date, tz),
      skill: assignment.skill,
    })),
  );

  return assignments;
}

export const getIsoDayForDate = (date: Date, tz: string): number => {
  const zoned = toZonedDate(date, tz);
  return getIsoDayFromUtc(zoned);
};

export const getDayNameForIsoDay = (isoDay: number): string =>
  DAY_NAMES[(isoDay - 1 + DAY_NAMES.length) % DAY_NAMES.length];

export const resolveWeekStart = (date: Date, tz: string, weekOffset = 0): Date => {
  const zoned = startOfDayUtc(toZonedDate(date, tz));
  const isoDay = getIsoDayFromUtc(zoned);
  const start = addDaysUtc(zoned, -(isoDay - 1) + weekOffset * 7);
  return start;
};

export const addDaysInTz = (date: Date, days: number): Date => addDaysUtc(date, days);

export const deriveWeightsFromSkillRatings = (
  ratings: Partial<Record<Skill, number>> | undefined,
  targetBand: number,
): Partial<Record<Skill, number>> => {
  const normalized: Partial<Record<Skill, number>> = {};
  SKILL_ORDER.forEach((skill) => {
    const rating = Number(ratings?.[skill]) || 0;
    const gap = Math.max(0, targetBand - rating);
    normalized[skill] = Math.min(4, 1 + Math.round(gap));
  });
  return normalized;
};

export const buildAvailabilityFromSchedule = (schedule?: string): Availability => {
  const normalized = (schedule ?? "").toLowerCase();
  if (normalized === "weekday") {
    return { weekdays: true, weekends: false };
  }
  if (normalized === "weekend") {
    return { weekdays: false, weekends: true };
  }
  return { weekdays: true, weekends: true };
};

export { SKILL_ORDER };

export function assignSkillsToDays(
  days: Date[],
  prefs: DistributionPrefs,
): Assignment[] {
  const tz = prefs.tz || "UTC";
  const sanitizedDays = days
    .map((day) => startOfDayUtc(toZonedDate(day, tz)))
    .sort((a, b) => a.getTime() - b.getTime())
    .filter((day) => {
      const isoDay = getIsoDayFromUtc(day);
      return isEligibleDay(isoDay, prefs.availability ?? {});
    });

  const queue = buildSkillQueue(prefs.weights);
  if (!sanitizedDays.length) {
    return [];
  }

  const assignments: Assignment[] = [];
  sanitizedDays.forEach((day, index) => {
    assignments.push({
      date: new Date(day.getTime()),
      skill: queue[index % queue.length],
    });
  });

  console.log(
    "[Distributor] assignments:",
    assignments.map((assignment) => ({
      date: formatForLog(assignment.date, tz),
      skill: assignment.skill,
    })),
  );

  return assignments;
}
