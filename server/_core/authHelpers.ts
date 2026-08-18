import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context";
import * as db from "../db";

type AuthUser = NonNullable<TrpcContext["user"]>;

export function requireAuthUser(ctx: TrpcContext): AuthUser {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return ctx.user;
}

export async function requireDriverProfile(userId: number) {
  const profile = await db.getOrCreateDriverProfile(userId);
  if (!profile) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Driver profile unavailable" });
  }
  return profile;
}

/**
 * Resolve the caller's role on a ride, or null if they're not a party to it.
 * rides.driverId stores driverProfiles.id — map via the profile to compare
 * against users.id.
 */
export async function getRideRole(
  ride: { passengerId: number; driverId: number | null },
  userId: number,
): Promise<"passenger" | "driver" | null> {
  if (ride.passengerId === userId) return "passenger";
  if (ride.driverId != null) {
    const driver = await db.getDriverPublicById(ride.driverId);
    if (driver?.userId === userId) return "driver";
  }
  return null;
}

export async function assertRideParticipant(rideId: number, userId: number) {
  const ride = await db.getRideById(rideId);
  if (!ride) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Ride not found" });
  }
  const role = await getRideRole(ride, userId);
  if (!role) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not part of this ride" });
  }
  return { ride, role };
}

export async function assertRideDriver(rideId: number, userId: number) {
  const { ride, role } = await assertRideParticipant(rideId, userId);
  if (role !== "driver") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the assigned driver can do this" });
  }
  return ride;
}

/** Allow unverified drivers in dev/demo; block in production unless opted in. */
export function assertDriverCanGoOnline(isVerified: boolean) {
  const autoVerify =
    process.env.AUTO_VERIFY_DRIVERS === "true" || process.env.NODE_ENV !== "production";
  if (!isVerified && !autoVerify) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your driver account is pending verification. Contact support to go online.",
    });
  }
}

export async function assertCanViewDriverPublic(driverProfileId: number, userId: number) {
  const profile = await db.getOrCreateDriverProfile(userId);
  if (profile?.id === driverProfileId) return;

  const activePassenger = await db.getActiveRideForPassenger(userId);
  if (activePassenger?.driverId === driverProfileId) return;

  if (await db.passengerHasRideWithDriver(userId, driverProfileId)) return;

  throw new TRPCError({ code: "FORBIDDEN", message: "Cannot view this driver" });
}

export async function assertNotificationOwner(notificationId: number, userId: number) {
  const dbConn = await db.getDb();
  if (!dbConn) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }
  const { notifications } = await import("../../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");
  const rows = await dbConn
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Notification not found" });
  }
}

export async function assertOwnDriverProfile(driverProfileId: number, userId: number) {
  const profile = await requireDriverProfile(userId);
  if (profile.id !== driverProfileId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not your driver profile" });
  }
  return profile;
}
