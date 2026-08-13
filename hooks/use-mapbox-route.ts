import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/hooks/use-route";
import { getRoute } from "@/lib/mapbox";

export function useMapboxRoute(from: LatLng | null | undefined, to: LatLng | null | undefined, enabled = true, refreshIntervalMs = 15000) {
  const [coords, setCoords] = useState<{ lat: number; lng: number }[] | undefined>(undefined);
  const [distanceKm, setDistanceKm] = useState<number | undefined>(undefined);
  const [durationMin, setDurationMin] = useState<number | undefined>(undefined);
  const [steps, setSteps] = useState<any[] | undefined>(undefined);
  const mounted = useRef(true);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      if (!enabled || !from || !to) return;
      try {
        const r = await getRoute(from, to);
        if (cancelled) return;
        if (!mounted.current) return;
        setCoords(r.geometry);
        setDistanceKm(r.distance / 1000);
        setDurationMin(r.duration / 60);
        setSteps(r.steps ?? []);
      } catch (err) {
        console.warn("[useMapboxRoute] fetch failed", err);
      } finally {
        if (!cancelled && mounted.current) {
          timer.current = window.setTimeout(fetchOnce, refreshIntervalMs);
        }
      }
    }
    // start immediately
    if (enabled) {
      fetchOnce();
    } else {
      // clear
      setCoords(undefined);
      setDistanceKm(undefined);
      setDurationMin(undefined);
      setSteps(undefined);
      if (timer.current) window.clearTimeout(timer.current);
    }

    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.lat, from?.lng, to?.lat, to?.lng, enabled]);

  return {
    coords,
    distanceKm,
    durationMin,
    steps,
  };
}
