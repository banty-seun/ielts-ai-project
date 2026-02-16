import { z } from "zod";
import { ieltsContextTypeSchema } from "./scriptBlueprint";

export const LISTENING_ENGINE_TYPES = [
  "mcq_single",
  "multi_select",
  "form_or_table_completion",
  "sentence_or_note_completion",
  "map_or_diagram_labeling",
  "matching_letters",
] as const;

export const listeningEngineTypeSchema = z.enum(LISTENING_ENGINE_TYPES);
export type ListeningEngineType = z.infer<typeof listeningEngineTypeSchema>;

export const questionRangeSchema = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
});

export const questionBlockPlanSchema = z.object({
  section_no: z.number().int().positive(),
  block_no: z.number().int().positive(),
  segment_no: z.number().int().positive(),
  question_range: questionRangeSchema,
  engine_type: listeningEngineTypeSchema,
  instructions: z.string().min(1),
});

export type QuestionBlockPlan = z.infer<typeof questionBlockPlanSchema>;

export const questionBlockPlanSetSchema = z.object({
  build_id: z.string().min(1),
  section_no: z.number().int().positive(),
  context_type: ieltsContextTypeSchema,
  plans: z.array(questionBlockPlanSchema).length(3),
});

export type QuestionBlockPlanSet = z.infer<typeof questionBlockPlanSetSchema>;

export const answerNormalizationModeSchema = z.enum(["strict", "lenient"]);
export type AnswerNormalizationMode = z.infer<typeof answerNormalizationModeSchema>;

export const answerNormalizationRuleSchema = z.object({
  mode: answerNormalizationModeSchema.default("lenient"),
  numeric_handling: z.enum(["exact", "normalize"]).default("normalize"),
});

export const answerKeyEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("single_choice"),
    question_id: z.string().min(1),
    accepted_option_ids: z.array(z.string().min(1)).length(1),
    tags: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("multi_choice"),
    question_id: z.string().min(1),
    accepted_option_ids: z.array(z.string().min(1)).min(2),
    ordered: z.boolean().default(false),
    tags: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("text"),
    question_id: z.string().min(1),
    accepted_texts: z.array(z.string().min(1)).min(1),
    normalization: answerNormalizationRuleSchema.default({
      mode: "lenient",
      numeric_handling: "normalize",
    }),
    tags: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("matching"),
    question_id: z.string().min(1),
    accepted_pairs: z.array(
      z.object({
        left: z.string().min(1),
        right: z.string().min(1),
      }),
    ).min(1),
    ordered: z.boolean().default(true),
    tags: z.array(z.string().min(1)).min(1),
  }),
]);

export type AnswerKeyEntry = z.infer<typeof answerKeyEntrySchema>;

export const answerKeySchema = z.object({
  version: z.string().min(1),
  section_id: z.string().min(1),
  entries: z.array(answerKeyEntrySchema).min(1),
});

export type AnswerKey = z.infer<typeof answerKeySchema>;

export const BASE_SCORING_TAGS = [
  "numbers",
  "dates",
  "maps",
  "directions",
  "synonyms",
  "vocabulary",
  "detail",
  "inference",
  "attitude",
  "general",
] as const;

export const LISTENING_TAG_TAXONOMY_VERSION = "1.0.0" as const;

export const ENGINE_SCORING_TAGS = [
  "spelling_capture",
  "instruction_limit_violation",
  "map_spatial_reference",
  "matching_pair_confusion",
] as const;

export const LISTENING_SCORING_TAGS = [...BASE_SCORING_TAGS, ...ENGINE_SCORING_TAGS] as const;
export const listeningScoringTagSchema = z.enum(LISTENING_SCORING_TAGS);
export type ListeningScoringTag = z.infer<typeof listeningScoringTagSchema>;

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/g, " ");

const normalizeNumericTokens = (value: string) =>
  value
    .replace(/,/g, "")
    .replace(/\bone\b/gi, "1")
    .replace(/\btwo\b/gi, "2")
    .replace(/\bthree\b/gi, "3")
    .replace(/\bfour\b/gi, "4")
    .replace(/\bfive\b/gi, "5")
    .replace(/\bsix\b/gi, "6")
    .replace(/\bseven\b/gi, "7")
    .replace(/\beight\b/gi, "8")
    .replace(/\bnine\b/gi, "9")
    .replace(/\bten\b/gi, "10");

export const normalizeTextAnswer = (
  input: string,
  rule: AnswerNormalizationMode | z.infer<typeof answerNormalizationRuleSchema> = "lenient",
) => {
  const normalizedRule =
    typeof rule === "string"
      ? { mode: rule, numeric_handling: "normalize" as const }
      : answerNormalizationRuleSchema.parse(rule);

  let value = input;
  if (normalizedRule.mode === "lenient") {
    value = value.toLowerCase().replace(/[^\w\s.-]/g, " ");
  }
  value = normalizeWhitespace(value);
  if (normalizedRule.numeric_handling === "normalize") {
    value = normalizeNumericTokens(value);
  }
  return value;
};

export const validateTagCompatibility = (params: {
  engineType: ListeningEngineType;
  tags: string[];
}) => {
  const tags = params.tags.map((tag) => tag.toLowerCase());
  const unknownTags = tags.filter((tag) => !LISTENING_SCORING_TAGS.includes(tag as ListeningScoringTag));

  const issues: string[] = [];
  if (unknownTags.length > 0) {
    issues.push(`UNKNOWN_TAGS:${unknownTags.join(",")}`);
  }

  if (params.engineType === "map_or_diagram_labeling") {
    const hasMapTag = tags.includes("maps") || tags.includes("map_spatial_reference");
    if (!hasMapTag) {
      issues.push("MAP_ENGINE_MISSING_MAP_TAG");
    }
  }

  if (params.engineType === "matching_letters") {
    const hasMatchingTag = tags.includes("matching_pair_confusion");
    if (!hasMatchingTag) {
      issues.push("MATCHING_ENGINE_MISSING_MATCHING_TAG");
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
};
