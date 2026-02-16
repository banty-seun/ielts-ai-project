# Listening Governance Policy Spec (Roadmap J)

## Policy Version
`J-1.0.0` (runtime value from `LISTENING_GOVERNANCE_POLICY_VERSION`).

## Risk Classes
1. `learning_content`
2. `scoring_feedback`
3. `personalized_coaching`
4. `plan_adjustment`

## Required Checks By Risk Class
1. `learning_content`: schema validation, prohibited-output checks, approved prompt/model version.
2. `scoring_feedback`: schema validation, scoring/tag consistency.
3. `personalized_coaching`: schema validation, evidence-binding, grounded-claim checks, confidence threshold gate.
4. `plan_adjustment`: schema validation, prohibited-output checks.

## Ownership and Approval Chain
1. Prompt registry owner: `platform_ai`.
2. Model policy owner: `platform_ai`.
3. Release approvals for high-risk classes: governance reviewer role.
4. Exception approvals: governance admin role.

## Provenance Requirements
Generated artifacts must retain:
1. `policy_version`
2. `validator_set_version`
3. `prompt_model` metadata (`prompt_version`, `model_id`, `model_settings`, `owner`, `approved_at`, `status`)
4. Fallback reason when deterministic fallback is activated.

## Enforcement Points
1. Publish validation gate (policy-as-code).
2. Coaching analysis gate (evidence + grounded claims + confidence gating).
3. Review override endpoint (reason code, role check, audit ledger).

## Exception Requirements
All production bypass/exception records must include:
1. Owner.
2. Expiry date.
3. Reason code and reason notes.
4. Optional incident ticket reference.

## Secret Handling Checks
1. Pre-commit scan: `.githooks/pre-commit` runs `npm run check:secrets:staged`.
2. CI scan: `.github/workflows/secret-scan.yml` runs `npm run check:secrets`.
3. Local hook setup command: `git config core.hooksPath .githooks`.
