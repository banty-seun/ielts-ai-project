# Listening Contract Migration Inventory

Implements Roadmap I (`I4.1`) migration source-of-truth inventory.

## Inventory Version

1. Version: `1.0.0`
2. Scope: listening task records (`task_progress.skill = listening`)
3. Output artifact: migration report JSON from `server/scripts/backfillListeningContracts.ts`

## Transformation Classes

1. Session package contract:
   - Ensure startup/readiness metadata exists in `progressData.sessionPrefetch` and contract-related state.
2. Question JSON blocks:
   - Ensure question contract state exists (`listeningQuestionContract`) with stable ordering and block plan.
3. Result payloads:
   - Ensure section result payloads include section identity, attempted/correct/incorrect/unanswered, and timing summary.
4. Coaching payload references:
   - Ensure coach payload references are linked in `progressData.performanceCoach`.

## Case Classification

1. No-op:
   - Contract fields present and valid; no write required.
2. Auto-fix:
   - Missing but derivable fields can be populated deterministically.
3. Manual-review:
   - Missing core source data (for example, empty question set) or invariant violations.

## Verification Invariants

1. Section count target: 4.
2. Questions per section target: 10.
3. Section-internal part/block count target: 3.
4. Renderer payload is valid and renderable.

## Rollout Readiness Attachment

Migration report must include:

1. inventory version
2. processed/skipped/failed counts
3. case classification counts
4. mismatch categories and sample task IDs
5. run metadata (`dryRun`, scope filters, startedAt, completedAt, correlationId)

Readiness report assembly:

6. Build consolidated readiness artifact with:
   `node --import tsx server/scripts/buildListeningRolloutReadinessReport.ts --inventory-report=<inventory-json> --reconciliation-report=<reconciliation-json> --output=<readiness-json>`
