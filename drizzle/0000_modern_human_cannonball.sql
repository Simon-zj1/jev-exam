CREATE TABLE "answers" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"question_id" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"score_percent" integer,
	"needs_review_count" integer
);
--> statement-breakpoint
CREATE TABLE "exam_blueprints" (
	"id" text PRIMARY KEY NOT NULL,
	"material_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"topics" jsonb NOT NULL,
	"generator_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_questions" (
	"exam_id" text NOT NULL,
	"question_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "exam_questions_exam_id_question_id_pk" PRIMARY KEY("exam_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"material_id" text NOT NULL,
	"blueprint_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"generator_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judgments" (
	"id" text PRIMARY KEY NOT NULL,
	"answer_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"question_id" text NOT NULL,
	"user_id" text NOT NULL,
	"method" text NOT NULL,
	"score" double precision NOT NULL,
	"score_percent" integer NOT NULL,
	"confidence" double precision NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reasons" jsonb NOT NULL,
	"points" jsonb NOT NULL,
	"penalties" jsonb NOT NULL,
	"score_low" double precision,
	"score_high" double precision,
	"engine_id" text NOT NULL,
	"model" text NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery" (
	"user_id" text NOT NULL,
	"topic_key" text NOT NULL,
	"topic_title" text NOT NULL,
	"value" double precision NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mastery_user_id_topic_key_pk" PRIMARY KEY("user_id","topic_key")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"raw_text" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mistake_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"material_id" text NOT NULL,
	"topic_key" text NOT NULL,
	"topic_title" text NOT NULL,
	"last_score_percent" integer NOT NULL,
	"wrong_count" integer DEFAULT 1 NOT NULL,
	"last_attempt_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"material_id" text NOT NULL,
	"blueprint_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"topic_title" text NOT NULL,
	"type" text NOT NULL,
	"stem" text NOT NULL,
	"options" jsonb,
	"answer_key" jsonb NOT NULL,
	"rubric_points" jsonb,
	"source_anchor" text NOT NULL,
	"difficulty" text NOT NULL,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"kind" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_user_id_day_kind_pk" PRIMARY KEY("user_id","day","kind")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"byok_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "answers_attempt_question_unique" ON "answers" USING btree ("attempt_id","question_id");--> statement-breakpoint
CREATE INDEX "attempts_exam_idx" ON "attempts" USING btree ("exam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_blueprints_material_unique" ON "exam_blueprints" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "exams_user_idx" ON "exams" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "judgments_answer_unique" ON "judgments" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "judgments_attempt_idx" ON "judgments" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "materials_user_idx" ON "materials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mistake_items_user_question_unique" ON "mistake_items" USING btree ("user_id","question_id");--> statement-breakpoint
CREATE INDEX "questions_material_idx" ON "questions" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "questions_blueprint_idx" ON "questions" USING btree ("blueprint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");