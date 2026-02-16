-- 0005_add_listening_section_state_table.sql
CREATE TABLE IF NOT EXISTS public.listening_section_state (
  id varchar PRIMARY KEY,
  task_progress_id varchar NOT NULL REFERENCES public.task_progress(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  section_id varchar NOT NULL,
  section_no integer NOT NULL,
  state varchar(32) NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  last_error_code varchar(64),
  idempotency_key varchar NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_section_state_task_idx
  ON public.listening_section_state (task_progress_id);

CREATE INDEX IF NOT EXISTS listening_section_state_user_idx
  ON public.listening_section_state (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS listening_section_state_task_section_idx
  ON public.listening_section_state (task_progress_id, section_id);

-- Backfill historical section lifecycle state from task_progress.progress_data.sectionLifecycle
INSERT INTO public.listening_section_state (
  id,
  task_progress_id,
  user_id,
  section_id,
  section_no,
  state,
  attempt,
  last_error_code,
  idempotency_key,
  updated_at,
  created_at
)
SELECT
  'lss_' || md5(tp.id || ':' || COALESCE(elem->>'section_id', '') || ':' || COALESCE(elem->>'updated_at', now()::text)),
  tp.id,
  tp.user_id,
  elem->>'section_id',
  COALESCE((elem->>'section_no')::integer, 1),
  COALESCE(NULLIF(elem->>'state', ''), 'PLANNED'),
  COALESCE((elem->>'attempt')::integer, 0),
  NULLIF(elem->>'last_error_code', ''),
  COALESCE(NULLIF(elem->>'idempotency_key', ''), tp.id || ':1:migrated'),
  COALESCE((elem->>'updated_at')::timestamptz, now()),
  now()
FROM public.task_progress tp
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(tp.progress_data->'sectionLifecycle', '[]'::jsonb)) elem
WHERE COALESCE(elem->>'section_id', '') <> ''
ON CONFLICT (task_progress_id, section_id) DO NOTHING;
