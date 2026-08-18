import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";
import { trpc } from "@/lib/trpc";

const UPDATE_INTERVAL_MS = 5000;
const MIN_DISTANCE_M = 15;

/**
 * While `enabled`, watches the device position and streams it to the server
 * via driver.updateLocation (throttled to every ~5s / 15m of movement).
 * Also returns the latest local position so the driver map can show the car
 * moving without waiting for a server round-trip.
 *
 * Works on native (expo-location, asks foreground permission) and web
 * (navigator.geolocation). Stops cleanly when `enabled` flips off or the
 * component unmounts.
 */
export function useDriverLocation(driverId: number | undefined, enabled: boolean) {
  const updateLocation = trpc.driver.updateLocation.useMutation();
  // Keep the mutation in a ref so the effect doesn't re-run on each render
  const mutateRef = useRef(updateLocation.mutate);
  mutateRef.current = updateLocation.mutate;
  const lastSentRef = useRef<number>(0);
  const [livePos, setLivePos] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!driverId || !enabled) return;

    let cancelled = false;
    let webWatchId: number | null = null;
    let nativeSub: Location.LocationSubscription | null = null;

    const send = (lat: number, lng: number) => {
      // Always update local state immediately for the driver's own map
      setLivePos({ lat, lng });
      const now = Date.now();
      if (now - lastSentRef.current < UPDATE_INTERVAL_MS) return;
      lastSentRef.current = now;
      mutateRef.current(
        { lat, lng },
        { onError: (e) => console.warn("[Location] update failed:", e.message) }
      );
    };

    const start = async () => {
      if (Platform.OS === "web") {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
          console.warn("[Location] geolocation unavailable on this browser");
          return;
        }
        webWatchId = navigator.geolocation.watchPosition(
          (pos) => send(pos.coords.latitude, pos.coords.longitude),
          (err) => console.warn("[Location] web watch error:", err.message),
          { enableHighAccuracy: true, maximumAge: 3000 }
        );
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || cancelled) {
        console.warn("[Location] permission not granted");
        return;
      }
      nativeSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: UPDATE_INTERVAL_MS,
          distanceInterval: MIN_DISTANCE_M,
        },
        (pos) => send(pos.coords.latitude, pos.coords.longitude)
      );
    };

    start();

    return () => {
      cancelled = true;
      if (webWatchId !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(webWatchId);
      }
      nativeSub?.remove();
    };
  }, [driverId, enabled]);

  return livePos;
}

/** Haversine distance in km between two coordinates. */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Rough ETA in minutes assuming ~30 km/h city average. */
export function etaMinutes(km: number): number {
  return Math.max(1, Math.ceil((km / 30) * 60));
}
