---
title: RideX Stride — Demo and Architecture
---

# Welcome

RideX Stride — in-app navigation MVP

Note:
- Briefly state project goal: an in-app ride tracking and navigation experience with server-side Mapbox proxy.

---

# Key Differentiators

- In-app navigation (no forced external maps)
- Server-side Mapbox proxy (token remains secret)
- Automatic off-route detection & rerouting
- TTS fallback for instructions

Note:
- Emphasize privacy and integration trade-offs.

---

# Quickstart (Demo)

1. Start backend + client: pnpm dev
2. Login with phone OTP (use dev code if visible)
3. Create Passenger account, request a ride (choose pickup & destination)
4. Login as Driver, accept ride
5. Observe route on driver tracking screen, ETA, and spoken next instruction

Note:
- For the demo, have two phones/emulators or open two browsers.

---

# Architecture (diagram)

![Architecture diagram](../diagrams/flow.svg)

Note:
- Explain client → server → Mapbox flow and the reason for server proxy.

---

# Mapbox Integration Details

- Endpoint: GET /api/mapbox/directions?originLat&originLng&destLat&destLng
- Server uses MAPBOX_TOKEN from env and returns: {distance, duration, geometry, steps}

Note:
- Mention geometry conversion (lon,lat -> {lat,lng}).

---

# Rerouting & Off-route Detection

- Client measures point-to-segment distance (haversine approximation)
- Threshold default: 40m
- Throttled immediate fetch on deviation (~8s throttle)

Note:
- Explain why server-side map-matching could be future improvement.

---

# Demo wrap-up

- Show ride completion flow and server logs (Mapbox requests)
- Q&A: discuss limitations and roadmap

Note:
- Be ready to answer questions about token security, costs, and reliability.

