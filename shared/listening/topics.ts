export const LISTENING_EVENT_TOPICS = {
  PLAN_EVENTS: "listening.plan.events",
  SECTION_COMMANDS: "listening.section.commands",
  SECTION_EVENTS: "listening.section.events",
  ASSET_EVENTS: "listening.asset.events",
  ATTEMPT_EVENTS: "listening.attempt.events",
  FEEDBACK_EVENTS: "listening.feedback.events",
  DEADLETTER: "listening.deadletter",
} as const;

export type ListeningEventTopic = (typeof LISTENING_EVENT_TOPICS)[keyof typeof LISTENING_EVENT_TOPICS];

export const LISTENING_EVENT_TYPES = {
  SESSION_PLAN_CREATED: "listening.session.plan.created",
  SECTION_BUILD_REQUESTED: "listening.section.build.requested",
  PREFETCH_BOOST_REQUESTED: "listening.prefetch.boost.requested",
  SECTION_STATE_CHANGED: "listening.section.state.changed",
  SECTION_PUBLISHED: "listening.section.published",
  SECTION_STEP_FAILED: "listening.section.step.failed",
  PERFORMANCE_ANALYZED: "listening.performance.analyzed",
  WEEKLY_PLAN_ADJUSTMENT_REQUESTED: "listening.weekly.plan.adjustment.requested",
  DEADLETTER_CREATED: "listening.deadletter.created",
} as const;

export type ListeningEventType = (typeof LISTENING_EVENT_TYPES)[keyof typeof LISTENING_EVENT_TYPES];
