# Listening Telemetry Release Checklist

This checklist is required for Roadmap G releases that include listening runtime telemetry changes.

## Compliance Checks

1. Confirm `LISTENING_TELEMETRY_RETENTION_DAYS` is set for the environment.
2. Confirm scheduled cleanup is enabled and running (`LISTENING_TELEMETRY_CLEANUP_INTERVAL_MS`).
3. Verify telemetry payloads exclude raw answer text/value fields.
4. Verify persisted telemetry is schema-versioned (`version` / `schemaVersion` fields).
5. Verify legacy sessions without new telemetry fields still finalize successfully.
6. Verify section results include attempted/correct/incorrect/unanswered/accuracy/timing only.
7. Verify dashboard/practice readiness boost calls are idempotent (no duplicate section jobs).
