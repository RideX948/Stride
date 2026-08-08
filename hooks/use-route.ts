import { trpc } from "@/lib/trpc";

export type LatLng = { lat: number; lng: number };

// ~110m grid: a moving driver only changes the query input (and thus triggers
// a refetch) after real movement, and react-query caches every leg fetched.
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Road-shaped route between two points, fetched from the server (OSRM) and
 * cached aggressively — roads don't move. Returns undefined data until loaded;
 * callers keep their straight-line fallback in the meantime.
 */
export function useRoute(from: LatLng | null | undefined, to: LatLng | null | undefined, enabled = true) {
  const query = trpc.rides.routeGeometry.useQuery(
    {
      fromLat: from ? round3(from.lat) : 0,
      fromLng: from ? round3(from.lng) : 0,
      toLat: to ? round3(to.lat) : 0,
      toLng: to ? round3(to.lng) : 0,
    },
    {
      enabled: enabled && from != null && to != null,
      staleTime: Infinity,
      retry: 1,
    },
  );
  return {
    coords: query.data?.coords,
    distanceKm: query.data?.distanceKm,
    durationMin: query.data?.durationMin,
    isEstimated: query.data?.estimated ?? true,
  };
}
