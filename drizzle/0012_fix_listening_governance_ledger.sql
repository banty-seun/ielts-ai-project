CREATE TABLE IF NOT EXISTS public.listening_governance_ledger (
  id varchar PRIMARY KEY NOT NULL,
  task_progress_id varchar REFERENCES public.task_progress(id),
  user_id varchar REFERENCES public.users(id),
  section_id varchar,
  section_no integer,
  session_id varchar(128),
  attempt_id varchar(128),
  policy_version varchar(48) NOT NULL,
  prompt_version varchar(64),
  prompt_registry_id varchar(160),
  model_id varchar(128),
  validator_set_version varchar(64),
  validation_verdict varchar(24),
  action_type varchar(64) NOT NULL,
  actor_id varchar(128) NOT NULL,
  actor_type varchar(32) NOT NULL,
  approver_id varchar(128),
  trace_id varchar(128),
  correlation_id varchar(128),
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listening_governance_ledger_user_idx
  ON public.listening_governance_ledger (user_id);
CREATE INDEX IF NOT EXISTS listening_governance_ledger_task_idx
  ON public.listening_governance_ledger (task_progress_id);
CREATE INDEX IF NOT EXISTS listening_governance_ledger_section_idx
  ON public.listening_governance_ledger (section_id);
CREATE INDEX IF NOT EXISTS listening_governance_ledger_session_idx
  ON public.listening_governance_ledger (session_id);
CREATE INDEX IF NOT EXISTS listening_governance_ledger_action_idx
  ON public.listening_governance_ledger (action_type);
CREATE INDEX IF NOT EXISTS listening_governance_ledger_corr_idx
  ON public.listening_governance_ledger (correlation_id);
CREATE INDEX IF NOT EXISTS listening_governance_ledger_created_idx
  ON public.listening_governance_ledger (created_at);

CREATE OR REPLACE FUNCTION public.listening_governance_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'listening_governance_ledger is append-only';
END;
$$;

DROP TRIGGER IF EXISTS listening_governance_ledger_no_update
  ON public.listening_governance_ledger;
CREATE TRIGGER listening_governance_ledger_no_update
BEFORE UPDATE ON public.listening_governance_ledger
FOR EACH ROW
EXECUTE FUNCTION public.listening_governance_ledger_immutable();

DROP TRIGGER IF EXISTS listening_governance_ledger_no_delete
  ON public.listening_governance_ledger;
CREATE TRIGGER listening_governance_ledger_no_delete
BEFORE DELETE ON public.listening_governance_ledger
FOR EACH ROW
EXECUTE FUNCTION public.listening_governance_ledger_immutable();
