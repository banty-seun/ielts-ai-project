CREATE TABLE IF NOT EXISTS "listening_event_outbox" (
  "id" varchar PRIMARY KEY NOT NULL,
  "task_progress_id" varchar NOT NULL REFERENCES "task_progress"("id"),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "topic" varchar(64) NOT NULL,
  "event_type" varchar(128) NOT NULL,
  "event_version" varchar(32) NOT NULL,
  "event_id" varchar(128) NOT NULL,
  "envelope" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "listening_event_outbox_task_idx"
  ON "listening_event_outbox" ("task_progress_id");

CREATE INDEX IF NOT EXISTS "listening_event_outbox_event_type_idx"
  ON "listening_event_outbox" ("event_type");

CREATE INDEX IF NOT EXISTS "listening_event_outbox_created_idx"
  ON "listening_event_outbox" ("created_at");
