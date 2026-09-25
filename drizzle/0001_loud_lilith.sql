CREATE TABLE "review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"material_id" text NOT NULL,
	"topic_key" text NOT NULL,
	"topic_title" text NOT NULL,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"last_score_percent" integer,
	"last_rating" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"rating" integer NOT NULL,
	"score_percent" integer NOT NULL,
	"stability_before" double precision NOT NULL,
	"difficulty_before" double precision NOT NULL,
	"stability_after" double precision NOT NULL,
	"difficulty_after" double precision NOT NULL,
	"elapsed_days" double precision NOT NULL,
	"scheduled_days" double precision NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_user_question_unique" ON "review_items" USING btree ("user_id","question_id");--> statement-breakpoint
CREATE INDEX "review_items_due_idx" ON "review_items" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "review_logs_user_idx" ON "review_logs" USING btree ("user_id","reviewed_at");