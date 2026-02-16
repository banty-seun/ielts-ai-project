import { randomUUID } from "crypto";
import type { TaskProgress } from "@shared/schema";
import {
  deriveValidationVerdict,
  listeningTimingArtifactSchema,
  listeningValidationReportSchema,
  type ListeningTimingArtifact,
  type ListeningValidationReport,
  type ValidationGateResult,
  type ListeningValidationErrorCode,
} from "@shared/listening";
import { listeningRendererRootSchema } from "@shared/listening/renderer";
import { validateTranscriptComplete } from "./content";
import { normalizeLegacyQuestionsForApi } from "./listeningQuestionAdapters";
import { resolveListeningQuestionContract } from "./listeningQuestionContractState";
import { buildSectionManifestFromTask, buildTaskManifestReferences } from "./listeningManifest";
import { buildAnchorsForSegments, loadAnchors, validateAnchorsForSection } from "./listeningAnchors";
import {
  deriveSegmentAssignmentsForCoverage,
  validateSegmentAssignmentCoverage,
} from "./segmentOrder";
import { normalizeRendererEngineType } from "@shared/listening/renderer";
import {
  createTelemetryContext,
  finishListeningStageSpan,
  startListeningStageSpan,
} from "./listeningObservability";
import {
  buildGovernanceProvenance,
  runGovernancePolicyGateForManifest,
} from "./listeningGovernancePolicy";

type ValidationContext = {
  task: TaskProgress;
  sectionNo: number;
};

type ValidationOutcome = {
  report: ListeningValidationReport;
  rendererPayload: any | null;
  answerKey: any | null;
  audioAssets: Array<Record<string, any>>;
  timingArtifact?: ListeningTimingArtifact;
  governanceProvenance?: Record<string, unknown>;
};

type GateExecutionResult = {
  gate: ValidationGateResult;
};

const SEGMENT_MIN_SEC = Number(process.env.LISTENING_SEGMENT_MIN_SEC ?? 90);
const SEGMENT_MAX_SEC = Number(process.env.LISTENING_SEGMENT_MAX_SEC ?? 240);
const SECTION_BUDGET_TOLERANCE_SEC = Number(process.env.LISTENING_SECTION_BUDGET_TOLERANCE_SEC ?? 60);

const okGate = (gateName: ValidationGateResult["gate_name"], diagnostics: Record<string, unknown> = {}): GateExecutionResult => ({
  gate: {
    gate_name: gateName,
    status: "pass",
    severity: "low",
    diagnostics,
  },
});

const failGate = (
  gateName: ValidationGateResult["gate_name"],
  errorCode: ListeningValidationErrorCode,
  message: string,
  severity: ValidationGateResult["severity"] = "high",
  diagnostics: Record<string, unknown> = {},
): GateExecutionResult => ({
  gate: {
    gate_name: gateName,
    status: "fail",
    severity,
    error_code: errorCode,
    message,
    diagnostics,
  },
});

const readProgressData = (task: TaskProgress) => (task.progressData ?? {}) as Record<string, any>;

const readSegmentAudioAssets = (task: TaskProgress) => {
  const progressData = readProgressData(task);
  const sectionAudioAssets = Array.isArray(progressData.sectionAudioAssets)
    ? progressData.sectionAudioAssets
    : [];
  if (sectionAudioAssets.length > 0) {
    return sectionAudioAssets;
  }
  const segments = Array.isArray(progressData.segments) ? progressData.segments : [];
  const mappedFromSegments = segments
    .map((segment: any, index: number) => ({
      segment_no: Number(segment?.ieltsPart ?? segment?.segmentNo ?? index + 1),
      url: segment?.audioUrl,
      duration_seconds: Number(segment?.estimatedDurationSec ?? 0),
      accent: segment?.accent ?? task.accent ?? "British",
      voice_id: segment?.voiceId ?? null,
    }))
    .filter((asset) => Number.isFinite(asset.segment_no));
  if (mappedFromSegments.length > 0) {
    return mappedFromSegments;
  }
  if (task.audioUrl) {
    return [
      {
        segment_no: 1,
        url: task.audioUrl,
        duration_seconds: Number(task.duration ?? 0),
        accent: task.accent ?? "British",
      },
    ];
  }
  return [];
};

