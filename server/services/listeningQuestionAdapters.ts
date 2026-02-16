import {
  AnswerKey,
  AnswerKeyEntry,
  ListeningEngineType,
  ListeningRendererRoot,
  LISTENING_ENGINE_TYPES,
  LISTENING_SCORING_TAGS,
  QuestionBlockPlanSet,
  answerKeySchema,
  normalizeTextAnswer,
  transformLegacyQuestionsToRenderer,
  validateListeningRendererPayload,
  validateTagCompatibility,
} from "@shared/listening";
import type { Question } from "@shared/schema";
import { generateQuestionsFromScript } from "../openai";

export interface EngineAdapterInput {
  sectionId: string;
  sectionNo: number;
  plan: QuestionBlockPlanSet;
  scriptText: string;
  difficulty?: string;
}

export interface EngineAdapter {
  engineType: ListeningEngineType;
  generate: (input: EngineAdapterInput) => Promise<ListeningRendererRoot["blocks"][number][]>;
  validate: (blocks: ListeningRendererRoot["blocks"]) => { ok: boolean; issues: string[] };
  normalize: (blocks: ListeningRendererRoot["blocks"]) => ListeningRendererRoot["blocks"];
  answerKeyExtract: (blocks: ListeningRendererRoot["blocks"]) => AnswerKeyEntry[];
}

const ADAPTER_ERROR = {
  engineMismatch: "ADAPTER_ENGINE_MISMATCH",
  missingTags: "ADAPTER_MISSING_TAGS",
  invalidQuestion: "ADAPTER_INVALID_QUESTION",
  instructionConstraint: "ADAPTER_INSTRUCTION_CONSTRAINT",
  generationUnavailable: "ADAPTER_GENERATION_NOT_IMPLEMENTED",
} as const;

const defaultEngineTags = (engineType: ListeningEngineType): string[] => {
  if (engineType === "map_or_diagram_labeling") return ["maps", "map_spatial_reference"];
  if (engineType === "matching_letters") return ["matching_pair_confusion"];
  if (engineType === "form_or_table_completion" || engineType === "sentence_or_note_completion") {
    return ["detail", "spelling_capture"];
  }
  if (engineType === "multi_select") return ["detail"];
  return ["general"];
};

const buildPromptBank = (scriptText: string): string[] => {
  const parts = scriptText
    .split(/[.!?]/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : ["Listen carefully and answer based on the recording."];
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "at", "for", "from", "with", "by", "is", "are",
  "was", "were", "be", "been", "being", "it", "this", "that", "these", "those", "as", "if", "then", "than", "so",
  "you", "your", "we", "our", "they", "their", "he", "she", "his", "her", "them", "there", "here", "will", "would",
  "can", "could", "should", "may", "might", "do", "does", "did", "have", "has", "had", "about", "into", "over",
]);

const buildKeywordBank = (scriptText: string): string[] => {
  const tokens = scriptText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
  const unique = Array.from(new Set(tokens));
  return unique.length ? unique : ["schedule", "booking", "office", "hall", "library", "meeting"];
};

const rangeCount = (from: number, to: number) => Math.max(0, to - from + 1);

const completionInstructionByEngine = (engineType: ListeningEngineType) => {
  if (engineType === "form_or_table_completion") return "Complete the form or table. Write NO MORE THAN TWO WORDS.";
  if (engineType === "sentence_or_note_completion") return "Complete the notes. Write NO MORE THAN TWO WORDS.";
  return null;
};

const ensureQuestionTags = (question: Question, fallbackTag: string) => {
  if (Array.isArray(question.tags) && question.tags.length > 0) {
    const validTags = question.tags
      .map((tag) => String(tag).toLowerCase())
      .filter((tag) => LISTENING_SCORING_TAGS.includes(tag as any));
    if (validTags.length > 0) {
      return validTags;
    }
  }
  return [fallbackTag];
};

const buildMcqBlockFromLegacy = (params: {
  sectionId: string;
  sectionNo: number;
  questions: Question[];
  segmentCount?: number;
}): ListeningRendererRoot => {
  return transformLegacyQuestionsToRenderer({
    sectionId: params.sectionId,
    sectionNo: params.sectionNo,
    questions: params.questions,
    segmentCount: params.segmentCount ?? 3,
  });
};

