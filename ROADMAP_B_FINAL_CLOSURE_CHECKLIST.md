# Roadmap B Final Closure Checklist

Source of truth: `LISTENING_ROADMAP_B_USER_STORIES.md`

## Task Checklist (Dependency Order)

- [x] B1.1 complete extraction: orchestration execution moved to `server/services/listeningSessionPrefetchOrchestrator.ts`, while `server/routes.ts` remains dispatch + status compatibility and worker binding only.
- [x] B5.1/B5.2 durable eventing: `SECTION_STATE_CHANGED` and `SECTION_PUBLISHED` now emit via durable outbox-backed path with retry behavior.
- [x] B5.3 replay/readiness consistency: replay utility rebuilds readiness model from durable events and verified deterministic outcomes.
- [x] B4.1/B4.2 priority signal fidelity: boost source (`dashboard_start_click`, `session_open`, `transition_wait`, etc.) now drives scoring (not hardcoded), with idempotent boost behavior retained.
- [x] B3.2.4 DLQ ops visibility: DLQ metrics are published for create/replay and alert signals emitted for repeated failures.
- [x] B2.1/B2.3 integration resilience coverage: deep tests added for at-least-once dedupe, lock/re-entry safety, and replay consistency.
- [x] Final deep verification pass: migrations/schema gate, readiness probe, runtime task-content probe, targeted tests, smoke checks.

## Verification Log

- `npx tsc --noEmit`
- `node --import tsx --test server/services/__tests__/listeningRoadmapBContracts.test.ts server/services/__tests__/listeningOrchestratorWorker.test.ts server/services/__tests__/listeningReentryResume.test.ts server/services/__tests__/listeningSectionStateRecovery.test.ts server/services/__tests__/listeningDurableEvents.test.ts server/services/__tests__/listeningPrioritySignals.test.ts server/services/__tests__/listeningGovernancePrerequisites.test.ts`
- `npm run guard:listening-schema`
- `npm run verify:listening-readiness`
- `npm run verify:listening-runtime`
- `npm run verify:listening-readiness-rebuild`
- `npm run verify:listening-readiness-replay-determinism`
- `npm run smoke:api`
