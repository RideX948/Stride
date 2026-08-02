import { useEffect } from "react";
import { realtime } from "@/lib/realtime";
import { useRideX } from "@/lib/ridex-context";
import { useRealtimeInvalidations } from "@/hooks/use-realtime";

/**
 * Owns the realtime connection lifecycle. Rendered once inside the provider
 * tree (app/_layout.tsx): connects the WebSocket while a user is signed in and
 * maps incoming events to react-query cache updates.
 */
export function RealtimeManager() {
  const { isAuthenticated } = useRideX();
  useRealtimeInvalidations();

  useEffect(() => {
    if (isAuthenticated) {
      realtime.connect();
    } else {
      realtime.disconnect();
    }
  }, [isAuthenticated]);

  return null;
}
