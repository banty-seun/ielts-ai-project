# Roadmap Item J: AI Governance, Hallucination Prevention, and Security Controls

This document expands **Roadmap Item J** from `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md` into detailed user stories and acceptance criteria.

It is codebase-aware and marks what currently exists versus what must be added for practical AI governance, reliable hallucination prevention, and security/privacy controls in the listening architecture.

## Label Legend

- `[EXISTS]` Already implemented and reusable.
- `[MODIFY]` Exists but needs adaptation.
- `[NEW]` Must be added.
- `[DEPRECATE]` Should be phased out from critical path.

---

## 0) Current-State Baseline (Roadmap J Scope)

### Reusable foundation

1. Request authentication and user binding already exist via `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/firebaseAuth.ts` (`verifyFirebaseAuth`, `ensureFirebaseUser`). `[EXISTS]`
2. Ownership checks are present in task/plan controllers and routes (permission guards returning `403`). `[EXISTS]`
3. Input/schema validation foundations exist in `/Users/oluwaseunbantale/Documents/ielts-ai-project/shared/schema.ts` (`onboardingSchema`, `taskContentUpdateSchema`, typed models). `[EXISTS]`
4. Transcript quality validation exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/content.ts` (`validateTranscriptComplete`). `[EXISTS]`
5. LLM calls already force JSON mode and low-variance generation (`temperature: 0`) in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/openai.ts`. `[EXISTS]`
6. User-data deletion flow exists in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/storage.ts` (`deleteUserDataByEmail`) and can be reused for retention/privacy workflows. `[EXISTS]`

### Gaps vs target governance and security posture

1. No explicit AI governance policy for model/prompt approval, risk classification, and release gates. `[NEW]`
2. No standardized provenance metadata (model version, prompt version, validator set, policy version) stored with generated artifacts. `[NEW]`
3. No universal evidence-binding contract for coach outputs and recommendations (claim -> section/question evidence mapping). `[NEW]`
4. No centralized policy-as-code enforcement layer before publish (safety, allowed output classes, prohibited content checks). `[NEW]`
5. No explicit PII classification/redaction policy in logs/events for generation/coaching pipelines. `[NEW]`
6. No governance audit ledger and periodic compliance checks for overrides/regenerations/promotions. `[NEW]`

### Candidates to phase out

1. Ad-hoc debug logging of full scripts and generation payload details in production pathways. `[DEPRECATE]`
2. Unversioned prompt/model evolution that cannot be audited per published section/result. `[DEPRECATE]`
3. Relying on generic JSON parse success as quality/safety assurance. `[DEPRECATE]`

---

## J1 - AI Governance Policy Baseline

### J1.1 Story - Governance Policy Specification

**User Story**  
As a product/security owner, I want a clear governance policy so AI generation changes are controlled and auditable.

**Acceptance Criteria**

1. Policy defines risk classes for outputs: `learning_content`, `scoring_feedback`, `personalized_coaching`, `plan_adjustment`. `[NEW]`
2. Policy defines required checks per class (schema, evidence-binding, confidence threshold, moderation/prohibited-output checks). `[NEW]`
3. Policy maps ownership and approval chain for model/prompt/rule changes. `[NEW]`
4. Policy version is referenced in generated artifact metadata. `[NEW]`

### J1.2 Story - Governance Decision Records

**User Story**  
As an engineering lead, I want decision records for AI controls so governance tradeoffs are explicit and maintainable.

**Acceptance Criteria**

1. ADRs capture accepted model families, fallback strategy, and disallowed behavior classes. `[NEW]`
2. Existing architecture documentation in listening roadmap artifacts is linked from governance ADRs. `[MODIFY]`
3. Any production exception requires documented expiry date and owner. `[NEW]`
4. ADR updates are required when control boundaries change materially. `[NEW]`

### J1.3 Story - Policy-as-Code Gate Wiring

**User Story**  
As a backend engineer, I want governance rules executable as code so policy is enforced automatically, not manually.

**Acceptance Criteria**

1. Publish path blocks outputs that fail active governance policy checks. `[NEW]`
2. Existing validation gate framework planned in Roadmap F is reused as enforcement host. `[MODIFY]`
3. Policy gate emits structured failure reason codes for triage and reporting. `[NEW]`
4. Policy bypass (if any) requires explicit privileged override path with audit. `[NEW]`

---

## J2 - Hallucination Prevention and Evidence Binding

### J2.1 Story - Evidence-Bound Output Contract

**User Story**  
As a learner, I want recommendations tied to my real mistakes so feedback is trustworthy and specific.

**Acceptance Criteria**

1. Every coaching claim includes linked evidence references: `section_id`, `part_id`, `question_ids`, `error_tags`. `[NEW]`
2. Existing scoring/tag structures in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/scoring.ts` and `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/services/feedback.ts` are reused as primary evidence source. `[EXISTS]`
3. Claims without evidence references are rejected at validation/publish stage. `[NEW]`
4. UI payload supports displaying evidence links for transparency. `[NEW]`