const readExpectedAssetCount = (task: TaskProgress) => {
  const progressData = readProgressData(task);
  if (Array.isArray(progressData.sectionAudioAssets) && progressData.sectionAudioAssets.length > 0) {
    return progressData.sectionAudioAssets.length;
  }
  if (Array.isArray(progressData.segments) && progressData.segments.length > 0) {
    return progressData.segments.length;
  }
  return 1;
};

const buildSegmentMetadata = (task: TaskProgress) => {
  const progressData = readProgressData(task);
  const segments = Array.isArray(progressData.segments) ? progressData.segments : [];
  if (segments.length > 0) {
    return segments.map((segment: any, index: number) => ({
      segment_id: String(segment?.id ?? `seg_${index + 1}`),
      section_id: task.id,
      section_no: Number(progressData?.sessionOrder ?? 1),
      segment_no: Number(segment?.ieltsPart ?? segment?.segmentNo ?? index + 1),
      predicted_duration_seconds: Number(segment?.estimatedDurationSec ?? 0),
      transcript_text: String(segment?.transcript ?? segment?.scriptText ?? ""),
      accent: String(segment?.accent ?? task.accent ?? "British"),
      voice_id: String(segment?.voiceId ?? ""),
      linkage: {
        blueprint_id: String(progressData?.listeningBlueprint?.data?.blueprint_id ?? "legacy-blueprint"),
        prior_segment_id: null,
      },
      tags: [],
    }));
  }
  const duration = Number(task.duration ?? 0);
  return [
    {
      segment_id: "seg_1",
      section_id: task.id,
      section_no: Number(progressData?.sessionOrder ?? 1),
      segment_no: 1,
      predicted_duration_seconds: Number.isFinite(duration) && duration > 0 ? duration : 120,
      transcript_text: String(task.scriptText ?? ""),
      accent: String(task.accent ?? "British"),
      voice_id: "",
      linkage: {
        blueprint_id: String(progressData?.listeningBlueprint?.data?.blueprint_id ?? "legacy-blueprint"),
        prior_segment_id: null,
      },
      tags: [],
    },
  ];
};

const runTranscriptGate = (ctx: ValidationContext): GateExecutionResult => {
  const result = validateTranscriptComplete(ctx.task.scriptText ?? "");
  if (!result.ok) {
    return failGate(
      "transcript_quality",
      "TRANSCRIPT_INVALID",
      result.reason ?? "Transcript validation failed",
      "high",
      { section_id: ctx.task.id },
    );
  }
  return okGate("transcript_quality", { words: result.wordCount ?? null });
};

const runRendererGate = (
  ctx: ValidationContext,
): { gateResult: GateExecutionResult; rendererPayload: any | null; answerKey: any | null; normalizedQuestions: any[] } => {
  const normalizedQuestions = normalizeLegacyQuestionsForApi(ctx.task.questions ?? []);
  if (!normalizedQuestions.length) {
    return {
      gateResult: failGate(
        "renderer_schema",
        "QUESTION_SCHEMA_INVALID",
        "Question set missing",
        "high",
        { section_id: ctx.task.id },
      ),
      rendererPayload: null,
      answerKey: null,
      normalizedQuestions,
    };
  }

  try {
    const contract = resolveListeningQuestionContract(ctx.task as any);
    if (!contract.ok) {
      return {
        gateResult: failGate(
          "renderer_schema",
          "QUESTION_SCHEMA_INVALID",
          contract.error,
          "high",
          { path: "question_contract" },
        ),
        rendererPayload: null,
        answerKey: null,
        normalizedQuestions,
      };
    }

    const parsed = listeningRendererRootSchema.safeParse(contract.rendererPayload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        gateResult: failGate(
          "renderer_schema",
          "QUESTION_SCHEMA_INVALID",
          issue?.message ?? "Renderer payload invalid",
          "high",
          {
            path: issue?.path?.join(".") ?? "renderer",
          },
        ),
        rendererPayload: null,
        answerKey: null,
        normalizedQuestions,
      };
    }

    return {
      gateResult: okGate("renderer_schema", {
        block_count: parsed.data.blocks.length,
      }),
      rendererPayload: parsed.data,
      answerKey: contract.answerKey,
      normalizedQuestions,
    };
  } catch (error: any) {
    return {
      gateResult: failGate(
        "renderer_schema",
        "QUESTION_SCHEMA_INVALID",
        error?.message ?? "Renderer schema validation failed",
        "high",
      ),
      rendererPayload: null,
      answerKey: null,
      normalizedQuestions,
    };
  }
};

