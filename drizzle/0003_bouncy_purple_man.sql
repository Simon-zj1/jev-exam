CREATE TABLE "feedback_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"attempt_id" text,
	"kind" text NOT NULL,
	"note" text,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"model" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "llm_usage_user_id_day_model_pk" PRIMARY KEY("user_id","day","model")
);
--> statement-breakpoint
CREATE INDEX "feedback_reports_user_idx" ON "feedback_reports" USING btree ("user_id","created_at");