import { AppState, Platform, type AppStateStatus } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "./_core/auth";

/**
 * Realtime WebSocket client (framework-free singleton).
 *
 * Connects to the server's /api/ws push channel and delivers small JSON
 * events. React bindings live in hooks/use-realtime.ts; screens subscribe to
 * topics ("ride:<id>", "driver:<profileId>", "drivers:online") and a central
 * handler maps events to react-query invalidations. Existing polling stays on
 * at slower intervals as the degraded fallback, so a broken socket never
 * breaks the app.
 *
 * Event shapes mirror server/realtime/bus.ts (plain JSON — dates are ISO strings).
 */

export type ServerEvent =
  | { type: "connected"; userId: number }
  | { type: "subscribed"; topic: string }
  | { type: "error"; topic?: string; code?: string }
  | { type: "pong" }
  | { type: "ride:new"; rideId: number; rideType: string; ts: number }
  | { type: "ride:taken"; rideId: number; ts: number }
  | { type: "ride:update"; rideId: number; status: string; ts: number }
  | { type: "driver:location"; driverId: number; lat: number; lng: number; ts: number }
  | {
      type: "message:new";
      rideId: number;
      message: {
        id: number;
        rideId: number;
        senderId: number;
        senderRole: "passenger" | "driver";
        body: string;
        createdAt: string;
      };
      ts: number;
    }
  | { type: "sos:update"; rideId: number; sosId: number; triggeredBy: string; status: string; ts: number }
  | { type: "notification:new"; ts: number }
  | { type: "wallet:update"; ts: number };

export type RealtimeStatus = "connecting" | "open" | "closed";

const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 40_000; // force-reconnect if the server goes silent
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

function buildWsUrl(token: string): string | null {
  let base = getApiBaseUrl();
  if (!base) {
    // Relative base — only meaningful on web where we know our own origin.
    if (Platform.OS === "web" && typeof window !== "undefined" && window.location) {
      base = window.location.origin;
    } else {
      return null;
    }
  }
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/api/ws?token=${encodeURIComponent(token)}`;
}

class RealtimeClient {
  private ws: WebSocket | null = null;
  private desiredTopics = new Map<string, number>(); // topic → refcount
  private handlers = new Set<(ev: ServerEvent) => void>();
  private statusListeners = new Set<(status: RealtimeStatus) => void>();
  private _status: RealtimeStatus = "closed";
  private shouldRun = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private appStateSub: { remove: () => void } | null = null;

  get status(): RealtimeStatus {
    return this._status;
  }

  /** Start (or restart) the connection loop. Safe to call repeatedly. */
  connect() {
    this.shouldRun = true;
    this.watchAppState();
    if (this.ws || this.reconnectTimer) return;
    void this.open();
  }

  /** Stop the loop and close the socket (e.g. on logout). */
  disconnect() {
    this.shouldRun = false;
    this.clearTimers();
    this.appStateSub?.remove();
    this.appStateSub = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already dead */
      }
      this.ws = null;
    }
    this.setStatus("closed");
  }

  /**
   * Declare interest in a topic. Ref-counted: the socket subscribes on first
   * interest, unsubscribes when the last consumer leaves, and re-subscribes
   * automatically after every reconnect. Returns a cleanup function.
   */
  subscribe(topic: string): () => void {
    const count = this.desiredTopics.get(topic) ?? 0;
    this.desiredTopics.set(topic, count + 1);
    if (count === 0) this.send({ type: "subscribe", topic });

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.desiredTopics.get(topic) ?? 0;
      if (current <= 1) {
        this.desiredTopics.delete(topic);
        this.send({ type: "unsubscribe", topic });
      } else {
        this.desiredTopics.set(topic, current - 1);
      }
    };
  }

  /** Listen for server events. Returns a cleanup function. */
  on(handler: (ev: ServerEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatusChange(cb: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private setStatus(status: RealtimeStatus) {
    if (this._status === status) return;
    this._status = status;
    for (const cb of this.statusListeners) {
      try {
        cb(status);
      } catch {
        /* listener error — ignore */
      }
    }
  }

  private async open() {
    if (!this.shouldRun || this.ws) return;

    const token = await Auth.getSessionToken();
    if (!token) {
      // Not signed in yet — retry on the backoff schedule.
      this.scheduleReconnect();
      return;
    }
    const url = buildWsUrl(token);
    if (!url) {
      this.scheduleReconnect();
      return;
    }

    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      // Wait for the server's "connected" frame before declaring victory —
      // fires below in onmessage.
    };

    ws.onmessage = (e) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.lastPongAt = Date.now();

      if (event.type === "connected") {
        this.attempts = 0;
        this.setStatus("open");
        this.startPing();
        // Re-subscribe everything consumers still want
        for (const topic of this.desiredTopics.keys()) {
          this.send({ type: "subscribe", topic });
        }
        return;
      }
      if (event.type === "pong") return;

      for (const handler of this.handlers) {
        try {
          handler(event);
        } catch (err) {
          console.error("[realtime] handler error:", err);
        }
      }
    };

    ws.onerror = () => {
      // onclose follows; nothing to do here
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.clearPing();
      this.setStatus("closed");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (!this.shouldRun || this.reconnectTimer) return;
    const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempts);
    const jitter = backoff * 0.2 * (Math.random() * 2 - 1); // ±20%
    this.attempts = Math.min(this.attempts + 1, 10);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, Math.max(250, backoff + jitter));
  }

  private startPing() {
    this.clearPing();
    this.lastPongAt = Date.now();
    this.pingTimer = setInterval(() => {
      // RN doesn't surface half-open sockets — if the server has gone silent
      // past the timeout, force-close to trigger the reconnect path.
      if (Date.now() - this.lastPongAt > PONG_TIMEOUT_MS) {
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
        return;
      }
      this.send({ type: "ping" });
    }, PING_INTERVAL_MS);
  }

  private clearPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimers() {
    this.clearPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private send(payload: { type: string; topic?: string }) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch {
        /* socket died mid-send; reconnect loop handles it */
      }
    }
  }

  private watchAppState() {
    if (this.appStateSub) return;
    // The socket dies while backgrounded on native (and browsers may drop it
    // in background tabs) — reconnect promptly on foreground.
    this.appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active" && this.shouldRun && !this.ws && !this.reconnectTimer) {
        this.attempts = 0;
        void this.open();
      }
    });
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("online", () => {
        if (this.shouldRun && !this.ws) {
          this.attempts = 0;
          void this.open();
        }
      });
    }
  }
}

export const realtime = new RealtimeClient();
