export type WhatsAppMessageType =
  | "otp"
  | "appointment_confirmation"
  | "appointment_reminder"
  | "appointment_cancelled"
  | "appointment_rescheduled"
  | "waitlist_offer";

export type WhatsAppSendInput = {
  toE164: string;
  type: WhatsAppMessageType;
  templateKey: string;
  params: Record<string, string>;
  idempotencyKey: string;
};

export type WhatsAppSendResult = {
  providerMessageId: string;
};

export interface WhatsAppProvider {
  send(input: WhatsAppSendInput): Promise<WhatsAppSendResult>;
}

export class OfficialWhatsAppProvider implements WhatsAppProvider {
    async send(_input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    throw new Error(
      "OfficialWhatsAppProvider is not wired to a vendor yet. Keep WHATSAPP_PROVIDER=mock until costs, API and legal review are complete.",
    );
  }
}

type MockRecord = WhatsAppSendInput & { providerMessageId: string; at: string };

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly sent: MockRecord[] = [];
  private readonly otpByPhone = new Map<string, string>();
  private readonly seenKeys = new Set<string>();

  async send(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    const existing = this.sent.find((row) => row.idempotencyKey === input.idempotencyKey);
    if (existing) {
      return { providerMessageId: existing.providerMessageId };
    }
    if (this.seenKeys.has(input.idempotencyKey)) {
      return { providerMessageId: `mock-dup-${input.idempotencyKey}` };
    }
    this.seenKeys.add(input.idempotencyKey);
    const providerMessageId = `mock-${this.sent.length + 1}`;
    this.sent.push({ ...input, providerMessageId, at: new Date().toISOString() });
    if (input.type === "otp" && input.params["code"]) {
      this.otpByPhone.set(input.toE164, input.params["code"]);
    }
    return { providerMessageId };
  }

  getLastOtpForTests(phoneE164: string): string | undefined {
    if (process.env.NODE_ENV === "production") {
      return undefined;
    }
    return this.otpByPhone.get(phoneE164);
  }
}

export function createWhatsAppProvider(kind: "mock" | "official"): WhatsAppProvider {
  if (kind === "official") {
    return new OfficialWhatsAppProvider();
  }
  return new MockWhatsAppProvider();
}