### J2.2 Story - Grounded Generation Validation

**User Story**  
As a quality engineer, I want generated scripts/questions/coaching checked against known inputs so unsupported claims do not ship.

**Acceptance Criteria**

1. Validator checks that generated recommendation text only references facts present in attempt/session data. `[NEW]`
2. Existing transcript completeness validator (`validateTranscriptComplete`) remains as a lower-level content sanity check. `[EXISTS]`
3. Unsupported entities or invented metrics are flagged as `UNGROUNDED_CLAIM`. `[NEW]`
4. Failed grounded checks route item to regeneration or manual review flow. `[NEW]`

### J2.3 Story - Deterministic Fallback and Confidence Gating

**User Story**  
As a reliability owner, I want deterministic fallback feedback when model confidence is low so users still receive safe outputs.

**Acceptance Criteria**

1. Confidence threshold gates decide whether generative enrichment is allowed. `[NEW]`
2. Existing deterministic scoring/session-summary signals are used to produce fallback outputs. `[MODIFY]`
3. Fallback outputs are schema-valid and evidence-linked even when model output is discarded. `[NEW]`
4. Fallback activation reason is recorded for monitoring and tuning. `[NEW]`

---

## J3 - Prompt/Model Registry and Release Controls

### J3.1 Story - Prompt and Model Version Registry

**User Story**  
As an AI platform engineer, I want prompt/model versions registered so each output can be traced to exact generation configuration.

**Acceptance Criteria**