const runQuestionCoverageGate = (params: {
  task: TaskProgress;
  normalizedQuestions: any[];
  rendererPayload: any | null;
}) => {
  const { task, normalizedQuestions, rendererPayload } = params;
  if (!rendererPayload) {
    return failGate(
      "question_coverage",
      "QUESTION_COVERAGE_INVALID",
      "Renderer payload unavailable for coverage validation",
      "high",
    );
  }

  if (normalizedQuestions.length !== 10) {
    return failGate(
      "question_coverage",
      "QUESTION_COVERAGE_INVALID",
      `Expected 10 questions, got ${normalizedQuestions.length}`,
      "high",
      { expected: 10, actual: normalizedQuestions.length },
    );
  }

  const numericRefs = normalizedQuestions.map((question, index) => {
    const m = String(question?.id ?? `q${index + 1}`).match(/(\d+)/);
    return Number(m?.[1] ?? index + 1);
  });
  const uniqueNumbers = new Set(numericRefs);
  if (uniqueNumbers.size !== numericRefs.length) {
    return failGate(
      "question_coverage",
      "QUESTION_COVERAGE_INVALID",
      "Duplicate question numbers detected",
      "high",
      { question_numbers: numericRefs },
    );
  }

  const seen = new Map<string, { block_id: string; segment_no: number }>();
  for (const block of rendererPayload.blocks ?? []) {
    const segmentNo = Number(block?.segment_no ?? 0);
    for (const question of block.questions ?? []) {
      const qid = String(question?.question_id ?? "");
      if (!qid) continue;
      if (seen.has(qid)) {
        return failGate(
          "question_coverage",
          "QUESTION_COVERAGE_INVALID",
          `Question mapped to multiple blocks: ${qid}`,
          "high",
          { question_id: qid },
        );
      }
      seen.set(qid, {
        block_id: String(block?.block_id ?? ""),
        segment_no: segmentNo,
      });
    }
  }

  const missing = normalizedQuestions
    .map((question) => String(question.id))
    .filter((questionId) => !seen.has(questionId));
  if (missing.length > 0) {
    return failGate(
      "question_coverage",
      "QUESTION_COVERAGE_INVALID",
      "Some questions are not mapped to block and segment",
      "high",
      { missing_question_ids: missing },
    );
  }

  const progressData = readProgressData(task);
  const existingAssignments =
    progressData.segmentAssignments && typeof progressData.segmentAssignments === "object"
      ? (progressData.segmentAssignments as Record<string, string[]>)
      : {};
  const progressSegments = Array.isArray(progressData.segments) ? progressData.segments : [];
  const progressSegmentIdByNo = new Map<number, string>();
  progressSegments.forEach((segment: any, index: number) => {
    const resolvedNo = Number(segment?.ieltsPart ?? segment?.segmentNo ?? index + 1);
    const resolvedId = String(segment?.id ?? `segment-${index + 1}`);
    if (Number.isFinite(resolvedNo) && resolvedNo > 0) {
      progressSegmentIdByNo.set(resolvedNo, resolvedId);
    }
  });
  const segmentIdsFromProgress = progressSegments.map((segment: any, index: number) =>
    String(segment?.id ?? `segment-${index + 1}`),
  );
  const segmentIdsFromRenderer = (rendererPayload.blocks ?? []).map((block: any) =>
    String(
      block?.segment_id ??
        progressSegmentIdByNo.get(Number(block?.segment_no ?? 1)) ??
        `segment-${Number(block?.segment_no ?? 1)}`,
    ),
  );
  const authoritativeSegmentIds = Array.from(
    new Set([...Object.keys(existingAssignments), ...segmentIdsFromProgress]),
  ).filter((value) => value.trim().length > 0);
  const segmentIds =
    authoritativeSegmentIds.length > 0
      ? authoritativeSegmentIds
      : (Array.from(new Set(segmentIdsFromRenderer)) as string[]).filter(
          (value: string) => value.trim().length > 0,
        );
  const questionIds = normalizedQuestions.map((question) => String(question.id));
  const derivedAssignments = deriveSegmentAssignmentsForCoverage({
    questionIds,
    segmentIds: segmentIds.length > 0 ? segmentIds : ["segment-1"],
    existingAssignments,
  });
  const coverage = validateSegmentAssignmentCoverage({
    questionIds,
    segmentIds: segmentIds.length > 0 ? segmentIds : ["segment-1"],
    assignments: derivedAssignments.assignments,
    segmentOrder:
      progressData.segmentOrder && typeof progressData.segmentOrder === "object"
        ? (progressData.segmentOrder as Record<string, string[]>)
        : {},
  });
  if (!coverage.ok) {
    return failGate(
      "question_coverage",
      "QUESTION_COVERAGE_INVALID",
      "Segment assignment coverage is incomplete",
      "high",
      {
        ...coverage.diagnostics,
        assignments_derived: derivedAssignments.changed,
      },
    );
  }

  return okGate("question_coverage", {
    mapped_questions: seen.size,
    assignments_derived: derivedAssignments.changed,
  });
};

