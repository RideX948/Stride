/**
 * One-time Aza webhook registration. Run AFTER the merchant account exists
 * and AZA_API_KEY is set in .env:
 *
 *   npx tsx scripts/register-aza-webhook.ts https://your-public-host.com
 *
 * The URL must be publicly reachable (use `npx ngrok http 3000` locally).
 * Prints the endpoint's signing secret — set it as AZA_WEBHOOK_SECRET in .env.
 */
import "dotenv/config";

const apiKey = process.env.AZA_API_KEY ?? "";
const apiUrl = process.env.AZA_API_URL ?? "https://api.aza.systems";
const host = process.argv[2];

async function main() {
  if (!apiKey) {
    console.error("AZA_API_KEY is not set in .env — get one from merchants.aza.systems");
    process.exit(1);
  }
  if (!host) {
    console.error("Usage: npx tsx scripts/register-aza-webhook.ts https://your-public-host.com");
    process.exit(1);
  }

  const url = `${host.replace(/\/$/, "")}/api/aza/webhook`;
  console.log(`Registering webhook: ${url}`);

  const res = await fetch(`${apiUrl}/api/v1/merchant/webhooks`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      events: ["checkout.completed", "checkout.expired", "checkout.cancelled", "checkout.refunded"],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Registration failed (${res.status}):`, body);
    process.exit(1);
  }

  console.log("Webhook registered:", JSON.stringify(body, null, 2));
  const secret = body.signingSecret ?? body.secret ?? body.data?.signingSecret;
  if (secret) {
    console.log(`\nAdd this to your .env:\n\nAZA_WEBHOOK_SECRET=${secret}\n`);
  } else {
    console.log("\nCheck the response above for the signing secret and set it as AZA_WEBHOOK_SECRET in .env");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
