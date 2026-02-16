import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSegmentRenderKey,
  createSectionAudioAssetMetadata,
  createSectionAudioQaLog,
  createSignedAudioTokenForKey,
  resolveSignedAudioProxyRedirect,
} from "../../audioService";
import { buildSectionManifestFromTask, validateManifestPublishGates } from "../listeningManifest";

const baseQuestionContract = {
  build_id: "qbp_test_1",
  section_no: 1,
  block_plan: {
    build_id: "qbp_test_1",
    section_no: 1,
    context_type: "everyday_social_conversation",
    plans: [
      {
        section_no: 1,
        block_no: 1,
        segment_no: 1,
        question_range: { from: 1, to: 3 },
        engine_type: "mcq_single",
        instructions: "Choose one correct answer.",
      },
      {
        section_no: 1,
        block_no: 2,
        segment_no: 2,
        question_range: { from: 4, to: 6 },
        engine_type: "multi_select",
        instructions: "Choose all correct answers as instructed.",
      },
      {
        section_no: 1,
        block_no: 3,
        segment_no: 3,
        question_range: { from: 7, to: 10 },
        engine_type: "form_or_table_completion",
        instructions: "Complete the form or table with words from the audio.",
      },
    ],
  },
  question_order: ["q1"],
  question_number_map: { q1: 1 },
  question_count: 1,
};

const buildTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-e-1",
  userId: "user-e-1",
  accent: "British",
  scriptText: Array.from({ length: 40 })
    .map(
      (_, idx) =>
        `Sentence ${idx + 1}: The speaker confirms dates, prices, locations, and follow-up steps for the learner.`,
    )
    .join(" "),
  questions: [
    {
      id: "q1",
      question: "What does the speaker confirm first?",
      options: [
        { id: "A", text: "Date" },
        { id: "B", text: "Address" },
        { id: "C", text: "Price" },
        { id: "D", text: "Policy" },
      ],
      correctAnswer: "A",
      tags: ["detail"],
    },
  ],
  duration: 180,
  audioUrl: "https://example.com/legacy.mp3",
  progressData: {
    sessionOrder: 1,
    listeningQuestionContract: baseQuestionContract,
    sectionAudioAssets: [
      {
        segment_no: 1,
        accent: "British",
        voice_id: "Amy",
        url: "https://example.com/s1.mp3",
        duration_seconds: 180,
        retrieval_verified: true,
        status: "success",
        url_mode: "public",
      },
    ],
  },
  ...overrides,
});

test("segment render key contains deterministic dimensions", () => {
  const key = buildSegmentRenderKey({
    sessionId: "session-abc",
    userId: "user-1",
    weekNumber: 7,
    taskId: "task-1",
    sectionNo: 2,
    segmentNo: 3,
    accent: "British",
    promptVersion: "v2.1",
  });

  assert.equal(
    key,
    "audio/session-session-abc/user-1/week-7/task-task-1/section-2/segment-3/british/pv-v2-1.mp3",
  );
});

test("signed token resolves to S3 URL", () => {
  const token = createSignedAudioTokenForKey({
    key: "audio/user-1/week-1/task-a/section-1/segment-1/british/pv-v1.mp3",
    bucket: "ielts-ai-audio",
    expiresInSeconds: 300,
  });

  const url = resolveSignedAudioProxyRedirect(token);
  assert.ok(url);
  assert.ok(url!.includes("ielts-ai-audio.s3."));
  assert.ok(url!.includes("segment-1"));
});

test("manifest publish gate blocks missing section assets", () => {
  const task = buildTask({
    audioUrl: null,
    duration: 0,
    progressData: {
      sessionOrder: 1,
      listeningQuestionContract: baseQuestionContract,
      sectionAudioAssets: [],
    },
  });

  const gate = validateManifestPublishGates(task as any);
  assert.equal(gate.ok, false);
  assert.equal((gate as any).error.code, "AUDIO_ASSET_INVALID");
});

test("manifest publish gate blocks unverified assets", () => {
  const task = buildTask({
    progressData: {
      sessionOrder: 1,
      listeningQuestionContract: baseQuestionContract,
      sectionAudioAssets: [
        {
          segment_no: 1,
          accent: "British",
          url: "https://example.com/s1.mp3",
          duration_seconds: 180,
          retrieval_verified: false,
          status: "success",
        },
      ],
    },
  });

  const gate = validateManifestPublishGates(task as any);
  assert.equal(gate.ok, false);
  assert.equal((gate as any).error.code, "AUDIO_ASSET_INVALID");
});

test("manifest includes audio assets and qa summary", () => {
  const manifest = buildSectionManifestFromTask(buildTask() as any);
  assert.equal(manifest.audio_assets.length, 1);
  assert.equal(manifest.audio_assets[0].segment_no, 1);
  assert.equal(manifest.build_metadata.qa_summary?.total_assets, 1);
  assert.equal(manifest.build_metadata.qa_summary?.failed_assets, 0);
});

test("asset metadata + qa log contain segment provenance", () => {
  const render = {
    success: true,
    sectionNo: 1,
    promptVersion: "v1",
    results: [
      {
        segmentNo: 1,
        status: "success",
        url: "https://example.com/s1.mp3",
        durationSec: 120,
        accent: "British",
        voiceId: "Amy",
        provider: "aws-polly",
        providerVersion: "neural-v1",
        retrievalVerified: true,
        durationSource: "derived_media",
      },
      {
        segmentNo: 2,
        status: "failed",
        accent: "British",
        provider: "aws-polly",
        providerVersion: "neural-v1",
        errorCode: "AUDIO_VALIDATION_FAILED",
        errorMessage: "SMALL_BUFFER",
        validatorCode: "AUDIO_VALIDATION_FAILED",
        validatorReason: "SMALL_BUFFER",
      },
    ],
  } as any;

  const assets = createSectionAudioAssetMetadata({ render, sectionNo: 1 });
  assert.equal(assets.length, 1);
  assert.equal(assets[0].voice_id, "Amy");

  const qaLog = createSectionAudioQaLog({ render, sectionNo: 1 });
  assert.equal(qaLog.summary.total, 2);
  assert.equal(qaLog.summary.failed, 1);
  assert.equal(qaLog.summary.validator_failures, 1);
});
