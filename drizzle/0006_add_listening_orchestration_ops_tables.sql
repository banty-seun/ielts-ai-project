-- 0006_add_listening_orchestration_ops_tables.sql

CREATE TABLE IF NOT EXISTS public.listening_execution_lock (
  id varchar PRIMARY KEY,
  lock_key varchar NOT NULL,
  task_progress_id varchar NOT NULL REFERENCES public.task_progress(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  step_name varchar(64) NOT NULL,
  owner_id varchar(64) NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS listening_execution_lock_key_idx
  ON public.listening_execution_lock (lock_key);

CREATE INDEX IF NOT EXISTS listening_execution_lock_task_idx
  ON public.listening_execution_lock (task_progress_id);

CREATE INDEX IF NOT EXISTS listening_execution_lock_expires_idx
  ON public.listening_execution_lock (expires_at);

CREATE TABLE IF NOT EXISTS public.listening_dead_letter (
  id varchar PRIMARY KEY,
  task_progress_id varchar NOT NULL REFERENCES public.task_progress(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  section_id varchar NOT NULL,
  section_no integer NOT NULL,
  step_name varchar(64) NOT NULL,
  error_code varchar(64) NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  context jsonb NOT NULL,
  replayed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_dead_letter_task_idx
  ON public.listening_dead_letter (task_progress_id);

CREATE INDEX IF NOT EXISTS listening_dead_letter_user_idx
  ON public.listening_dead_letter (user_id);

CREATE INDEX IF NOT EXISTS listening_dead_letter_created_idx
  ON public.listening_dead_letter (created_at);

CREATE TABLE IF NOT EXISTS public.listening_readiness_model (
  id varchar PRIMARY KEY,
  task_progress_id varchar NOT NULL REFERENCES public.task_progress(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  section_id varchar NOT NULL,
  section_no integer NOT NULL,
  state varchar(32) NOT NULL,
  part_ready boolean NOT NULL DEFAULT false,
  manifest_status varchar(32) NOT NULL,
  manifest jsonb,
  last_event_id varchar,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS listening_readiness_model_task_section_idx
  ON public.listening_readiness_model (task_progress_id, section_id);

CREATE INDEX IF NOT EXISTS listening_readiness_model_user_idx
  ON public.listening_readiness_model (user_id);

CREATE INDEX IF NOT EXISTS listening_readiness_model_state_idx
  ON public.listening_readiness_model (state);

CREATE TABLE IF NOT EXISTS public.listening_queue_metric (
  id varchar PRIMARY KEY,
  task_progress_id varchar NOT NULL REFERENCES public.task_progress(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  section_no integer NOT NULL,
  priority_class varchar(16) NOT NULL,
  step_name varchar(64) NOT NULL,
  enqueue_to_start_ms integer,
  start_to_publish_ms integer,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_queue_metric_task_idx
  ON public.listening_queue_metric (task_progress_id);

CREATE INDEX IF NOT EXISTS listening_queue_metric_priority_idx
  ON public.listening_queue_metric (priority_class);

CREATE INDEX IF NOT EXISTS listening_queue_metric_created_idx
  ON public.listening_queue_metric (created_at);
