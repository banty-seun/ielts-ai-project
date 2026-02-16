import { z } from "zod";

export const sectionLifecycleStateSchema = z.enum([
  "PLANNED",
  "SCRIPT_READY",
  "QUESTIONS_READY",
  "AUDIO_READY",
  "VALIDATED",
  "PUBLISHED",
  "REVIEW_REQUIRED",
  "FAILED",
]);

export type SectionLifecycleState = z.infer<typeof sectionLifecycleStateSchema>;

export const prefetchStatusSchema = z.enum(["idle", "queued", "running", "ready", "ready_partial", "error"]);
export type PrefetchStatus = z.infer<typeof prefetchStatusSchema>;

const allowedTransitions: Record<SectionLifecycleState, SectionLifecycleState[]> = {
  PLANNED: ["SCRIPT_READY", "FAILED"],
  SCRIPT_READY: ["QUESTIONS_READY", "FAILED"],
  QUESTIONS_READY: ["AUDIO_READY", "FAILED"],
  AUDIO_READY: ["VALIDATED", "FAILED"],
  VALIDATED: ["PUBLISHED", "REVIEW_REQUIRED", "FAILED"],
  PUBLISHED: [],
  REVIEW_REQUIRED: ["VALIDATED", "FAILED", "PLANNED"],
  FAILED: ["PLANNED"],
};

export const canTransitionSectionState = (
  fromState: SectionLifecycleState,
  toState: SectionLifecycleState,
): boolean => {
  return allowedTransitions[fromState].includes(toState);
};

export const applySectionStateTransition = (params: {
  sectionId: string;
  fromState: SectionLifecycleState;
  toState: SectionLifecycleState;
  eventId: string;
}) => {
  if (!canTransitionSectionState(params.fromState, params.toState)) {
    return {
      ok: false as const,
      error: {
        code: "INVALID_SECTION_STATE_TRANSITION",
        section_id: params.sectionId,
        from_state: params.fromState,
        to_state: params.toState,
        event_id: params.eventId,
      },
    };
  }

  return {
    ok: true as const,
    nextState: params.toState,
  };
};

export const mapPrefetchStatusToSectionState = (status: PrefetchStatus): SectionLifecycleState => {
  switch (status) {
    case "idle":
    case "queued":
      return "PLANNED";
    case "running":
      return "SCRIPT_READY";
    case "ready_partial":
      return "VALIDATED";
    case "ready":
      return "PUBLISHED";
    case "error":
      return "FAILED";
    default:
      return "PLANNED";
  }
};

export interface ListeningSectionStateRecord {
  section_id: string;
  section_no: number;
  state: SectionLifecycleState;
  attempt: number;
  last_error_code?: string | null;
  updated_at: string;
  idempotency_key: string;
}

export const listeningSectionStateRecordSchema = z.object({
  section_id: z.string().min(1),
  section_no: z.number().int().positive(),
  state: sectionLifecycleStateSchema,
  attempt: z.number().int().nonnegative(),
  last_error_code: z.string().nullable().optional(),
  updated_at: z.string().datetime(),
  idempotency_key: z.string().min(1),
});

export const assertSequentialSectionStart = (params: {
  requestedSectionNo: number;
  sections: ListeningSectionStateRecord[];
}) => {
  const requiredPublished = params.requestedSectionNo - 1;
  if (requiredPublished <= 0) {
    return { ok: true as const };
  }

  const publishedCount = params.sections.filter(
    (section) => section.section_no < params.requestedSectionNo && section.state === "PUBLISHED",
  ).length;

  if (publishedCount < requiredPublished) {
    return {
      ok: false as const,
      error: {
        code: "SECTION_ORDER_VIOLATION",
        requested_section_no: params.requestedSectionNo,
        required_published: requiredPublished,
        current_published: publishedCount,
      },
    };
  }

  return { ok: true as const };
};
