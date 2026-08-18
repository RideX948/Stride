# ENV_SAMPLE — example env variables (DO NOT COMMIT secrets)

# Server
MAPBOX_TOKEN=pk.<your_mapbox_directions_token>
DATABASE_URL=postgres://user:pass@host:5432/dbname
JWT_SECRET=replace_with_a_secure_secret

# Optional: Expo public variables for the client (exposed in JS)
EXPO_PUBLIC_API_BASE_URL=https://stride-production-e41b.up.railway.app
EXPO_PUBLIC_APP_ID=ridex
EXPO_PUBLIC_OAUTH_PORTAL_URL=https://your-oauth-portal
EXPO_PUBLIC_OAUTH_SERVER_URL=https://your-oauth-server

# Production CORS allowlist (comma-separated). Leave empty to allow all origins.
CORS_ORIGINS=https://your-app.com,http://localhost:8081

# SMS for live OTP (leave SMS_PROVIDER empty in dev)
SMS_PROVIDER=arkesel
SMS_API_KEY=
SMS_SENDER_ID=RideX

# Notes
- Put any secrets in Railway (production) or in a local .env file for development.
- The repo contains scripts/load-env.js which loads .env into process.env for server runs if present.
- For web development, EXPO_PUBLIC_API_BASE_URL helps the client find the correct backend instead of using the Metro origin.