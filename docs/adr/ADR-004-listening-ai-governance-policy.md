# ADR-004: Listening AI Governance Policy and Exception Controls

## Status
Accepted - 2026-02-16

## Context
Roadmap J requires explicit AI governance for prompt/model approvals, hallucination prevention, and auditable overrides.

## Decision
Adopt a policy-as-code governance baseline with four risk classes:
`learning_content`, `scoring_feedback`, `personalized_coaching`, `plan_adjustment`.

Per-class controls:
1. `learning_content`: schema validation, prohibited-output checks, approved prompt/model version.
2. `scoring_feedback`: schema validation and scoring/tag consistency checks.
3. `personalized_coaching`: evidence-binding, grounded-claim validation, confidence threshold + deterministic fallback.
4. `plan_adjustment`: schema validation and prohibited-output checks.

Accepted model/prompt strategy:
1. Production uses approved prompt registry entries only.
2. Prompt/model changes require reviewer approval before promotion.
3. Deterministic fallback remains available for low-confidence coaching outputs.

Disallowed behavior classes:
1. Ungrounded claims without evidence references.
2. Prohibited content classes from governance policy checks.
3. Unapproved prompt/model versions in production.

## Exception Policy
Production exceptions require:
1. Owner.
2. Expiry date (`expires_at`).
3. Reason and scope.
4. Incident linkage when applicable.

Expired exceptions are invalid and must be removed or renewed by admin approval.

## Related Architecture Docs
1. `LISTENING_RESTRUCTURE_ROADMAP.md`
2. `LISTENING_MODULE_PROCESS_FLOW.md`
3. `LISTENING_MODULE_SEQUENCE_DIAGRAM.md`
4. `docs/adr/ADR-001-listening-orchestration-strategy.md`
5. `docs/adr/ADR-003-listening-validation-quality-gates.md`

## Consequences
1. Governance checks become explicit and traceable.
2. Prompt/model changes become auditable and reversible.
3. Operational overhead increases slightly due to required approvals and evidence linkage.
