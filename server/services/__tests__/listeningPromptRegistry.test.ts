import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPromptChangeRequest,
  configurePromptExperiment,
  listOverduePostHocPromptChanges,
  promotePromptVersion,
  registerPromptTemplate,
  resolvePromptIdForOutputClass,
  resolvePromptTemplateForExecution,
  rollbackPromptVersionForOutputClass,
  setActivePromptVersion,
  validatePromptTemplateCompatibility,
  markPromptChangeRequestPostHocReviewed,
} from "../listeningPromptRegistry";

const TEST_PROMPT_ID = "listening.segment.generation.registry.test";

test("prompt registry resolves experiment candidate by deterministic rollout", async () => {
  await registerPromptTemplate({
    prompt_id: TEST_PROMPT_ID,
    version: "2.0.0",
    status: "draft",
    owner: "platform_ai",
    approved_at: null,
    model_id: "gpt-4o-mini",
    model_settings: {
      temperature: 0.4,
    },
    created_by: "test",
    created_at: new Date().toISOString(),
    template: "candidate template",
  });

  await configurePromptExperiment({
    promptId: TEST_PROMPT_ID,
    enabled: true,
    percentage: 100,
    candidateVersion: "2.0.0",
  });

  const resolved = await resolvePromptTemplateForExecution({
    promptId: TEST_PROMPT_ID,
    userId: "user_test",
    sectionId: "section_test",
  });
  assert.equal(resolved.assignment.mode, "experiment");
  assert.equal(resolved.selected.version, "2.0.0");
});

test("prompt registry defaults are scoped per prompt id", async () => {
  const questionPrompt = await resolvePromptTemplateForExecution({
    promptId: "listening.question.generation",
    userId: "user_default",
    sectionId: "section_default",
  });
  assert.ok(questionPrompt.selected.template.includes("Generate exactly 10 multiple-choice questions"));

  const advisorPrompt = await resolvePromptTemplateForExecution({
    promptId: "listening.coaching.advisor",
    userId: "user_default",
    sectionId: "section_default",
  });
  assert.ok(advisorPrompt.selected.template.includes("study advisor"));
});

test("prompt promotion enforces quality gate", async () => {
  await assert.rejects(
    () =>
      promotePromptVersion({
        promptId: TEST_PROMPT_ID,
        version: "2.0.0",
        qualityGatePassed: false,
      }),
    /regression suite failed/i,
  );
});

test("direct activation is blocked in production unless explicitly enabled", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.LISTENING_ALLOW_DIRECT_PROMPT_ACTIVATION;
  process.env.NODE_ENV = "production";
  delete process.env.LISTENING_ALLOW_DIRECT_PROMPT_ACTIVATION;

  try {
    await assert.rejects(
      () => setActivePromptVersion(TEST_PROMPT_ID, "2.0.0"),
      /PROMPT_ACTIVATION_REQUIRES_PROMOTION/,
    );
  } finally {
    if (typeof originalNodeEnv === "string") {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (typeof originalAllow === "string") {
      process.env.LISTENING_ALLOW_DIRECT_PROMPT_ACTIVATION = originalAllow;
    } else {
      delete process.env.LISTENING_ALLOW_DIRECT_PROMPT_ACTIVATION;
    }
  }
});

test("prompt output classes resolve to expected prompt ids", () => {
  assert.equal(resolvePromptIdForOutputClass("scripts"), "listening.segment.generation");
  assert.equal(resolvePromptIdForOutputClass("questions"), "listening.question.generation");
  assert.equal(resolvePromptIdForOutputClass("coaching"), "listening.coaching.advisor");
});

test("prompt template compatibility validator catches missing contracts", () => {
  const bad = validatePromptTemplateCompatibility({
    outputClass: "questions",
    template: "Generate a short summary paragraph only.",
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.includes("MISSING_QUESTION_CONTEXT"));
});

test("prompt template compatibility validator enforces output-class schema placeholders", () => {
  const questionsMissingPlaceholder = validatePromptTemplateCompatibility({
    outputClass: "questions",
    template: `Return JSON with "questions", "question", "options", "correctAnswer", "explanation". Generate exactly 10 questions.`,
  });
  assert.equal(questionsMissingPlaceholder.ok, false);
  assert.ok(questionsMissingPlaceholder.issues.includes("MISSING_QUESTION_PLACEHOLDER_DIFFICULTY"));

  const scriptsMissingSchema = validatePromptTemplateCompatibility({
    outputClass: "scripts",
    template: `Generate listening segment script from {{blueprint_context}} and {{segment_no}} and {{target_duration_seconds}} and {{user_level}} and {{target_band}} and {{accent}}. Return JSON only.`,
  });
  assert.equal(scriptsMissingSchema.ok, false);
  assert.ok(scriptsMissingSchema.issues.includes("MISSING_SCRIPT_RESPONSE_SCHEMA"));
});

test("rollback switches active prompt to previous version for output class", async () => {
  const promptId = resolvePromptIdForOutputClass("questions");
  await registerPromptTemplate({
    prompt_id: promptId,
    version: "1.0.1",
    status: "draft",
    owner: "platform_ai",
    approved_at: null,
    model_id: "gpt-4o-mini",
    model_settings: { temperature: 0.2 },
    created_by: "test",
    created_at: new Date().toISOString(),
    template:
      'Generate exactly 10 questions at {{difficulty}} level. Return JSON with "questions", "question", "options", "correctAnswer", and "explanation".',
  });
  await promotePromptVersion({
    promptId,
    version: "1.0.1",
    qualityGatePassed: true,
  });

  await registerPromptTemplate({
    prompt_id: promptId,
    version: "1.0.2",
    status: "draft",
    owner: "platform_ai",
    approved_at: null,
    model_id: "gpt-4o-mini",
    model_settings: { temperature: 0.2 },
    created_by: "test",
    created_at: new Date().toISOString(),
    template:
      'Generate exactly 10 questions at {{difficulty}} level. Return strict JSON with "questions", "question", "options", "correctAnswer", and "explanation".',
  });
  await promotePromptVersion({
    promptId,
    version: "1.0.2",
    qualityGatePassed: true,
  });

  const rollback = await rollbackPromptVersionForOutputClass({
    outputClass: "questions",
    actorId: "test_reviewer",
  });
  assert.equal(rollback.promptId, promptId);
  assert.equal(rollback.fromVersion, "1.0.2");
  assert.equal(rollback.toVersion, "1.0.1");
  assert.equal(rollback.compatibility.ok, true);
});

test("emergency prompt change request is discoverable and can be post-hoc reviewed", async () => {
  const dueAt = new Date(Date.now() - 60 * 1000);
  const created = await createPromptChangeRequest({
    promptId: resolvePromptIdForOutputClass("coaching"),
    version: "9.9.9",
    outputClass: "coaching",
    riskClass: "personalized_coaching",
    requestedBy: "requester_1",
    approverId: "approver_1",
    status: "post_hoc_pending",
    stagedTestingEvidence: "runbook-link",
    expectedImpact: "faster recommendation precision",
    rollbackCriteria: "restore previous approved version if rejection spikes",
    qualityGatePassed: true,
    isEmergency: true,
    incidentTicket: "INC-123",
    postHocReviewDueAt: dueAt,
  });
  const overdue = await listOverduePostHocPromptChanges();
  assert.ok(overdue.some((item) => item.id === created.id));

  const reviewed = await markPromptChangeRequestPostHocReviewed({
    id: created.id,
    reviewedBy: "reviewer_2",
    reason: "validated after emergency rollout",
  });
  assert.ok(reviewed);
  assert.equal(reviewed?.status, "post_hoc_completed");
});
