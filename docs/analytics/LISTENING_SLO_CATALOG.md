# Listening SLO Catalog

This file implements Roadmap I (`I2.1`) SLO definitions and error-budget policy.

## SLO-1 Publish Success

1. Objective: >= 99.0% successful section publish.
2. Window: rolling 7 days.
3. Numerator: publishes with `success=true` and valid manifest integrity.
4. Denominator: all publish attempts.
5. Owner: Backend + Infra.

## SLO-2 Part-1 Startup Readiness

1. Objective: >= 95.0% part-1 ready at session start.
2. Window: rolling 7 days.
3. Numerator: startup gate checks with `ready=true`.
4. Denominator: all startup gate checks for listening sessions.
5. Owner: Backend + Frontend.

## SLO-3 Generation Latency

1. Objective: p95 end-to-end generation latency <= 120 seconds.
2. Window: rolling 24 hours.
3. Measure: `section_scheduled` -> `published` span chain.
4. Owner: Backend + Infra.

## SLO-4 Coach Availability

1. Objective: >= 98.0% completed attempts produce performance-coach output.
2. Window: rolling 7 days.
3. Numerator: completed attempts with persisted `performanceCoach.latest`.
4. Denominator: all completed listening attempts.
5. Owner: Backend.

## Error Budgets

1. SLO-1 error budget: 1.0%.
2. SLO-2 error budget: 5.0%.
3. SLO-3 latency budget breach if p95 > threshold for 2 consecutive windows.
4. SLO-4 error budget: 2.0%.

## Burn-Rate Policy

1. High burn: 2-hour burn rate > 4x budget triggers `critical` alert.
2. Medium burn: 24-hour burn rate > 2x budget triggers `high` alert.
3. Low burn: 7-day burn rate > 1x budget triggers `warning` alert.

## Escalation SLA

1. `critical`: acknowledge <= 10 minutes, mitigate <= 30 minutes.
2. `high`: acknowledge <= 30 minutes, mitigate <= 2 hours.
3. `warning`: acknowledge <= 4 hours, triage in next business day.
