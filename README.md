RideX — In-app ride tracking & navigation MVP

Summary

RideX is a mobile/web app prototype for ride-hailing with in-app route drawing, ETA, basic navigation instructions and automatic rerouting. The app uses a server-side Mapbox Directions proxy to keep the Mapbox token private, a TRPC backend for business logic, and an Expo React Native client for passenger and driver flows.

Highlights / Differentiators

- In-app navigation MVP: route drawing, ETA and step instructions rendered and spoken inside the app (no forced redirect to Google Maps).
- Server-side Mapbox Directions proxy: Mapbox token remains secret on the server (Railway), improving security.
- Automatic rerouting on deviation: client-side off-route detection with throttled route refresh.
- TTS fallback: tries native expo-speech if available, otherwise uses Web Speech API on web.

Quickstart (Windows PowerShell)

1) Clone and install
   cd C:\Users\Iddriss\Downloads\stride
   pnpm install

2) Environment
   - The server needs MAPBOX_TOKEN (Mapbox Directions token) and DATABASE_URL to run fully.
   - For web dev it's helpful to set EXPO_PUBLIC_API_BASE_URL so the client talks to the correct backend (examples below).

3) Run (local dev)
   pnpm dev

This runs the server and the Expo/Metro client together. When both are running you should see the API listening (e.g. "[api] server listening on port 3006") and Expo Metro serving the app.

4) Run web-only client
   npx expo start --web

5) Test the Mapbox route endpoint directly (smoke test)
   # Replace with your Railway URL or http://localhost:3006 for local
   curl "https://stride-production-e41b.up.railway.app/api/mapbox/directions?originLat=51.5074&originLng=-0.1278&destLat=51.5155&destLng=-0.0754"

Important env examples

- Railway (production) example
  EXPO_PUBLIC_API_BASE_URL=https://stride-production-e41b.up.railway.app
  MAPBOX_TOKEN=pk.<your_mapbox_token_here>
  DATABASE_URL=postgres://...
  JWT_SECRET=verysecret

- Local dev example
  EXPO_PUBLIC_API_BASE_URL=http://localhost:3006
  MAPBOX_TOKEN=pk.<your_mapbox_token_here>

Where to put .env

Place a .env file in the repo root for local dev (scripts/load-env.js will merge it into process.env for server runs). Do NOT commit secrets to Git.

How to test driver & passenger flows (quick)

1) Start the app (pnpm dev)
2) Open the app in a browser or on device
3) Sign up / Login with phone OTP (in dev the backend often returns a DEV code you can use)
4) Choose role on the role select screen (Passenger or Driver)
5) Passenger: create a ride (choose pickup and destination) and request
6) Driver: sign in with a different account, accept the ride
7) Driver tracking screen: you should see a route drawn and ETA + next instruction

Troubleshooting

- useMapboxRoute fetch failed repeatedly on web: set EXPO_PUBLIC_API_BASE_URL to your API host (e.g. Railway URL or http://localhost:3006). The repo's lib/mapbox.ts will use getApiBaseUrl() to derive the host.
- CORS: the server sets permissive CORS headers and will reflect the request origin for credentials. If you see CORS errors, confirm the exact request URL in DevTools and check server logs.
- Expo web push tokens: "Listening to push token changes is not yet fully supported on web" is informational only — push token listeners are no-op on web.

Files of interest

- server/_core/mapbox.ts — Mapbox Directions proxy (server)
- lib/mapbox.ts — client helper for /api/mapbox/directions
- hooks/use-mapbox-route.ts — route fetching, off-route detection and auto-reroute logic
- hooks/use-navigation-instructions.ts — next-turn extraction and TTS
- app/(passenger)/tracking.tsx — passenger tracking UI integration
- components/ride-map.tsx — map UI used to draw route geometry
- hooks/usePushNotifications.ts — push notifications hook (imports fixed)

Screenshots & Diagram

- Screenshots: placeholder image locations are in /docs/screenshots/. Add PNGs named:
  - docs/screenshots/auth.png
  - docs/screenshots/role-select.png
  - docs/screenshots/passenger-request.png
  - docs/screenshots/driver-tracking.png

  Example Markdown to include a screenshot:
  ![Driver tracking](./docs/screenshots/driver-tracking.png)

- Architecture diagram: a simple diagram is included at /diagrams/flow.svg — open it in your editor or a browser. Replace with a higher-fidelity image if you want.

Slides and Demo Script

- Slides (Reveal markdown): slides/slides.md — easy to edit and export to PPT later.
- Speaker notes: slides/speaker_notes.md
- Demo script / checklist: docs/demo_script.md

If you'd like I can also:
- Generate a PowerPoint (.pptx) from the slides.md (requires extra tooling) or export a PDF
- Capture actual screenshots if you start the app locally and allow me to fetch them

Next step: I can commit and push these docs into git now if you want (you already approved).