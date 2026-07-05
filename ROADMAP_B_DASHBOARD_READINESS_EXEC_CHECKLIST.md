# Roadmap B Dashboard Readiness Fix (Executable Checklist)

Source of truth: `LISTENING_ROADMAP_B_USER_STORIES.md`

## Task Checklist (Dependency Order)

- [x] 1. Harden startup schema preflight for readiness/orchestration tables (verified existing startup preflight + schema gate coverage in `server/index.ts` and `server/services/listeningReleaseSchemaGate.ts`).
- [x] 2. Consolidate readiness lifecycle naming across backend/client (`queued`, `warming`, `ready`, `error`) while preserving compatibility fields.
- [x] 3. Make pre-generation background-first from dashboard intent signals (dashboard-open boost) and keep B1/B4 orchestration path idempotent.
- [x] 4. Expose durable readiness summary to dashboard cards (status, updatedAt, attempts, message/error, ETA where possible).
- [x] 5. Update dashboard card rendering to show explicit readiness states on cards before click.
- [x] 6. Prevent ready-looking cards when not ready (CTA gating/relabeling + non-ready click opens prep/status flow).
- [x] 7. Persist/resume prep status on dashboard revisit via polling refresh of progress/readiness state.
- [x] 8. Add poll-based readiness notification/toast when queued/warming tasks become ready.
- [x] 9. Remove noisy debug logs in orchestration/readiness/dashboard paths (`routes.ts`, `listeningReadiness.ts`, `ListeningWeeklyPlan.tsx`) (task-progress weekly-plan debug logs removed; one-time schema warning in `listeningReadiness.ts` intentionally retained).
- [x] 10. Add integration verification for dashboard-open boost (without sandbox entry) and run deep verification suite.
