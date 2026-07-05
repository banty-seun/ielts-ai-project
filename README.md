# IELTS AI Companion

**An AI-powered IELTS preparation platform that turns a generic test-prep experience into a personalized, adaptive coaching loop — purpose-built for candidates preparing for Canadian immigration.**

> This README doubles as a product brief. It documents the problem, the users, the strategy, the delivery plan, and the engineering system that backs it — so a reader can understand *what* was built, *why*, and *how the work was sequenced and de-risked*.

---

## 1. The Problem

IELTS candidates — especially those testing for immigration — face three recurring pain points:

1. **Generic practice.** Most prep tools serve the same static question banks to everyone, ignoring each learner's actual weak spots.
2. **No feedback loop.** Learners complete practice tests but rarely get specific, actionable guidance on *why* they missed points or *what to do next*.
3. **Listening is the hardest to self-study.** It needs realistic, accent-varied audio and timed, section-based flows that free tools can't produce at scale.

**Opportunity:** Use generative AI to produce exam-realistic content on demand and wrap it in a personalized coaching loop — at a fraction of the cost of human-authored content.

---

## 2. Target Users & Jobs-to-be-Done

| Persona | Context | Job-to-be-Done |
|---|---|---|
| **The Immigration Candidate** | Needs a specific band score for a PR/visa pathway; time-boxed and outcome-driven | "Help me hit my target band efficiently by focusing my study time where it matters." |
| **The Anxious Re-taker** | Missed their band by a small margin; low confidence | "Show me exactly what I got wrong and give me a concrete plan to improve." |
| **The Busy Professional** | Studying around a full-time job | "Give me realistic, timed practice I can trust, whenever I have a spare 30 minutes." |

**Primary JTBD:** *Turn limited study time into measurable band-score improvement through targeted, realistic practice and clear next steps.*

---

## 3. Product Vision & Strategy

> **Vision:** A companion that knows where you are, generates exactly the practice you need, and coaches you toward your target band — session by session.

**Strategic pillars:**

1. **Personalization over volume** — a smaller amount of *targeted* practice beats a large static bank.
2. **Realism as a moat** — exam-accurate structure (4 sections, 40 questions, 32 minutes), accent-aware audio, and mixed question-type engines.
3. **Trust by construction** — AI content is validated, versioned, and governed before it ever reaches a learner.
4. **Ship safely, scale deliberately** — every generation stage is observable and rollback-ready; cohorts expand only behind quality gates.

---

## 4. Success Metrics (KPIs)

Product and reliability targets that define "done well," not just "done":

| Category | Metric | Target |
|---|---|---|
| **Content reliability** | Successful section publish rate | ≥ 99% |
| **Perceived latency** | Section 1 ready before session start | ≥ 95% of attempts |
| **Personalization coverage** | Personalized recommendations generated for completed attempts | ≥ 98% |
| **Quality** | Schema-breaking payloads reaching the renderer in production | 0 |
| **Engagement (leading)** | Session completion rate (all 4 parts) | Tracked per cohort |
| **Outcome (lagging)** | Self-reported band improvement across attempts | Tracked per cohort |

---

## 5. Scope: The Listening Module

The flagship module delivers a full, exam-realistic listening experience:

- **4 sections** (Parts 1–4), **10 questions each** (40 total), **~32 minutes**.
- Each section script is generated as **3 linked segments** to respect model constraints while keeping narrative continuity.
- Each section mixes **2–3 question-type engines** via a config-driven (JSON) renderer — no hardcoded UI per question type.
- **Accent-aware text-to-speech** for realistic audio.
- **Per-section result pages** plus a **final personalized coaching report** that feeds weaknesses back into the next practice recommendation.

### End-to-end flow

```
Onboarding → AI Weekly Plan → Sequential Section Generation (S1→S4)
   → [blueprint → 3 script segments → question blocks → accent TTS → validation → publish]
   → Timed Listening Runtime → Per-Part Results → Final Personalized Coach Report
   → Weakness signals feed back into the next plan
```

---

## 6. Roadmap & Delivery Plan

The build was decomposed into **10 workstreams (A–J)** sequenced by dependency, with an explicit MVP cut and milestone gates. Full detail lives in [`LISTENING_MASTER_EXECUTION_PLAN.md`](LISTENING_MASTER_EXECUTION_PLAN.md) and the per-workstream user-story docs (`LISTENING_ROADMAP_A…J_USER_STORIES.md`).

