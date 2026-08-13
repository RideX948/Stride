import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  driverProfiles,
  driverSessions,
  earnings,
  InsertUser,
  messages,
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
import { realtimeBus } from "./realtime/bus";
import * as aza from "./aza";
import { sendPushNotification } from "./push";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // prepare: false is required for Supabase's transaction pooler (pgbouncer).
      // Flaky networks (mobile hotspots) drop many Postgres handshakes, so:
      //  - connect_timeout: give each attempt more time before giving up
      //  - keep_alive: hold on to a connection once we win one
      //  - fetch_types: false skips an extra startup roundtrip
      const client = postgres(process.env.DATABASE_URL, {
        prepare: false,
        connect_timeout: 10,
        keep_alive: 30,
        idle_timeout: 0,
        fetch_types: false,
      });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/**
 * Retry a DB operation on connection-level failures. On unreliable networks
 * (e.g. phone hotspots) most handshakes are silently dropped but some get
 * through — a few retries turns "always fails" into "usually works".
 */
export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Drizzle wraps the driver error ("Failed query: ...") — the real code
      // (CONNECT_TIMEOUT etc.) lives on err.cause, so check the whole chain.
      const chain: unknown[] = [err];
      let cur = err as { cause?: unknown };
      while (cur?.cause) { chain.push(cur.cause); cur = cur.cause as { cause?: unknown }; }
      const CONN_CODES = ["CONNECT_TIMEOUT", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "ENOTFOUND"];
      const isConnErr = chain.some((e) => {
        const code = (e as { code?: string })?.code ?? "";
        const msg = e instanceof Error ? e.message : String(e);
        return CONN_CODES.some((c) => code === c || msg.includes(c));
      });
      if (!isConnErr || i === attempts - 1) throw err;
      const label = (chain[chain.length - 1] as { code?: string })?.code ?? (err instanceof Error ? err.message : "unknown");
      console.warn(`[Database] Connection attempt ${i + 1}/${attempts} failed (${label}), retrying...`);
    }
  }
  throw lastErr;
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

/**
 * Road-shaped route geometry via OSRM (same public API as routeDistance, but
 * with the full polyline). Falls back to a straight 2-point line so the map
 * always has something to draw. Cached in-memory — roads don't move, and the
 * client polls; keep the public OSRM server out of the hot path.
 */
type RouteGeometry = { coords: { lat: number; lng: number }[]; distanceKm: number; durationMin: number; estimated: boolean };
const routeGeoCache = new Map<string, RouteGeometry>();

export async function routeGeometry(lat1: number, lng1: number, lat2: number, lng2: number): Promise<RouteGeometry> {
  // ~11m key resolution: nearby requests share a cache entry
  const key = [lat1, lng1, lat2, lng2].map((n) => n.toFixed(4)).join(",");
  const cached = routeGeoCache.get(key);
  if (cached) return cached;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    const route = data?.routes?.[0];
    if (data?.code === "Ok" && route?.geometry?.coordinates?.length > 1) {
      const result: RouteGeometry = {
        // GeoJSON is [lng, lat]
        coords: route.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng })),
        distanceKm: parseFloat((route.distance / 1000).toFixed(2)),
        durationMin: Math.max(1, Math.ceil(route.duration / 60)),
        estimated: false,
      };
      if (routeGeoCache.size >= 200) {
        // naive eviction: drop the oldest entry
        const first = routeGeoCache.keys().next().value;
        if (first !== undefined) routeGeoCache.delete(first);
      }
      routeGeoCache.set(key, result);
      return result;
    }
  } catch (err) {
    console.warn("[routeGeometry] OSRM failed, straight-line fallback:", (err as Error).message);
  }
  // Fallback: straight line (what the map drew before) — NOT cached, so a
  // later request retries OSRM once it recovers.
  return {
    coords: [{ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 }],
    ...estimateDistance(lat1, lng1, lat2, lng2),
    estimated: true,
  };
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
  // Atomic conditional update: only one driver can win the searching→accepted
  // transition; a concurrent accept (or the expiry sweeper) sees zero rows.
  const updated = await db.update(rides)
    .set({ status: "accepted", driverId, acceptedAt: new Date() })
    .where(and(eq(rides.id, rideId), eq(rides.status, "searching")))
    .returning({ id: rides.id });
  if (!updated.length) throw new Error("Ride not available");
  await db.insert(rideStatusHistory).values({ rideId, status: "accepted" });
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

