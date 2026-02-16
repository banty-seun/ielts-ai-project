import type { TaskProgress } from "@shared/schema";
import { continuityReportSchema, type ContinuityIssue, type ContinuityReport, type ListeningSectionBlueprint, type ListeningSectionSegment } from "@shared/listening";
import { storage } from "../storage";

const CONTINUITY_ROOT = "listeningContinuity";
const DEFAULT_COHERENCE_THRESHOLD = Number(process.env.LISTENING_COHERENCE_THRESHOLD ?? 0.65);

const findMissingEntityMentions = (blueprint: ListeningSectionBlueprint, segments: ListeningSectionSegment[]) => {
  const issues: ContinuityIssue[] = [];
  blueprint.entities.forEach((entity) => {
    const missingIn = segments
      .filter((segment) => !segment.transcript_text.toLowerCase().includes(entity.name.toLowerCase()))
      .map((segment) => segment.segment_no);
    if (missingIn.length >= 2) {
      issues.push({
        issue_type: "entity_mismatch",
        severity: "high",
        segment_refs: missingIn,
        message: `Entity "${entity.name}" missing across segments`,
        remediation_hint: "Regenerate missing segments to keep entity continuity.",
      });
    }
  });
  return issues;
};

const findFactMismatches = (blueprint: ListeningSectionBlueprint, segments: ListeningSectionSegment[]) => {
  const issues: ContinuityIssue[] = [];
  const combined = segments.map((segment) => segment.transcript_text.toLowerCase()).join(" ");
  blueprint.facts.forEach((fact) => {
    const tokens = fact.text
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 4);
    if (tokens.length === 0) return;
    const matched = tokens.some((token) => combined.includes(token));
    if (!matched) {
      issues.push({
        issue_type: "fact_mismatch",
        severity: "high",
        segment_refs: [1, 2, 3],
        message: `Blueprint fact not grounded: "${fact.text}"`,
        remediation_hint: "Regenerate segment content to re-ground key facts.",
      });
    }
  });
  return issues;
};

const findTimelineBreaks = (blueprint: ListeningSectionBlueprint, segments: ListeningSectionSegment[]) => {
  const issues: ContinuityIssue[] = [];
  const combined = segments.map((segment) => segment.transcript_text.toLowerCase()).join(" ");

  blueprint.timeline.forEach((checkpoint) => {
    const tokens = checkpoint.label
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 3);
    if (tokens.length === 0) {
      return;
    }

    const matched = tokens.some((token) => combined.includes(token));
    if (!matched) {
      issues.push({
        issue_type: "timeline_break",
        severity: "high",
        segment_refs: [1, 2, 3],
        message: `Timeline checkpoint missing: "${checkpoint.label}"`,
        remediation_hint: "Regenerate segment transitions to preserve timeline continuity.",
      });
    }
  });

  return issues;
};

const findMetadataSignalBreaks = (blueprint: ListeningSectionBlueprint, segments: ListeningSectionSegment[]) => {
  const issues: ContinuityIssue[] = [];
  const combined = segments.map((segment) => segment.transcript_text.toLowerCase()).join(" ");
  const signals = [
    blueprint.topic_domain,
    blueprint.context_label,
    blueprint.scenario_overview,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  signals.forEach((signal) => {
    const signalTokens = signal
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 4);
    if (signalTokens.length === 0) {
      return;
    }
    const hasSignal = signalTokens.some((token) => combined.includes(token));
    if (!hasSignal) {
      issues.push({
        issue_type: "coherence_break",
        severity: "low",
        segment_refs: [1, 2, 3],
        message: `Supplemental continuity signal missing: "${signal}"`,
        remediation_hint: "Include context metadata cues in segment transitions.",
      });
    }
  });

  return issues;
};

