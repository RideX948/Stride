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

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
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

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
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
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
