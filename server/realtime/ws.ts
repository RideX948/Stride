import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { sdk } from "../_core/sdk";
import * as db from "../db";
import { realtimeBus, type Address, type BusMessage, type RealtimeEvent } from "./bus";

/**
 * WebSocket push channel at /api/ws.
 *
 * Auth: token in the query string (?token=<jwt>) verified via sdk.verifySession
 * BEFORE the upgrade is accepted — cookies are unreliable on native and
 * cross-origin web, matching the bearer scheme lib/trpc.ts already uses.
 * Do NOT log upgrade URLs: they contain the session token.
 *
 * ID conventions (repeated from routers.ts because it bites):
 *  - user channels are keyed by users.id (socket.userId)
 *  - "driver:<id>" GPS topics are keyed by driverProfiles.id
 *  - "ride:<id>" rooms are keyed by rides.id; rides.driverId stores
 *    driverProfiles.id, NOT users.id — membership checks map via the profile.
 */

const WS_PATH = "/api/ws";
const HEARTBEAT_MS = 30_000;

type ClientSocket = WebSocket & {
  userId: number;
  /** driverProfiles.id if this user has a driver profile (resolved lazily). */
  driverProfileId?: number | null;
  topics: Set<string>;
  /** rideIds this socket has passed a membership check for. */
  authorizedRides: Set<number>;
  isAlive: boolean;
};

// Registries: userId → sockets (multiple tabs/devices), topic → sockets.
const userSockets = new Map<number, Set<ClientSocket>>();
const topicSockets = new Map<string, Set<ClientSocket>>();

function addToRegistry<K>(map: Map<K, Set<ClientSocket>>, key: K, ws: ClientSocket) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(ws);
}

function removeFromRegistry<K>(map: Map<K, Set<ClientSocket>>, key: K, ws: ClientSocket) {
  const set = map.get(key);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) map.delete(key);
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Dead socket — the heartbeat sweep will clean it up.
  }
}

// ─── Topic authorization ──────────────────────────────────────────────────────

async function canSubscribe(ws: ClientSocket, topic: string): Promise<boolean> {
  // "drivers:online" — must actually be a driver (have a profile row).
  if (topic === "drivers:online") {
    if (ws.driverProfileId === undefined) {
      const profile = await db.getOrCreateDriverProfile(ws.userId);
      ws.driverProfileId = profile?.id ?? null;
    }
    return ws.driverProfileId != null;
  }

  // "ride:<id>" — must be the ride's passenger or its driver.
  const rideMatch = topic.match(/^ride:(\d+)$/);
  if (rideMatch) {
    const rideId = Number(rideMatch[1]);
    if (ws.authorizedRides.has(rideId)) return true;
    const ride = await db.getRideById(rideId);
    if (!ride) return false;
    let member = ride.passengerId === ws.userId;
    if (!member && ride.driverId != null) {
      // rides.driverId is driverProfiles.id — resolve to the owning user.
      const driver = await db.getDriverPublicById(ride.driverId);
      member = driver?.userId === ws.userId;
    }
    if (member) ws.authorizedRides.add(rideId);
    return member;
  }

  // "driver:<profileId>" — GPS stream; same data as the public driver.getPublic
  // query, so any authenticated user may listen.
  if (/^driver:\d+$/.test(topic)) return true;

  return false;
}

// ─── Client message handling ──────────────────────────────────────────────────

async function handleMessage(ws: ClientSocket, raw: string) {
  let msg: { type?: string; topic?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type === "ping") {
    send(ws, { type: "pong" });
    return;
  }

  if (msg.type === "subscribe" && typeof msg.topic === "string") {
    const topic = msg.topic;
    if (ws.topics.has(topic)) {
      send(ws, { type: "subscribed", topic });
      return;
    }
    try {
      if (await canSubscribe(ws, topic)) {
        ws.topics.add(topic);
        addToRegistry(topicSockets, topic, ws);
        send(ws, { type: "subscribed", topic });
      } else {
        send(ws, { type: "error", topic, code: "FORBIDDEN" });
      }
    } catch (err) {
      console.error("[realtime] subscribe check failed:", err);
      send(ws, { type: "error", topic, code: "INTERNAL" });
    }
    return;
  }

  if (msg.type === "unsubscribe" && typeof msg.topic === "string") {
    ws.topics.delete(msg.topic);
    removeFromRegistry(topicSockets, msg.topic, ws);
  }
}

// ─── Fan-out from the bus ─────────────────────────────────────────────────────

function deliver(address: Address, event: RealtimeEvent) {
  const targets =
    address.kind === "user"
      ? userSockets.get(address.userId)
      : topicSockets.get(address.topic);
  if (!targets || targets.size === 0) return;
  const payload = JSON.stringify({ ...event, ts: Date.now() });
  for (const ws of targets) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
      } catch {
        /* pruned by heartbeat */
      }
    }
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export function initRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    try {
      const token = url.searchParams.get("token");
      const session = await sdk.verifySession(token);
      const user = session ? await db.getUserByOpenId(session.openId) : null;
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (rawWs) => {
        const ws = rawWs as ClientSocket;
        ws.userId = user.id;
        ws.topics = new Set();
        ws.authorizedRides = new Set();
        ws.isAlive = true;
        addToRegistry(userSockets, user.id, ws);
        wss.emit("connection", ws, req);
        send(ws, { type: "connected", userId: user.id });
      });
    } catch (err) {
      console.error("[realtime] upgrade failed:", err);
      socket.destroy();
    }
  });

  wss.on("connection", (rawWs) => {
    const ws = rawWs as ClientSocket;

    ws.on("message", (data) => {
      void handleMessage(ws, data.toString());
    });

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("close", () => {
      removeFromRegistry(userSockets, ws.userId, ws);
      for (const topic of ws.topics) {
        removeFromRegistry(topicSockets, topic, ws);
      }
    });

    ws.on("error", (err) => {
      console.error("[realtime] socket error:", err.message);
    });
  });

  // Heartbeat: terminate sockets that missed a ping round.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const client = ws as ClientSocket;
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch {
        client.terminate();
      }
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(heartbeat));

  realtimeBus.subscribe(({ address, event }: BusMessage) => {
    try {
      deliver(address, event);
    } catch (err) {
      console.error("[realtime] deliver failed:", err);
    }
  });

  console.log(`[realtime] WebSocket server ready at ${WS_PATH}`);
}

/** Connection/topic counts — for debugging and tests. */
export function getRealtimeStats() {
  return {
    users: userSockets.size,
    topics: Object.fromEntries(
      Array.from(topicSockets.entries()).map(([t, s]) => [t, s.size]),
    ),
  };
}
