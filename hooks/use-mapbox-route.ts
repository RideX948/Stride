import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/hooks/use-route";
import { getRoute } from "@/lib/mapbox";

type MaybePos = { lat: number; lng: number } | null | undefined;

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000; // m
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aa = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

function pointToSegmentDistanceMeters(p: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  // Convert lat/lng to simple equirectangular projection locally (good for short distances)
  const latRad = (p.lat + a.lat + b.lat) / 3;
  const cosLat = Math.cos((latRad * Math.PI) / 180);
  const ax = a.lng * cosLat;
  const ay = a.lat;
  const bx = b.lng * cosLat;
  const by = b.lat;
  const px = p.lng * cosLat;
  const py = p.lat;

  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  const c2 = vx * vx + vy * vy;
  const t = c2 === 0 ? 0 : Math.max(0, Math.min(1, c1 / c2));
  const projx = ax + t * vx;
  const projy = ay + t * vy;
  // convert back to lat/lng distance using haversine between p and proj
  const proj = { lat: projy, lng: projx / cosLat };
  return haversineMeters(p, proj);
}

export function useMapboxRoute(
  from: LatLng | null | undefined,
  to: LatLng | null | undefined,
  enabled = true,
  refreshIntervalMs = 15000,
  currentPosition: MaybePos = null,
  offRouteThresholdMeters = 40,
) {
  const [coords, setCoords] = useState<{ lat: number; lng: number }[] | undefined>(undefined);
  const [distanceKm, setDistanceKm] = useState<number | undefined>(undefined);
  const [durationMin, setDurationMin] = useState<number | undefined>(undefined);
  const [steps, setSteps] = useState<any[] | undefined>(undefined);
  const mounted = useRef(true);
  const timer = useRef<number | null>(null);
  const lastFetchAt = useRef<number>(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  async function fetchOnce() {
    if (!enabled || !from || !to) return;
    try {
      const r = await getRoute(from, to);
      if (!mounted.current) return;
      setCoords(r.geometry);
      setDistanceKm(r.distance / 1000);
      setDurationMin(r.duration / 60);
      setSteps(r.steps ?? []);
      lastFetchAt.current = Date.now();
    } catch (err) {
      console.warn("[useMapboxRoute] fetch failed", err);
    }
  }

  useEffect(() => {
    let cancelled = false;
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

    function scheduleNext() {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        if (cancelled) return;
        await fetchOnce();
        scheduleNext();
      }, refreshIntervalMs);
    }

    if (enabled) scheduleNext();

    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.lat, from?.lng, to?.lat, to?.lng, enabled, refreshIntervalMs]);

  // Off-route detection: if driver moves away from the current polyline beyond threshold,
  // trigger an immediate fetch (but avoid spamming by min interval)
  useEffect(() => {
    if (!enabled || !coords || coords.length < 2 || !currentPosition) return;
    const p = currentPosition;
    let minDist = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const d = pointToSegmentDistanceMeters(p, a, b);
      if (d < minDist) minDist = d;
      if (minDist <= offRouteThresholdMeters) break;
    }
    if (minDist > offRouteThresholdMeters) {
      const now = Date.now();
      // throttle: don't refetch more often than 8s
      if (now - lastFetchAt.current > 8000) {
        // immediate fetch
        fetchOnce();
      }
    }
  }, [currentPosition?.lat, currentPosition?.lng, coords, enabled, offRouteThresholdMeters]);

  return {
    coords,
    distanceKm,
    durationMin,
    steps,
  };
}
