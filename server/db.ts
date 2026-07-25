import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  driverProfiles,
  driverSessions,
  earnings,
  InsertUser,
  notifications,
  otpCodes,
  passengerProfiles,
  paymentMethods,
  payments,
  payouts,
  promoCodeUsage,
  promoCodes,
  ratings,
  rideStatusHistory,
  rides,
  savedPlaces,
  sosAlerts,
  supportTickets,
  users,
  walletTransactions,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // prepare: false is required for Supabase's transaction pooler (pgbouncer)
      const client = postgres(process.env.DATABASE_URL, { prepare: false });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "phone", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    (values as unknown as Record<string, unknown>)[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByPhone(phone: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  return result[0];
}

/** Persist which side of the marketplace the user chose. */
export async function setUserAppRole(userId: number, appRole: "passenger" | "driver") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ appRole }).where(eq(users.id, userId));
}

// ─── OTP (phone login) ────────────────────────────────────────────────────────

/** Max OTPs a phone may request within the rate window. */
const OTP_RATE_LIMIT = 5;
const OTP_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 min

export async function countRecentOtps(phone: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const windowStart = new Date(Date.now() - OTP_RATE_WINDOW_MS);
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), gte(otpCodes.createdAt, windowStart)));
  return { count: result[0]?.count ?? 0, limit: OTP_RATE_LIMIT };
}

export async function createOtp(phone: string, codeHash: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Invalidate any previous unused codes for this phone
  await db.update(otpCodes).set({ isUsed: true })
    .where(and(eq(otpCodes.phone, phone), eq(otpCodes.isUsed, false)));
  await db.insert(otpCodes).values({ phone, codeHash, expiresAt });
}

export async function getActiveOtp(phone: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select().from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), eq(otpCodes.isUsed, false), gte(otpCodes.expiresAt, new Date())))
    .orderBy(desc(otpCodes.createdAt)).limit(1);
  return result[0] ?? null;
}

