# Listening Alert Rules

This file implements Roadmap I (`I2.2`) critical alert definitions.

## Critical Rules

1. Publish failure spike:
   - Condition: publish failure ratio > 5% over 15 minutes.
   - Severity: `critical`.
2. DLQ growth:
   - Condition: unresolved DLQ count increases by >= 10 in 10 minutes.
   - Severity: `critical`.
3. Retry exhaustion spike:
   - Condition: `retry.exhausted` >= 5 in 15 minutes.
   - Severity: `high`.
4. TTS failure spike:
   - Condition: TTS failures >= `LISTENING_TTS_ALERT_FAILURE_THRESHOLD` in 15 minutes.
   - Severity: `high`.
5. Coach-analysis miss:
   - Condition: completed attempts without coach output > 2% over 1 hour.
   - Severity: `high`.

## Alert Payload Requirements

1. `trace_id`
2. `request_id`
3. `session_id`
4. `section_id` (if available)
5. failing stage/provider
6. threshold and observed value

## Noise Controls

1. Dedup window: 10 minutes per alert signature.
2. Suppression: do not page repeatedly while incident open.
3. Severity tiers: `warning`, `high`, `critical`.
4. Auto-resolve only after 2 consecutive healthy windows.
