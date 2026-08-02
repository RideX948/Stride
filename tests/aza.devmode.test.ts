import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azaConfig, createCheckoutSession, createConnectTransfer, isDevAzaMode, resolveRecipient } from "../server/aza";

describe("aza dev mode (no API key)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    azaConfig.apiKey = "";
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports dev mode when no key is configured", () => {
    expect(isDevAzaMode()).toBe(true);
  });

  it("returns a simulated checkout session without any network call", async () => {
    const session = await createCheckoutSession({
      amount: 50,
      description: "test top-up",
      reference: "topup_1_123",
      idempotencyKey: "topup_1_123",
    });
    expect(session.id).toMatch(/^dev_/);
    expect(session.checkoutUrl).toBe(""); // empty = dev marker for the client
    expect(session.status).toBe("PENDING");
    expect(session.amount).toBe(50);
    expect(session.reference).toBe("topup_1_123");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a simulated completed transfer without any network call", async () => {
    const transfer = await createConnectTransfer({
      recipient: "driver@example.com",
      amount: 120.5,
      note: "payout",
      idempotencyKey: "payout_1",
    });
    expect(transfer.id).toMatch(/^dev_tr_/);
    expect(transfer.status).toBe("COMPLETED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats any recipient as valid in dev mode", async () => {
    const result = await resolveRecipient("anyone@example.com");
    expect(result.valid).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
