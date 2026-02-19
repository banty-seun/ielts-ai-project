# PR Review Policy (Listening Releases)

This repository uses a non-hard-enforced review policy for listening release PRs.

## Required Reviewer Check (Listening Release PRs)

Reviewers should not approve a listening release PR unless the PR includes all Story E evidence links from the PR template:
1. `listening-schema-gate` workflow run URL (passed).
2. Migration application log (`migration-apply.log`).
3. Schema gate output (`schema-gate.log`).
4. Readiness probe output (`readiness-probe.log`, `buildManifestReadiness` path).
5. Task-content probe output (`task-content-probe.log`, `/api/firebase/task-content/:id` for a valid listening task).

## Source of Truth

Use the PR template at:
`/Users/oluwaseunbantale/Documents/ielts-ai-project/.github/pull_request_template.md`
