Slide 1 — Welcome
- Introduce yourself and the project name
- One-line summary: a ride-hailing prototype with in-app navigation and live tracking

Slide 2 — Key Differentiators
- Highlight in-app navigation vs opening external maps
- Security: server-side Mapbox token
- UX: rerouting & TTS

Slide 3 — Quickstart (Demo)
- Explain quick steps you will perform during demo
- Mention developer conveniences (DEV OTP code)

Slide 4 — Architecture
- Walk through the diagram: Client, Server, Mapbox
- Emphasize where data flows and where secrets live

Slide 5 — Mapbox Integration
- Show example request & response shape
- Note geometry coordinate conversion

Slide 6 — Rerouting
- Explain algorithm & parameters (threshold, throttle)
- When server-side map-matching might be preferable

Slide 7 — Wrap-up
- Show server logs/Mapbox requests if possible
- Invite questions about cost, scalability, or UX

Recording tips
- Have two browsers/emulators ready: one passenger and one driver
- Keep console logs open for backend to show Mapbox requests
- Keep demo actions small and repeatable (create a test ride near the demo area)
