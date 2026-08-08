import * as db from "./db";
import { realtimeBus } from "./realtime/bus";

/**
 * Ride expiry sweeper.
 *
 * A ride left in "searching" (no driver accepted, passenger never cancelled)
 * would otherwise sit in every driver's pending list forever. This sweeps
 * stale searching rides to "no_driver_found", notifies the passenger, and
 * fans the change out over the realtime bus.
 *
 * Single-process setInterval is fine here — the in-memory realtimeBus already
 * assumes one process, and expireStaleSearchingRides conditions on
 * status='searching' so a double-fire (or a race with an accepting driver)
 * is harmless.
 */

const SEARCH_TIMEOUT_MS =
  parseInt(process.env.RIDE_SEARCH_TIMEOUT_MS ?? "", 10) || 5 * 60_000;
// Sweep roughly 10x per timeout window, clamped to a sane 5s–30s range.
const SWEEP_INTERVAL_MS = Math.min(30_000, Math.max(5_000, Math.floor(SEARCH_TIMEOUT_MS / 10)));

async function sweep() {
  try {
    const expired = await db.withDbRetry(() =>
      db.expireStaleSearchingRides(new Date(Date.now() - SEARCH_TIMEOUT_MS)),
    );
    for (const ride of expired) {
      console.log(`[sweeper] ride #${ride.id} expired (no driver found)`);
      await db.createNotification({
        userId: ride.passengerId,
        type: "no_driver_found",
        title: "No drivers found",
        body: "We couldn't find a driver for your ride. Please try again.",
        data: JSON.stringify({ rideId: ride.id }),
      });
      // Passenger tracking screen refetches getById → shows "No driver found"
      realtimeBus.publish(
        { kind: "topic", topic: `ride:${ride.id}` },
        { type: "ride:update", rideId: ride.id, status: "no_driver_found" },
      );
      // Drop the request from every online driver's pending list/modal
      realtimeBus.publish(
        { kind: "topic", topic: "drivers:online" },
        { type: "ride:taken", rideId: ride.id },
      );
    }
  } catch (err) {
    // The sweeper re-runs shortly anyway; keep transient network noise to one
    // line instead of a full stack dump. The deepest cause carries the real
    // code (CONNECT_TIMEOUT etc.) — drizzle wraps it.
    let cause = err as { cause?: unknown };
    while (cause?.cause) cause = cause.cause as { cause?: unknown };
    const label =
      (cause as { code?: string })?.code ??
      (cause instanceof Error ? cause.message : String(cause));
    console.warn(`[sweeper] sweep failed (${label}) — will retry next interval`);
  }
}

export function startRideSweeper() {
  // tsconfig targets DOM types where setInterval returns number — but this
  // runs under Node, whose Timeout supports unref (don't hold the process open).
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS) as unknown as NodeJS.Timeout;
  timer.unref?.();
  console.log(
    `[sweeper] ride expiry sweeper started (timeout ${SEARCH_TIMEOUT_MS / 1000}s, sweep every ${SWEEP_INTERVAL_MS / 1000}s)`,
  );
  return timer;
}
