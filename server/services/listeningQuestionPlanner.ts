import { randomUUID } from "crypto";
import {
  LISTENING_ENGINE_TYPES,
  ListeningEngineType,
  QuestionBlockPlanSet,
  questionBlockPlanSetSchema,
} from "@shared/listening";
import { buildQuestionRangesFromDistribution } from "./segmentOrder";

const DEFAULT_INSTRUCTIONS: Record<ListeningEngineType, string> = {
  mcq_single: "Choose one correct answer.",
  multi_select: "Choose all correct answers as instructed.",
  form_or_table_completion: "Complete the form or table with words from the audio.",
  sentence_or_note_completion: "Complete the notes with words from the audio.",
  map_or_diagram_labeling: "Label the map/diagram using the options provided.",
  matching_letters: "Match the statements to the correct letter options.",
};

const contextEngineMix: Record<string, ListeningEngineType[]> = {
  everyday_social_conversation: ["form_or_table_completion", "mcq_single", "multi_select"],
  everyday_social_monologue: ["sentence_or_note_completion", "matching_letters", "mcq_single"],
  educational_conversation: ["multi_select", "matching_letters", "sentence_or_note_completion"],
  educational_lecture: ["sentence_or_note_completion", "map_or_diagram_labeling", "mcq_single"],
};

const supportedDistributions = [
  [3, 3, 4],
  [4, 3, 3],
] as const;

export const createQuestionBlockPlan = (params: {
  sectionNo: number;
  contextType: string;
  questionCount?: number;
  distribution?: [number, number, number];
  engineMix?: ListeningEngineType[];
  buildId?: string;
}): QuestionBlockPlanSet => {
  const questionCount = params.questionCount ?? 10;
  if (questionCount !== 10) {
    throw new Error("BLOCK_PLAN_QUESTION_COUNT_MUST_BE_10");
  }

  const distribution = params.distribution ?? [...supportedDistributions[0]];
  const distributionKey = distribution.join(",");
  const supported = supportedDistributions.some((value) => value.join(",") === distributionKey);
  if (!supported) {
    throw new Error(`UNSUPPORTED_BLOCK_DISTRIBUTION:${distributionKey}`);
  }

  const suggestedMix = contextEngineMix[params.contextType] ?? contextEngineMix.everyday_social_conversation;
  const engineMix = (params.engineMix && params.engineMix.length ? params.engineMix : suggestedMix).slice(0, 3);
  if (engineMix.length !== 3) {
    throw new Error("ENGINE_MIX_MUST_CONTAIN_THREE_BLOCKS");
  }

  const unsupportedEngines = engineMix.filter((engine) => !LISTENING_ENGINE_TYPES.includes(engine));
  if (unsupportedEngines.length > 0) {
    throw new Error(`UNSUPPORTED_ENGINE_TYPES:${unsupportedEngines.join(",")}`);
  }

  const allowedForContext = contextEngineMix[params.contextType] ?? contextEngineMix.everyday_social_conversation;
  const contextIncompatibilities = engineMix.filter((engine) => !allowedForContext.includes(engine));
  if (contextIncompatibilities.length > 0) {
    throw new Error(`INCOMPATIBLE_ENGINE_FOR_CONTEXT:${params.contextType}:${contextIncompatibilities.join(",")}`);
  }

  const ranges = buildQuestionRangesFromDistribution(distribution, questionCount);
  const plans = distribution.map((count, index) => {
    const engine = engineMix[index];
    const plan = {
      section_no: params.sectionNo,
      block_no: index + 1,
      segment_no: index + 1,
      question_range: ranges[index],
      engine_type: engine,
      instructions: DEFAULT_INSTRUCTIONS[engine],
    };
    return plan;
  });

  const planSet: QuestionBlockPlanSet = {
    build_id: params.buildId ?? `qbp_${randomUUID()}`,
    section_no: params.sectionNo,
    context_type: params.contextType as any,
    plans,
  };

  return questionBlockPlanSetSchema.parse(planSet);
};