/**
 * Expire searching rides older than the cutoff. Atomic per-row: a ride a
 * driver accepts in the same instant is skipped (both sides condition on
 * status='searching'). Returns the expired rides for notification fan-out.
 */
export async function expireStaleSearchingRides(cutoff: Date) {
  const db = await getDb();
  if (!db) return [];
  const expired = await db.update(rides)
    .set({ status: "no_driver_found" })
    .where(and(eq(rides.status, "searching"), lte(rides.requestedAt, cutoff)))
    .returning({ id: rides.id, passengerId: rides.passengerId });
  if (expired.length) {
    await db.insert(rideStatusHistory).values(
      expired.map((r) => ({ rideId: r.id, status: "no_driver_found" as const })),
    );
  }
  return expired;
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

/**
 * Cash out a driver's wallet via an Aza Connect transfer to their linked Aza
 * account. Flow: validate → debit wallet + pending payout row → transfer →
 * settle (completed with reference, or failed with an automatic refund).
 * In dev Aza mode the transfer is simulated and always succeeds.
 */
export async function requestPayout(driverId: number, amount: number, method: "bank_transfer" | "instant" | "mobile_money", accountLast4?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const driver = await db.select().from(driverProfiles).where(eq(driverProfiles.id, driverId)).limit(1);
  if (!driver[0]) throw new Error("Driver not found");
  if (!driver[0].azaRecipient && !aza.isDevAzaMode()) {
    throw new Error("Link your Aza account first to receive payouts");
  }
  const balance = parseFloat(driver[0].walletBalance ?? "0");
  if (amount > balance) throw new Error("Insufficient balance");

  // Debit up front and record the pending payout
  const newBal = (balance - amount).toFixed(2);
  await db.update(driverProfiles).set({ walletBalance: newBal }).where(eq(driverProfiles.id, driverId));
  const payoutRow = await db.insert(payouts)
    .values({ driverId, amount: amount.toFixed(2), method, accountLast4, status: "pending" })
    .returning({ id: payouts.id });
  const payoutId = payoutRow[0].id;
  // NOTE: driver wallet txns store driverProfiles.id in userId (existing convention)
  await db.insert(walletTransactions).values({ userId: driverId, userType: "driver", type: "debit", amount: amount.toFixed(2), balanceAfter: newBal, description: "Payout request", referenceType: "payout", referenceId: payoutId });

  try {
    const transfer = await aza.createConnectTransfer({
      recipient: driver[0].azaRecipient ?? "",
      amount,
      note: `RideX payout #${payoutId}`,
      idempotencyKey: `payout_${payoutId}`,
    });
    await db.update(payouts)
      .set({ status: "completed", reference: transfer.id, processedAt: new Date() })
      .where(eq(payouts.id, payoutId));
    await createNotification({
      userId: driver[0].userId,
      type: "payout_sent",
      title: "Payout sent 💸",
      body: `GH₵${amount.toFixed(2)} is on its way to your Aza account.`,
      data: JSON.stringify({ payoutId }),
    });
    // Realtime is keyed by users.id — resolve from the profile
    realtimeBus.publish({ kind: "user", userId: driver[0].userId }, { type: "wallet:update" });
    return { newBalance: newBal, status: "completed" as const };
  } catch (err) {
    // Refund the debit atomically and mark the payout failed
    const reason = (err as Error).message.slice(0, 500);
    console.warn("[aza] payout transfer failed, refunding:", reason);
    await db.update(driverProfiles)
      .set({ walletBalance: sql`${driverProfiles.walletBalance} + ${amount.toFixed(2)}` })
      .where(eq(driverProfiles.id, driverId));
    const refreshed = await db.select({ walletBalance: driverProfiles.walletBalance }).from(driverProfiles).where(eq(driverProfiles.id, driverId)).limit(1);
    await db.insert(walletTransactions).values({ userId: driverId, userType: "driver", type: "credit", amount: amount.toFixed(2), balanceAfter: refreshed[0]?.walletBalance ?? newBal, description: "Payout refunded", referenceType: "payout", referenceId: payoutId });
    await db.update(payouts).set({ status: "failed", failureReason: reason }).where(eq(payouts.id, payoutId));
    realtimeBus.publish({ kind: "user", userId: driver[0].userId }, { type: "wallet:update" });
    throw new Error(`Payout failed: ${reason}`);
  }
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
  // Single realtime hook covering every notification call site: nudge the
  // recipient to refetch their unread count / list.
  realtimeBus.publish({ kind: "user", userId: data.userId }, { type: "notification:new" });

  // Send push notification if user has a token
  const token = await getPushToken(data.userId);
  if (token) {
    sendPushNotification({
      to: token,
      title: data.title,
      body: data.body,
      data: data.data ? JSON.parse(data.data) : undefined,
    }).catch((err) => console.warn("[push] Failed to send:", err));
  }
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

// ─── Push Tokens ──────────────────────────────────────────────────────────────

export async function savePushToken(userId: number, token: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ expoPushToken: token }).where(eq(users.id, userId));
}