const createMcqSingleAdapter = (): EngineAdapter => ({
  engineType: "mcq_single",
  generate: async (input) => {
    const generated = await generateQuestionsFromScript(
      input.scriptText,
      `${input.sectionId} Questions`,
      input.difficulty ?? "intermediate",
    );
    if (!generated.success || !generated.questions?.length) {
      throw Object.assign(new Error(generated.error ?? "QUESTION_GENERATION_FAILED"), {
        code: "QUESTION_GENERATION_FAILED",
      });
    }

    const migrated = buildMcqBlockFromLegacy({
      sectionId: input.sectionId,
      sectionNo: input.sectionNo,
      questions: generated.questions,
      segmentCount: 3,
    });
    return migrated.blocks;
  },
  validate: (blocks) => {
    const issues: string[] = [];
    blocks.forEach((block) => {
      if (block.engine !== "mcq_single" && block.engine !== "legacy_mcq") {
        issues.push(`MCQ_ADAPTER_ENGINE_MISMATCH:${block.block_id}`);
      }
    });
    return { ok: issues.length === 0, issues };
  },
  normalize: (blocks) => blocks,
  answerKeyExtract: (blocks) => {
    const entries: AnswerKeyEntry[] = [];
    blocks.forEach((block) => {
      if (block.engine !== "mcq_single" && block.engine !== "legacy_mcq") return;
      block.questions.forEach((question) => {
        entries.push({
          kind: "single_choice",
          question_id: question.question_id,
          accepted_option_ids: [question.answer_key],
          tags: question.tags,
        });
      });
    });
    return entries;
  },
});