| Wave | Workstream | Outcome |
|---|---|---|
| **0 — Foundations** | **A** Domain contracts & architecture | Versioned event/data contracts before any build |
| | **B** Sequential orchestration & eventing | Ordered, idempotent, event-driven section generation |
| **1 — Content core** | **C** Script generation subsystem | Linked multi-segment scripts |
| | **D** Question generation + config-driven renderer | Mixed question engines from JSON |
| | **E** Accent-aware TTS & asset pipeline | Realistic audio assets |
| **2 — Trust & runtime** | **F** Validation gates, quality & publish controls | Bad content can't publish |
| | **G** Runtime UX, session progress & results | Timed flow + per-section results |
| **3 — Scale & safety** | **H** Performance coach & personalization loop | Evidence-grounded recommendations |
| | **I** Observability, reliability & rollout | Tracing, alerts, canary controls |
| | **J** AI governance & hallucination prevention | Prompt registry, safety, compliance |

**Critical path:** `A → B → C → D → E → F → G → H`. Workstreams **I** and **J** run in parallel and act as **hard gates**: no canary expansion without I's controls, no full rollout without J's.

### Milestone gates
- **M1** — Contracts + orchestration validated in CI/staging
- **M2** — End-to-end content generation (4 sequential sections)
- **M3** — Publish quality + runtime (validation blocks bad packages; Part-1 startup target met)
- **M4** — Personalization + safety baseline for **canary**
- **M5** — Broad rollout behind a stable canary window and governance sign-off

---

## 7. Risk Management

Risks were tracked with explicit owners in the delivery plan and mitigated *in the architecture*, not just in process:

| Risk | Mitigation |
|---|---|
| Generation latency hurts UX | Prefetch prioritization + queue priority so Part 1 is ready before launch while Parts 2–4 warm in the background |
| Schema drift between AI agents and the renderer | Strict shared contracts + validation gates (A, D, F) |
| Low-quality / hallucinated coaching | Evidence-binding and deterministic fallbacks (H, J) |
| Operational blind spots at rollout | Tracing, alerting, canary switch (I) |
| Secret / PII leakage via logs | Redaction policy + production-safe logging + CI secret scanning (J) |

---

## 8. How the System Is Built

A modern full-stack TypeScript application. This section is intentionally high-level; the detail lives in the code and the docs referenced above.

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript, Vite, Tailwind + shadcn/ui, TanStack Query, Wouter |
| Backend | Express.js + TypeScript |
| Database | PostgreSQL (Neon) via Drizzle ORM |
| Auth | Firebase Authentication + Firebase Admin |
| AI / Media | OpenAI (script & question generation), AWS Polly (accent-aware TTS), AWS S3 (audio storage) |
| Email | SendGrid |

**Architectural stance:**
- **Contracts first** — shared, versioned types (`shared/listening/`) keep AI producers and the UI renderer in lockstep.
- **Orchestration as a domain service** — sequential section generation with idempotency, execution locks, a durable event outbox, and a dead-letter queue with replay.
- **Governed AI** — a prompt registry, experiments, validation reports, and a compliance ledger sit around every generation step.
- **Rollout safety** — readiness models, canary scorecards, and rollback switches gate cohort expansion.

### Repository layout
```
client/    React SPA (dashboard, practice, listening session, onboarding)
server/    Express API + ~60 listening service modules (orchestration, governance, rollout)
shared/    Drizzle schema + versioned listening domain contracts
drizzle/   SQL migrations
docs/      Design + operational documentation
scripts/   Release probes, schema gates, and secret scanning
```

---

## 9. Running Locally

```bash
# 1. Install
npm install

# 2. Configure environment (copy and fill in your own credentials)
cp .env.example .env
#   plus server.env / client.env for local server and client vars

# 3. Start Postgres and apply schema
npm run db:push

# 4. Run the dev server
npm run dev
```

**Quality gates you can run:**
```bash
npm run check                       # types + secret scan + listening fixtures
npm run guard:listening-schema      # schema gate
npm run verify:listening-readiness  # release-readiness probe
```

---

## 10. Security & Secrets

- **No credentials are committed.** All secrets live in local, git-ignored env files (`.env`, `server.env`, `client.env`) or the deployment platform's secret store.
- `.env.example` documents required keys with empty placeholders.
- CI runs an automated **secret scan** (`npm run check:secrets`) and the repository history is kept secret-free.
- If you fork this, supply your own OpenAI, AWS, Firebase, and SendGrid credentials.

---

## 11. What This Project Demonstrates (PM Lens)

- **Problem-first thinking** — a clear user problem and JTBD before any feature.
- **Strategy → metrics → scope** — measurable success criteria that gate quality, not just shipping.
- **Dependency-driven roadmapping** — 10 workstreams sequenced with an explicit critical path, MVP cut, and milestone gates.
- **Risk management as design** — top risks mitigated architecturally, with observability and rollback built in.
- **Responsible AI delivery** — validation, governance, and canary rollout treated as first-class product requirements.
