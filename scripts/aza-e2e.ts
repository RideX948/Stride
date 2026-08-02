/**
 * End-to-end check of the Aza payment loop (manual verification).
 * Run with the server up: npx tsx scripts/aza-e2e.ts [port]
 *
 * Dev mode (no AZA_API_KEY): the top-up auto-completes via the dev timer.
 * Live mode (aza_test_/aza_live_ key): a real checkout session is created,
 * but localhost can't receive Aza's webhook — so we deliver the
 * checkout.completed event to /api/aza/webhook ourselves (signed when
 * AZA_WEBHOOK_SECRET is set), twice, proving both the completion path and
 * webhook idempotency exactly as production would exercise them.
 */
import "dotenv/config";
import { createHmac } from "crypto";
import { sdk } from "../server/_core/sdk";
import * as db from "../server/db";

const port = process.argv[2] ?? "3005";
const base = `http://localhost:${port}/api/trpc`;

async function callTrpc(proc: string, input: unknown, token: string, isMutation = true) {
  const url = `${base}/${proc}`;
  const res = await fetch(isMutation ? url : `${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`, {
    method: isMutation ? "POST" : "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(isMutation ? { body: JSON.stringify({ json: input }) } : {}),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${proc} → ${res.status}: ${JSON.stringify(body)}`);
  return body?.result?.data?.json;
}

/** Deliver a webhook event to the local server the way Aza would. */
async function deliverWebhook(event: object) {
  const raw = Buffer.from(JSON.stringify(event));
  const secret = process.env.AZA_WEBHOOK_SECRET ?? "";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) {
    headers["x-aza-signature"] = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  }
  const res = await fetch(`http://localhost:${port}/api/aza/webhook`, { method: "POST", headers, body: raw });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  const openId = "phone:+233200000002";
  await db.upsertUser({ openId, phone: "+233200000002", name: "Aza E2E", loginMethod: "phone", lastSignedIn: new Date() });
  const user = await db.getUserByOpenId(openId);
  if (!user) throw new Error("no test user");
  const token = await sdk.createSessionToken(openId, { name: "Aza E2E", expiresInMs: 300_000 });
  console.log("user:", user.id);

  // Balance before
  const before = await callTrpc("passenger.getWallet", { userId: user.id }, token, false);
  console.log("balance before:", before.balance);

  // 1. Create top-up
  const topUp = await callTrpc("payments.createTopUp", { amount: 25 }, token);
  console.log("createTopUp:", JSON.stringify(topUp));
  console.log("mode:", topUp.devMode ? "dev (simulated)" : "LIVE (real Aza session)");
  if (topUp.devMode) {
    if (topUp.checkoutUrl !== "") console.log("WARN: expected empty checkoutUrl in dev mode");
  } else {
    console.log("checkoutUrl:", topUp.checkoutUrl ? "PASS" : "FAIL (missing)");
    // Nobody pays at the hosted checkout in this script — complete the loop
    // by delivering the webhook ourselves, exactly as Aza's servers would.
    const payment = await db.getPaymentById(topUp.paymentId);
    const delivery = await deliverWebhook({
      type: "checkout.completed",
      id: topUp.sessionId,
      reference: payment!.reference,
    });
    console.log("webhook delivery:", JSON.stringify(delivery), delivery.status === 200 ? "PASS" : "FAIL");
  }

  // 2. Poll status until completed
  let status = "pending";
  for (let i = 0; i < 8 && status === "pending"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await callTrpc("payments.getStatus", { paymentId: topUp.paymentId }, token, false);
    status = s.status;
  }
  console.log("payment status:", status, status === "completed" ? "PASS" : "FAIL");

  // 3. Balance after
  const after = await callTrpc("passenger.getWallet", { userId: user.id }, token, false);
  console.log("balance after:", after.balance);
  const diff = parseFloat(after.balance) - parseFloat(before.balance);
  console.log("credited:", diff.toFixed(2), Math.abs(diff - 25) < 0.001 ? "PASS" : "FAIL");

  // 4. Idempotency: redeliver the completion — must not double-credit.
  //    Live mode: a second webhook delivery (Aza retry). Dev mode: a direct
  //    duplicate completion call.
  const payment = await db.getPaymentById(topUp.paymentId);
  if (topUp.devMode) {
    const again = await db.completeTopUpPayment(payment!.reference!, "dup_test");
    console.log("duplicate completion:", JSON.stringify(again), !again.ok && again.reason === "already_processed" ? "PASS" : "FAIL");
  } else {
    const redelivery = await deliverWebhook({
      type: "checkout.completed",
      id: topUp.sessionId,
      reference: payment!.reference,
    });
    console.log("webhook redelivery:", JSON.stringify(redelivery), redelivery.status === 200 ? "PASS" : "FAIL");
  }
  const final = await callTrpc("passenger.getWallet", { userId: user.id }, token, false);
  console.log("balance unchanged:", final.balance, final.balance === after.balance ? "PASS" : "FAIL");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
