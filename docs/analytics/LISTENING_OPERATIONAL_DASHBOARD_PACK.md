# Listening Operational Dashboard Pack

This dashboard pack covers Roadmap I (`I1.3`) for queue, stage, readiness, reliability, and trace-linked observability.

## Panels

1. Queue depth by priority class (`P1_CURRENT`, `P2_NEXT_24H`, `P3_LATER`).
2. Queue delay (`enqueue_to_start_ms`) p50/p95/p99 by stage.
3. Stage span latency (`span:*`) p50/p95/p99:
   - `plan_selected`
   - `section_scheduled`
   - `script_generated`
   - `question_generated`
   - `audio_rendered`
   - `validated`
   - `published`
   - `result_computed`
   - `coach_analyzed`
4. Stage success ratio and failure ratio by stage and error class.
5. Retry metrics (`scheduled`, `executed`, `failed`, `exhausted`) and top error codes.
6. DLQ volume over time and unresolved backlog.
7. Section readiness:
   - part-1 startup readiness success rate
   - per-section publish completeness
8. Manifest integrity:
   - mismatch count
   - blocked publish count
9. Render mode and rollout:
   - legacy vs new/cohort volume
   - rollback active indicator

## Data Sources

1. `listening_queue_metric` table (queue + span metric rows).
2. `listening_dead_letter` table (terminal failures).
3. `listening_readiness_model` table (part readiness / manifest status).
4. `listening_publish_audit` + `listening_manifest_version` tables.
5. Structured logs (`[ListeningStructuredLog]`) with trace and request correlation fields.

## Correlation Linking

Use these fields for drill-down links:

1. `trace_id`
2. `request_id`
3. `session_id` (task/session)
4. `section_id`
5. `event_name`

## Freshness Targets

1. Queue/retry panels: <= 1 minute lag.
2. Span latency panels: <= 5 minutes lag.
3. Daily scorecards: UTC day boundary.
