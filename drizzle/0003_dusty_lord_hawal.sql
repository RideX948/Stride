CREATE TYPE "public"."sos_status" AS ENUM('active', 'acknowledged', 'resolved', 'false_alarm');--> statement-breakpoint
CREATE TABLE "sos_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"triggeredBy" "user_type" NOT NULL,
	"rideId" integer,
	"latitude" real,
	"longitude" real,
	"message" text,
	"status" "sos_status" DEFAULT 'active' NOT NULL,
	"resolvedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
