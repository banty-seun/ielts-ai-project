-- 0003_add_more_indexes.sql
CREATE INDEX IF NOT EXISTS task_attempts_task_idx ON public.task_attempts ("task_progress_id");