export async function getPushToken(userId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select({ expoPushToken: users.expoPushToken }).from(users).where(eq(users.id, userId));
  return result[0]?.expoPushToken ?? null;
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

// ─── Ride Messages (driver ↔ passenger chat) ──────────────────────────────────

export async function createMessage(data: typeof messages.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(messages).values(data).returning();
  return result[0];
}

export async function getMessagesForRide(rideId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages)
    .where(eq(messages.rideId, rideId))
    .orderBy(messages.createdAt)
    .limit(limit);
}

// ─── Payments (Aza) ───────────────────────────────────────────────────────────

/**
 * Create a payment ledger row. rideId 0 is a sentinel meaning "not tied to a
 * ride" (wallet top-ups) — always filter rideId > 0 when joining to rides.
 */
export async function createPayment(data: {
  rideId: number;
  userId: number;
  amount: string;
  method: "wallet" | "mobile_money" | "card" | "cash";
  status?: "pending" | "completed" | "failed";
  reference: string;
  providerRef?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(payments).values(data).returning({ id: payments.id });
  return result[0].id;
}

export async function getPaymentByReference(reference: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(payments).where(eq(payments.reference, reference)).limit(1);
  return result[0] ?? null;
}

/**
 * Pending Aza payments old enough to reconcile against the provider
 * (created before the cutoff, with a provider session to ask about).
 */
export async function getPendingProviderPayments(cutoff: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payments)
    .where(and(
      eq(payments.status, "pending"),
      lte(payments.createdAt, cutoff),
      sql`${payments.providerRef} IS NOT NULL`,
    ))
    .orderBy(payments.createdAt)
    .limit(25);
}

export async function getPaymentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return result[0] ?? null;
}

export async function setPaymentProviderRef(id: number, providerRef: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(payments).set({ providerRef }).where(eq(payments.id, id));
}

/**
 * Complete a pending top-up: mark the payment completed and credit the
 * passenger's wallet. Shared by the Aza webhook and the dev auto-complete
 * timer. Idempotent — a payment only transitions out of "pending" once, so a
 * duplicate webhook delivery can never double-credit.
 */
