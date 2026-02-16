-- 0004_add_task_progress_unique_scope.sql
CREATE UNIQUE INDEX IF NOT EXISTS task_progress_unique_scope_idx
  ON public.task_progress (user_id, weekly_plan_id, day_number, task_title, skill);