export async function incrementOtpAttempts(otpId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` }).where(eq(otpCodes.id, otpId));
}

export async function consumeOtp(otpId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(otpCodes).set({ isUsed: true }).where(eq(otpCodes.id, otpId));
}

// ─── Passenger Profiles ───────────────────────────────────────────────────────

export async function getOrCreatePassengerProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const existing = await db.select().from(passengerProfiles).where(eq(passengerProfiles.userId, userId)).limit(1);
  if (existing[0]) return existing[0];
  await db.insert(passengerProfiles).values({ userId });
  const created = await db.select().from(passengerProfiles).where(eq(passengerProfiles.userId, userId)).limit(1);
  return created[0] ?? null;
}

export async function updatePassengerProfile(userId: number, data: Partial<typeof passengerProfiles.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(passengerProfiles).set(data).where(eq(passengerProfiles.userId, userId));
}

export async function getPassengerWallet(userId: number) {
  const db = await getDb();
  if (!db) return { balance: "0.00", transactions: [] };
  const profile = await db.select({ walletBalance: passengerProfiles.walletBalance })
    .from(passengerProfiles).where(eq(passengerProfiles.userId, userId)).limit(1);
  const txns = await db.select().from(walletTransactions)
    .where(and(eq(walletTransactions.userId, userId), eq(walletTransactions.userType, "passenger")))
    .orderBy(desc(walletTransactions.createdAt)).limit(20);
  return { balance: profile[0]?.walletBalance ?? "0.00", transactions: txns };
}

export async function topUpPassengerWallet(userId: number, amount: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const profile = await getOrCreatePassengerProfile(userId);
  const currentBalance = parseFloat(profile?.walletBalance ?? "0");
  const newBalance = (currentBalance + amount).toFixed(2);
  await db.update(passengerProfiles).set({ walletBalance: newBalance }).where(eq(passengerProfiles.userId, userId));
  await db.insert(walletTransactions).values({
    userId, userType: "passenger", type: "credit",
    amount: amount.toFixed(2), balanceAfter: newBalance,
    description: "Wallet top-up", referenceType: "topup",
  });
  return { newBalance };
}

// ─── Driver Profiles ──────────────────────────────────────────────────────────

export async function getOrCreateDriverProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const existing = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, userId)).limit(1);
  if (existing[0]) return existing[0];
  await db.insert(driverProfiles).values({ userId });
  const created = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, userId)).limit(1);
  return created[0] ?? null;
}

export async function updateDriverProfile(userId: number, data: Partial<typeof driverProfiles.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(driverProfiles).set(data).where(eq(driverProfiles.userId, userId));
}

/**
 * Public driver card for passengers: profile (by driverProfiles.id, which is
 * what rides.driverId stores) joined with the user's display name.
 */
export async function getDriverPublicById(driverProfileId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({
      id: driverProfiles.id,
      userId: driverProfiles.userId,
      name: users.name,
      phone: users.phone,
      avatarUrl: driverProfiles.avatarUrl,
      rating: driverProfiles.rating,
      totalTrips: driverProfiles.totalTrips,
      vehicleModel: driverProfiles.vehicleModel,
      vehiclePlate: driverProfiles.vehiclePlate,
      vehicleColor: driverProfiles.vehicleColor,
      isVerified: driverProfiles.isVerified,
      currentLat: driverProfiles.currentLat,
      currentLng: driverProfiles.currentLng,
    })
    .from(driverProfiles)
    .innerJoin(users, eq(users.id, driverProfiles.userId))
    .where(eq(driverProfiles.id, driverProfileId))
    .limit(1);
  return result[0] ?? null;
}

export async function updateDriverLocation(driverId: number, lat: number, lng: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(driverProfiles).set({ currentLat: lat, currentLng: lng, lastLocationAt: new Date() })
    .where(eq(driverProfiles.id, driverId));
}

export async function toggleDriverOnline(driverId: number, isOnline: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (isOnline) {
    await db.update(driverProfiles).set({ isOnline: true, onlineSince: new Date() }).where(eq(driverProfiles.id, driverId));
    await db.insert(driverSessions).values({ driverId, startedAt: new Date() });
  } else {
    await db.update(driverProfiles).set({ isOnline: false, onlineSince: null }).where(eq(driverProfiles.id, driverId));
    const openSession = await db.select().from(driverSessions)
      .where(and(eq(driverSessions.driverId, driverId), sql`${driverSessions.endedAt} IS NULL`))
      .orderBy(desc(driverSessions.startedAt)).limit(1);
    if (openSession[0]) {
      const mins = Math.floor((Date.now() - openSession[0].startedAt.getTime()) / 60000);
      await db.update(driverSessions).set({ endedAt: new Date(), totalOnlineMin: mins }).where(eq(driverSessions.id, openSession[0].id));
    }
  }
}

export async function findNearestAvailableDriver(rideType: string, pickupLat: number, pickupLng: number) {
  const db = await getDb();
  if (!db) return null;
  const drivers = await db.select().from(driverProfiles)
    .where(and(
      eq(driverProfiles.isOnline, true),
      eq(driverProfiles.isActive, true),
      eq(driverProfiles.isVerified, true),
      eq(driverProfiles.vehicleType, rideType as "economy" | "comfort" | "premium"),
      sql`${driverProfiles.currentLat} IS NOT NULL`,
    )).limit(20);
  if (!drivers.length) return null;
  // Find closest by Haversine approximation
  let closest = drivers[0];
  let minDist = Infinity;
  for (const d of drivers) {
    if (!d.currentLat || !d.currentLng) continue;
    const dlat = (d.currentLat - pickupLat) * 111;
    const dlng = (d.currentLng - pickupLng) * 111 * Math.cos(pickupLat * Math.PI / 180);
    const dist = Math.sqrt(dlat * dlat + dlng * dlng);
    if (dist < minDist) { minDist = dist; closest = d; }
  }
  return minDist < 15 ? closest : null; // within 15 km
}

/**
 * Online drivers near a point (~radiusKm), with their positions so clients
 * can both show a count and draw them on the map.
 */
export async function getNearbyOnlineDrivers(lat: number, lng: number, radiusKm = 15) {
  const db = await getDb();
  if (!db) return [];
  const drivers = await db
    .select({
      id: driverProfiles.id,
      currentLat: driverProfiles.currentLat,
      currentLng: driverProfiles.currentLng,
      vehicleType: driverProfiles.vehicleType,
    })
    .from(driverProfiles)
    .where(and(
      eq(driverProfiles.isOnline, true),
      eq(driverProfiles.isActive, true),
      sql`${driverProfiles.currentLat} IS NOT NULL`,
    ))
    .limit(50);
  return drivers.filter((d) => {
    if (d.currentLat == null || d.currentLng == null) return false;
    const dlat = (d.currentLat - lat) * 111;
    const dlng = (d.currentLng - lng) * 111 * Math.cos((lat * Math.PI) / 180);
    return Math.sqrt(dlat * dlat + dlng * dlng) <= radiusKm;
  });
}

// ─── Fare Calculation ─────────────────────────────────────────────────────────

export function calculateFare(rideType: string, distanceKm: number, durationMin: number, surgeMultiplier = 1.0) {
  const rates: Record<string, { base: number; perKm: number; perMin: number }> = {
    economy:  { base: 5.00, perKm: 1.50, perMin: 0.20 },
    comfort:  { base: 8.00, perKm: 2.20, perMin: 0.30 },
    premium:  { base: 15.00, perKm: 3.50, perMin: 0.45 },
  };
  const rate = rates[rideType] ?? rates.economy;
  const baseFare = rate.base;
  const distanceFare = distanceKm * rate.perKm;
  const timeFare = durationMin * rate.perMin;
  const subtotal = (baseFare + distanceFare + timeFare) * surgeMultiplier;
  return {
    baseFare: baseFare.toFixed(2),
    distanceFare: distanceFare.toFixed(2),
    timeFare: timeFare.toFixed(2),
    estimatedFare: subtotal.toFixed(2),
    surgeMultiplier: surgeMultiplier.toFixed(2),
  };
}

/**
 * Demand-based surge multiplier for a ride tier: compares riders currently
 * waiting (status "searching") against online drivers of that tier. More
 * demand than supply → price nudges up. Clamped to 1.0–2.0 and rounded to
 * the nearest 0.1 so it reads cleanly ("1.3x").
 */
export async function computeSurge(rideType: string): Promise<number> {
  const db = await getDb();
  if (!db) return 1.0;
  const [waitingRows, driverRows] = await Promise.all([
    db.select({ id: rides.id }).from(rides)
      .where(and(eq(rides.status, "searching"), eq(rides.rideType, rideType as "economy" | "comfort" | "premium"))),
    db.select({ id: driverProfiles.id }).from(driverProfiles)
      .where(and(
        eq(driverProfiles.isOnline, true),
        eq(driverProfiles.isActive, true),
        eq(driverProfiles.vehicleType, rideType as "economy" | "comfort" | "premium"),
      )),
  ]);
  const waiting = waitingRows.length;
  const drivers = driverRows.length;
  // No waiting riders, or plenty of idle drivers → no surge
  if (waiting === 0 || drivers === 0) return waiting > 0 && drivers === 0 ? 1.5 : 1.0;
  const ratio = waiting / drivers; // demand pressure
  if (ratio <= 1) return 1.0;
  // Each unit of excess demand adds ~0.5x, capped at 2.0
  const raw = 1.0 + (ratio - 1) * 0.5;
  const clamped = Math.min(2.0, Math.max(1.0, raw));
  return Math.round(clamped * 10) / 10;
}

export function estimateDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const durationMin = Math.ceil((distanceKm / 30) * 60); // assume 30 km/h avg
  return { distanceKm: parseFloat(distanceKm.toFixed(2)), durationMin };
}

/**
 * Real road distance/duration via the public OSRM API (no key). Follows actual
 * roads instead of a straight line — a 3km straight hop can be 5km by road.
 * Falls back to the Haversine estimate if OSRM is unreachable or times out, so
 * booking never blocks on a flaky network. `estimated` flags which path ran.
 */
export async function routeDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  try {
    // OSRM expects lng,lat order
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    const route = data?.routes?.[0];
    if (data?.code === "Ok" && route) {
      const distanceKm = parseFloat((route.distance / 1000).toFixed(2)); // meters → km
      const durationMin = Math.max(1, Math.ceil(route.duration / 60)); // seconds → min
      return { distanceKm, durationMin, estimated: false };
    }
  } catch (err) {
    console.warn("[routeDistance] OSRM failed, using Haversine:", (err as Error).message);
  }
  return { ...estimateDistance(lat1, lng1, lat2, lng2), estimated: true };
}

// ─── Rides ────────────────────────────────────────────────────────────────────

export async function createRide(data: typeof rides.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(rides).values(data).returning({ id: rides.id });
  const rideId = result[0].id;
  await db.insert(rideStatusHistory).values({ rideId, status: "searching" });
  return rideId;
}

export async function getRideById(rideId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
  return result[0] ?? null;
}

export async function updateRideStatus(rideId: number, status: typeof rides.$inferInsert["status"], extra?: Partial<typeof rides.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const timestamps: Partial<typeof rides.$inferInsert> = {};
  if (status === "accepted") timestamps.acceptedAt = new Date();
  if (status === "arriving") timestamps.arrivedAt = new Date();
  if (status === "in_progress") timestamps.startedAt = new Date();
  if (status === "completed") timestamps.completedAt = new Date();
  if (status === "cancelled") timestamps.cancelledAt = new Date();
  await db.update(rides).set({ status, ...timestamps, ...extra }).where(eq(rides.id, rideId));
  await db.insert(rideStatusHistory).values({ rideId, status: status! });
}

export async function acceptRide(rideId: number, driverId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ride = await getRideById(rideId);
  if (!ride || ride.status !== "searching") throw new Error("Ride not available");
  await updateRideStatus(rideId, "accepted", { driverId });
}

export async function completeRide(rideId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ride = await getRideById(rideId);
  if (!ride) throw new Error("Ride not found");
  await updateRideStatus(rideId, "completed");
  // Record earnings for driver
  if (ride.driverId && ride.actualFare) {
    const gross = parseFloat(ride.actualFare);
    const commission = gross * 0.20;
    const net = gross - commission;
    await db.insert(earnings).values({
      driverId: ride.driverId, rideId,
      grossAmount: gross.toFixed(2), commission: commission.toFixed(2), netAmount: net.toFixed(2),
    });
    // Credit driver wallet
    const driver = await db.select().from(driverProfiles).where(eq(driverProfiles.id, ride.driverId)).limit(1);
    if (driver[0]) {
      const newBal = (parseFloat(driver[0].walletBalance ?? "0") + net).toFixed(2);
      await db.update(driverProfiles).set({ walletBalance: newBal, totalTrips: sql`${driverProfiles.totalTrips} + 1`, totalEarnings: sql`${driverProfiles.totalEarnings} + ${net}` }).where(eq(driverProfiles.id, ride.driverId));
      await db.insert(walletTransactions).values({ userId: ride.driverId, userType: "driver", type: "credit", amount: net.toFixed(2), balanceAfter: newBal, description: `Ride #${rideId} earnings`, referenceType: "ride", referenceId: rideId });
    }
  }
  // Update passenger ride count
  if (ride.passengerId) {
    await db.update(passengerProfiles).set({ totalRides: sql`${passengerProfiles.totalRides} + 1` }).where(eq(passengerProfiles.userId, ride.passengerId));
  }
  return ride;
}

