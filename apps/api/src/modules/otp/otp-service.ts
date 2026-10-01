import { ERROR_CODES, normalizeArPhone } from "@hep/shared";
import type { AppEnv } from "@hep/config";
import type { PrismaClient } from "@hep/db";
import { hmacSha256, randomOtp, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { WhatsAppProvider } from "../whatsapp/provider.js";

export type OtpIssueInput = {
  purpose: string;
  subject: string;
  destinationE164: string;
  ip: string;
  patientId?: string | null;
};

export class OtpService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly whatsapp: WhatsAppProvider,
  ) {}

  async issue(input: OtpIssueInput): Promise<{ ok: true }> {
    const destination = normalizeArPhone(input.destinationE164) ?? input.destinationE164;
    if (!input.purpose || !input.subject || !destination) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Solicitud OTP inválida.");
    }
    const subjectHmac = hmacSha256(`${input.purpose}:${input.subject}`, this.env.SESSION_SECRET);
    const destinationHmac = hmacSha256(destination, this.env.SESSION_SECRET);
    const code = randomOtp();
    const codeHash = sha256(`${this.env.SESSION_SECRET}:${code}`);
    const expiresAt = new Date(Date.now() + this.env.OTP_TTL_SECONDS * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.otpRequest.updateMany({
        where: {
          subjectHmac,
          purpose: input.purpose,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: new Date() },
      });
      await tx.otpRequest.create({
        data: {
          purpose: input.purpose,
          subjectHmac,
          destinationHmac,
          codeHash,
          expiresAt,
          maxAttempts: this.env.OTP_MAX_ATTEMPTS,
          ipHash: sha256(input.ip),
          patientId: input.patientId ?? null,
        },
      });
    });

    await this.whatsapp.send({
      toE164: destination,
      type: "otp",
      templateKey: "otp",
      params: { code },
      idempotencyKey: `otp:${subjectHmac}:${expiresAt.toISOString()}`,
    });

    return { ok: true };
  }

  async consume(input: {
    purpose: string;
    subject: string;
    destinationE164: string;
    code: string;
  }): Promise<void> {
    if (!/^\d{6}$/.test(input.code)) {
      throw new AppError(401, ERROR_CODES.OTP_INVALID, "Código inválido o vencido.");
    }
    const destination = normalizeArPhone(input.destinationE164) ?? input.destinationE164;
    const subjectHmac = hmacSha256(`${input.purpose}:${input.subject}`, this.env.SESSION_SECRET);
    const destinationHmac = hmacSha256(destination, this.env.SESSION_SECRET);
    const codeHash = sha256(`${this.env.SESSION_SECRET}:${input.code}`);

    const otp = await this.prisma.otpRequest.findFirst({
      where: {
        subjectHmac,
        destinationHmac,
        purpose: input.purpose,
        consumedAt: null,
        invalidatedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otp || otp.expiresAt.getTime() < Date.now()) {
      throw new AppError(401, ERROR_CODES.OTP_INVALID, "Código inválido o vencido.");
    }
    if (otp.attempts >= otp.maxAttempts) {
      throw new AppError(401, ERROR_CODES.OTP_INVALID, "Código inválido o vencido.");
    }

    const ok = otp.codeHash === codeHash;
    await this.prisma.otpRequest.update({
      where: { id: otp.id },
      data: ok
        ? { consumedAt: new Date(), attempts: { increment: 1 } }
        : { attempts: { increment: 1 } },
    });
    if (!ok) {
      throw new AppError(401, ERROR_CODES.OTP_INVALID, "Código inválido o vencido.");
    }
  }
}