const defaultPassThroughAdapter = (engineType: ListeningEngineType): EngineAdapter => ({
  engineType,
  generate: async (input) => {
    const promptBank = buildPromptBank(input.scriptText);
    const keywordBank = buildKeywordBank(input.scriptText);
    const plans = input.plan.plans.filter((plan) => plan.engine_type === engineType);
    if (!plans.length) return [];

    const blocks: ListeningRendererRoot["blocks"][number][] = [];
    plans.forEach((plan, blockIndex) => {
      const count = rangeCount(plan.question_range.from, plan.question_range.to);
      const questions = Array.from({ length: count }).map((_, index) => {
        const qno = plan.question_range.from + index;
        const promptSeed = promptBank[(qno - 1) % promptBank.length] ?? `Question ${qno}`;
        const primaryKeyword = keywordBank[(qno - 1) % keywordBank.length] ?? `item-${qno}`;
        const secondaryKeyword = keywordBank[qno % keywordBank.length] ?? `detail-${qno}`;
        const baseQuestion = {
          question_id: `${input.sectionId}-q${qno}`,
          prompt:
            engineType === "form_or_table_completion" || engineType === "sentence_or_note_completion"
              ? `${promptSeed.replace(/[.?!]+$/, "")} ___`
              : promptSeed.endsWith("?")
                ? promptSeed
                : `${promptSeed}?`,
          answer_key: "",
          tags: defaultEngineTags(engineType),
        };

        if (engineType === "multi_select") {
          const options = Array.from({ length: 4 }).map((_, idx) => {
            const keyword = keywordBank[(qno + idx) % keywordBank.length] ?? `option-${idx + 1}`;
            return {
              id: String.fromCharCode(65 + idx),
              label: keyword.replace(/^\w/, (char) => char.toUpperCase()),
            };
          });
          return {
            ...baseQuestion,
            answer_key: `${options[0].id},${options[2].id}`,
            options,
          };
        }
        if (engineType === "matching_letters") {
          return {
            ...baseQuestion,
            prompt: `Match the statement about ${primaryKeyword} to the correct letter.`,
            answer_key: String.fromCharCode(65 + (index % 3)),
          };
        }
        if (engineType === "map_or_diagram_labeling") {
          return {
            ...baseQuestion,
            prompt: `Identify the location for ${primaryKeyword} on the map.`,
            answer_key: primaryKeyword.replace(/^\w/, (char) => char.toUpperCase()),
          };
        }
        return {
          ...baseQuestion,
          answer_key: secondaryKeyword,
        };
      });

      const baseBlock = {
        block_id: `${input.sectionId}-block-${plan.block_no}`,
        block_title: `Questions ${plan.question_range.from}-${plan.question_range.to}`,
        instructions: completionInstructionByEngine(engineType) ?? plan.instructions,
        question_range: plan.question_range,
        segment_no: plan.segment_no,
        render_hints: {
          source: "adapter_generated",
          engine: engineType,
          selection_count: engineType === "multi_select" ? 2 : undefined,
          max_words:
            engineType === "form_or_table_completion" || engineType === "sentence_or_note_completion" ? 2 : undefined,
        },
      };

      if (engineType === "multi_select") {
        blocks.push({
          ...baseBlock,
          engine: "multi_select",
          questions: questions as any,
        } as any);
        return;
      }

      if (engineType === "form_or_table_completion" || engineType === "sentence_or_note_completion") {
        blocks.push({
          ...baseBlock,
          engine: engineType,
          questions: questions as any,
          blanks: questions.map((question, idx) => ({
            blank_no: plan.question_range.from + idx,
            accepted_answers: [String((question as any).answer_key)],
          })),
        } as any);
        return;
      }

      if (engineType === "map_or_diagram_labeling") {
        blocks.push({
          ...baseBlock,
          engine: "map_or_diagram_labeling",
          questions: questions as any,
          labels: questions.map((question, idx) => ({
            label_id: String.fromCharCode(65 + idx),
            correct_value: String((question as any).answer_key),
          })),
        } as any);
        return;
      }

      blocks.push({
        ...baseBlock,
        engine: "matching_letters",
        questions: questions as any,
        pairs: ["A", "B", "C"].map((left, idx) => {
          const keyword = keywordBank[(blockIndex + idx) % keywordBank.length] ?? `statement-${idx + 1}`;
          return {
            left,
            right: keyword.replace(/^\w/, (char) => char.toUpperCase()),
          };
        }),
      } as any);
    });

    return blocks;
  },
  validate: (blocks) => {
    const issues: string[] = [];
    blocks
      .filter((block) => block.engine === engineType)
      .forEach((block) => {
        block.questions.forEach((question) => {
          if (!question.prompt?.trim() || !question.answer_key?.trim()) {
            issues.push(`${ADAPTER_ERROR.invalidQuestion}:${block.block_id}:${question.question_id}:MISSING_PROMPT_OR_ANSWER`);
          }

          const tagResult = validateTagCompatibility({
            engineType,
            tags: question.tags,
          });
          if (!tagResult.ok) {
            issues.push(`${block.block_id}:${question.question_id}:${tagResult.issues.join("|")}`);
          }

          if (
            (engineType === "form_or_table_completion" || engineType === "sentence_or_note_completion") &&
            typeof block.instructions === "string"
          ) {
            const maxWords = block.instructions.match(/max(?:imum)?\s+(\d+)\s+word/i);
            if (maxWords) {
              const limit = Number(maxWords[1]);
              const words = String(question.answer_key).trim().split(/\s+/).filter(Boolean).length;
              if (Number.isFinite(limit) && words > limit) {
                issues.push(
                  `${ADAPTER_ERROR.instructionConstraint}:${block.block_id}:${question.question_id}:ANSWER_WORD_LIMIT_EXCEEDED`,
                );
              }
            }
          }

          if (engineType === "multi_select") {
            const optionsCount = Array.isArray((question as any).options) ? (question as any).options.length : 0;
            if (optionsCount < 2) {
              issues.push(`${ADAPTER_ERROR.invalidQuestion}:${block.block_id}:${question.question_id}:INSUFFICIENT_OPTIONS`);
            }
            const selected = String(question.answer_key)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean);
            if (selected.length < 2) {
              issues.push(
                `${ADAPTER_ERROR.instructionConstraint}:${block.block_id}:${question.question_id}:MULTI_SELECT_REQUIRES_TWO_OR_MORE`,
              );
            }
          }

          if (engineType === "map_or_diagram_labeling") {
            const labels = Array.isArray((block as any).labels) ? (block as any).labels : [];
            if (!labels.length) {
              issues.push(`${ADAPTER_ERROR.invalidQuestion}:${block.block_id}:${question.question_id}:MISSING_LABELS`);
            }
          }

          if (engineType === "matching_letters") {
            const pairs = Array.isArray((block as any).pairs) ? (block as any).pairs : [];
            if (!pairs.length) {
              issues.push(`${ADAPTER_ERROR.invalidQuestion}:${block.block_id}:${question.question_id}:MISSING_PAIRS`);
            }
          }
        });
      });
    return { ok: issues.length === 0, issues };
  },
  normalize: (blocks) => blocks,
  answerKeyExtract: (blocks) => {
    const entries: AnswerKeyEntry[] = [];
    blocks
      .filter((block) => block.engine === engineType)
      .forEach((block) => {
        block.questions.forEach((question) => {
          if (engineType === "multi_select") {
            entries.push({
              kind: "multi_choice",
              question_id: question.question_id,
              accepted_option_ids: question.answer_key.split(",").map((value) => value.trim()).filter(Boolean),
              ordered: false,
              tags: question.tags,
            });
            return;
          }
          if (engineType === "matching_letters") {
            entries.push({
              kind: "matching",
              question_id: question.question_id,
              accepted_pairs: [{ left: question.question_id, right: question.answer_key }],
              ordered: true,
              tags: question.tags,
            });
            return;
          }
          if (engineType === "form_or_table_completion" || engineType === "sentence_or_note_completion") {
            entries.push({
              kind: "text",
              question_id: question.question_id,
              accepted_texts: [question.answer_key],
              normalization: { mode: "lenient", numeric_handling: "normalize" },
              tags: question.tags,
            });
            return;
          }
          entries.push({
            kind: "text",
            question_id: question.question_id,
            accepted_texts: [question.answer_key],
            normalization: { mode: "strict", numeric_handling: "exact" },
            tags: question.tags,
          });
        });
      });
    return entries;
  },
});

