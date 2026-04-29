CREATE TYPE "public"."model_tier" AS ENUM('flash', 'pro');--> statement-breakpoint
CREATE TYPE "public"."photo_status" AS ENUM('queued', 'classifying', 'matched', 'staging', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "pinterest_board" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"pin_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ingesting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pinterest_pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"original_url" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_board" (
	"run_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	CONSTRAINT "run_board_run_id_board_id_pk" PRIMARY KEY("run_id","board_id")
);
--> statement-breakpoint
CREATE TABLE "run_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"input_url" text NOT NULL,
	"classified_theme" text,
	"classification_confidence" real,
	"matched_board_id" uuid,
	"match_confidence" real,
	"output_url" text,
	"status" "photo_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"zillow_url" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"model_tier" "model_tier" DEFAULT 'flash' NOT NULL,
	"workflow_run_id" text,
	"photo_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinterest_board" ADD CONSTRAINT "pinterest_board_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinterest_pin" ADD CONSTRAINT "pinterest_pin_board_id_pinterest_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."pinterest_board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_board" ADD CONSTRAINT "run_board_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_board" ADD CONSTRAINT "run_board_board_id_pinterest_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."pinterest_board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_photo" ADD CONSTRAINT "run_photo_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_photo" ADD CONSTRAINT "run_photo_matched_board_id_pinterest_board_id_fk" FOREIGN KEY ("matched_board_id") REFERENCES "public"."pinterest_board"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pinterest_board_user_idx" ON "pinterest_board" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pinterest_board_user_url_idx" ON "pinterest_board" USING btree ("user_id","url");--> statement-breakpoint
CREATE INDEX "pinterest_pin_board_idx" ON "pinterest_pin" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "run_photo_run_idx" ON "run_photo" USING btree ("run_id","index");--> statement-breakpoint
CREATE INDEX "run_user_status_idx" ON "run" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "run_user_created_idx" ON "run" USING btree ("user_id","created_at");