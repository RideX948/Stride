import { getApiBaseUrl } from "@/constants/oauth";

export type RouteResult = {
  distance: number; // meters
  duration: number; // seconds
  geometry: { lat: number; lng: number }[];
  steps: any[];
};

export async function getRoute(origin: { lat: number; lng: number }, dest: { lat: number; lng: number }): Promise<RouteResult> {
  const params = new URLSearchParams({
    originLat: String(origin.lat),
    originLng: String(origin.lng),
    destLat: String(dest.lat),
    destLng: String(dest.lng),
  });

  const apiBase = getApiBaseUrl();
  const path = `/api/mapbox/directions?${params.toString()}`;
  const fetchUrl = apiBase ? `${apiBase.replace(/\/$/, "")}${path}` : path;

  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error("Failed to fetch route: " + res.statusText);
  const payload = await res.json();
  return payload as RouteResult;
}
