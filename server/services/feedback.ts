import { friendlyTagLabel } from "./scoring";

type Histogram = Record<
  string,
  {
    correct: number;
    total: number;
  }
>;

interface SessionSummaryInput {
  histogram: Histogram;
  recentSessions: Array<{
    scorePercent?: number | null;
    histogram?: Histogram | null;
  }>;
}

interface SessionFeedback {
  strengths: string[];
  focusNext: string[];
  trend: "up" | "down" | "flat";
}

const MIN_OBSERVATIONS = 3;
const STRENGTH_THRESHOLD = 0.8;
const FOCUS_THRESHOLD = 0.6;

const summarizeTag = (tag: string, prefix: "Strength" | "Focus"): string => {
  const label = friendlyTagLabel(tag);
  return prefix === "Strength"
    ? `Solid on ${label.toLowerCase()}`
    : `Focus on ${label.toLowerCase()}`;
};

const accuracy = (entry: { correct: number; total: number }) =>
  entry.total ? entry.correct / entry.total : 0;

const mergeHistograms = (histograms: Histogram[]): Histogram => {
  const merged: Histogram = {};
  histograms.forEach((hist) => {
    Object.entries(hist).forEach(([tag, data]) => {
      merged[tag] = {
        correct: (merged[tag]?.correct ?? 0) + (data.correct ?? 0),
        total: (merged[tag]?.total ?? 0) + (data.total ?? 0),
      };
    });
  });
  return merged;
};

export function buildSessionFeedback(input: SessionSummaryInput): SessionFeedback {
  const { histogram, recentSessions } = input;
  const strengths: string[] = [];
  const focusNext: string[] = [];

  const previousHistogram = mergeHistograms(
    recentSessions
      .map((session) => session.histogram)
      .filter((hist): hist is Histogram => Boolean(hist)),
  );

  Object.entries(histogram).forEach(([tag, data]) => {
    if (data.total < MIN_OBSERVATIONS) {
      return;
    }
    const acc = accuracy(data);
    if (acc >= STRENGTH_THRESHOLD && strengths.length < 2) {
      strengths.push(summarizeTag(tag, "Strength"));
      return;
    }
    if (acc <= FOCUS_THRESHOLD && focusNext.length < 3) {
      focusNext.push(summarizeTag(tag, "Focus"));
    }
  });

  if (focusNext.length === 0) {
    const weakest = Object.entries(histogram)
      .filter(([, data]) => data.total >= 1)
      .sort((a, b) => accuracy(a[1]) - accuracy(b[1]))
      .slice(0, 2);

    weakest.forEach(([tag]) => {
      if (focusNext.length < 2) {
        focusNext.push(summarizeTag(tag, "Focus"));
      }
    });
  }

  if (!strengths.length) {
    strengths.push("Consistent effort on core listening tasks");
  }
  if (!focusNext.length) {
    focusNext.push("Keep practicing to reinforce this skill");
  }

  const recentScores = recentSessions
    .map((session) => session.scorePercent ?? null)
    .filter((value): value is number => typeof value === "number");

  const latest = recentScores[0];
  const previous = recentScores[1];
  const trend: SessionFeedback["trend"] =
    typeof latest === "number" && typeof previous === "number"
      ? latest > previous + 2
        ? "up"
        : latest + 2 < previous
          ? "down"
          : "flat"
      : "flat";

  return { strengths, focusNext, trend };
}
