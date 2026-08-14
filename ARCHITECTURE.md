RideX — Architecture Overview

Purpose

This document explains the high-level architecture of RideX, focusing on the in-app Mapbox navigation MVP, how the server and client interact, and where the important code lives.

System overview

- Client (Expo React Native / Web)
  - Screens: auth, role-select, passenger flows, driver flows, tracking.
  - Map UI: components/ride-map.tsx draws markers, polylines and live driver position.
  - Hooks: hooks/use-mapbox-route.ts (fetches route, computes off-route), hooks/use-navigation-instructions.ts (next-step text + TTS), hooks/usePushNotifications.ts.
  - Client-side Mapbox access: None. The client calls a server endpoint to get directions and steps (keeps token secret).

- Server (Express + TRPC + background jobs)
  - API router: server/_core/index.ts registers TRPC and route-level endpoints
  - Mapbox proxy: server/_core/mapbox.ts — GET /api/mapbox/directions
    - Accepts originLat, originLng, destLat, destLng
    - Calls Mapbox Directions API with server MAPBOX_TOKEN
    - Returns simplified geometry (array of {lat,lng}), distance, duration and steps
  - Realtime WebSocket service: server/realtime/ws (used to push driver position and ride updates)
  - Sweepers: background jobs to clean stale ride searches, reconcile payments, etc.

Mapbox directions flow (why server-side)

1) Client requests route via /api/mapbox/directions with pickup and dropoff coordinates.
2) Server constructs Mapbox Directions HTTP request (geometries=geojson, overview=full, steps=true) and attaches the token from process.env.MAPBOX_TOKEN.
3) Server translates Mapbox geometry ([lon,lat] arrays) into {lat,lng} for the client, and reduces each step to an object with distance, duration, name, maneuver and per-step geometry.

Security & privacy rationale

- Mapbox token is stored as MAPBOX_TOKEN on the server (Railway env). This prevents token leakage in client bundles.
- Server sets CORS headers and allows credentialed requests; for production you can tighten allowed origins.

Client routing & reroute details

- Hook: hooks/use-mapbox-route.ts
  - Inputs: origin, dest, enabled flag, refreshMs, currentPosition, offRouteThresholdMeters
  - Behavior: fetches /api/mapbox/directions once then refreshes periodically (refreshMs). If the driver’s currentPosition is farther than offRouteThresholdMeters from the polyline, it triggers an immediate, throttled refetch.
  - Off-route detection: point-to-segment distance using local haversine approximation (sufficient for urban distances). Threshold default: 40 meters (tunable).
  - Throttling: prevents repeated refetches while GPS jitter occurs (e.g., once per ~8s when deviating).

- Hook: hooks/use-navigation-instructions.ts
  - Parses steps returned by the Mapbox proxy
  - Chooses the next step and emits a text instruction
  - Calls lib/speech.ts to speak the instruction

TTS fallback (lib/speech.ts)

- Tries to require('expo-speech') for native builds (if dependency installed)
- Falls back to the browser SpeechSynthesis API on web

Deployment notes

- Railway deployment: push to origin/main (auto-deploy if enabled) or use manual Redeploy
- Important Railway env variables:
  - MAPBOX_TOKEN (required for /api/mapbox/directions)
  - DATABASE_URL (for full functionality)
  - JWT_SECRET (session cookie signing)
  - EXPO_PUBLIC_API_BASE_URL (optional; helpful for web to point client to the deployed API)

Testing & verification

- Smoke test Mapbox proxy:
  curl "https://<your-host>/api/mapbox/directions?originLat=<>&originLng=<>&destLat=<>&destLng<>"
  Response should include distance, duration, geometry (array) and steps (array)

- Verify client routing:
  - Start local dev (pnpm dev)
  - Ensure EXPO_PUBLIC_API_BASE_URL is set to http://localhost:3006 (or the Railway URL)
  - Open tracking screens and confirm polylines, ETA and next instruction appear

Roadmap / next improvements

- Add a visible "rerouting" UI indicator (toast) and logging/analytics for reroute frequency
- Install and pin expo-speech for reliable native TTS
- Improve off-route detection (map-matching or server-side reroute) and handle blocked roads
- Add caching on server for repeated local routes to reduce Mapbox calls
- Harden type definitions so the project compiles without skipLibCheck

Key files referenced

- server/_core/mapbox.ts
- lib/mapbox.ts
- hooks/use-mapbox-route.ts
- hooks/use-navigation-instructions.ts
- lib/speech.ts
- app/(passenger)/tracking.tsx
- components/ride-map.tsx

Contact / notes

If you want, I can generate a diagram image (SVG/PNG) showing the flow (Client ↔ Server ↔ Mapbox) and add it to this doc. I can also produce a short demo script for your defense showing which screens to open and what to say.