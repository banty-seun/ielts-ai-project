import { storage } from "../storage";

const safeRate = (num: number, den: number) => {
  if (den <= 0) return 0;
  return Number((num / den).toFixed(4));
};

export const runGovernanceLedgerIntegrityCheck = async (params: {
  userId?: string;
  from?: Date;
  to?: Date;
}) => {
  const ledger = await storage.listListeningGovernanceLedger({
    limit: 1000,
    from: params.from,
    to: params.to,
  });
  const scoped = params.userId
    ? ledger.filter((entry) => !entry.userId || entry.userId === params.userId)
    : ledger;
  const missingPolicy = scoped.filter((entry) => !entry.policyVersion);
  const missingAction = scoped.filter((entry) => !entry.actionType);
  const missingCorrelated = scoped.filter(
    (entry) => !entry.traceId && !entry.correlationId && !entry.sessionId,
  );
  const gaps = [
    ...missingPolicy.map((entry) => ({ id: entry.id, gap: "MISSING_POLICY_VERSION" })),
    ...missingAction.map((entry) => ({ id: entry.id, gap: "MISSING_ACTION_TYPE" })),
    ...missingCorrelated.map((entry) => ({ id: entry.id, gap: "MISSING_CORRELATION_LINK" })),
  ];
  return {
    ok: gaps.length === 0,
    totals: {
      rows: scoped.length,
      gaps: gaps.length,
    },
    gaps,
  };
};

export const computeGovernanceKpis = async (params: {
  userId?: string;
  from?: Date;
  to?: Date;
}) => {
  const ledger = await storage.listListeningGovernanceLedger({
    limit: 5000,
    from: params.from,
    to: params.to,
  });
  const scoped = params.userId
    ? ledger.filter((entry) => !entry.userId || entry.userId === params.userId)
    : ledger;
  const violationCount = scoped.filter((entry) =>
    String(entry.actionType ?? "").startsWith("POLICY_") ||
    String(entry.validationVerdict ?? "").toUpperCase() === "FAIL",
  ).length;
  const overrideCount = scoped.filter((entry) =>
    String(entry.actionType ?? "").includes("APPROVE_WITH_EXCEPTION") ||
    String(entry.actionType ?? "").includes("APPROVE_WITH_OVERRIDE"),
  ).length;
  const rejectedCount = scoped.filter((entry) =>
    String(entry.actionType ?? "").includes("UNGROUNDED_CLAIM") ||
    String(entry.actionType ?? "").includes("CONFIDENCE_BELOW_THRESHOLD") ||
    String(entry.validationVerdict ?? "").toUpperCase() === "FAIL",
  ).length;
  const remediationRows = scoped.filter(
    (entry) =>
      String(entry.actionType ?? "").includes("REQUEUE") ||
      String(entry.actionType ?? "").includes("FORCE_REGENERATE") ||
      String(entry.actionType ?? "").includes("APPROVE_WITH_EXCEPTION"),
  );
  const remediationDurations = remediationRows
    .map((entry) => {
      const createdAt = new Date(entry.createdAt).getTime();
      const metadata = (entry.metadata ?? {}) as Record<string, any>;
      const detectedAtRaw = metadata?.detected_at;
      if (typeof detectedAtRaw !== "string") return null;
      const detectedAt = Date.parse(detectedAtRaw);
      if (!Number.isFinite(detectedAt)) return null;
      return Math.max(0, createdAt - detectedAt) / 60_000;
    })
    .filter((value): value is number => Number.isFinite(Number(value)));
  const meanRemediationMinutes =
    remediationDurations.length > 0
      ? Number((remediationDurations.reduce((sum, value) => sum + value, 0) / remediationDurations.length).toFixed(2))
      : 0;

  return {
    sample_size: scoped.length,
    hallucination_rejection_rate: safeRate(rejectedCount, scoped.length),
    override_rate: safeRate(overrideCount, scoped.length),
    policy_violation_rate: safeRate(violationCount, scoped.length),
    mean_remediation_time_minutes: meanRemediationMinutes,
  };
};
