import type { Application, Request, Response } from "express";

const MAPBOX_BASE = "https://api.mapbox.com/directions/v5/mapbox/driving";

export function registerMapboxRoutes(app: Application) {
  app.get("/api/mapbox/directions", async (req: Request, res: Response) => {
    try {
      const { originLat, originLng, destLat, destLng } = req.query as Record<string, string>;
      if (!originLat || !originLng || !destLat || !destLng) {
        res.status(400).json({ error: "originLat, originLng, destLat and destLng are required" });
        return;
      }

      const token = process.env.MAPBOX_TOKEN ?? process.env.MAPBOX_ACCESS_TOKEN;
      if (!token) {
        res.status(500).json({ error: "Mapbox token not configured on server (MAPBOX_TOKEN)" });
        return;
      }

      // Mapbox expects lon,lat pairs
      const coords = `${originLng},${originLat};${destLng},${destLat}`;
      const url = `${MAPBOX_BASE}/${coords}?geometries=geojson&overview=full&steps=true&alternatives=false&access_token=${encodeURIComponent(token)}`;

      const r = await fetch(url);
      if (!r.ok) {
        const txt = await r.text();
        console.error("[mapbox] directions failed:", r.status, txt);
        res.status(502).json({ error: "Mapbox directions request failed", status: r.status, body: txt });
        return;
      }

      const payload = await r.json();
      const route = payload?.routes?.[0];
      if (!route) {
        res.status(404).json({ error: "No route found" });
        return;
      }

      // Convert GeoJSON coordinates [lon, lat] -> { lat, lng }
      const coordsLatLng = (route.geometry?.coordinates ?? []).map((c: number[]) => ({ lat: c[1], lng: c[0] }));

      // Simplify steps to useful fields
      const steps = [] as any[];
      if (route.legs && Array.isArray(route.legs)) {
        for (const leg of route.legs) {
          if (!leg || !Array.isArray(leg.steps)) continue;
          for (const s of leg.steps) {
            steps.push({
              distance: s.distance,
              duration: s.duration,
              name: s.name,
              maneuver: s.maneuver,
              geometry: s.geometry?.coordinates?.map((c: number[]) => ({ lat: c[1], lng: c[0] })) ?? [],
            });
          }
        }
      }

      res.json({
        distance: route.distance,
        duration: route.duration,
        geometry: coordsLatLng,
        steps,
      });
    } catch (err) {
      console.error("[mapbox] directions error:", err);
      res.status(500).json({ error: "internal" });
    }
  });
}
