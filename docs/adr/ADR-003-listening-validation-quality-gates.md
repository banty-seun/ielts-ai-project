# ADR-003: Listening Validation and Quality Gates

## Status
Accepted - 2026-02-10

## Context
Invalid section packages should not be published to production clients.

## Decision
Publish is blocked unless all validation gates pass.

## Publish Gates
1. Transcript completeness gate using `server/services/content.ts` (`validateTranscriptComplete`).
2. Question renderer schema validity gate (root + engine contracts + block/segment mapping).
3. Answer key completeness gate (every published question has an answer key).
4. Audio and anchor gate (audio asset URL/duration present; anchor contract references produced).
5. Scoring/tag consistency gate reusing scoring tag conventions from `server/services/scoring.ts`.

## Failure Handling
1. Transient failures retry via centralized retry helper (`server/services/prefetchRetry.ts`).
2. Repeated failures transition section state to `FAILED` and produce structured error metadata (`last_error_code`, attempt).
3. Dead-letter/manual review entry point: failed sections remain non-published with manifest validation error context in persisted state for operator review.

## Consequences
1. Fewer invalid packages reach clients.
2. Slightly longer build latency due to strict validation prior to publish.
