CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_plans" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"full_name" varchar NOT NULL,
	"phone_number" varchar,
	"target_band_score" numeric(3, 1) NOT NULL,
	"test_date" timestamp,
	"not_decided" varchar(5) DEFAULT 'false' NOT NULL,
	"skill_ratings" jsonb NOT NULL,
	"immigration_goal" varchar NOT NULL,
	"study_preferences" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_progress_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"score" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_progress" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"weekly_plan_id" varchar NOT NULL,
	"week_number" integer NOT NULL,
	"day_number" integer NOT NULL,
	"task_title" varchar NOT NULL,
	"skill" varchar(20) DEFAULT 'listening' NOT NULL,
	"status" varchar(20) DEFAULT 'not-started' NOT NULL,
	"progress_data" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"script_text" text,
	"audio_url" varchar,
	"questions" jsonb,
	"accent" varchar(20) DEFAULT 'British',
	"duration" integer DEFAULT 0,
	"replay_limit" integer DEFAULT 3,
	"script_type" varchar(20),
	"difficulty" varchar(20),
	"ielts_part" integer,
	"topic_domain" varchar(100),
	"context_label" varchar(100),
	"scenario_overview" text,
	"estimated_duration_sec" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY NOT NULL,
	"username" varchar NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"bio" text,
	"profile_image_url" varchar,
	"google_id" varchar,
	"firebase_uid" varchar,
	"onboarding_completed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid")
);
--> statement-breakpoint
CREATE TABLE "weekly_study_plans" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"week_number" integer NOT NULL,
	"skill_focus" varchar NOT NULL,
	"week_focus" text,
	"plan_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_task_progress_id_task_progress_id_fk" FOREIGN KEY ("task_progress_id") REFERENCES "public"."task_progress"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_progress" ADD CONSTRAINT "task_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_progress" ADD CONSTRAINT "task_progress_weekly_plan_id_weekly_study_plans_id_fk" FOREIGN KEY ("weekly_plan_id") REFERENCES "public"."weekly_study_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_study_plans" ADD CONSTRAINT "weekly_study_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "task_attempts_task_idx" ON "task_attempts" USING btree ("task_progress_id");--> statement-breakpoint
CREATE INDEX "task_attempts_user_idx" ON "task_attempts" USING btree ("user_id");