import { z } from "zod";
import type { Question } from "@shared/schema";
import { LISTENING_SCORING_TAGS, type ListeningScoringTag } from "./questionContracts";

export const rendererSchemaVersion = "1.0.0" as const;
const scoringTagSchema = z.enum(LISTENING_SCORING_TAGS);

const questionRefSchema = z.object({
  question_id: z.string().min(1),
  prompt: z.string().min(1),
  answer_key: z.string().min(1),
  tags: z.array(scoringTagSchema).default(["general"]),
});

const completionItemSchema = z.object({
  blank_no: z.number().int().positive(),
  accepted_answers: z.array(z.string().min(1)).min(1),
});

const baseBlockSchema = z.object({
  block_id: z.string().min(1),
  block_title: z.string().min(1),
  instructions: z.string().min(1),
  question_range: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }),
  segment_no: z.number().int().positive(),
  render_hints: z.record(z.string(), z.unknown()).default({}),
});

export const formTableCompletionBlockSchema = baseBlockSchema.extend({
  engine: z.literal("form_or_table_completion"),
  questions: z.array(questionRefSchema).min(1),
  blanks: z.array(completionItemSchema).min(1),
});

export const sentenceNoteSummaryCompletionBlockSchema = baseBlockSchema.extend({
  engine: z.literal("sentence_or_note_completion"),
  questions: z.array(questionRefSchema).min(1),
  blanks: z.array(completionItemSchema).min(1),
});

export const mcqSingleSelectBlockSchema = baseBlockSchema.extend({
  engine: z.literal("mcq_single"),
  questions: z
    .array(
      questionRefSchema.extend({
        options: z
          .array(
            z.object({
              id: z.string().min(1),
              label: z.string().min(1),
            }),
          )
          .length(4),
      }),
    )
    .min(1),
});

export const multiSelectBlockSchema = baseBlockSchema.extend({
  engine: z.literal("multi_select"),
  questions: z
    .array(
      questionRefSchema.extend({
        options: z.array(
          z.object({
            id: z.string().min(1),
            label: z.string().min(1),
          }),
        ).min(2),
      }),
    )
    .min(1),
});

const labelingItemSchema = z.object({
  label_id: z.string().min(1),
  correct_value: z.string().min(1),
});

export const mapDiagramLabelingBlockSchema = baseBlockSchema.extend({
  engine: z.literal("map_or_diagram_labeling"),
  questions: z.array(questionRefSchema).min(1),
  labels: z.array(labelingItemSchema).min(1),
});

export const matchingLetterMappingBlockSchema = baseBlockSchema.extend({
  engine: z.literal("matching_letters"),
  questions: z.array(questionRefSchema).min(1),
  pairs: z
    .array(
      z.object({
        left: z.string().min(1),
        right: z.string().min(1),
      }),
    )
    .min(1),
});

export const legacyMcqBlockSchema = baseBlockSchema.extend({
  engine: z.literal("legacy_mcq"),
  questions: z
    .array(
      z.object({
        question_id: z.string().min(1),
        prompt: z.string().min(1),
        options: z
          .array(
            z.object({
              id: z.string().min(1),
              label: z.string().min(1),
            }),
          )
          .length(4),
        answer_key: z.string().min(1),
        tags: z.array(scoringTagSchema).default(["general"]),
      }),
    )
    .min(1),
});

// Deprecated aliases kept for migration compatibility.
export const deprecatedRendererBlockSchema = z.union([
  baseBlockSchema.extend({
    engine: z.literal("form_table_completion"),
    questions: z.array(questionRefSchema).min(1),
    blanks: z.array(completionItemSchema).min(1),
  }),
  baseBlockSchema.extend({
    engine: z.literal("sentence_note_summary_completion"),
    questions: z.array(questionRefSchema).min(1),
    blanks: z.array(completionItemSchema).min(1),
  }),
  baseBlockSchema.extend({
    engine: z.literal("mcq_single_select"),
    questions: z.array(
      questionRefSchema.extend({
        options: z.array(
          z.object({
            id: z.string().min(1),
            label: z.string().min(1),
          }),
        ).length(4),
      }),
    ).min(1),
  }),
  baseBlockSchema.extend({
    engine: z.literal("map_diagram_labeling"),
    questions: z.array(questionRefSchema).min(1),
    labels: z.array(labelingItemSchema).min(1),
  }),
  baseBlockSchema.extend({
    engine: z.literal("matching_letter_mapping"),
    questions: z.array(questionRefSchema).min(1),
    pairs: z.array(
      z.object({
        left: z.string().min(1),
        right: z.string().min(1),
      }),
    ).min(1),
  }),
]);

export const rendererBlockSchema = z.union([
  formTableCompletionBlockSchema,
  sentenceNoteSummaryCompletionBlockSchema,
  mcqSingleSelectBlockSchema,
  multiSelectBlockSchema,
  mapDiagramLabelingBlockSchema,
  matchingLetterMappingBlockSchema,
  legacyMcqBlockSchema,
  deprecatedRendererBlockSchema,
]);