export const listeningEngineAdapters: Record<ListeningEngineType, EngineAdapter> = {
  mcq_single: createMcqSingleAdapter(),
  multi_select: defaultPassThroughAdapter("multi_select"),
  form_or_table_completion: defaultPassThroughAdapter("form_or_table_completion"),
  sentence_or_note_completion: defaultPassThroughAdapter("sentence_or_note_completion"),
  map_or_diagram_labeling: defaultPassThroughAdapter("map_or_diagram_labeling"),
  matching_letters: defaultPassThroughAdapter("matching_letters"),
};

export const migrateLegacyQuestionsToRenderer = (params: {
  sectionId: string;
  sectionNo: number;
  questions: Question[];
  compatibilityMode?: "legacy_mcq";
}) => {
  const payload = buildMcqBlockFromLegacy({
    sectionId: params.sectionId,
    sectionNo: params.sectionNo,
    questions: params.questions,
    segmentCount: 3,
  });

  const validation = validateListeningRendererPayload(payload);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw Object.assign(new Error(issue?.message ?? "RENDERER_SCHEMA_INVALID"), {
      code: "RENDERER_SCHEMA_INVALID",
      path: issue?.path?.join(".") ?? "unknown",
    });
  }

  console.log("[QuestionAdapter][migration]", {
    section_id: params.sectionId,
    section_no: params.sectionNo,
    compatibility_mode: params.compatibilityMode ?? "legacy_mcq",
    transformed_payload_version: payload.renderer_schema_version,
    blocks: payload.blocks.length,
  });

  return payload;
};

export const buildAnswerKeyFromRenderer = (params: {
  sectionId: string;
  blocks: ListeningRendererRoot["blocks"];
  version?: string;
}): AnswerKey => {
  const entries: AnswerKeyEntry[] = [];
  params.blocks.forEach((block) => {
    const adapter =
      block.engine === "legacy_mcq"
        ? listeningEngineAdapters.mcq_single
        : LISTENING_ENGINE_TYPES.includes(block.engine as ListeningEngineType)
          ? listeningEngineAdapters[block.engine as ListeningEngineType]
          : null;
    if (!adapter) return;
    entries.push(...adapter.answerKeyExtract([block]));
  });

  const normalized = entries.map((entry) => {
    if (entry.kind !== "text") return entry;
    return {
      ...entry,
      accepted_texts: entry.accepted_texts.map((value) => normalizeTextAnswer(value, entry.normalization)),
    };
  });

  return answerKeySchema.parse({
    version: params.version ?? "1.0.0",
    section_id: params.sectionId,
    entries: normalized,
  });
};

export const validateRendererWithAdapterRules = (blocks: ListeningRendererRoot["blocks"]) => {
  const issues: string[] = [];
  blocks.forEach((block) => {
    if (block.engine === "legacy_mcq") {
      const result = listeningEngineAdapters.mcq_single.validate([block]);
      if (!result.ok) {
        issues.push(...result.issues);
      }
      return;
    }
    const engine = block.engine as ListeningEngineType;
    if (!LISTENING_ENGINE_TYPES.includes(engine)) {
      issues.push(`UNSUPPORTED_ENGINE:${block.engine}`);
      return;
    }
    const result = listeningEngineAdapters[engine].validate([block]);
    if (!result.ok) {
      issues.push(...result.issues);
    }
    block.questions.forEach((question) => {
      if (!Array.isArray(question.tags) || question.tags.length === 0) {
        issues.push(`${ADAPTER_ERROR.missingTags}:${block.block_id}:${question.question_id}`);
      }
    });
  });
  return {
    ok: issues.length === 0,
    issues,
  };
};

export const normalizeLegacyQuestionsForApi = (questions: unknown): Question[] => {
  return (Array.isArray(questions) ? questions : [])
    .slice(0, 10)
    .map((question, index) => {
      const options = Array.isArray(question?.options)
        ? question.options.slice(0, 4).map((option: any, optionIndex: number) => ({
            id: String(option?.id ?? `option${optionIndex + 1}`),
            text: typeof option === "string" ? option : String(option?.text ?? option?.label ?? ""),
          }))
        : [];

      return {
        id: String(question?.id ?? `q${index + 1}`),
        question: String(question?.question ?? question?.text ?? "").trim(),
        options,
        correctAnswer: typeof question?.correctAnswer === "string" ? question.correctAnswer : undefined,
        explanation: typeof question?.explanation === "string" ? question.explanation : undefined,
        type: typeof question?.type === "string" ? question.type : undefined,
        groupId: typeof question?.groupId === "string" ? question.groupId : undefined,
        tags: ensureQuestionTags(question, "general"),
      } as Question;
    })
    .filter((question) => question.question.length > 0);
};
