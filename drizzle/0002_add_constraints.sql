-- 0002_add_constraints.sql
-- Example: add a unique index and a FK check

-- unique index example (skip if you already have one)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON public.users ("email");

-- example constraint (adjust names/columns to your schema)
-- ALTER TABLE public.study_plans
--   ADD CONSTRAINT study_plans_user_fk
--   FOREIGN KEY ("userId") REFERENCES public.users("id");
