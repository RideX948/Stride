/**
 * WS spike test (manual verification): mints a session token for a test user,
 * connects to /api/ws, subscribes, and checks event delivery end-to-end.
 * Run: npx tsx scripts/ws-spike.ts [port]
 */
import "dotenv/config";
import WebSocket from "ws";
import { sdk } from "../server/_core/sdk";
import * as db from "../server/db";

const port = process.argv[2] ?? "3005";

async function main() {
  // Find or create a test user
  const openId = "phone:+233200000001";
  await db.upsertUser({ openId, phone: "+233200000001", name: "WS Spike", loginMethod: "phone", lastSignedIn: new Date() });
  const user = await db.getUserByOpenId(openId);
  if (!user) throw new Error("failed to create test user");
  console.log("test user id:", user.id);

  const token = await sdk.createSessionToken(openId, { name: "WS Spike", expiresInMs: 60_000 });

  // 1. Bad token should be rejected
  await new Promise<void>((resolve) => {
    const bad = new WebSocket(`ws://localhost:${port}/api/ws?token=garbage`);
    bad.on("open", () => { console.log("FAIL: bad token accepted"); resolve(); });
    bad.on("error", () => { console.log("PASS: bad token rejected"); resolve(); });
  });

  // 2. Good token: expect connected frame, then subscribe round-trips
  const ws = new WebSocket(`ws://localhost:${port}/api/ws?token=${encodeURIComponent(token)}`);
  const frames: any[] = [];
  ws.on("message", (d) => {
    const msg = JSON.parse(d.toString());
    frames.push(msg);
    console.log("recv:", JSON.stringify(msg));
  });

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });

  await new Promise((r) => setTimeout(r, 300));
  if (frames.some((f) => f.type === "connected" && f.userId === user.id)) {
    console.log("PASS: connected frame with correct userId");
  } else {
    console.log("FAIL: no connected frame");
  }

  // 3. ping/pong
  ws.send(JSON.stringify({ type: "ping" }));
  // 4. driver:<id> topic is open to all authed users
  ws.send(JSON.stringify({ type: "subscribe", topic: "driver:1" }));
  // 5. ride topic for a ride we're not on should be FORBIDDEN (or not found → forbidden)
  ws.send(JSON.stringify({ type: "subscribe", topic: "ride:999999" }));
  await new Promise((r) => setTimeout(r, 800));

  console.log("pong:", frames.some((f) => f.type === "pong") ? "PASS" : "FAIL");
  console.log("driver topic subscribed:", frames.some((f) => f.type === "subscribed" && f.topic === "driver:1") ? "PASS" : "FAIL");
  console.log("foreign ride forbidden:", frames.some((f) => f.type === "error" && f.topic === "ride:999999") ? "PASS" : "FAIL");

  // 6. Event delivery: driver.updateLocation via tRPC HTTP should push driver:location
  const res = await fetch(`http://localhost:${port}/api/trpc/driver.updateLocation`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: { driverId: 1, lat: 5.6037, lng: -0.187 } }),
  });
  console.log("updateLocation http status:", res.status);
  await new Promise((r) => setTimeout(r, 800));
  console.log(
    "driver:location event received:",
    frames.some((f) => f.type === "driver:location" && f.driverId === 1) ? "PASS" : "FAIL",
  );

  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
