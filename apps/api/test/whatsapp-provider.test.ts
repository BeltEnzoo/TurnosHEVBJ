import { describe, expect, it } from "vitest";
import { MockWhatsAppProvider, OfficialWhatsAppProvider } from "../src/modules/whatsapp/provider.js";

describe("WhatsAppProvider", () => {
  it("is idempotent for the same key", async () => {
    const provider = new MockWhatsAppProvider();
    const input = {
      toE164: "+5491112345678",
      type: "otp" as const,
      templateKey: "patient_otp",
      params: { code: "123456" },
      idempotencyKey: "otp:test:1",
    };
    const first = await provider.send(input);
    const second = await provider.send(input);
    expect(first.providerMessageId).toBe(second.providerMessageId);
    expect(provider.sent).toHaveLength(1);
  });

  it("does not send via the official stub", async () => {
    const provider = new OfficialWhatsAppProvider();
    await expect(
      provider.send({
        toE164: "+5491112345678",
        type: "otp",
        templateKey: "patient_otp",
        params: { code: "123456" },
        idempotencyKey: "x",
      }),
    ).rejects.toThrow(/vendor/i);
  });
});
