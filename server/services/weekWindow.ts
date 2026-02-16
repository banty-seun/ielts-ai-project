import { addDaysUtc, startOfDayUtc, toZonedDate } from "./planDistributor";
import { getIsoDayForDate } from "./planDistributor";

export interface WeekWindows {
  week1Start: Date;
  week1End: Date;
  week2Start: Date;
  week2End: Date;
}

const sundayIndex = (isoDay: number): number => (isoDay === 7 ? 0 : isoDay);

export function getForwardWeekWindows(now: Date, tz: string): WeekWindows {
  const zonedStart = startOfDayUtc(toZonedDate(now, tz));
  const isoDay = getIsoDayForDate(zonedStart, tz);
  const sundayDow = sundayIndex(isoDay);
  const daysUntilSat = 6 - sundayDow;

  const week1Start = zonedStart;
  const week1End = addDaysUtc(week1Start, daysUntilSat);
  const week2Start = addDaysUtc(week1End, 1);
  const week2End = addDaysUtc(week2Start, 6);

  return {
    week1Start,
    week1End,
    week2Start,
    week2End,
  };
}

export function enumerateDays(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    out.push(new Date(cursor.getTime()));
    cursor = addDaysUtc(cursor, 1);
  }
  return out;
}

export { addDaysUtc };
