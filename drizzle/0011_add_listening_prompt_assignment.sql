CREATE TABLE IF NOT EXISTS public.listening_prompt_assignment (
  id varchar PRIMARY KEY NOT NULL,
  prompt_id varchar(160) NOT NULL,
  version varchar(64) NOT NULL,
  task_progress_id varchar REFERENCES public.task_progress(id),
  user_id varchar REFERENCES public.users(id),
  section_id varchar(128),
  assignment_mode varchar(24) NOT NULL,
  assignment_bucket integer,
  outcome varchar(24) NOT NULL,
  reason varchar(128),
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_prompt_assignment_prompt_idx
  ON public.listening_prompt_assignment (prompt_id, version);
CREATE INDEX IF NOT EXISTS listening_prompt_assignment_task_idx
  ON public.listening_prompt_assignment (task_progress_id);
CREATE INDEX IF NOT EXISTS listening_prompt_assignment_section_idx
  ON public.listening_prompt_assignment (section_id);
CREATE INDEX IF NOT EXISTS listening_prompt_assignment_created_idx
  ON public.listening_prompt_assignment (created_at);
