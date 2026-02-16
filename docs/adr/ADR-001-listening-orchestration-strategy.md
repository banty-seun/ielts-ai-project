# ADR-001: Listening Orchestration Strategy

## Status
Accepted - 2026-02-10

## Context
Current listening generation behavior is route-driven in `server/routes.ts` and depends on `progressData.sessionPrefetch` as control-plane state. This creates latency and API-path coupling.

## Decision
Adopt orchestrator-driven section commands/events with sequential per-session section processing.

1. Section processing order is strict (`section 1 -> section 2 -> ...`) and later sections are blocked until prior sections are `PUBLISHED`.
2. API routes dispatch orchestrator commands/events and read state; they do not run full generation stages inline as primary behavior.
3. Existing `sessionPrefetch` remains as backward-compatible transitional state while new section lifecycle records are persisted.
4. User-imminent prioritization: if user requests a section that is not ready, dispatch build command for that section immediately and return warming state.

## Consequences
1. Better fault recovery by resuming from persisted section lifecycle state.
2. Lower request-path complexity and latency in content fetch and next-task endpoints.
3. Transitional complexity because both legacy and new state contracts are supported during rollout.

## Migration
1. Route-triggered inline generation is deprecated from critical path.
2. Routes continue returning legacy fields (`phase`, `etaSecs`, `session.status`) until clients migrate.
3. `sessionPrefetch` is mapped to section lifecycle states through compatibility adapters.