const runAnchorBoundsAndTimingGates = (ctx: ValidationContext) => {
  const segmentMetadata = buildSegmentMetadata(ctx.task);
  const anchors = loadAnchors(ctx.task);
  const resolvedAnchors = anchors.length > 0 ? anchors : buildAnchorsForSegments({ task: ctx.task, segments: segmentMetadata as any });

  const durationsBySegmentNo = readSegmentAudioAssets(ctx.task).reduce(
    (acc, asset) => {
      const segmentNo = Number(asset?.segment_no ?? 0);
      const durationSec = Number(asset?.duration_seconds ?? 0);
      if (segmentNo > 0 && durationSec > 0) {
        acc[segmentNo] = durationSec;
      }
      return acc;
    },
    {} as Record<number, number>,
  );

  const anchorBounds = validateAnchorsForSection({
    task: ctx.task,
    anchors: resolvedAnchors as any,
    segments: segmentMetadata as any,
    ttsDurationsBySegmentNo: durationsBySegmentNo,
  });
  const anchorGate = anchorBounds.ok
    ? okGate("anchor_bounds", { anchors: resolvedAnchors.length })
    : failGate(
        "anchor_bounds",
        "ANCHOR_OUT_OF_BOUNDS",
        "Anchor validation failed (timing and/or configured block coverage)",
        "high",
        {
          errors: anchorBounds.errors,
          timing_errors: anchorBounds.timingErrors,
          coverage_errors: anchorBounds.coverageErrors,
        },
      );

  const segmentDurations = segmentMetadata.map((segment) => {
    const actual = Number(durationsBySegmentNo[segment.segment_no] ?? segment.predicted_duration_seconds ?? 0);
    return {
      segment_no: segment.segment_no,
      expected_duration_sec: Number(segment.predicted_duration_seconds ?? 0),
      actual_duration_sec: Math.max(0, actual),
      min_allowed_sec: SEGMENT_MIN_SEC,
      max_allowed_sec: SEGMENT_MAX_SEC,
      within_bounds: actual >= SEGMENT_MIN_SEC && actual <= SEGMENT_MAX_SEC,
      duration_source: durationsBySegmentNo[segment.segment_no] ? "metadata" : "word_count_fallback",
    };
  });

  const durationOutliers = segmentDurations.filter((item) => !item.within_bounds);
  const actualTotalSec = segmentDurations.reduce((sum, item) => sum + item.actual_duration_sec, 0);
  const expectedTotalSec = segmentDurations.reduce((sum, item) => sum + Number(item.expected_duration_sec ?? 0), 0);
  const budgetBase = expectedTotalSec > 0 ? expectedTotalSec : actualTotalSec;
  const budgetDeviation = Math.abs(actualTotalSec - budgetBase);
  const sectionWithinBudget = budgetDeviation <= SECTION_BUDGET_TOLERANCE_SEC;

  let durationGate: GateExecutionResult = okGate("duration_consistency", {
    total_seconds: actualTotalSec,
    expected_total_sec: budgetBase,
  });
  if (durationOutliers.length > 0) {
    durationGate = failGate(
      "duration_consistency",
      "SEGMENT_DURATION_OUT_OF_BOUNDS",
      "One or more segment durations are outside configured limits",
      "medium",
      { outliers: durationOutliers },
    );
  } else if (!sectionWithinBudget) {
    durationGate = failGate(
      "duration_consistency",
      "SECTION_DURATION_BUDGET_EXCEEDED",
      "Section total duration deviates beyond budget tolerance",
      "medium",
      {
        actual_total_sec: actualTotalSec,
        expected_total_sec: budgetBase,
        tolerance_sec: SECTION_BUDGET_TOLERANCE_SEC,
      },
    );
  }

  const timingArtifact = listeningTimingArtifactSchema.parse({
    section_id: ctx.task.id,
    section_no: ctx.sectionNo,
    generated_at: new Date().toISOString(),
    segment_durations: segmentDurations,
    section_budget: {
      expected_total_sec: budgetBase,
      actual_total_sec: actualTotalSec,
      tolerance_sec: SECTION_BUDGET_TOLERANCE_SEC,
      within_budget: sectionWithinBudget,
    },
    anchors: resolvedAnchors.map((anchor) => {
      const segmentDuration = Number(durationsBySegmentNo[anchor.segment_no] ?? 0);
      return {
        anchor_id: anchor.anchor_id,
        segment_no: anchor.segment_no,
        offset_seconds: anchor.offset_seconds,
        segment_duration_seconds: segmentDuration > 0 ? segmentDuration : Number(segmentMetadata.find((s) => s.segment_no === anchor.segment_no)?.predicted_duration_seconds ?? 0),
        within_bounds: anchor.offset_seconds >= 0 && anchor.offset_seconds < (segmentDuration > 0 ? segmentDuration : Number(segmentMetadata.find((s) => s.segment_no === anchor.segment_no)?.predicted_duration_seconds ?? 0)),
      };
    }),
  });

  return {
    anchorGate,
    durationGate,
    timingArtifact,
  };
};