export async function completeTopUpPayment(
  reference: string,
  providerRef?: string,
): Promise<{ ok: true; newBalance: string } | { ok: false; reason: "not_found" | "already_processed" }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "not_found" };
  const payment = await getPaymentByReference(reference);
  if (!payment) return { ok: false, reason: "not_found" };
  if (payment.status !== "pending") return { ok: false, reason: "already_processed" };

  await db.update(payments)
    .set({ status: "completed", ...(providerRef ? { providerRef } : {}) })
    .where(eq(payments.id, payment.id));

  // Atomic credit — no read-modify-write race
  await getOrCreatePassengerProfile(payment.userId);
  await db.update(passengerProfiles)
    .set({ walletBalance: sql`${passengerProfiles.walletBalance} + ${payment.amount}` })
    .where(eq(passengerProfiles.userId, payment.userId));
  const refreshed = await db.select({ walletBalance: passengerProfiles.walletBalance })
    .from(passengerProfiles).where(eq(passengerProfiles.userId, payment.userId)).limit(1);
  const newBalance = refreshed[0]?.walletBalance ?? payment.amount;

  await db.insert(walletTransactions).values({
    userId: payment.userId, // passenger txns store users.id
    userType: "passenger",
    type: "credit",
    amount: payment.amount,
    balanceAfter: newBalance,
    description: "Wallet top-up",
    referenceType: "topup",
    referenceId: payment.id,
  });
  await createNotification({
    userId: payment.userId,
    type: "wallet_topup",
    title: "Wallet topped up 💰",
    body: `GH₵${parseFloat(payment.amount).toFixed(2)} added to your wallet.`,
    data: JSON.stringify({ paymentId: payment.id }),
  });
  realtimeBus.publish({ kind: "user", userId: payment.userId }, { type: "wallet:update" });
  return { ok: true, newBalance };
}

/** Mark a pending top-up failed (checkout expired or cancelled). */
export async function failTopUpPayment(reference: string, reason: "expired" | "cancelled") {
  const db = await getDb();
  if (!db) return;
  const payment = await getPaymentByReference(reference);
  if (!payment || payment.status !== "pending") return;
  await db.update(payments).set({ status: "failed" }).where(eq(payments.id, payment.id));
  console.log(`[aza] top-up ${reference} marked failed (${reason})`);
}

/**
 * Complete a pending ride-fare payment (reference "ridepay_<rideId>_<ts>").
 * Sibling of completeTopUpPayment but does NOT touch the wallet — the fare is
 * paid straight to the merchant via Aza checkout. Records the digital
 * settlement on the ride and tells the passenger. Same idempotency guard:
 * a payment leaves "pending" exactly once.
 */
export async function completeRidePayment(
  reference: string,
  providerRef?: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "already_processed" }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "not_found" };
  const payment = await getPaymentByReference(reference);
  if (!payment) return { ok: false, reason: "not_found" };
  if (payment.status !== "pending") return { ok: false, reason: "already_processed" };

  await db.update(payments)
    .set({ status: "completed", ...(providerRef ? { providerRef } : {}) })
    .where(eq(payments.id, payment.id));

  // Record that the fare was settled digitally, not in cash
  if (payment.rideId > 0) {
    await db.update(rides).set({ paymentMethod: "mobile_money" }).where(eq(rides.id, payment.rideId));
  }
  await createNotification({
    userId: payment.userId,
    type: "ride_paid",
    title: "Ride paid ✅",
    body: `GH₵${parseFloat(payment.amount).toFixed(2)} for ride #${payment.rideId} paid via Aza.`,
    data: JSON.stringify({ paymentId: payment.id, rideId: payment.rideId }),
  });
  realtimeBus.publish({ kind: "user", userId: payment.userId }, { type: "wallet:update" });
  return { ok: true };
}

/**
 * Payment picture for a completed ride, for the rating screen: how it settled
 * (the "ride_<id>" marker row) and whether an Aza fare payment exists.
 */
