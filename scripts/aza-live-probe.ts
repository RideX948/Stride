/**
 * Live-mode probe of the Aza test API (aza_test_ key — no real money moves).
 * Exercises server/aza.ts against api.aza.systems: session create, session
 * fetch, recipient resolve. Run: npx tsx scripts/aza-live-probe.ts
 */
import "dotenv/config";
import * as aza from "../server/aza";

async function main() {
  if (aza.isDevAzaMode()) {
    console.error("AZA_API_KEY is not set — this probe needs a real (test) key in .env");
    process.exit(1);
  }
  console.log("mode: LIVE, api:", aza.azaConfig.apiUrl);

  // 1. Create a checkout session
  const reference = `probe_${Date.now()}`;
  const session = await aza.createCheckoutSession({
    amount: 1.0,
    description: "RideX integration probe",
    reference,
    metadata: { kind: "probe" },
    idempotencyKey: reference,
  });
  console.log("createCheckoutSession:", JSON.stringify(session));
  console.log("  has checkoutUrl:", session.checkoutUrl ? "PASS" : "FAIL");
  console.log("  status PENDING:", session.status === "PENDING" ? "PASS" : `FAIL (${session.status})`);
  console.log("  reference echoed:", session.reference === reference ? "PASS" : `FAIL (${session.reference})`);

  // 2. Idempotency: same key must return the same session, not a new one
  const dup = await aza.createCheckoutSession({
    amount: 1.0,
    description: "RideX integration probe",
    reference,
    metadata: { kind: "probe" },
    idempotencyKey: reference,
  });
  console.log("idempotent re-create:", dup.id === session.id ? "PASS" : `WARN (new id ${dup.id})`);

  // 3. Fetch it back
  const fetched = await aza.getSession(session.id);
  console.log("getSession:", JSON.stringify(fetched));
  console.log("  id matches:", fetched.id === session.id ? "PASS" : "FAIL");

  // 4. Resolve a recipient that should not exist
  const bogus = await aza.resolveRecipient(`no-such-user-${Date.now()}@example.invalid`);
  console.log("resolveRecipient(bogus):", JSON.stringify(bogus), bogus.valid === false ? "PASS" : "WARN (expected invalid)");

  process.exit(0);
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