const findCoherenceBreaks = (segments: ListeningSectionSegment[]) => {
  const issues: ContinuityIssue[] = [];
  for (let i = 1; i < segments.length; i += 1) {
    const prev = segments[i - 1].transcript_text.toLowerCase();
    const next = segments[i].transcript_text.toLowerCase();
    const transitionHintPresent =
      next.includes("as mentioned") ||
      next.includes("as discussed") ||
      next.includes("continuing") ||
      next.includes("following");
    const sharedWord = prev
      .split(/\W+/)
      .filter((word) => word.length > 5)
      .some((word) => next.includes(word));

    if (!transitionHintPresent && !sharedWord) {
      issues.push({
        issue_type: "coherence_break",
        severity: "low",
        segment_refs: [segments[i - 1].segment_no, segments[i].segment_no],
        message: "Weak transition between neighboring segments",
        remediation_hint: "Add linking sentence referencing prior context.",
      });
    }
  }
  return issues;
};

const computeCoherenceScore = (issues: ContinuityIssue[]) => {
  const high = issues.filter((issue) => issue.severity === "high").length;
  const low = issues.filter((issue) => issue.severity === "low").length;
  const score = 1 - Math.min(0.9, high * 0.25 + low * 0.1);
  return Math.max(0, Number(score.toFixed(2)));
};

export const buildContinuityReport = (params: {
  blueprint: ListeningSectionBlueprint;
  segments: ListeningSectionSegment[];
}): ContinuityReport => {
  const issues: ContinuityIssue[] = [
    ...findMissingEntityMentions(params.blueprint, params.segments),
    ...findFactMismatches(params.blueprint, params.segments),
    ...findTimelineBreaks(params.blueprint, params.segments),
    ...findMetadataSignalBreaks(params.blueprint, params.segments),
    ...findCoherenceBreaks(params.segments),
  ];

  const report: ContinuityReport = {
    section_id: params.blueprint.section_id,
    section_no: params.blueprint.section_no,
    issues,
    coherence_score: computeCoherenceScore(issues),
  };
  return continuityReportSchema.parse(report);
};

export const persistContinuityReport = async (task: TaskProgress, report: ContinuityReport) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const sectionNo = Number(progressData?.sessionOrder ?? report.section_no ?? 1);
  await storage.updateTaskProgress(task.id, {
    progressData: {
      ...progressData,
      [CONTINUITY_ROOT]: {
        data: report,
        section_id: report.section_id,
        section_step_id: `${report.section_id}:continuity`,
        section_no: sectionNo,
        updated_at: new Date().toISOString(),
      },
    },
  });
};

export const evaluateContinuity = async (params: {
  task: TaskProgress;
  blueprint: ListeningSectionBlueprint;
  segments: ListeningSectionSegment[];
  coherenceThreshold?: number;
}) => {
  const threshold = typeof params.coherenceThreshold === "number" ? params.coherenceThreshold : DEFAULT_COHERENCE_THRESHOLD;
  const report = buildContinuityReport({
    blueprint: params.blueprint,
    segments: params.segments,
  });
  await persistContinuityReport(params.task, report);
  console.log("[ListeningContinuity][Report]", {
    taskId: params.task.id,
    sectionId: report.section_id,
    sectionNo: report.section_no,
    coherenceScore: report.coherence_score,
    coherenceThreshold: threshold,
    issueCount: report.issues.length,
    highSeverityCount: report.issues.filter((issue) => issue.severity === "high").length,
    lowSeverityCount: report.issues.filter((issue) => issue.severity === "low").length,
  });

  const hasHighSeverity = report.issues.some((issue) => issue.severity === "high");
  const affectedSegmentNos = Array.from(
    new Set(
      report.issues
        .flatMap((issue) => issue.segment_refs)
        .filter((segmentNo) => Number.isFinite(segmentNo) && segmentNo > 0),
    ),
  );
  if (hasHighSeverity) {
    return {
      ok: false as const,
      errorCode: "CONTINUITY_HIGH_SEVERITY",
      retryable: false,
      report,
      affectedSegmentNos,
    };
  }
  if (report.coherence_score < threshold) {
    return {
      ok: false as const,
      errorCode: "COHERENCE_SCORE_BELOW_THRESHOLD",
      retryable: true,
      report,
      affectedSegmentNos,
    };
  }
  return {
    ok: true as const,
    report,
    affectedSegmentNos,
  };
};
