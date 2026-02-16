CREATE TABLE IF NOT EXISTS "listening_governance_exception" (
  "id" varchar PRIMARY KEY NOT NULL,
  "scope_type" varchar(64) NOT NULL,
  "scope_ref" varchar(160),
  "risk_class" varchar(64) NOT NULL,
  "owner" varchar(128) NOT NULL,
  "created_by" varchar(128) NOT NULL,
  "approver_id" varchar(128) NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "reason_notes" text NOT NULL,
  "incident_ticket" varchar(128),
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "listening_governance_exception_scope_idx"
  ON "listening_governance_exception" ("scope_type","scope_ref");
CREATE INDEX IF NOT EXISTS "listening_governance_exception_risk_idx"
  ON "listening_governance_exception" ("risk_class");
CREATE INDEX IF NOT EXISTS "listening_governance_exception_status_idx"
  ON "listening_governance_exception" ("status");
CREATE INDEX IF NOT EXISTS "listening_governance_exception_expires_idx"
  ON "listening_governance_exception" ("expires_at");
CREATE INDEX IF NOT EXISTS "listening_governance_exception_created_idx"
  ON "listening_governance_exception" ("created_at");

CREATE TABLE IF NOT EXISTS "listening_prompt_registry" (
  "id" varchar PRIMARY KEY NOT NULL,
  "prompt_id" varchar(160) NOT NULL,
  "version" varchar(64) NOT NULL,
  "status" varchar(24) NOT NULL,
  "owner" varchar(128) NOT NULL,
  "approved_at" timestamp with time zone,
  "model_id" varchar(128) NOT NULL,
  "model_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" varchar(128) NOT NULL,
  "template" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "listening_prompt_registry_prompt_version_idx"
  ON "listening_prompt_registry" ("prompt_id","version");
CREATE INDEX IF NOT EXISTS "listening_prompt_registry_prompt_idx"
  ON "listening_prompt_registry" ("prompt_id");
CREATE INDEX IF NOT EXISTS "listening_prompt_registry_status_idx"
  ON "listening_prompt_registry" ("status");
CREATE INDEX IF NOT EXISTS "listening_prompt_registry_approved_idx"
  ON "listening_prompt_registry" ("approved_at");

CREATE TABLE IF NOT EXISTS "listening_prompt_experiment" (
  "prompt_id" varchar(160) PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "percentage" integer DEFAULT 0 NOT NULL,
  "candidate_version" varchar(64),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "listening_prompt_experiment_enabled_idx"
  ON "listening_prompt_experiment" ("enabled");

CREATE TABLE IF NOT EXISTS "listening_prompt_change_request" (
  "id" varchar PRIMARY KEY NOT NULL,
  "prompt_id" varchar(160) NOT NULL,
  "version" varchar(64) NOT NULL,
  "output_class" varchar(32) NOT NULL,
  "risk_class" varchar(64) NOT NULL,
  "requested_by" varchar(128) NOT NULL,
  "approver_id" varchar(128),
  "status" varchar(32) NOT NULL,
  "staged_testing_evidence" text NOT NULL,
  "expected_impact" text NOT NULL,
  "rollback_criteria" text NOT NULL,
  "quality_gate_passed" boolean DEFAULT false NOT NULL,
  "is_emergency" boolean DEFAULT false NOT NULL,
  "incident_ticket" varchar(128),
  "post_hoc_review_due_at" timestamp with time zone,
  "post_hoc_reviewed_at" timestamp with time zone,
  "reason" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "listening_prompt_change_request_prompt_idx"
  ON "listening_prompt_change_request" ("prompt_id","version");
CREATE INDEX IF NOT EXISTS "listening_prompt_change_request_output_idx"
  ON "listening_prompt_change_request" ("output_class");
CREATE INDEX IF NOT EXISTS "listening_prompt_change_request_status_idx"
  ON "listening_prompt_change_request" ("status");
CREATE INDEX IF NOT EXISTS "listening_prompt_change_request_post_hoc_due_idx"
  ON "listening_prompt_change_request" ("post_hoc_review_due_at");
CREATE INDEX IF NOT EXISTS "listening_prompt_change_request_created_idx"
  ON "listening_prompt_change_request" ("created_at");

CREATE TABLE IF NOT EXISTS "listening_governance_ledger" (
  "id" varchar PRIMARY KEY NOT NULL,
  "task_progress_id" varchar REFERENCES "task_progress"("id"),
  "user_id" varchar REFERENCES "users"("id"),
  "section_id" varchar,
  "section_no" integer,
  "session_id" varchar(128),
  "attempt_id" varchar(128),
  "policy_version" varchar(48) NOT NULL,
  "prompt_version" varchar(64),
  "prompt_registry_id" varchar(160),
  "model_id" varchar(128),
  "validator_set_version" varchar(64),
  "validation_verdict" varchar(24),
  "action_type" varchar(64) NOT NULL,
  "actor_id" varchar(128) NOT NULL,
  "actor_type" varchar(32) NOT NULL,
  "approver_id" varchar(128),
  "trace_id" varchar(128),
  "correlation_id" varchar(128),
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "listening_governance_ledger_user_idx"
  ON "listening_governance_ledger" ("user_id");
CREATE INDEX IF NOT EXISTS "listening_governance_ledger_task_idx"
  ON "listening_governance_ledger" ("task_progress_id");
CREATE INDEX IF NOT EXISTS "listening_governance_ledger_section_idx"
  ON "listening_governance_ledger" ("section_id");
CREATE INDEX IF NOT EXISTS "listening_governance_ledger_session_idx"
  ON "listening_governance_ledger" ("session_id");
CREATE INDEX IF NOT EXISTS "listening_governance_ledger_action_idx"
  ON "listening_governance_ledger" ("action_type");
CREATE INDEX IF NOT EXISTS "listening_governance_ledger_corr_idx"
  ON "listening_governance_ledger" ("correlation_id");
CREATE INDEX IF NOT EXISTS "listening_governance_ledger_created_idx"
  ON "listening_governance_ledger" ("created_at");

CREATE TABLE IF NOT EXISTS "listening_governance_review_report" (
  "id" varchar PRIMARY KEY NOT NULL,
  "window_from" timestamp with time zone NOT NULL,
  "window_to" timestamp with time zone NOT NULL,
  "kpis" jsonb NOT NULL,
  "integrity" jsonb NOT NULL,
  "action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rollout_blocked" boolean DEFAULT false NOT NULL,
  "generated_by" varchar(128) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "listening_governance_review_window_idx"
  ON "listening_governance_review_report" ("window_from","window_to");
CREATE INDEX IF NOT EXISTS "listening_governance_review_blocked_idx"
  ON "listening_governance_review_report" ("rollout_blocked");
CREATE INDEX IF NOT EXISTS "listening_governance_review_created_idx"
  ON "listening_governance_review_report" ("created_at");

CREATE OR REPLACE FUNCTION listening_governance_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'listening_governance_ledger is append-only';
END;
$$;

DROP TRIGGER IF EXISTS listening_governance_ledger_no_update
  ON listening_governance_ledger;
CREATE TRIGGER listening_governance_ledger_no_update
BEFORE UPDATE ON listening_governance_ledger
FOR EACH ROW
EXECUTE FUNCTION listening_governance_ledger_immutable();

DROP TRIGGER IF EXISTS listening_governance_ledger_no_delete
  ON listening_governance_ledger;
CREATE TRIGGER listening_governance_ledger_no_delete
BEFORE DELETE ON listening_governance_ledger
FOR EACH ROW
EXECUTE FUNCTION listening_governance_ledger_immutable();
