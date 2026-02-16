import { z } from "zod";

export const IELTS_CONTEXT_TYPES = [
  "everyday_social_conversation",
  "everyday_social_monologue",
  "educational_conversation",
  "educational_lecture",
] as const;

export const ieltsContextTypeSchema = z.enum(IELTS_CONTEXT_TYPES);
export type IELTSContextType = z.infer<typeof ieltsContextTypeSchema>;

export const blueprintEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
});

export const blueprintTimelineCheckpointSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  order: z.number().int().positive(),
});

export const blueprintFactSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

export const blueprintAccentPlanSchema = z.object({
  default_accent: z.string().min(1),
  segment_accents: z
    .array(
      z.object({
        segment_no: z.number().int().positive(),
        accent: z.string().min(1),
        voice_hint: z.string().min(1).optional(),
      }),
    )
    .length(3),
});

export const listeningSectionBlueprintSchema = z.object({
  blueprint_id: z.string().min(1),
  blueprint_version: z.number().int().positive(),
  section_id: z.string().min(1),
  section_no: z.number().int().positive(),
  context_type: ieltsContextTypeSchema,
  entities: z.array(blueprintEntitySchema).min(1),
  timeline: z.array(blueprintTimelineCheckpointSchema).min(1),
  facts: z.array(blueprintFactSchema).min(1),
  roles: z.array(z.string().min(1)).min(1),
  accent_plan: blueprintAccentPlanSchema,
  topic_domain: z.string().min(1).optional(),
  context_label: z.string().min(1).optional(),
  scenario_overview: z.string().min(1).optional(),
  script_type: z.enum(["dialogue", "monologue"]),
  created_at: z.string().datetime(),
});

export type ListeningSectionBlueprint = z.infer<typeof listeningSectionBlueprintSchema>;

export const blueprintQualityGateResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string()),
});

export type BlueprintQualityGateResult = z.infer<typeof blueprintQualityGateResultSchema>;

export const resolveExpectedContextType = (params: {
  ieltsPart?: number | null;
  scriptType?: string | null;
}): IELTSContextType => {
  const scriptType = String(params.scriptType ?? "").toLowerCase();
  const part = Number(params.ieltsPart ?? 0);

  if (part === 1) return "everyday_social_conversation";
  if (part === 2) return "everyday_social_monologue";
  if (part === 3) return "educational_conversation";
  if (part === 4) return "educational_lecture";

  if (scriptType === "monologue") return "educational_lecture";
  return "everyday_social_conversation";
};

export const validateContextScriptTypeCompatibility = (params: {
  ieltsPart?: number | null;
  scriptType?: string | null;
}) => {
  const scriptType = String(params.scriptType ?? "").toLowerCase();
  const part = Number(params.ieltsPart ?? 0);
  const errors: string[] = [];

  if (scriptType !== "dialogue" && scriptType !== "monologue") {
    return {
      ok: true as const,
      errors,
    };
  }

  if ((part === 1 || part === 3) && scriptType !== "dialogue") {
    errors.push(`BLUEPRINT_CONTEXT_SCRIPT_TYPE_MISMATCH:ieltsPart=${part} requires dialogue`);
  }
  if ((part === 2 || part === 4) && scriptType !== "monologue") {
    errors.push(`BLUEPRINT_CONTEXT_SCRIPT_TYPE_MISMATCH:ieltsPart=${part} requires monologue`);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
};

export const validateBlueprintQuality = (
  blueprint: ListeningSectionBlueprint,
  minFacts = 3,
): BlueprintQualityGateResult => {
  const errors: string[] = [];
  if (!Array.isArray(blueprint.entities) || blueprint.entities.length === 0) {
    errors.push("BLUEPRINT_ENTITIES_EMPTY");
  }
  if (!Array.isArray(blueprint.timeline) || blueprint.timeline.length === 0) {
    errors.push("BLUEPRINT_TIMELINE_EMPTY");
  }
  if (!Array.isArray(blueprint.facts) || blueprint.facts.length < minFacts) {
    errors.push("BLUEPRINT_FACTS_BELOW_MINIMUM");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
};
