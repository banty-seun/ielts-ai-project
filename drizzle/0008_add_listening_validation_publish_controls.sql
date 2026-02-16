CREATE TABLE IF NOT EXISTS public.listening_validation_report (
  id varchar PRIMARY KEY,
  task_progress_id varchar NOT NULL REFERENCES public.task_progress(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  section_id varchar NOT NULL,
  section_no integer NOT NULL,
  verdict varchar(16) NOT NULL,
  severity varchar(16) NOT NULL,
  top_error_code varchar(64),
  report jsonb NOT NULL,
  timing_artifact jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_validation_report_task_idx
  ON public.listening_validation_report (task_progress_id);

CREATE INDEX IF NOT EXISTS listening_validation_report_section_idx
  ON public.listening_validation_report (section_id);

CREATE INDEX IF NOT EXISTS listening_validation_report_verdict_idx
  ON public.listening_validation_report (verdict);

CREATE INDEX IF NOT EXISTS listening_validation_report_created_idx
  ON public.listening_validation_report (created_at);

CREATE TABLE IF NOT EXISTS public.listening_review_queue (
  id varchar PRIMARY KEY,
  task_progress_id varchar NOT NULL REFERENCES public.task_progress(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  section_id varchar NOT NULL,
  section_no integer NOT NULL,
  validation_report_id varchar REFERENCES public.listening_validation_report(id) ON DELETE SET NULL,
  status varchar(24) NOT NULL,
  severity varchar(16) NOT NULL,
  failure_type varchar(64) NOT NULL,
  failure_code varchar(64) NOT NULL,
  context jsonb,
  sla_due_at timestamptz,
  escalated_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_review_queue_task_idx
  ON public.listening_review_queue (task_progress_id);

CREATE INDEX IF NOT EXISTS listening_review_queue_status_idx
  ON public.listening_review_queue (status);

CREATE INDEX IF NOT EXISTS listening_review_queue_severity_idx
  ON public.listening_review_queue (severity);

CREATE INDEX IF NOT EXISTS listening_review_queue_failure_type_idx
  ON public.listening_review_queue (failure_type);

CREATE INDEX IF NOT EXISTS listening_review_queue_sla_due_idx
  ON public.listening_review_queue (sla_due_at);

CREATE INDEX IF NOT EXISTS listening_review_queue_created_idx
  ON public.listening_review_queue (created_at);

CREATE TABLE IF NOT EXISTS public.listening_review_action (
  id varchar PRIMARY KEY,
  review_queue_id varchar NOT NULL REFERENCES public.listening_review_queue(id) ON DELETE CASCADE,
  task_progress_id varchar NOT NULL REFERENCES public.task_progress(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  section_id varchar NOT NULL,
  section_no integer NOT NULL,
  action varchar(40) NOT NULL,
  reviewer_id varchar NOT NULL,
  reason_notes text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_review_action_queue_idx
  ON public.listening_review_action (review_queue_id);

CREATE INDEX IF NOT EXISTS listening_review_action_task_idx
  ON public.listening_review_action (task_progress_id);

CREATE INDEX IF NOT EXISTS listening_review_action_action_idx
  ON public.listening_review_action (action);

CREATE INDEX IF NOT EXISTS listening_review_action_created_idx
  ON public.listening_review_action (created_at);

CREATE TABLE IF NOT EXISTS public.listening_manifest_version (
  id varchar PRIMARY KEY,
  task_progress_id varchar NOT NULL REFERENCES public.task_progress(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  section_id varchar NOT NULL,
  section_no integer NOT NULL,
  version_no integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  manifest jsonb NOT NULL,
  manifest_checksum_sha256 varchar(128) NOT NULL,
  hash_algorithm varchar(32) NOT NULL,
  hash_version varchar(16) NOT NULL,
  validation_report_id varchar REFERENCES public.listening_validation_report(id) ON DELETE SET NULL,
  generation_trace_id varchar(128),
  generation_correlation_id varchar(128),
  published_by varchar(128) NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listening_manifest_version_task_ver_unique UNIQUE (task_progress_id, version_no)
);

CREATE INDEX IF NOT EXISTS listening_manifest_version_task_idx
  ON public.listening_manifest_version (task_progress_id);

CREATE INDEX IF NOT EXISTS listening_manifest_version_section_idx
  ON public.listening_manifest_version (section_id);

CREATE INDEX IF NOT EXISTS listening_manifest_version_active_idx
  ON public.listening_manifest_version (is_active);

CREATE INDEX IF NOT EXISTS listening_manifest_version_published_idx
  ON public.listening_manifest_version (published_at);

CREATE TABLE IF NOT EXISTS public.listening_publish_audit (
  id varchar PRIMARY KEY,
  task_progress_id varchar NOT NULL REFERENCES public.task_progress(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  section_id varchar NOT NULL,
  section_no integer NOT NULL,
  manifest_version_id varchar REFERENCES public.listening_manifest_version(id) ON DELETE SET NULL,
  event_type varchar(64) NOT NULL,
  actor_id varchar(128) NOT NULL,
  actor_type varchar(32) NOT NULL,
  trace_id varchar(128),
  correlation_id varchar(128),
  validation_verdicts jsonb,
  override_action varchar(40),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_publish_audit_task_idx
  ON public.listening_publish_audit (task_progress_id);

CREATE INDEX IF NOT EXISTS listening_publish_audit_section_idx
  ON public.listening_publish_audit (section_id);

CREATE INDEX IF NOT EXISTS listening_publish_audit_event_idx
  ON public.listening_publish_audit (event_type);

CREATE INDEX IF NOT EXISTS listening_publish_audit_corr_idx
  ON public.listening_publish_audit (correlation_id);

CREATE INDEX IF NOT EXISTS listening_publish_audit_created_idx
  ON public.listening_publish_audit (created_at);
