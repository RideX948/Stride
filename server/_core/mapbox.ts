import type { Application, Request, Response } from "express";

const MAPBOX_BASE = "https://api.mapbox.com/directions/v5/mapbox/driving";

// Simple in-memory cache and rate limiter for the Mapbox proxy
const CACHE_TTL_MS = 60 * 1000; // 60s cache
const cache = new Map<string, { payload: any; ts: number }>();

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 120; // max requests per window per IP
const rateMap = new Map<string, { count: number; windowStart: number }>();

const metrics = {
  routeRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  rateLimited: 0,
  rerouteEvents: 0,
};

export function registerMapboxRoutes(app: Application) {
  app.get("/api/mapbox/directions", async (req: Request, res: Response) => {
    try {
      const { originLat, originLng, destLat, destLng } = req.query as Record<string, string>;
      if (!originLat || !originLng || !destLat || !destLng) {
        res.status(400).json({ error: "originLat, originLng, destLat and destLng are required" });
        return;
      }

      // Rate limiting by IP
      const ip = (req.headers["x-forwarded-for"] as string) || req.ip || "unknown";
      const now = Date.now();
      const entry = rateMap.get(ip);
      if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateMap.set(ip, { count: 1, windowStart: now });
      } else {
        if (entry.count + 1 > RATE_LIMIT_MAX) {
          metrics.rateLimited++;
          res.status(429).json({ error: "rate limit exceeded" });
          return;
        }
        entry.count++;
      }

      const token = process.env.MAPBOX_TOKEN ?? process.env.MAPBOX_ACCESS_TOKEN;
      if (!token) {
        res.status(500).json({ error: "Mapbox token not configured on server (MAPBOX_TOKEN)" });
        return;
      }

      metrics.routeRequests++;

      // Mapbox expects lon,lat pairs
      const coords = `${originLng},${originLat};${destLng},${destLat}`;
      const cacheKey = `${coords}`;

      // Serve from cache when available and fresh
      const cached = cache.get(cacheKey);
      if (cached && now - cached.ts < CACHE_TTL_MS) {
        metrics.cacheHits++;
        res.json(cached.payload);
        return;
      }

      metrics.cacheMisses++;

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

      const result = {
        distance: route.distance,
        duration: route.duration,
        geometry: coordsLatLng,
        steps,
      };

      // Cache result
      try {
        cache.set(cacheKey, { payload: result, ts: now });
      } catch (e) {
        // ignore cache set failures
      }

      res.json(result);
    } catch (err) {
      console.error("[mapbox] directions error:", err);
      res.status(500).json({ error: "internal" });
    }
  });

  // Lightweight metrics endpoints for demo/observability
  app.get("/api/internal/metrics", (_req: Request, res: Response) => {
    res.json({ metrics });
  });

  app.post("/api/internal/metrics", expressJsonMiddleware);
}

// Minimal JSON body parser for the metrics route to avoid coupling to full app.json
import { insertRerouteEvent } from "../db";

function expressJsonMiddleware(req: Request, res: Response) {
  // This function is registered as the handler for POST /api/internal/metrics
  // but the server already has express.json() globally; in case it's not wired,
  // we'll just parse the body if present and update counters.
  try {
    const body = (req as any).body ?? {};
    if (body && body.event === "reroute") {
      metrics.rerouteEvents++;
      // best-effort: persist to DB for observability
      try {
        const rideId = body.rideId ? Number(body.rideId) : undefined;
        const driverProfileId = body.driverProfileId ? Number(body.driverProfileId) : undefined;
        const originLat = body.originLat ? Number(body.originLat) : undefined;
        const originLng = body.originLng ? Number(body.originLng) : undefined;
        const destLat = body.destLat ? Number(body.destLat) : undefined;
        const destLng = body.destLng ? Number(body.destLng) : undefined;
        insertRerouteEvent({ rideId, driverProfileId, originLat, originLng, destLat, destLng, meta: body.meta ?? null }).catch(() => {});
      } catch (e) {
        // ignore
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false });
  }
}
