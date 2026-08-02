import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { azaConfig, verifyWebhookSignature } from "../server/aza";

const SECRET = "test_signing_secret";
const body = Buffer.from(JSON.stringify({ type: "checkout.completed", reference: "topup_1_123" }));

function sign(payload: Buffer, secret: string) {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

describe("verifyWebhookSignature", () => {
  afterEach(() => {
    azaConfig.webhookSecret = "";
  });

  it("accepts a valid signature", () => {
    azaConfig.webhookSecret = SECRET;
    expect(verifyWebhookSignature(body, sign(body, SECRET))).toBe(true);
  });

  it("rejects a tampered body", () => {
    azaConfig.webhookSecret = SECRET;
    const tampered = Buffer.from(JSON.stringify({ type: "checkout.completed", reference: "topup_999_123" }));
    expect(verifyWebhookSignature(tampered, sign(body, SECRET))).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    azaConfig.webhookSecret = SECRET;
    expect(verifyWebhookSignature(body, sign(body, "wrong_secret"))).toBe(false);
  });

  it("rejects a missing header", () => {
    azaConfig.webhookSecret = SECRET;
    expect(verifyWebhookSignature(body, undefined)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    azaConfig.webhookSecret = SECRET;
    const bare = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifyWebhookSignature(body, bare)).toBe(false);
  });

  it("rejects malformed hex without throwing", () => {
    azaConfig.webhookSecret = SECRET;
    expect(verifyWebhookSignature(body, "sha256=nothex!!")).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=abc")).toBe(false); // wrong length
  });

  it("passes everything in dev mode (no secret) — with a warning", () => {
    azaConfig.webhookSecret = "";
    expect(verifyWebhookSignature(body, undefined)).toBe(true);
    expect(verifyWebhookSignature(body, "sha256=deadbeef")).toBe(true);
  });
});
