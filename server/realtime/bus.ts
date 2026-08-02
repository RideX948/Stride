import { EventEmitter } from "node:events";

/**
 * Realtime event bus.
 *
 * db.ts and routers.ts emit onto this bus after successful DB writes; the
 * WebSocket layer (server/realtime/ws.ts) consumes it and fans events out to
 * connected clients. Keeping the emit sites decoupled from the socket layer
 * avoids import cycles and keeps them unit-testable without sockets.
 *
 * NOTE: in-memory, single-process only. Horizontal scaling would need a
 * pub/sub backplane (e.g. Redis) behind the same interface.
 */

// ─── Event shapes (mirrored client-side in lib/realtime.ts) ──────────────────

export type RealtimeEvent =
  // New searching ride → topic "drivers:online"
  | { type: "ride:new"; rideId: number; rideType: string }
  // Ride no longer available (accepted or cancelled while searching) → "drivers:online"
  | { type: "ride:taken"; rideId: number }
  // Ride lifecycle change → topic "ride:<id>" (clients invalidate queries)
  | { type: "ride:update"; rideId: number; status: string }
  // Driver GPS fix → topic "driver:<driverProfileId>" (applied via setQueryData)
  | { type: "driver:location"; driverId: number; lat: number; lng: number }
  // New chat message → topic "ride:<id>". createdAt is an ISO string (no superjson over WS).
  | {
      type: "message:new";
      rideId: number;
      message: {
        id: number;
        rideId: number;
        senderId: number;
        senderRole: "passenger" | "driver";
        body: string;
        createdAt: string;
      };
    }
  // SOS raised/resolved on a ride → topic "ride:<id>"
  | { type: "sos:update"; rideId: number; sosId: number; triggeredBy: string; status: string }
  // New notification row → implicit "user:<userId>" channel
  | { type: "notification:new" }
  // Wallet balance changed (top-up, ride debit, payout) → "user:<userId>".
  // Empty payload — clients refetch; balances never travel over WS.
  | { type: "wallet:update" };

// ─── Addressing ───────────────────────────────────────────────────────────────

export type Address =
  | { kind: "user"; userId: number }
  | { kind: "topic"; topic: string }; // "drivers:online" | "ride:<id>" | "driver:<profileId>"

export type BusMessage = { address: Address; event: RealtimeEvent };

const BUS_EVENT = "realtime";

class RealtimeBus extends EventEmitter {
  /** Emit an event to one or more addresses. Never throws. */
  publish(address: Address | Address[], event: RealtimeEvent) {
    try {
      const addresses = Array.isArray(address) ? address : [address];
      for (const a of addresses) {
        this.emit(BUS_EVENT, { address: a, event } satisfies BusMessage);
      }
    } catch (err) {
      console.error("[realtime] bus publish failed:", err);
    }
  }

  subscribe(handler: (msg: BusMessage) => void): () => void {
    this.on(BUS_EVENT, handler);
    return () => this.off(BUS_EVENT, handler);
  }
}

export const realtimeBus = new RealtimeBus();
// Many sockets may subscribe indirectly; the WS layer registers one listener,
// but tests can add more. Raise the default warning threshold a bit.
realtimeBus.setMaxListeners(50);
