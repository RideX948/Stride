import * as aza from "./aza";
import * as db from "./db";

/**
 * Payment reconciliation sweeper (live Aza mode only).
 *
 * Webhooks are the primary completion path, but they can't reach a dev
 * machine without a public URL, and client-side getStatus polling stops the
 * moment the user closes the top-up modal. This sweeper is the safety net:
 * it periodically asks Aza for the real status of pending payments and
 * completes/fails them through the exact same code paths the webhook uses —
 * idempotent, so a webhook and a sweep racing is harmless.
 */

const SWEEP_INTERVAL_MS = 60_000;
// Don't hammer Aza for payments the user is still actively checking out.
const MIN_AGE_MS = 60_000;

async function sweep() {
  try {
    const pending = await db.getPendingProviderPayments(new Date(Date.now() - MIN_AGE_MS));
    for (const payment of pending) {
      if (!payment.providerRef || !payment.reference) continue;
      try {
        const session = await aza.getSession(payment.providerRef);
        const isRidePay = payment.reference.startsWith("ridepay_");
        if (session.status === "COMPLETED") {
          const result = isRidePay
            ? await db.completeRidePayment(payment.reference, payment.providerRef)
            : await db.completeTopUpPayment(payment.reference, payment.providerRef);
          console.log(`[payments] reconciled ${payment.reference} → completed (${result.ok ? "credited" : result.reason})`);
        } else if (session.status === "EXPIRED" || session.status === "CANCELLED") {
          await db.failTopUpPayment(payment.reference, session.status === "EXPIRED" ? "expired" : "cancelled");
          console.log(`[payments] reconciled ${payment.reference} → failed (${session.status.toLowerCase()})`);
        }
        // PENDING → leave for the next sweep
      } catch (err) {
        // Per-payment failure (network, unknown session) — skip, retry next sweep
        console.warn(`[payments] reconcile failed for ${payment.reference}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    let cause = err as { cause?: unknown };
    while (cause?.cause) cause = cause.cause as { cause?: unknown };
    const label = (cause as { code?: string })?.code ?? (cause instanceof Error ? cause.message : String(cause));
    console.warn(`[payments] sweep failed (${label}) — will retry next interval`);
  }
}

export function startPaymentSweeper() {
  if (aza.isDevAzaMode()) {
    // Dev sessions complete via the simulated timer — nothing to reconcile
    return null;
  }
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS) as unknown as NodeJS.Timeout;
  timer.unref?.();
  // Run once at startup so payments stuck from a previous session are
  // credited as soon as the server boots, not a minute later.
  sweep();
  console.log(`[payments] reconciliation sweeper started (every ${SWEEP_INTERVAL_MS / 1000}s)`);
  return timer;
}
