import express, { type Express, type Request, type Response } from "express";
import * as aza from "./aza";
import * as db from "./db";

/**
 * Aza webhook receiver: POST /api/aza/webhook
 *
 * Registered with a route-level express.raw parser and mounted BEFORE the
 * global express.json middleware in server/_core/index.ts — the signature is
 * an HMAC over the exact raw bytes, so the body must not be parsed first.
 *
 * Aza retries failed deliveries with exponential backoff. Idempotency comes
 * from the payments status guard (a payment leaves "pending" exactly once),
 * so duplicate deliveries return 200 without double-crediting. Never respond
 * 5xx for a duplicate — only for genuine processing failures.
 */
export function registerAzaRoutes(app: Express) {
  app.post("/api/aza/webhook", express.raw({ type: "*/*" }), async (req: Request, res: Response) => {
    try {
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: "expected raw body" });
        return;
      }
      const signature = req.headers["x-aza-signature"];
      if (!aza.verifyWebhookSignature(req.body, typeof signature === "string" ? signature : undefined)) {
        res.status(401).json({ error: "invalid signature" });
        return;
      }

      // Real deliveries: { event: "checkout.completed", sessionId, reference, ... }
      // (older shape { type, id } still accepted for the e2e script/tests)
      let event: { event?: string; type?: string; sessionId?: string; id?: string; reference?: string };
      try {
        event = JSON.parse(req.body.toString("utf8"));
      } catch {
        res.status(400).json({ error: "invalid JSON" });
        return;
      }
      const eventType = event.event ?? event.type;
      const sessionId = event.sessionId ?? event.id;

      switch (eventType) {
        case "checkout.completed": {
          if (event.reference) {
            // ridepay_ = ride fare payment; everything else = wallet top-up
            const result = event.reference.startsWith("ridepay_")
              ? await db.completeRidePayment(event.reference, sessionId)
              : await db.completeTopUpPayment(event.reference, sessionId);
            if (!result.ok) {
              // already_processed = retry duplicate; not_found = not ours.
              // Both are 200 — Aza must not keep retrying.
              console.log(`[aza] checkout.completed for ${event.reference}: ${result.reason}`);
            }
          }
          break;
        }
        case "checkout.expired":
        case "checkout.cancelled": {
          if (event.reference) {
            await db.failTopUpPayment(event.reference, eventType === "checkout.expired" ? "expired" : "cancelled");
          }
          break;
        }
        case "checkout.refunded": {
          // Rare: a completed top-up refunded from the merchant dashboard.
          // Log for manual reconciliation; automatic clawback intentionally
          // not implemented (would need negative-balance policy).
          console.warn(`[aza] checkout.refunded received for ${event.reference} — manual reconciliation needed`);
          break;
        }
        default:
          console.log(`[aza] ignoring webhook event type: ${eventType}`);
      }

      res.json({ received: true });
    } catch (err) {
      // Genuine failure — 500 so Aza retries the delivery
      console.error("[aza] webhook processing failed:", err);
      res.status(500).json({ error: "processing failed" });
    }
  });
}
