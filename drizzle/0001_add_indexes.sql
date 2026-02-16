-- 0001_add_indexes.sql
-- Add any extra indexes or constraints here.

CREATE INDEX IF NOT EXISTS task_attempts_task_idx ON public.task_attempts ("taskId");
CREATE INDEX IF NOT EXISTS task_attempts_user_idx ON public.task_attempts ("userId");
