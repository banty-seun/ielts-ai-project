# Listening Restructure Master Execution Plan (A-J)

This document defines the execution order, dependency chain, MVP cut, and rollout path across roadmap items A through J.

Source artifacts:
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_RESTRUCTURE_ROADMAP.md`
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_ROADMAP_A_USER_STORIES.md`
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_ROADMAP_B_USER_STORIES.md`
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_ROADMAP_C_USER_STORIES.md`
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_ROADMAP_D_USER_STORIES.md`
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_ROADMAP_E_USER_STORIES.md`
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_ROADMAP_F_USER_STORIES.md`
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_ROADMAP_G_USER_STORIES.md`
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_ROADMAP_H_USER_STORIES.md`
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_ROADMAP_I_USER_STORIES.md`
- `/Users/oluwaseunbantale/Documents/ielts-ai-project/LISTENING_ROADMAP_J_USER_STORIES.md`

---

## 1) Execution Principles

1. Build contracts first, then orchestration, then generation, then runtime UX.
2. Ship safely: every generation stage must be observable and rollback-ready.
3. Enforce quality and governance before scaling cohorts.
4. Prefer incremental compatibility over big-bang replacement.

---

## 2) Dependency-Driven Order (A-J)

### Wave 0: Foundations

1. **A - Domain Contracts and Architecture Baseline**
- Hard prerequisite for all downstream work.

2. **B - Sequential Orchestration and Eventing**
- Depends on A.
- Enables ordered section generation and idempotent flow.

### Wave 1: Content Production Core

3. **C - Script Generation Subsystem**
- Depends on A, B.

4. **D - Question Generation + Config-Driven Renderer Contracts**
- Depends on A, B, C.

5. **E - Accent-Aware TTS and Asset Pipeline**
- Depends on B, C.

### Wave 2: Trust and Runtime

6. **F - Validation Gates, Quality, and Publish Controls**
- Depends on C, D, E.

7. **G - Runtime UX, Session Progress, and Section Results**
- Depends on B, D, E, F.

### Wave 3: Personalization and Scale Safety

8. **H - Performance Coach and Personalization Loop**
- Depends on D, G.

9. **I - Observability, Reliability, and Rollout**
- Runs in parallel from early phases; hard gate before broad rollout.

10. **J - AI Governance, Hallucination Prevention, and Security Controls**
- Depends on A, F, H, I for full rollout posture.

---

## 3) Critical Path

`A -> B -> C -> D -> E -> F -> G -> H` is the feature critical path.

`I` and `J` must run alongside the path and become mandatory at rollout gates:
- No canary expansion without I core controls.
- No full production expansion without J core controls.

---

## 4) MVP Cut (First Production-Usable Release)

## MVP Goal

Deliver a reliable 4-section listening flow with section-level results and low startup latency for Part 1, with safe rollout controls.

## MVP Includes

1. **A (P0), B (P0), C (P0), D (P0), E (P0), F (P0), G (P0)**
2. **I minimum controls**: I1 + I2 + I3 (baseline tracing/alerts/canary)
3. **J minimum controls**: J1 + J2 + J4 baseline controls

## MVP Excludes (Phase 2)

1. Advanced H features (full closed-loop tutor adaptation depth)
2. I4/I5 full migration + full runbook maturity (minimum viable version still required)
3. J3/J5 advanced registry operations and compliance cadence automation

---

## 5) Milestone Gate Plan

## Gate M1: Contract + Orchestration Ready

- Must complete: A + B(P0)
- Evidence:
  - Contract validation in CI
  - Ordered section orchestration in staging

## Gate M2: End-to-End Content Generation Ready

- Must complete: C(P0) + D(P0) + E(P0)
- Evidence:
  - 4 sections generated sequentially
  - 3-part scripts per section and renderable question blocks

## Gate M3: Publish Quality + Runtime Ready

- Must complete: F(P0) + G(P0)
- Evidence:
  - Validation gates block bad packages
  - Part 1 startup readiness target met in staging
  - Per-section result page available

## Gate M4: Personalization + Safety for Canary

- Must complete: H(P0) + I1/I2/I3 + J1/J2/J4 baseline
- Evidence:
  - Personalized recommendations grounded in evidence
  - Alerts and canary controls active
  - Governance and security baseline checks passing

## Gate M5: Broad Rollout

- Must complete: remaining I + remaining J + non-functional P0s
- Evidence:
  - Stable canary window without critical SLO breaches
  - Governance/security audit pass

---

## 6) Suggested Delivery Sequence (Practical)

1. **Sprint 1-2**: A, B(P0), I1 foundation (telemetry context)
2. **Sprint 3-4**: C(P0), E(P0), J4 hardening kickoff (redaction/secret hygiene)
3. **Sprint 5-6**: D(P0), F(P0), I2 alerts
4. **Sprint 7**: G(P0), J1/J2 baseline governance guards
5. **Sprint 8**: H(P0), I3 canary controls
6. **Sprint 9**: Remaining I/J, migration hardening, full rollout decision

---

## 7) MVP Readiness Checklist

1. Contracts versioned and validated (A).
2. Section generation strictly sequential with idempotency (B).
3. Section contains 3 linked script parts + 10 questions using schema renderer (C, D).
4. Accent-aware TTS assets generated and retrievable (E).
5. Publish blocked on validation failures (F).
6. Runtime supports section progression + section result pages (G).
7. Monitoring, alerting, canary switch active (I).
8. Evidence-binding, fallback safety, and privacy/security baseline active (J).

---

## 8) Risk Register (Top)

1. **Generation latency risk**
- Mitigation: prefetch order prioritizing imminent sessions; queue priority (B, I).

2. **Schema drift risk across agents and renderer**
- Mitigation: strict contracts + validation gates (A, D, F).

3. **Low-quality/hallucinated coaching**
- Mitigation: evidence-binding and deterministic fallback (H, J2).

4. **Operational blind spots during rollout**
- Mitigation: tracing/alerts/canary gates (I).

5. **Security/privacy leakage via logs/debug paths**
- Mitigation: redaction policy and production-safe logging controls (J4).

---

## 9) Recommended Immediate Next Steps

1. Approve this execution plan as the source of sequencing truth.
2. Lock MVP scope (include/exclude list) and set rollout success thresholds.
3. Start implementation from A/B with I1 and J4 controls in parallel from day one.
