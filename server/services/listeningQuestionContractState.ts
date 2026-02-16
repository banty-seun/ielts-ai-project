import type { TaskProgress } from "@shared/schema";
import type { QuestionBlockPlanSet } from "@shared/listening";
import { questionBlockPlanSetSchema } from "@shared/listening";
import {
  buildAnswerKeyFromRenderer,
  migrateLegacyQuestionsToRenderer,
  normalizeLegacyQuestionsForApi,
  validateRendererWithAdapterRules,
} from "./listeningQuestionAdapters";
import { createQuestionBlockPlan } from "./listeningQuestionPlanner";
import {
  createTelemetryContext,
  finishListeningStageSpan,
  startListeningStageSpan,
} from "./listeningObservability";

const CONTRACT_STATE_KEY = "listeningQuestionContract";

interface PersistedQuestionContractState {
  version: string;
  section_version: number;
  published?: boolean;
  section_no: number;
  build_id: string;
  block_plan: QuestionBlockPlanSet;
  question_order: string[];
  question_number_map: Record<string, number>;
  question_count: number;
  updated_at: string;
}

const resolveContextType = (task: TaskProgress, sectionNo: number) => {
  const contextLabel = String(task.contextLabel ?? "").toLowerCase();
  const scriptType = String(task.scriptType ?? "").toLowerCase();

  if (contextLabel.includes("lecture") || scriptType.includes("lecture") || sectionNo === 4) {
    return "educational_lecture" as const;
  }
  if (contextLabel.includes("educational conversation") || sectionNo === 3) {
    return "educational_conversation" as const;
  }
  if (contextLabel.includes("monologue") || sectionNo === 2) {
    return "everyday_social_monologue" as const;
  }
  return "everyday_social_conversation" as const;
};

