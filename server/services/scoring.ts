import type { Question } from "@shared/schema";

const LETTERS = ["A", "B", "C", "D"];

const TAG_LABELS: Record<string, string> = {
  numbers: "numbers",
  dates: "dates",
  maps: "maps",
  directions: "directions",
  synonyms: "synonyms",
  vocabulary: "vocabulary",
  detail: "details",
  inference: "inference",
  attitude: "attitude",
  general: "general",
};

const FALLBACK_TAG = "general";

export interface SegmentAnswer {
  questionId: string;
  choiceId?: string | null;
}

export interface ScoredSegment {
  correct: number;
  total: number;
  mistakeTags: string[];
  tagStats: Record<string, { correct: number; total: number }>;
  detail: Array<{
    questionId: string;
    isCorrect: boolean;
    pickedOptionId: string | null;
    correctOptionId: string | null;
  }>;
}

const normalizeOptions = (question: Question) => {
  const options = Array.isArray(question.options) ? question.options : [];
  return options.map((opt, idx) => ({
    id: opt.id ?? `option${idx + 1}`,
    text: opt.text ?? "",
  }));
};

const resolveCorrectOptionId = (question: Question, options: { id: string; text: string }[]) => {
  const letter = (question.correctAnswer ?? "").toString().trim().toUpperCase();
  const idx = LETTERS.indexOf(letter);
  if (idx >= 0 && options[idx]) {
    return options[idx].id;
  }
  return letter || null;
};

const deriveQuestionTags = (question: Question): string[] => {
  if (Array.isArray(question.tags) && question.tags.length) {
    return question.tags.map((tag) => tag.toLowerCase());
  }

  const text = `${question.text ?? question.question ?? ""}`.toLowerCase();
  const tags = new Set<string>();

  if (/\b(number|price|cost|time|date|code|phone|address|schedule|year|percentage)\b/.test(text)) {
    tags.add("numbers");
    tags.add("dates");
  }

  if (/\b(map|direction|route|north|south|east|west|turn|straight|left|right)\b/.test(text)) {
    tags.add("maps");
    tags.add("directions");
  }

  if (/\bsynonym|paraphrase|similar\b/.test(text)) {
    tags.add("synonyms");
  }

  if (/\bvocabulary|meaning|word|phrase\b/.test(text)) {
    tags.add("vocabulary");
  }

  if (/\bmain idea|overall|summary\b/.test(text)) {
    tags.add("general");
  }

  if (/\bdetail|specifically|according to\b/.test(text)) {
    tags.add("detail");
  }

  if (/\binfer|suggest|imply\b/.test(text)) {
    tags.add("inference");
  }

  if (/\battitude|opinion|tone|feel\b/.test(text)) {
    tags.add("attitude");
  }

  if (!tags.size) {
    tags.add(FALLBACK_TAG);
  }

  return Array.from(tags);
};

export function scoreSegment(params: {
  questions: Question[];
  answers: SegmentAnswer[];
}): ScoredSegment {
  const { questions, answers } = params;
  const answerMap = new Map(answers.map((ans) => [String(ans.questionId), ans.choiceId ?? null]));
  let correct = 0;
  const detail: ScoredSegment["detail"] = [];
  const mistakeTagAccumulator: Record<string, number> = {};
  const tagStats: Record<string, { correct: number; total: number }> = {};

  questions.forEach((question) => {
    const options = normalizeOptions(question);
    const correctOptionId = resolveCorrectOptionId(question, options);
    const pickedOptionId = answerMap.get(String(question.id)) ?? null;
    const isCorrect = Boolean(pickedOptionId && correctOptionId && pickedOptionId === correctOptionId);
    const tags = deriveQuestionTags(question);

    tags.forEach((tag) => {
      if (!tagStats[tag]) {
        tagStats[tag] = { correct: 0, total: 0 };
      }
      tagStats[tag].total += 1;
      if (isCorrect) {
        tagStats[tag].correct += 1;
      }
    });

    if (isCorrect) {
      correct += 1;
    } else {
      tags.forEach((tag) => {
        mistakeTagAccumulator[tag] = (mistakeTagAccumulator[tag] || 0) + 1;
      });
    }

    detail.push({
      questionId: String(question.id),
      isCorrect,
      pickedOptionId,
      correctOptionId: correctOptionId ?? null,
    });
  });

  const total = questions.length;
  const mistakeTags = Object.keys(mistakeTagAccumulator).length
    ? Object.keys(mistakeTagAccumulator).sort((a, b) => mistakeTagAccumulator[b] - mistakeTagAccumulator[a])
    : [FALLBACK_TAG];

  return {
    correct,
    total,
    mistakeTags,
    tagStats,
    detail,
  };
}

export const friendlyTagLabel = (tag: string): string => {
  return (
    {
      numbers: "Numbers & dates",
      dates: "Dates & schedules",
      maps: "Maps",
      directions: "Directions",
      synonyms: "Synonym traps",
      vocabulary: "Vocabulary-in-context",
      detail: "Specific details",
      inference: "Inference",
      attitude: "Speaker attitude",
      general: "Overall understanding",
    }[tag] ?? TAG_LABELS[tag] ?? "General listening"
  );
};
