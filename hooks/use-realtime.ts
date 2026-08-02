import { useEffect, useState } from "react";
import { realtime, type RealtimeStatus, type ServerEvent } from "@/lib/realtime";
import { trpc } from "@/lib/trpc";

/**
 * React bindings for the realtime WebSocket client (lib/realtime.ts).
 *
 * - useRealtimeConnected(): is the push channel live? Screens use this to
 *   stretch their fallback polling intervals: refetchInterval: live ? SLOW : FAST.
 * - useRealtimeTopic(topic): declare interest in a topic while mounted.
 * - useRealtimeInvalidations(): mounted ONCE inside the provider tree — maps
 *   server events to react-query cache updates/invalidations.
 */

export function useRealtimeConnected(): boolean {
  const [connected, setConnected] = useState(realtime.status === "open");
  useEffect(() => {
    setConnected(realtime.status === "open");
    return realtime.onStatusChange((status: RealtimeStatus) => {
      setConnected(status === "open");
    });
  }, []);
  return connected;
}

/** Subscribe to a topic while mounted. Pass null to skip (e.g. no active ride yet). */
export function useRealtimeTopic(topic: string | null, handler?: (ev: ServerEvent) => void) {
  useEffect(() => {
    if (!topic) return;
    const unsubTopic = realtime.subscribe(topic);
    const unsubEvents = handler ? realtime.on(handler) : null;
    return () => {
      unsubTopic();
      unsubEvents?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);
}

/**
 * Central event → cache mapping. Mount exactly once (app/_layout.tsx renders
 * <RealtimeInvalidations /> via this hook inside the tRPC provider tree).
 */
export function useRealtimeInvalidations() {
  const utils = trpc.useUtils();

  useEffect(() => {
    return realtime.on((ev: ServerEvent) => {
      switch (ev.type) {
        case "ride:update": {
          // Refetch over the existing HTTP link; queries and types untouched.
          void utils.rides.getById.invalidate({ rideId: ev.rideId });
          void utils.rides.getActiveForPassenger.invalidate();
          void utils.rides.getActiveForDriver.invalidate();
          if (ev.status === "completed") {
            void utils.driver.earningsSummary.invalidate();
            void utils.driver.getProfile.invalidate();
          }
          break;
        }
        case "ride:new":
        case "ride:taken": {
          void utils.rides.getPending.invalidate();
          void utils.rides.demand.invalidate();
          break;
        }
        case "driver:location": {
          // High-frequency: apply the fix directly, no refetch roundtrip.
          utils.driver.getPublic.setData({ driverId: ev.driverId }, (old) =>
            old ? { ...old, currentLat: ev.lat, currentLng: ev.lng } : old,
          );
          break;
        }
        case "message:new": {
          const incoming = {
            ...ev.message,
            // WS payloads bypass superjson — restore the Date the query cache expects.
            createdAt: new Date(ev.message.createdAt),
          };
          utils.messages.list.setData({ rideId: ev.rideId }, (old) => {
            if (!old) return old;
            if (old.some((m) => m.id === incoming.id)) return old; // dedupe (sender gets its own broadcast)
            return [...old, incoming];
          });
          break;
        }
        case "sos:update": {
          void utils.sos.getActive.invalidate();
          void utils.sos.getActiveForRide.invalidate({ rideId: ev.rideId });
          break;
        }
        case "notification:new": {
          void utils.notifications.getUnreadCount.invalidate();
          void utils.notifications.getAll.invalidate();
          break;
        }
        case "wallet:update": {
          void utils.passenger.getWallet.invalidate();
          void utils.driver.getWallet.invalidate();
          void utils.driver.payoutHistory.invalidate();
          break;
        }
      }
    });
  }, [utils]);
}
