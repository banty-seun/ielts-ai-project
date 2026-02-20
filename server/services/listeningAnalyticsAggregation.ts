import { createHash } from "crypto";
import { buildSectionAndSessionAnalytics } from "./listeningRoadmapGRuntime";

const toDeterministicJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => toDeterministicJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${toDeterministicJson(val)}`).join(",")}}`;
};

const normalizeAggregationCounter = (value: unknown) => {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber < 0) return 0;
  return Math.round(asNumber);
};

export type ListeningAnalyticsAggregationSource =
  | "segment_submit"
  | "finalize"
  | "finalize_mixed"
  | "manual_rebuild";

export type ListeningAnalyticsAggregationResult = {
  analytics: ReturnType<typeof buildSectionAndSessionAnalytics>;
  aggregation: Record<string, any>;
  skipped: boolean;
};

export const buildListeningAnalyticsAggregation = (params: {
  sectionResults: Array<Record<string, any>>;
  schemaVersion: string;
  source: ListeningAnalyticsAggregationSource;
  previousAggregation?: Record<string, any> | null;
  generatedAt?: string;
}): ListeningAnalyticsAggregationResult => {
  const previousAggregation = params.previousAggregation ?? {};
  const generatedAt = params.generatedAt ?? new Date().toISOString();

  const digestPayload = {
    schemaVersion: params.schemaVersion,
    sectionResults: params.sectionResults,
  };
  const inputDigest = createHash("sha256").update(toDeterministicJson(digestPayload)).digest("hex");
  const idempotencyKey = `listening_analytics:${params.schemaVersion}:${inputDigest.slice(0, 16)}`;
  const previousKey = String(previousAggregation.idempotencyKey ?? "");
  const skipped = previousKey === idempotencyKey;
  const previousRunCount = normalizeAggregationCounter(previousAggregation.runCount);

  return {
    analytics: buildSectionAndSessionAnalytics(params.sectionResults, params.schemaVersion),
    skipped,
    aggregation: {
      ...previousAggregation,
      schemaVersion: params.schemaVersion,
      rerunnable: true,
      idempotencyKey,
      inputDigest,
      runCount: skipped ? previousRunCount : previousRunCount + 1,
      lastRunSource: params.source,
      lastRunAt: generatedAt,
      lastStatus: skipped ? "noop" : "computed",
      lastComputedAt: skipped ? previousAggregation.lastComputedAt ?? null : generatedAt,
    },
  };
};