export async function getPassengerRideHistory(passengerId: number, limit = 20, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rides)
    .where(and(eq(rides.passengerId, passengerId), or(eq(rides.status, "completed"), eq(rides.status, "cancelled"))))
    .orderBy(desc(rides.createdAt)).limit(limit).offset(offset);
}

export async function getDriverRideHistory(driverId: number, limit = 20, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rides)
    .where(and(eq(rides.driverId, driverId), or(eq(rides.status, "completed"), eq(rides.status, "cancelled"))))
    .orderBy(desc(rides.createdAt)).limit(limit).offset(offset);
}

export async function getActiveRideForPassenger(passengerId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(rides)
    .where(and(eq(rides.passengerId, passengerId), or(eq(rides.status, "searching"), eq(rides.status, "accepted"), eq(rides.status, "arriving"), eq(rides.status, "in_progress"))))
    .orderBy(desc(rides.createdAt)).limit(1);
  return result[0] ?? null;
}

export async function getActiveRideForDriver(driverId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(rides)
    .where(and(eq(rides.driverId, driverId), or(eq(rides.status, "accepted"), eq(rides.status, "arriving"), eq(rides.status, "in_progress"))))
    .orderBy(desc(rides.createdAt)).limit(1);
  return result[0] ?? null;
}

export async function getPendingRidesForDriver(rideType?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = rideType
    ? and(eq(rides.status, "searching"), eq(rides.rideType, rideType as "economy" | "comfort" | "premium"))
    : eq(rides.status, "searching");
  return db.select().from(rides)
    .where(conditions)
    .orderBy(rides.requestedAt).limit(5);
}

