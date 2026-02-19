## Summary

<!-- Describe what changed and why. -->

## Testing

<!-- List key tests/commands run for this PR. -->

## Story E Listening Release Evidence (Required for Listening Release PRs)

Complete this section for any PR that touches listening release/runtime paths.

- [ ] `listening-schema-gate` workflow run completed and passed
- [ ] Migration application log attached
- [ ] Schema gate output attached
- [ ] Readiness probe output attached (`buildManifestReadiness` path)
- [ ] `/api/firebase/task-content/:id` probe output attached for a valid listening task

Evidence links:
1. Workflow run URL: <!-- paste URL -->
2. `migration-apply.log`: <!-- paste link/path -->
3. `schema-gate.log`: <!-- paste link/path -->
4. `readiness-probe.log`: <!-- paste link/path -->
5. `task-content-probe.log`: <!-- paste link/path -->

## Ops Notes

<!-- Any rollout or runbook notes for reviewers/operators. -->