const resolveExpectedAnswerKind = (engineRaw: string) => {
  const engine = normalizeRendererEngineType(engineRaw);
  if (engine === "legacy_mcq" || engine === "mcq_single") {
    return "single_choice";
  }
  if (engine === "multi_select") {
    return "multi_choice";
  }
  if (engine === "matching_letters") {
    return "matching";
  }
  return "text";
};

const runAnswerKeyGate = (params: {
  normalizedQuestions: any[];
  rendererPayload: any | null;
  answerKey: any | null;
}) => {
  const questionIds = params.normalizedQuestions.map((q) => String(q.id));
  const entries = Array.isArray(params.answerKey?.entries)
    ? (params.answerKey.entries as Array<Record<string, any>>)
    : [];
  const entriesByQuestion = new Map<string, Record<string, any>>(
    entries.map((entry: Record<string, any>) => [String(entry.question_id), entry]),
  );

  if (!params.rendererPayload) {
    return failGate(
      "answer_key_completeness",
      "ANSWER_KEY_MISSING",
      "Renderer payload unavailable for answer-key validation",
      "high",
    );
  }

  const unresolvedQuestionIds: string[] = [];
  const kindMismatch: Array<{ question_id: string; expected: string; actual: string }> = [];
  const malformedEntries: Array<{ question_id: string; reason: string }> = [];

  for (const block of params.rendererPayload.blocks ?? []) {
    const expectedKind = resolveExpectedAnswerKind(String(block?.engine ?? ""));
    for (const question of block.questions ?? []) {
      const questionId = String(question?.question_id ?? "");
      if (!questionId) continue;
      const entry = entriesByQuestion.get(questionId);
      if (!entry) {
        unresolvedQuestionIds.push(questionId);
        continue;
      }
      if (String(entry.kind) !== expectedKind) {
        kindMismatch.push({
          question_id: questionId,
          expected: expectedKind,
          actual: String(entry.kind ?? "unknown"),
        });
        unresolvedQuestionIds.push(questionId);
        continue;
      }

      if (entry.kind === "single_choice") {
        const accepted = Array.isArray(entry.accepted_option_ids) ? entry.accepted_option_ids : [];
        const optionIds = Array.isArray(question?.options)
          ? question.options.map((option: any) => String(option?.id ?? ""))
          : [];
        if (accepted.length !== 1 || (optionIds.length > 0 && !optionIds.includes(String(accepted[0])))) {
          malformedEntries.push({ question_id: questionId, reason: "INVALID_SINGLE_CHOICE_ENTRY" });
          unresolvedQuestionIds.push(questionId);
        }
      } else if (entry.kind === "multi_choice") {
        const accepted = Array.isArray(entry.accepted_option_ids) ? entry.accepted_option_ids : [];
        const optionIds = Array.isArray(question?.options)
          ? question.options.map((option: any) => String(option?.id ?? ""))
          : [];
        const unknownOptions = accepted.filter((value: string) => optionIds.length > 0 && !optionIds.includes(String(value)));
        if (accepted.length < 2 || unknownOptions.length > 0) {
          malformedEntries.push({ question_id: questionId, reason: "INVALID_MULTI_CHOICE_ENTRY" });
          unresolvedQuestionIds.push(questionId);
        }
      } else if (entry.kind === "text") {
        const acceptedTexts = Array.isArray(entry.accepted_texts) ? entry.accepted_texts : [];
        if (acceptedTexts.length < 1 || acceptedTexts.some((value: unknown) => String(value).trim().length === 0)) {
          malformedEntries.push({ question_id: questionId, reason: "INVALID_TEXT_ENTRY" });
          unresolvedQuestionIds.push(questionId);
        }
      } else if (entry.kind === "matching") {
        const acceptedPairs = Array.isArray(entry.accepted_pairs) ? entry.accepted_pairs : [];
        if (acceptedPairs.length < 1) {
          malformedEntries.push({ question_id: questionId, reason: "INVALID_MATCHING_ENTRY" });
          unresolvedQuestionIds.push(questionId);
        }
      }
    }
  }

  const missing = questionIds.filter((id) => !entriesByQuestion.has(id));
  const unresolved = Array.from(new Set([...missing, ...unresolvedQuestionIds]));
  if (unresolved.length > 0) {
    return failGate(
      "answer_key_completeness",
      "ANSWER_KEY_MISSING",
      "Answer key is missing entries for one or more questions",
      "high",
      {
        missing_question_ids: missing,
        unresolved_question_ids: unresolved,
        kind_mismatch: kindMismatch,
        malformed_entries: malformedEntries,
      },
    );
  }
  return okGate("answer_key_completeness", {
    answer_key_entries: entries.length,
    validated_questions: questionIds.length,
  });
};

