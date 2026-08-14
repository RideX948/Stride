Demo Script & Checklist — RideX Stride

Preparation
- Start the app: pnpm dev
- Ensure backend shows: [api] server listening on port 3006
- Optionally set EXPO_PUBLIC_API_BASE_URL=http://localhost:3006
- Open two browser tabs or two devices (one for passenger, one for driver)

Script
1) Passenger: Sign up / Login
   - Enter phone number (eg. 0241234567)
   - Use DEV code if shown to auto-fill OTP
   - Choose "Passenger" on role select

2) Passenger: Request a ride
   - Select pickup location on the map (or enter coords)
   - Select destination and request a ride
   - Note the request ID in UI or logs

3) Driver: Login with different account
   - Choose "Driver" role
   - Open incoming ride requests and accept the passenger's ride

4) Driver: Open tracking screen
   - Observe route polyline drawn on map
   - Confirm ETA updates and "Next instruction" text appears
   - If TTS is enabled, hear next-turn instruction

5) Optional: Simulate deviation
   - Move driver marker off the route (or change coordinates)
   - Observe rerouting: new Mapbox request appears in server logs, route updates
   - Note reroute UI (if implemented)

6) End ride
   - Complete ride on driver UI
   - Observe ride status changes on passenger UI

Notes for the defense
- Show server logs during Steps 2 and 4 to highlight Mapbox proxy requests
- Explain token security: MAPBOX_TOKEN lives on server (Railway env)
- If time allows, show ARCHITECTURE.md and diagrams/flow.svg

Troubleshooting during demo
- If route fails to load: check DevTools Network and ensure requests go to http://localhost:3006 or the Railway host
- If OTP not received in dev: use DEV code shown in the app UI (dev mode)
- If TTS doesn't speak: expo-speech may not be installed — web fallback uses browser TTS
