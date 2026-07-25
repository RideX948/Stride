CREATE TYPE "public"."cancelled_by" AS ENUM('passenger', 'driver', 'system');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('fixed', 'percent');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'wallet', 'mobile_money', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payment_method_type" AS ENUM('card', 'mobile_money', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'completed', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('bank_transfer', 'instant', 'mobile_money');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."rater_type" AS ENUM('passenger', 'driver');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('searching', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled', 'no_driver_found');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."txn_type" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('passenger', 'driver');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('economy', 'comfort', 'premium');--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"avatarUrl" text,
	"licenseNumber" varchar(50),
	"licenseExpiry" timestamp,
	"rating" numeric(3, 2) DEFAULT '5.00',
	"totalTrips" integer DEFAULT 0 NOT NULL,
	"isOnline" boolean DEFAULT false NOT NULL,
	"isVerified" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"vehicleModel" varchar(100),
	"vehiclePlate" varchar(20),
	"vehicleColor" varchar(50),
	"vehicleYear" integer,
	"vehicleType" "vehicle_type" DEFAULT 'economy',
	"currentLat" real,
	"currentLng" real,
	"lastLocationAt" timestamp,
	"acceptanceRate" numeric(5, 2) DEFAULT '100.00',
	"completionRate" numeric(5, 2) DEFAULT '100.00',
	"walletBalance" numeric(10, 2) DEFAULT '0.00',
	"totalEarnings" numeric(12, 2) DEFAULT '0.00',
	"onlineSince" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"driverId" integer NOT NULL,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"endedAt" timestamp,
	"totalOnlineMin" integer DEFAULT 0 NOT NULL,
	"tripsCompleted" integer DEFAULT 0 NOT NULL,
	"earningsGross" numeric(10, 2) DEFAULT '0.00'
);
--> statement-breakpoint
CREATE TABLE "earnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"driverId" integer NOT NULL,
	"rideId" integer NOT NULL,
	"grossAmount" numeric(10, 2) NOT NULL,
	"commission" numeric(10, 2) NOT NULL,
	"commissionRate" numeric(5, 2) DEFAULT '20.00',
	"netAmount" numeric(10, 2) NOT NULL,
	"bonusAmount" numeric(10, 2) DEFAULT '0.00',
	"surgeBonus" numeric(10, 2) DEFAULT '0.00',
	"earnedAt" timestamp DEFAULT now() NOT NULL,
	"isPaid" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"data" text,
	"isRead" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passenger_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"avatarUrl" text,
	"rating" numeric(3, 2) DEFAULT '5.00',
	"totalRides" integer DEFAULT 0 NOT NULL,
	"walletBalance" numeric(10, 2) DEFAULT '0.00',
	"homeAddress" text,
	"homeLat" real,
	"homeLng" real,
	"workAddress" text,
	"workLat" real,
	"workLng" real,
	"preferredPaymentMethodId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"type" "payment_method_type" NOT NULL,
	"label" varchar(100) NOT NULL,
	"last4" varchar(4),
	"network" varchar(30),
	"isDefault" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"providerRef" varchar(100),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"rideId" integer NOT NULL,
	"userId" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"reference" varchar(100),
	"providerRef" varchar(100),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"driverId" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"method" "payout_method" NOT NULL,
	"accountNumber" varchar(20),
	"accountName" varchar(100),
	"accountLast4" varchar(4),
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"reference" varchar(100),
	"failureReason" text,
	"processedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_code_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"promoCodeId" integer NOT NULL,
	"userId" integer NOT NULL,
	"rideId" integer NOT NULL,
	"discountApplied" numeric(10, 2) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"description" text,
	"discountType" "discount_type" NOT NULL,
	"discountValue" numeric(10, 2) NOT NULL,
	"maxDiscount" numeric(10, 2),
	"minFare" numeric(10, 2) DEFAULT '0.00',
	"usageLimit" integer,
	"usageCount" integer DEFAULT 0 NOT NULL,
	"perUserLimit" integer DEFAULT 1,
	"isActive" boolean DEFAULT true NOT NULL,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"rideId" integer NOT NULL,
	"raterId" integer NOT NULL,
	"rateeId" integer NOT NULL,
	"raterType" "rater_type" NOT NULL,
	"score" integer NOT NULL,
	"comment" text,
	"tags" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"rideId" integer NOT NULL,
	"status" varchar(30) NOT NULL,
	"changedAt" timestamp DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" serial PRIMARY KEY NOT NULL,
	"passengerId" integer NOT NULL,
	"driverId" integer,
	"status" "ride_status" DEFAULT 'searching' NOT NULL,
	"rideType" "vehicle_type" NOT NULL,
	"pickupAddress" text NOT NULL,
	"pickupLat" real NOT NULL,
	"pickupLng" real NOT NULL,
	"destinationAddress" text NOT NULL,
	"destinationLat" real NOT NULL,
	"destinationLng" real NOT NULL,
	"estimatedFare" numeric(10, 2),
	"actualFare" numeric(10, 2),
	"baseFare" numeric(10, 2),
	"distanceFare" numeric(10, 2),
	"timeFare" numeric(10, 2),
	"surgeMultiplier" numeric(4, 2) DEFAULT '1.00',
	"distanceKm" numeric(8, 2),
	"durationMin" integer,
	"promoCode" varchar(20),
	"discount" numeric(10, 2) DEFAULT '0.00',
	"paymentMethod" "payment_method" DEFAULT 'mobile_money',
	"cancelledBy" "cancelled_by",
	"cancelReason" text,
	"requestedAt" timestamp DEFAULT now() NOT NULL,
	"acceptedAt" timestamp,
	"arrivedAt" timestamp,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"cancelledAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_places" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"label" varchar(50) NOT NULL,
	"address" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"icon" varchar(30) DEFAULT 'place',
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"rideId" integer,
	"category" varchar(50) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'medium' NOT NULL,
	"resolvedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"phone" varchar(20),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"loginMethod" varchar(32) DEFAULT 'oauth',
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"userType" "user_type" NOT NULL,
	"type" "txn_type" NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"balanceAfter" numeric(10, 2) NOT NULL,
	"description" varchar(255) NOT NULL,
	"referenceType" varchar(30),
	"referenceId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