export const listeningRendererRootSchema = z.object({
  renderer_schema_version: z.string().min(1),
  section_id: z.string().min(1),
  section_no: z.number().int().positive(),
  blocks: z.array(rendererBlockSchema).min(1),
});

export type ListeningRendererRoot = z.infer<typeof listeningRendererRootSchema>;

export const normalizeRendererEngineType = (engine: string) => {
  if (engine === "form_table_completion") return "form_or_table_completion";
  if (engine === "sentence_note_summary_completion") return "sentence_or_note_completion";
  if (engine === "mcq_single_select") return "mcq_single";
  if (engine === "map_diagram_labeling") return "map_or_diagram_labeling";
  if (engine === "matching_letter_mapping") return "matching_letters";
  return engine;
};

export const normalizeRendererPayload = (input: ListeningRendererRoot): ListeningRendererRoot => {
  const normalized: ListeningRendererRoot = {
    ...input,
    blocks: input.blocks.map((block) => ({
      ...block,
      engine: normalizeRendererEngineType(block.engine as string) as any,
    })),
  };
  return listeningRendererRootSchema.parse(normalized);
};

const toScoringTags = (question: Question): ListeningScoringTag[] => {
  if (Array.isArray(question.tags) && question.tags.length > 0) {
    const parsed = question.tags
      .map((tag) => scoringTagSchema.safeParse(tag))
      .filter((result) => result.success)
      .map((result) => result.data);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return ["general"];
};

export const transformLegacyQuestionsToRenderer = (params: {
  sectionId: string;
  sectionNo: number;
  questions: Question[];
  segmentCount?: number;
}): ListeningRendererRoot => {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const segmentCount = Math.max(1, Math.min(3, params.segmentCount ?? 3));

  const mappedQuestions = questions.map((question, idx) => {
    const options = Array.isArray(question.options) ? question.options : [];
    return {
      idx,
      question_id: String(question.id ?? `q${idx + 1}`),
      prompt: String(question.question ?? question.text ?? ""),
      options: options.map((option, optionIdx) => ({
        id: String(option.id ?? `option${optionIdx + 1}`),
        label: String(option.text ?? ""),
      })),
      answer_key: String(question.correctAnswer ?? ""),
      tags: toScoringTags(question),
    };
  });

  const blocks: ListeningRendererRoot["blocks"] = [];
  const assignedQuestionIds = new Set<string>();
  for (let segmentNo = 1; segmentNo <= segmentCount; segmentNo += 1) {
    const start = Math.floor(((segmentNo - 1) / segmentCount) * mappedQuestions.length);
    const end =
      segmentNo === segmentCount
        ? mappedQuestions.length
        : Math.floor((segmentNo / segmentCount) * mappedQuestions.length);
    const blockQuestions = mappedQuestions.slice(start, end);
    const invalidInBlock = blockQuestions.filter((question) => {
      return question.prompt.trim().length === 0 || question.options.length !== 4 || question.answer_key.trim().length === 0;
    });
    if (invalidInBlock.length > 0) {
      throw new Error(
        `Renderer mapping failed: missing block/segment mapping details for question(s) ${invalidInBlock
          .map((item) => item.question_id)
          .join(", ")}`,
      );
    }

    if (blockQuestions.length > 0) {
      blockQuestions.forEach((question) => assignedQuestionIds.add(question.question_id));
      blocks.push({
        block_id: `${params.sectionId}-block-${segmentNo}`,
        block_title: `Questions ${blockQuestions[0].idx + 1}-${blockQuestions[blockQuestions.length - 1].idx + 1}`,
        instructions: "Choose the correct option for each question.",
        question_range: {
          from: blockQuestions[0].idx + 1,
          to: blockQuestions[blockQuestions.length - 1].idx + 1,
        },
        segment_no: segmentNo,
        render_hints: {
          layout: "list",
        },
        engine: "legacy_mcq",
        questions: blockQuestions,
      });
    }

  }

  const missingMappings = mappedQuestions
    .map((question) => question.question_id)
    .filter((questionId) => !assignedQuestionIds.has(questionId));
  if (missingMappings.length > 0) {
    throw new Error(
      `Renderer mapping failed: question(s) without segment mapping: ${missingMappings.join(", ")}`,
    );
  }

  const payload: ListeningRendererRoot = {
    renderer_schema_version: rendererSchemaVersion,
    section_id: params.sectionId,
    section_no: params.sectionNo,
    blocks,
  };

  return listeningRendererRootSchema.parse(payload);
};

export const validateListeningRendererPayload = (input: unknown) => {
  const parsed = listeningRendererRootSchema.safeParse(input);
  if (!parsed.success) {
    return parsed;
  }
  return listeningRendererRootSchema.safeParse(normalizeRendererPayload(parsed.data));
};