const parsePersistedPlan = (value: unknown) => {
  const parsed = questionBlockPlanSetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const buildStableQuestionOrder = (currentIds: string[], existingOrder: string[]) => {
  const currentSet = new Set(currentIds);
  const stable = existingOrder.filter((id) => currentSet.has(id));
  const remaining = currentIds.filter((id) => !stable.includes(id));
  return [...stable, ...remaining];
};

const stableQuestionsByOrder = <T extends { id: string }>(questions: T[], order: string[]) => {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return order.map((id) => byId.get(id)).filter(Boolean) as T[];
};

const buildQuestionNumberMap = (order: string[]) => {
  return order.reduce<Record<string, number>>((acc, id, index) => {
    acc[id] = index + 1;
    return acc;
  }, {});
};

export const resolveListeningQuestionContract = (task: TaskProgress) => {
  const normalizedQuestions = normalizeLegacyQuestionsForApi(task.questions ?? []);
  if (!normalizedQuestions.length) {
    return {
      ok: false as const,
      error: "QUESTION_SET_MISSING",
    };
  }

  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const sectionNo = Number(progressData?.sessionOrder ?? task.ieltsPart ?? 1) || 1;
  const spanContext = createTelemetryContext({
    traceId: String(progressData?.sessionBatchId ?? `trc_questions_${task.id}`),
    requestId: String(progressData?.sessionBatchId ?? `req_questions_${task.id}`),
    userId: task.userId,
    weeklyPlanId: task.weeklyPlanId,
    sessionId: task.id,
    sectionId: `${task.id}:section-${sectionNo}`,
    partId: String(sectionNo),
    agentName: "question_agent",
  });
  const questionSpan = startListeningStageSpan({
    stage: "question_generated",
    context: spanContext,
    taskProgressId: task.id,
  });
  const existingState = (progressData?.[CONTRACT_STATE_KEY] ?? {}) as Partial<PersistedQuestionContractState>;
  const requestedSectionVersion = Number(progressData?.listeningQuestionContractRequest?.section_version ?? NaN);
  const currentSectionVersion = Number(existingState.section_version ?? 1);
  const nextSectionVersion =
    Number.isFinite(requestedSectionVersion) && requestedSectionVersion > currentSectionVersion
      ? requestedSectionVersion
      : currentSectionVersion;
  const existingOrder = Array.isArray(existingState.question_order)
    ? existingState.question_order.map((id) => String(id))
    : [];
  const currentIds = normalizedQuestions.map((question) => String(question.id));
  const removedIds = existingOrder.filter((id) => !currentIds.includes(id));
  if (existingState.published && removedIds.length > 0 && nextSectionVersion <= currentSectionVersion) {
    void finishListeningStageSpan(questionSpan, {
      success: false,
      errorClass: "QUESTION_CONTRACT_VERSION_BUMP_REQUIRED",
    });
    return {
      ok: false as const,
      error: "QUESTION_CONTRACT_VERSION_BUMP_REQUIRED",
    };
  }
  const questionOrder = buildStableQuestionOrder(currentIds, existingOrder);
  const stableQuestions = stableQuestionsByOrder(normalizedQuestions, questionOrder);

  const contextType = resolveContextType(task, sectionNo);
  const persistedPlan = parsePersistedPlan(existingState.block_plan);
  const blockPlan =
    persistedPlan && persistedPlan.section_no === sectionNo
      ? persistedPlan
      : createQuestionBlockPlan({
          sectionNo,
          contextType,
          buildId: typeof existingState.build_id === "string" ? existingState.build_id : `blockplan_${task.id}`,
        });
  for (const plan of blockPlan.plans) {
    const blockSpan = startListeningStageSpan({
      stage: "question_generated",
      context: createTelemetryContext({
        traceId: spanContext.trace_id,
        requestId: spanContext.request_id,
        userId: task.userId,
        weeklyPlanId: task.weeklyPlanId,
        sessionId: task.id,
        sectionId: `${task.id}:section-${sectionNo}`,
        partId: String(plan.block_no),
        agentName: "question_agent",
      }),
      metadata: {
        section_no: sectionNo,
        part_no: plan.block_no,
        block_no: plan.block_no,
        engine_type: plan.engine_type,
        span_scope: "part",
      },
      taskProgressId: task.id,
    });
    void finishListeningStageSpan(blockSpan, {
      success: true,
      metadata: {
        section_no: sectionNo,
        part_no: plan.block_no,
        block_no: plan.block_no,
        question_range: plan.question_range,
      },
    });
  }

  const rendererPayload = migrateLegacyQuestionsToRenderer({
    sectionId: task.id,
    sectionNo,
    questions: stableQuestions,
    compatibilityMode: "legacy_mcq",
  });
  const adapterValidation = validateRendererWithAdapterRules(rendererPayload.blocks);
  const answerKey = buildAnswerKeyFromRenderer({
    sectionId: task.id,
    blocks: rendererPayload.blocks,
  });
  void finishListeningStageSpan(questionSpan, {
    success: adapterValidation.ok,
    errorClass: adapterValidation.ok ? null : "QUESTION_ADAPTER_RULE_INVALID",
    metadata: {
      issues: adapterValidation.issues.length,
      question_count: stableQuestions.length,
    },
  });

  const nextState: PersistedQuestionContractState = {
    version: "1.0.0",
    section_version: nextSectionVersion,
    published: Boolean(existingState.published),
    section_no: sectionNo,
    build_id: blockPlan.build_id,
    block_plan: blockPlan,
    question_order: questionOrder,
    question_number_map: buildQuestionNumberMap(questionOrder),
    question_count: stableQuestions.length,
    updated_at: new Date().toISOString(),
  };

  const previousSerialized = JSON.stringify({
    section_version: existingState.section_version,
    published: existingState.published,
    section_no: existingState.section_no,
    build_id: existingState.build_id,
    block_plan: existingState.block_plan,
    question_order: existingState.question_order,
    question_number_map: existingState.question_number_map,
    question_count: existingState.question_count,
  });
  const nextSerialized = JSON.stringify({
    section_version: nextState.section_version,
    published: nextState.published,
    section_no: nextState.section_no,
    build_id: nextState.build_id,
    block_plan: nextState.block_plan,
    question_order: nextState.question_order,
    question_number_map: nextState.question_number_map,
    question_count: nextState.question_count,
  });
  const changed = previousSerialized !== nextSerialized;

  return {
    ok: true as const,
    sectionNo,
    stableQuestions,
    rendererPayload,
    answerKey,
    blockPlan,
    issues: adapterValidation.issues,
    changed,
    nextProgressData: {
      ...progressData,
      [CONTRACT_STATE_KEY]: nextState,
    },
  };
};