const runAssetGate = (ctx: ValidationContext) => {
  const assets = readSegmentAudioAssets(ctx.task);
  const expected = readExpectedAssetCount(ctx.task);
  const assetDiagnostics = assets.map((asset) => ({
    segment_no: Number(asset?.segment_no ?? 0),
    has_url: typeof asset?.url === "string" && asset.url.trim().length > 0,
    retrieval_verified: asset?.retrieval_verified ?? null,
    validator_code: asset?.validator_code ?? null,
    duration_seconds: Number(asset?.duration_seconds ?? 0),
  }));
  if (assets.length === 0) {
    return {
      gate: failGate(
        "asset_completeness",
        "ASSET_MISSING",
        "No section audio assets available",
        "high",
        { expected_assets: expected, assets: assetDiagnostics },
      ).gate,
      assets,
    };
  }
  if (assets.length < expected) {
    return {
      gate: failGate(
        "asset_completeness",
        "ASSET_MISSING",
        `Asset count mismatch expected=${expected} actual=${assets.length}`,
        "high",
        { expected_assets: expected, actual_assets: assets.length, assets: assetDiagnostics },
      ).gate,
      assets,
    };
  }
  const unreachable = assets.find((asset) => {
    const missingUrl = typeof asset?.url !== "string" || asset.url.trim().length === 0;
    const retrievalFlagFailed = asset?.retrieval_verified === false;
    const validatorFailed = Boolean(asset?.validator_code);
    return missingUrl || retrievalFlagFailed || validatorFailed;
  });
  if (unreachable) {
    return {
      gate: failGate(
        "asset_completeness",
        "ASSET_UNREACHABLE",
        `Asset verification failed for segment ${String(unreachable.segment_no ?? "unknown")}`,
        "high",
        {
          segment_no: unreachable.segment_no ?? null,
          validator_code: unreachable.validator_code ?? null,
          retrieval_verified: unreachable.retrieval_verified ?? null,
          assets: assetDiagnostics,
        },
      ).gate,
      assets,
    };
  }
  return {
    gate: okGate("asset_completeness", { asset_count: assets.length, assets: assetDiagnostics }).gate,
    assets,
  };
};

