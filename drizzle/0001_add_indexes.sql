-- 0001_add_indexes.sql
-- Add any extra indexes or constraints here.

CREATE INDEX IF NOT EXISTS task_attempts_task_idx ON public.task_attempts ("task_progress_id");
CREATE INDEX IF NOT EXISTS task_attempts_user_idx ON public.task_attempts ("user_id");