/** Pickup points of all currently-searching rides — the real demand map. */
export async function getDemandPoints() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: rides.id,
      lat: rides.pickupLat,
      lng: rides.pickupLng,
      rideType: rides.rideType,
    })
    .from(rides)
    .where(eq(rides.status, "searching"))
    .limit(50);
}

// ─── Ratings ──────────────────────────────────────────────────────────────────

export async function submitRating(data: typeof ratings.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(ratings).values(data);
  // Recalculate ratee average
  const allRatings = await db.select({ score: ratings.score }).from(ratings).where(eq(ratings.rateeId, data.rateeId));
  const avg = allRatings.reduce((s, r) => s + r.score, 0) / allRatings.length;
  const avgStr = avg.toFixed(2);
  if (data.raterType === "passenger") {
    await db.update(driverProfiles).set({ rating: avgStr }).where(eq(driverProfiles.userId, data.rateeId));
  } else {
    await db.update(passengerProfiles).set({ rating: avgStr }).where(eq(passengerProfiles.userId, data.rateeId));
  }
}

export async function getRideRatings(rideId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(ratings).where(eq(ratings.rideId, rideId));
}

// ─── Earnings ─────────────────────────────────────────────────────────────────

export async function getDriverEarningsSummary(driverId: number, period: "today" | "week" | "month") {
  const db = await getDb();
  if (!db) return { total: "0.00", tripsCount: 0, earnings: [] };
  const now = new Date();
  let fromDate = new Date();
  if (period === "today") fromDate.setHours(0, 0, 0, 0);
  else if (period === "week") fromDate.setDate(now.getDate() - 7);
  else fromDate.setMonth(now.getMonth() - 1);

  const data = await db.select().from(earnings)
    .where(and(eq(earnings.driverId, driverId), gte(earnings.earnedAt, fromDate)))
    .orderBy(desc(earnings.earnedAt));
  const total = data.reduce((s, e) => s + parseFloat(e.netAmount), 0);
  return { total: total.toFixed(2), tripsCount: data.length, earnings: data };
}

