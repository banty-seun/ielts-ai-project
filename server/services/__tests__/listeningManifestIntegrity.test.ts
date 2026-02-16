import test from "node:test";
import assert from "node:assert/strict";
import { attachManifestIntegrity, verifyManifestIntegrity } from "../listeningManifestIntegrity";

const baseManifest = {
  manifest_version: "1.0.0",
  section_id: "task_1",
  section_no: 1,
  question_json_url: "/api/listening/sections/task_1/questions.json",
  audio_assets: [
    {
      segment_no: 1,
      accent: "British",
      url: "https://example.com/audio.mp3",
      duration_seconds: 120,
      checksum_sha256: "abc",
    },
  ],
  anchors_url: "/api/listening/sections/task_1/anchors.json",
  answer_key_url: "/api/listening/sections/task_1/answer-key.json",
  build_metadata: {
    build_id: "build_task_1",
    build_version: "1.0.0",
    built_at: new Date().toISOString(),
  },
  immutable: true as const,
};

test("manifest integrity attaches checksum and verifies successfully", () => {
  const signed = attachManifestIntegrity(baseManifest as any);
  const verified = verifyManifestIntegrity(signed as any);
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(typeof verified.checksum, "string");
    assert.equal(verified.checksum.length > 0, true);
  }
});

test("manifest integrity detects tampered manifest", () => {
  const signed = attachManifestIntegrity(baseManifest as any);
  const tampered = {
    ...signed,
    answer_key_url: "/tampered",
  };
  const verified = verifyManifestIntegrity(tampered as any);
  assert.equal(verified.ok, false);
  if (!verified.ok) {
    assert.equal(verified.error_code, "MANIFEST_SIGNATURE_MISMATCH");
  }
});
