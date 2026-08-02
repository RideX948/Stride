CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"rideId" integer NOT NULL,
	"senderId" integer NOT NULL,
	"senderRole" "user_type" NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
