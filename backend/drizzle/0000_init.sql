CREATE TYPE "public"."registration_status" AS ENUM('confirmed', 'waitlisted', 'cancelled');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_capacity_positive" CHECK ("events"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"email" text NOT NULL,
	"status" "registration_status" NOT NULL,
	"seq" bigserial NOT NULL,
	"ticket_code" text,
	"manage_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	CONSTRAINT "registrations_ticket_only_when_confirmed" CHECK (("registrations"."status" = 'confirmed') = ("registrations"."ticket_code" is not null) or "registrations"."status" = 'cancelled')
);
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_event_email_active" ON "registrations" USING btree ("event_id","email") WHERE "registrations"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_ticket_code" ON "registrations" USING btree ("ticket_code");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_manage_token" ON "registrations" USING btree ("manage_token");--> statement-breakpoint
CREATE INDEX "registrations_event_status_seq" ON "registrations" USING btree ("event_id","status","seq");