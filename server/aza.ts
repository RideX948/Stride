/**
 * Aza payments integration (api.aza.systems — Ghana merchant payments).
 *
 * In development (no AZA_API_KEY configured) every call is simulated:
 * checkout sessions auto-complete via a dev timer in the payments router and
 * Connect transfers succeed instantly — the whole money loop is testable
 * without a merchant account. Set AZA_API_KEY (aza_test_... or aza_live_...)
 * to flip to real API calls with zero code changes.
 *
 * Endpoints used (all under /api/v1, X-Api-Key auth):
 *  - POST /merchant/sessions                    hosted checkout for top-ups
 *  - GET  /merchant/sessions/{id}               session status
 *  - POST /merchant/connect/transfers           driver payouts to their Aza wallet
 *  - GET  /merchant/connect/recipients/resolve  validate a recipient
 *
 * Webhooks: X-Aza-Signature: sha256=<hex> — HMAC-SHA256 over the RAW body.
 */

import { createHmac, randomUUID, timingSafeEqual } from "crypto";

export const azaConfig = {
  apiKey: process.env.AZA_API_KEY ?? "", // "" = dev mode
  webhookSecret: process.env.AZA_WEBHOOK_SECRET ?? "",
  apiUrl: process.env.AZA_API_URL ?? "https://api.aza.systems",
};

export const isDevAzaMode = () => !azaConfig.apiKey;

export type AzaSessionStatus = "PENDING" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "REFUNDED";

export type AzaSession = {
  id: string;
  checkoutUrl: string; // "" in dev mode — the client treats that as the simulated marker
  status: AzaSessionStatus;
  amount: number;
  reference?: string;
};

export type AzaTransfer = { id: string; status: string };

async function azaFetch(path: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${azaConfig.apiUrl}/api/v1${path}`, {
      ...init,
      headers: {
        "X-Api-Key": azaConfig.apiKey,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Error envelope: { success: false, error: { code, message } } — with
      // fallbacks for flat { error, message } shapes.
      const err = body?.error;
      const code = (typeof err === "object" ? err?.code : err) ?? `HTTP_${res.status}`;
      const message = (typeof err === "object" ? err?.message : body?.message) ?? "Aza API request failed";
      throw new Error(`[aza] ${code}: ${message}`);
    }
    // Success envelope: { success: true, data: {...} } — unwrap it
    return body?.data ?? body;
  } finally {
    clearTimeout(timer);
  }
}

/** Create a hosted checkout session. Customer pays at checkoutUrl. */
export async function createCheckoutSession(params: {
  amount: number; // GHS, e.g. 50.0
  description: string;
  reference: string; // our reference — echoed on the session and in webhooks
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<AzaSession> {
  if (isDevAzaMode()) {
    const session: AzaSession = {
      id: `dev_${randomUUID()}`,
      checkoutUrl: "",
      status: "PENDING",
      amount: params.amount,
      reference: params.reference,
    };
    console.log(`[aza:dev] simulated checkout session ${session.id} for GH₵${params.amount.toFixed(2)} (${params.reference})`);
    return session;
  }

  const body = await azaFetch("/merchant/sessions", {
    method: "POST",
    body: JSON.stringify({
      amount: Number(params.amount.toFixed(2)),
      description: params.description,
      reference: params.reference,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
      idempotencyKey: params.idempotencyKey,
    }),
  });
  return {
    id: body.id,
    checkoutUrl: body.checkoutUrl,
    status: body.status ?? "PENDING",
    amount: body.amount ?? params.amount,
    reference: body.reference ?? params.reference,
  };
}

/** Fetch a checkout session's current status. */
export async function getSession(sessionId: string): Promise<AzaSession> {
  if (isDevAzaMode()) {
    // Dev sessions live only in the payments table; report PENDING here and
    // let the dev auto-complete timer drive the real state.
    return { id: sessionId, checkoutUrl: "", status: "PENDING", amount: 0 };
  }
  const body = await azaFetch(`/merchant/sessions/${sessionId}`);
  return {
    id: body.id,
    checkoutUrl: body.checkoutUrl ?? "",
    status: body.status,
    amount: body.amount ?? 0,
    reference: body.reference,
  };
}

/** Push money from the merchant balance to a driver's own Aza wallet. */
export async function createConnectTransfer(params: {
  recipient: string; // Aza email or username
  amount: number;
  note: string;
  idempotencyKey: string; // retry-safe: same key returns the original transfer
}): Promise<AzaTransfer> {
  if (isDevAzaMode()) {
    await new Promise((r) => setTimeout(r, 300));
    const transfer = { id: `dev_tr_${randomUUID()}`, status: "COMPLETED" };
    console.log(`[aza:dev] simulated transfer ${transfer.id}: GH₵${params.amount.toFixed(2)} → ${params.recipient || "(no recipient)"}`);
    return transfer;
  }
  const body = await azaFetch("/merchant/connect/transfers", {
    method: "POST",
    body: JSON.stringify({
      recipient: params.recipient,
      amount: Number(params.amount.toFixed(2)),
      note: params.note,
      idempotencyKey: params.idempotencyKey,
    }),
  });
  return { id: body.id, status: body.status ?? "COMPLETED" };
}

/** Check that an Aza email/username exists before saving it as a payout target. */
export async function resolveRecipient(identifier: string): Promise<{ valid: boolean; name?: string }> {
  if (isDevAzaMode()) {
    return { valid: true, name: identifier };
  }
  try {
    const body = await azaFetch(
      `/merchant/connect/recipients/resolve?identifier=${encodeURIComponent(identifier)}`,
    );
    // Resolve returns 200 with a found/canReceive verdict in the body — an
    // unknown recipient is NOT an HTTP error.
    if (body?.found === false || body?.canReceive === false) return { valid: false };
    return { valid: true, name: body?.displayName ?? body?.name ?? identifier };
  } catch (err) {
    const message = (err as Error).message;
    // NOT_FOUND-style errors mean an invalid recipient; network errors should
    // not block saving (warn-don't-block) — the caller decides.
    if (/404|NOT_FOUND|RECIPIENT/i.test(message)) return { valid: false };
    console.warn("[aza] resolveRecipient network failure, allowing save:", message);
    return { valid: true };
  }
}

/**
 * Verify the X-Aza-Signature header ("sha256=<hex>") against the raw request
 * body. Constant-time compare. Returns true in dev mode (no secret) so the
 * simulated flow keeps working — with a loud warning.
 */
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!azaConfig.webhookSecret) {
    console.warn("[aza:dev] AZA_WEBHOOK_SECRET not set — skipping signature verification");
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length).trim();
  const expected = createHmac("sha256", azaConfig.webhookSecret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
