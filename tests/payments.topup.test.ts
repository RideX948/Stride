import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";

// Simulate the payments status-transition guard: the first completion for a
// reference succeeds, later ones report already_processed — like the real
// db.completeTopUpPayment.
const credited = new Set<string>();
vi.mock("../server/db", () => ({
  completeTopUpPayment: vi.fn(async (reference: string) => {
    if (credited.has(reference)) return { ok: false, reason: "already_processed" as const };
    credited.add(reference);
    return { ok: true, newBalance: "50.00" };
  }),
  failTopUpPayment: vi.fn(async () => {}),
}));

import { registerAzaRoutes } from "../server/azaWebhook";
import * as db from "../server/db";

async function withServer(fn: (baseUrl: string) => Promise<void>) {
  const app = express();
  registerAzaRoutes(app);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function postWebhook(baseUrl: string, event: object) {
  return fetch(`${baseUrl}/api/aza/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
}

describe("aza webhook top-up idempotency (dev mode, no signature)", () => {
  beforeEach(() => {
    credited.clear();
    vi.clearAllMocks();
  });

  it("credits once and returns 200 for a duplicate delivery", async () => {
    await withServer(async (baseUrl) => {
      const event = { type: "checkout.completed", id: "evt_1", reference: "topup_1_111" };

      const first = await postWebhook(baseUrl, event);
      expect(first.status).toBe(200);

      // Aza retries the same delivery — must still be 200, no double credit
      const second = await postWebhook(baseUrl, event);
      expect(second.status).toBe(200);

      expect(db.completeTopUpPayment).toHaveBeenCalledTimes(2);
      expect(credited.size).toBe(1);
    });
  });

  it("returns 200 for an unknown reference (not ours — never 5xx)", async () => {
    await withServer(async (baseUrl) => {
      const res = await postWebhook(baseUrl, {
        type: "checkout.completed",
        id: "evt_2",
        reference: "unknown_ref",
      });
      expect(res.status).toBe(200);
    });
  });

  it("routes expired/cancelled to failTopUpPayment", async () => {
    await withServer(async (baseUrl) => {
      const res = await postWebhook(baseUrl, {
        type: "checkout.expired",
        id: "evt_3",
        reference: "topup_1_222",
      });
      expect(res.status).toBe(200);
      expect(db.failTopUpPayment).toHaveBeenCalledWith("topup_1_222", "expired");
    });
  });

  it("rejects invalid JSON with 400", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/aza/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      expect(res.status).toBe(400);
    });
  });
});