const runManifestCompletenessGate = (ctx: ValidationContext, assets: Array<Record<string, any>>) => {
  const refs = buildTaskManifestReferences(ctx.task as any);
  const missingRefs = [
    ["question_json_url", refs.question_json_url],
    ["anchors_url", refs.anchors_url],
    ["answer_key_url", refs.answer_key_url],
  ].filter(([, value]) => typeof value !== "string" || !value.trim());
  if (missingRefs.length > 0) {
    return failGate(
      "manifest_completeness",
      "MANIFEST_INCOMPLETE",
      "Manifest references are incomplete",
      "high",
      { missing_refs: missingRefs.map(([key]) => key) },
    );
  }
  if (!assets.length) {
    return failGate(
      "manifest_completeness",
      "MANIFEST_INCOMPLETE",
      "Manifest audio assets are missing",
      "high",
    );
  }
  try {
    const manifestCandidate = buildSectionManifestFromTask(ctx.task);
    if (
      typeof manifestCandidate.manifest_version !== "string" ||
      manifestCandidate.manifest_version.trim().length === 0
    ) {
      return failGate(
        "manifest_completeness",
        "MANIFEST_INCOMPLETE",
        "Manifest schema version missing",
        "high",
      );
    }
    return okGate("manifest_completeness", {
      refs,
      audio_assets: assets.length,
      manifest_version: manifestCandidate.manifest_version,
    });
  } catch (error: any) {
    return failGate(
      "manifest_completeness",
      "MANIFEST_INCOMPLETE",
      error?.message ?? "Manifest schema validation failed",
      "high",
      { refs },
    );
  }
};

