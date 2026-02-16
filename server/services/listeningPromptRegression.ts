import { validateTranscriptComplete } from "./content";
import type { ListeningSectionSegment } from "@shared/listening";

const hasContinuitySignal = (previous: string, next: string) => {
  const normalizedPrev = previous.toLowerCase();
  const normalizedNext = next.toLowerCase();
  const phraseSignals = ["as mentioned", "as discussed", "continuing", "following", "earlier"];
  if (phraseSignals.some((phrase) => normalizedNext.includes(phrase))) {
    return true;
  }

  return normalizedPrev
    .split(/\W+/)
    .filter((token) => token.length > 5)
    .some((token) => normalizedNext.includes(token));
};

export const runPromptQualityRegression = (segments: ListeningSectionSegment[]) => {
  const failures: string[] = [];
  const orderedSegments = [...segments].sort((a, b) => a.segment_no - b.segment_no);
  if (orderedSegments.length !== 3) {
    failures.push(`SEGMENT_COUNT_INVALID:${orderedSegments.length}`);
  }

  segments.forEach((segment) => {
    const transcriptCheck = validateTranscriptComplete(segment.transcript_text, { minWords: 90 });
    if (!transcriptCheck.ok) {
      failures.push(`${segment.segment_id}:TRANSCRIPT_${transcriptCheck.reason ?? "INVALID"}`);
    }
    if (segment.predicted_duration_seconds < 120 || segment.predicted_duration_seconds > 180) {
      failures.push(`${segment.segment_id}:DURATION_OUT_OF_RANGE`);
    }
    if (!segment.linkage.blueprint_id) {
      failures.push(`${segment.segment_id}:MISSING_BLUEPRINT_LINK`);
    }
    if (!segment.difficulty || !segment.difficulty.trim()) {
      failures.push(`${segment.segment_id}:MISSING_DIFFICULTY_DECLARATION`);
    }
    if (!(segment.difficulty_confidence >= 0.5 && segment.difficulty_confidence <= 1)) {
      failures.push(`${segment.segment_id}:DIFFICULTY_CONFIDENCE_OUT_OF_RUBRIC`);
    }
  });

  for (let idx = 1; idx < orderedSegments.length; idx += 1) {
    const previous = orderedSegments[idx - 1];
    const current = orderedSegments[idx];
    if (!hasContinuitySignal(previous.transcript_text, current.transcript_text)) {
      failures.push(`${current.segment_id}:MISSING_TRANSITION_CONTINUITY_SIGNAL`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
};
