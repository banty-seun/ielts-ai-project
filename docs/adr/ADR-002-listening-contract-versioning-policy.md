# ADR-002: Listening Contract and Versioning Policy

## Status
Accepted - 2026-02-10

## Context
Listening events and renderer/package schemas require controlled evolution while supporting existing `TaskProgress` content fields.

## Decision
Use semantic versioning for event/schema contracts with explicit compatibility policy.

1. Version format is `major.minor.patch`.
2. `major`: breaking changes (field removals, required field changes, semantic behavior changes).
3. `minor`: backward-compatible additions (new optional fields, new event payload fields).
4. `patch`: non-structural fixes (clarifications, constraints tightening without breaking valid payloads).
5. Deprecation window: maintain compatibility adapters for at least one migration cycle before removing legacy contracts.

## Compatibility Requirements
1. Existing `TaskProgress` fields (`scriptText`, `audioUrl`, `questions`) remain readable.
2. Legacy MCQ payloads are transformed into renderer blocks via compatibility transform before validation/publish.
3. Legacy prefetch status fields remain in API responses while manifest/readiness fields are introduced.

## Consequences
1. Contract changes are traceable and safer across services.
2. Consumers can adopt new contracts incrementally without forced synchronized releases.
