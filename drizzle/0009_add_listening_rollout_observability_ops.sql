CREATE TABLE IF NOT EXISTS public.listening_rollout_audit (
  id varchar PRIMARY KEY,
  action_type varchar(48) NOT NULL,
  actor_id varchar(128) NOT NULL,
  reason text NOT NULL,
  incident_ticket varchar(128),
  affected_cohorts jsonb NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_rollout_audit_action_idx
  ON public.listening_rollout_audit (action_type);

CREATE INDEX IF NOT EXISTS listening_rollout_audit_actor_idx
  ON public.listening_rollout_audit (actor_id);

CREATE INDEX IF NOT EXISTS listening_rollout_audit_created_idx
  ON public.listening_rollout_audit (created_at);

CREATE TABLE IF NOT EXISTS public.listening_synthetic_probe_run (
  id varchar PRIMARY KEY,
  run_id varchar(128) NOT NULL,
  probe_name varchar(128) NOT NULL,
  stage varchar(64) NOT NULL,
  environment varchar(64) NOT NULL,
  success boolean NOT NULL,
  status_code integer,
  failure_reason text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_synthetic_probe_run_run_idx
  ON public.listening_synthetic_probe_run (run_id);

CREATE INDEX IF NOT EXISTS listening_synthetic_probe_run_stage_idx
  ON public.listening_synthetic_probe_run (stage);

CREATE INDEX IF NOT EXISTS listening_synthetic_probe_run_env_idx
  ON public.listening_synthetic_probe_run (environment);

CREATE INDEX IF NOT EXISTS listening_synthetic_probe_run_created_idx
  ON public.listening_synthetic_probe_run (created_at);