1. Registry stores `prompt_version`, `model_id`, `model_settings`, `owner`, `approved_at`, and `status`. `[NEW]`
2. Existing OpenAI invocation points in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/openai.ts` are updated to attach registry IDs to outputs. `[MODIFY]`
3. Section manifests and coaching outputs persist generation provenance metadata. `[NEW]`
4. Unknown/unapproved prompt versions cannot be used in production mode. `[NEW]`

### J3.2 Story - Change Approval Workflow

**User Story**  
As a release manager, I want controlled approvals for prompt/model changes so quality and safety do not regress silently.

**Acceptance Criteria**

1. Promotion workflow requires staged testing evidence and explicit approvers for high-risk output classes. `[NEW]`
2. Existing canary controls from Roadmap I are integrated with prompt/model promotion steps. `[MODIFY]`
3. Change requests are linked to expected impact and rollback criteria. `[NEW]`
4. Emergency changes require post-hoc review within defined SLA. `[NEW]`

### J3.3 Story - Rollback to Last Known Good Configuration

**User Story**  
As on-call, I want instant rollback to last approved generation config so incidents can be contained quickly.

**Acceptance Criteria**

1. System supports one-step rollback per output class (scripts/questions/coaching). `[NEW]`
2. Rollback event records actor, reason, scope, and impacted cohorts/sessions. `[NEW]`
3. Existing runtime feature-flag patterns in `/Users/oluwaseunbantale/Documents/ielts-ai-project/server/routes.ts` are reused for initial switch control. `[EXISTS]`
4. Rollback compatibility check ensures schema contracts remain valid for consumer UI. `[NEW]`

---

## J4 - Data Security and Privacy Guardrails

### J4.1 Story - Secret and Credential Handling Hardening

**User Story**  
As a security engineer, I want strict secret handling so API keys and credentials never leak through logs or payloads.

**Acceptance Criteria**

1. Existing env-based secret loading (`OPENAI_API_KEY`, AWS credentials) remains the only secret source in runtime codepaths. `[EXISTS]`
2. Debug outputs that expose sensitive operational details (full payloads/script text/credential metadata) are removed or redacted for production. `[MODIFY]`
3. Secret scanning and pre-commit/CI checks are added for server/client code. `[NEW]`
4. API responses and events never include secret-derived values. `[NEW]`

### J4.2 Story - PII Redaction and Data Minimization

**User Story**  
As a privacy owner, I want telemetry and logs to minimize personal data so we reduce compliance and breach risks.

**Acceptance Criteria**

1. PII classes are defined (name, email, phone, UID mapping, free-text notes). `[NEW]`
2. Logging middleware and generation/coaching logs enforce redaction/masking rules by default. `[NEW]`
3. Existing auth and onboarding flows are reviewed to remove non-essential PII from logs. `[MODIFY]`
4. Privacy-safe log mode is enabled by default in production. `[NEW]`

### J4.3 Story - Retention, Deletion, and Access Control Alignment

**User Story**  
As a compliance lead, I want retention and deletion controls so generated data lifecycle follows policy.

**Acceptance Criteria**

1. Retention windows are defined separately for content artifacts, attempts, analytics, and audit logs. `[NEW]`
2. Existing deletion support in `storage.deleteUserDataByEmail` is expanded to include generated assets and derived analytics footprints. `[MODIFY]`
3. Access roles for override/audit endpoints are explicitly defined and enforced. `[NEW]`
4. Scheduled cleanup jobs produce reconciliation reports for retained/deleted records. `[NEW]`

---

## J5 - Human Override, Auditability, and Compliance Operations

### J5.1 Story - Governed Override Workflow

**User Story**  
As an operations reviewer, I want governed override capabilities so problematic outputs can be corrected without bypassing accountability.

**Acceptance Criteria**

1. Override actions support `hold`, `requeue`, `force-regenerate`, and `approve_with_exception`. `[NEW]`
2. Override privileges are restricted to authorized roles and verified on each action. `[NEW]`
3. Existing permission enforcement pattern in controllers/routes is reused for authorization checks. `[EXISTS]`
4. Each override requires reason code and optional incident linkage. `[NEW]`

### J5.2 Story - Governance Audit Ledger

**User Story**  
As an auditor, I want an immutable governance ledger so policy compliance can be reconstructed for any published output.

**Acceptance Criteria**

1. Ledger stores: policy version, prompt/model version, validation verdicts, overrides, approvers, timestamps. `[NEW]`
2. Existing attempt/session storage records are linked to ledger entries via correlation IDs. `[MODIFY]`
3. Ledger is queryable by user/session/section and change window. `[NEW]`
4. Ledger integrity checks run periodically and alert on gaps. `[NEW]`

### J5.3 Story - Compliance Review Cadence and KPIs

**User Story**  
As a governance owner, I want periodic review metrics so we can prove controls are effective and improving.

**Acceptance Criteria**

1. Governance KPIs include hallucination rejection rate, override rate, policy-violation rate, and mean remediation time. `[NEW]`
2. Existing observability dashboards from Roadmap I are extended with governance KPI panels. `[MODIFY]`
3. Quarterly review produces action items with owners and due dates. `[NEW]`
4. Repeated control failures trigger mandatory backlog reprioritization before wider rollout. `[NEW]`

---

## Implementation Notes for Roadmap Item J

1. Keep governance lightweight: enforce a small set of high-impact controls first (evidence-binding, versioning, redaction, approval, audit trail).
2. Build governance on top of existing validation/auth foundations instead of introducing a separate disconnected subsystem.
3. Treat hallucination prevention as a pipeline guard (contract + validator + fallback), not a prompt-only instruction.
4. Remove or gate verbose debug logs before canary expansion to avoid accidental data exposure.
5. Couple J rollout with I canary gates so governance effectiveness is measured from day one.

## Suggested Deliverables Checklist (J Complete)

1. Governance policy spec with policy-as-code enforcement in publish flow.
2. Evidence-bound hallucination prevention and deterministic fallback contracts.
3. Prompt/model registry with approval and rollback controls.
4. Security/privacy controls for secret handling, redaction, retention, and access.
5. Override workflow, immutable governance audit ledger, and compliance KPI cadence.
