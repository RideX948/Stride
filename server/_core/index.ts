import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { initRealtime } from "../realtime/ws";
import { startRideSweeper } from "../rideSweeper";
import { startPaymentSweeper } from "../paymentSweeper";
import { registerAzaRoutes } from "../azaWebhook";
import { registerMapboxRoutes } from "./mapbox";
import { ENV } from "./env";
import * as db from "../db";

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  if (!ENV.isProduction) return true;
  const allowed = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(origin);
}

function warnProductionConfig() {
  if (!ENV.isProduction) return;
  if (!(process.env.CORS_ORIGINS ?? "").trim()) {
    console.warn(
      "[config] CORS_ORIGINS is empty in production — all browser origins are allowed. Set a comma-separated allowlist.",
    );
  }
  if (process.env.AUTO_VERIFY_DRIVERS !== "false" && process.env.AUTO_VERIFY_DRIVERS !== "true") {
    console.warn(
      "[config] Set AUTO_VERIFY_DRIVERS=false in production to require manual driver verification.",
    );
  }
  if (!process.env.SMS_PROVIDER) {
    console.warn("[config] SMS_PROVIDER is not set — OTP codes will not be sent via SMS.");
  }
  if (!process.env.AZA_API_KEY) {
    console.warn("[config] AZA_API_KEY is not set — payments run in dev simulation mode.");
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // CORS: permissive in dev; allowlist in production via CORS_ORIGINS
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Aza webhook needs the raw body for HMAC verification — its route-level
  // express.raw parser must win before the global json middleware below.
  registerAzaRoutes(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerMapboxRoutes(app);

  app.get("/api/health", async (_req, res) => {
    let dbOk = false;
    try {
      dbOk = (await db.getDb()) != null;
    } catch {
      dbOk = false;
    }
    const ok = dbOk;
    res.status(ok ? 200 : 503).json({
      ok,
      db: dbOk,
      timestamp: Date.now(),
      env: ENV.isProduction ? "production" : "development",
    });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  // On Railway, PORT is assigned by the platform and must be used exactly.
  // Locally, fall back to 3006.
  const port = parseInt(process.env.PORT || "3006");

  // Realtime push channel (WebSocket) at /api/ws
  initRealtime(server);

  // Expire stale "searching" rides in the background
  startRideSweeper();

  // Reconcile pending Aza payments (webhook safety net; live mode only)
  startPaymentSweeper();

  server.listen(port, "0.0.0.0", () => {
    warnProductionConfig();
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