export async function getDriverPayoutHistory(driverId: number, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payouts).where(eq(payouts.driverId, driverId)).orderBy(desc(payouts.createdAt)).limit(limit);
}

export async function requestPayout(driverId: number, amount: number, method: "bank_transfer" | "instant" | "mobile_money", accountLast4?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const driver = await db.select().from(driverProfiles).where(eq(driverProfiles.id, driverId)).limit(1);
  if (!driver[0]) throw new Error("Driver not found");
  const balance = parseFloat(driver[0].walletBalance ?? "0");
  if (amount > balance) throw new Error("Insufficient balance");
  const newBal = (balance - amount).toFixed(2);
  await db.update(driverProfiles).set({ walletBalance: newBal }).where(eq(driverProfiles.id, driverId));
  await db.insert(payouts).values({ driverId, amount: amount.toFixed(2), method, accountLast4, status: "pending" });
  await db.insert(walletTransactions).values({ userId: driverId, userType: "driver", type: "debit", amount: amount.toFixed(2), balanceAfter: newBal, description: "Payout request", referenceType: "payout" });
  return { newBalance: newBal };
}

// ─── Promo Codes ──────────────────────────────────────────────────────────────

export async function validatePromoCode(code: string, userId: number, fare: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const promo = await db.select().from(promoCodes).where(and(eq(promoCodes.code, code.toUpperCase()), eq(promoCodes.isActive, true))).limit(1);
  if (!promo[0]) throw new Error("Invalid promo code");
  const p = promo[0];
  if (p.expiresAt && p.expiresAt < new Date()) throw new Error("Promo code has expired");
  if (p.usageLimit && p.usageCount >= p.usageLimit) throw new Error("Promo code usage limit reached");
  if (p.minFare && fare < parseFloat(p.minFare)) throw new Error(`Minimum fare of GH₵${p.minFare} required`);
  const userUsage = await db.select().from(promoCodeUsage).where(and(eq(promoCodeUsage.promoCodeId, p.id), eq(promoCodeUsage.userId, userId)));
  if (p.perUserLimit && userUsage.length >= p.perUserLimit) throw new Error("You have already used this promo code");
  let discount = p.discountType === "percent" ? fare * parseFloat(p.discountValue) / 100 : parseFloat(p.discountValue);
  if (p.maxDiscount) discount = Math.min(discount, parseFloat(p.maxDiscount));
  return { valid: true, discount: discount.toFixed(2), promoId: p.id };
}