const runPolicyEnforcementGate = (ctx: ValidationContext): GateExecutionResult => {
  const result = runGovernancePolicyGateForManifest(ctx.task);
  if (!result.ok) {
    return failGate(
      "policy_enforcement",
      result.code ?? "POLICY_CHECK_FAILED",
      result.message ?? "Governance policy check failed",
      "high",
      result.diagnostics,
    );
  }
  return okGate("policy_enforcement", result.diagnostics);
};

export const runListeningValidationGate = (ctx: ValidationContext): ValidationOutcome => {
  const progressData = (ctx.task.progressData ?? {}) as Record<string, any>;
  const spanContext = createTelemetryContext({
    traceId: String(progressData?.sessionBatchId ?? `trc_validation_${ctx.task.id}`),
    requestId: String(progressData?.sessionBatchId ?? `req_validation_${ctx.task.id}`),
    userId: ctx.task.userId,
    weeklyPlanId: ctx.task.weeklyPlanId,
    sessionId: ctx.task.id,
    sectionId: `${ctx.task.id}:section-${ctx.sectionNo}`,
    partId: String(ctx.sectionNo),
    agentName: "validation_gate",
  });
  const validationSpan = startListeningStageSpan({
    stage: "validated",
    context: spanContext,
    taskProgressId: ctx.task.id,
  });

  const gates: ValidationGateResult[] = [];
  const reportId = `lvr_${randomUUID()}`;
  const sectionNo = Number(ctx.sectionNo || 1);

  const transcript = runTranscriptGate(ctx);
  gates.push(transcript.gate);

  const renderer = runRendererGate(ctx);
  gates.push(renderer.gateResult.gate);

  const coverage = runQuestionCoverageGate({
    task: ctx.task,
    normalizedQuestions: renderer.normalizedQuestions,
    rendererPayload: renderer.rendererPayload,
  });
  gates.push(coverage.gate);

  const anchorAndTiming = runAnchorBoundsAndTimingGates(ctx);
  gates.push(anchorAndTiming.anchorGate.gate);
  gates.push(anchorAndTiming.durationGate.gate);

  const answerKey = runAnswerKeyGate({
    normalizedQuestions: renderer.normalizedQuestions,
    rendererPayload: renderer.rendererPayload,
    answerKey: renderer.answerKey,
  });
  gates.push(answerKey.gate);

  const asset = runAssetGate(ctx);
  gates.push(asset.gate);

  const manifestCompleteness = runManifestCompletenessGate(ctx, asset.assets);
  gates.push(manifestCompleteness.gate);
  const policyEnforcement = runPolicyEnforcementGate(ctx);
  gates.push(policyEnforcement.gate);

  const verdict = deriveValidationVerdict(gates);
  const report = listeningValidationReportSchema.parse({
    report_id: reportId,
    section_id: ctx.task.id,
    section_no: sectionNo,
    verdict: verdict.verdict,
    severity: verdict.severity,
    top_error_code: verdict.top_error_code,
    gates,
    timing_artifact: anchorAndTiming.timingArtifact,
    created_at: new Date().toISOString(),
  });
  void finishListeningStageSpan(validationSpan, {
    success: report.verdict === "PASS",
    errorClass: report.verdict === "PASS" ? null : String(report.top_error_code ?? "VALIDATION_FAILED"),
    metadata: {
      gate_count: gates.length,
      severity: report.severity,
      verdict: report.verdict,
    },
  });

  return {
    report,
    rendererPayload: renderer.rendererPayload,
    answerKey: renderer.answerKey,
    audioAssets: asset.assets,
    timingArtifact: anchorAndTiming.timingArtifact,
    governanceProvenance: buildGovernanceProvenance({
      task: ctx.task,
      riskClass: "learning_content",
    }) as unknown as Record<string, unknown>,
  };
};