export async function getRidePaymentInfo(rideId: number, userId: number) {
  const empty = {
    settledMethod: null as "wallet" | "cash" | null,
    azaPaid: false,
    pendingAzaPaymentId: null as number | null,
    fare: "0.00",
  };
  const db = await getDb();
  if (!db) return empty;
  const ride = await getRideById(rideId);
  if (!ride || ride.passengerId !== userId) return empty;

  const fare = ride.actualFare ?? ride.estimatedFare ?? "0.00";
  const settlement = await getPaymentByReference(`ride_${rideId}`);
  // Latest Aza fare payment for this ride (reference "ridepay_...")
  const azaRows = await db.select().from(payments)
    .where(and(eq(payments.rideId, rideId), sql`${payments.reference} LIKE 'ridepay_%'`))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  const aza = azaRows[0];

  return {
    settledMethod: settlement ? (settlement.method === "wallet" ? "wallet" as const : "cash" as const) : null,
    azaPaid: aza?.status === "completed",
    pendingAzaPaymentId: aza?.status === "pending" ? aza.id : null,
    fare: parseFloat(fare).toFixed(2),
  };
}

/** Make one payment method the default (clears the flag on the rest). */
export async function setDefaultPaymentMethod(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(paymentMethods).set({ isDefault: false }).where(eq(paymentMethods.userId, userId));
  await db.update(paymentMethods).set({ isDefault: true })
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.userId, userId)));
}

/**
 * Settle the passenger's side of a completed ride. Wallet rides debit the
 * full fare if the balance covers it (atomic conditional update); otherwise
 * the ride settles as cash — never partial, never negative. Idempotent via
 * the per-ride payments row.
 */
export async function debitPassengerForRide(rideId: number): Promise<{ method: "wallet" | "cash" }> {
  const db = await getDb();
  if (!db) return { method: "cash" };
  const ride = await getRideById(rideId);
  if (!ride) return { method: "cash" };

  // Idempotency: one payments row per ride, ever
  const existing = await getPaymentByReference(`ride_${rideId}`);
  if (existing) return { method: existing.method === "wallet" ? "wallet" : "cash" };

  const fare = ride.actualFare ?? ride.estimatedFare ?? "0.00";
  const fareNum = parseFloat(fare);

  if (ride.paymentMethod === "wallet" && fareNum > 0) {
    // Atomic conditional debit: only succeeds if the balance covers the fare
    const debited = await db.update(passengerProfiles)
      .set({ walletBalance: sql`${passengerProfiles.walletBalance} - ${fare}` })
      .where(and(
        eq(passengerProfiles.userId, ride.passengerId),
        sql`${passengerProfiles.walletBalance} >= ${fare}`,
      ))
      .returning({ walletBalance: passengerProfiles.walletBalance });

    if (debited[0]) {
      await db.insert(walletTransactions).values({
        userId: ride.passengerId, // passenger txns store users.id
        userType: "passenger",
        type: "debit",
        amount: parseFloat(fare).toFixed(2),
        balanceAfter: debited[0].walletBalance ?? "0.00",
        description: `Ride #${rideId} fare`,
        referenceType: "ride",
        referenceId: rideId,
      });
      await createPayment({
        rideId,
        userId: ride.passengerId,
        amount: parseFloat(fare).toFixed(2),
        method: "wallet",
        status: "completed",
        reference: `ride_${rideId}`,
      });
      realtimeBus.publish({ kind: "user", userId: ride.passengerId }, { type: "wallet:update" });
      return { method: "wallet" };
    }
    // Insufficient balance — fall through to cash and record it honestly
    await db.update(rides).set({ paymentMethod: "cash" }).where(eq(rides.id, rideId));
  }

  await createPayment({
    rideId,
    userId: ride.passengerId,
    amount: parseFloat(fare).toFixed(2),
    method: "cash",
    status: "completed",
    reference: `ride_${rideId}`,
  });
  return { method: "cash" };
}

/** Update a driver profile by driverProfiles.id (the sibling keys on userId). */
export async function updateDriverProfileById(driverProfileId: number, data: Partial<typeof driverProfiles.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(driverProfiles).set(data).where(eq(driverProfiles.id, driverProfileId));
}