// ─── Saved Places ─────────────────────────────────────────────────────────────

export async function getSavedPlaces(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(savedPlaces).where(eq(savedPlaces.userId, userId)).orderBy(savedPlaces.createdAt);
}

export async function addSavedPlace(data: typeof savedPlaces.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(savedPlaces).values(data);
}

export async function deleteSavedPlace(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(savedPlaces).where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, userId)));
}

// ─── Payment Methods ──────────────────────────────────────────────────────────

export async function getPaymentMethods(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(paymentMethods).where(and(eq(paymentMethods.userId, userId), eq(paymentMethods.isActive, true))).orderBy(desc(paymentMethods.isDefault));
}

export async function addPaymentMethod(data: typeof paymentMethods.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.isDefault) {
    await db.update(paymentMethods).set({ isDefault: false }).where(eq(paymentMethods.userId, data.userId));
  }
  await db.insert(paymentMethods).values(data);
}

export async function deletePaymentMethod(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(paymentMethods).set({ isActive: false }).where(and(eq(paymentMethods.id, id), eq(paymentMethods.userId, userId)));
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function createNotification(data: typeof notifications.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notifications).values(data);
}

export async function getUserNotifications(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function markNotificationRead(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
}

export async function markAllNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return result[0]?.count ?? 0;
}

// ─── Support ──────────────────────────────────────────────────────────────────

export async function createSupportTicket(data: typeof supportTickets.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(supportTickets).values(data).returning({ id: supportTickets.id });
  return result[0].id;
}

export async function getUserSupportTickets(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).orderBy(desc(supportTickets.createdAt));
}

// ─── SOS Alerts ───────────────────────────────────────────────────────────────

export async function createSosAlert(data: typeof sosAlerts.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(sosAlerts).values(data).returning({ id: sosAlerts.id });
  return result[0].id;
}

export async function getActiveSosForUser(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(sosAlerts)
    .where(and(eq(sosAlerts.userId, userId), or(eq(sosAlerts.status, "active"), eq(sosAlerts.status, "acknowledged"))))
    .orderBy(desc(sosAlerts.createdAt)).limit(1);
  return result[0] ?? null;
}

export async function getActiveSosForRide(rideId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sosAlerts)
    .where(and(eq(sosAlerts.rideId, rideId), or(eq(sosAlerts.status, "active"), eq(sosAlerts.status, "acknowledged"))))
    .orderBy(desc(sosAlerts.createdAt));
}

export async function resolveSosAlert(id: number, userId: number, status: "resolved" | "false_alarm") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sosAlerts)
    .set({ status, resolvedAt: new Date() })
    .where(and(eq(sosAlerts.id, id), eq(sosAlerts.userId, userId)));
}
