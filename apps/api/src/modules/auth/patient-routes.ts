import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ERROR_CODES, normalizeArPhone, normalizeDni } from "@hep/shared";
import { hmacSha256, randomToken, sha256 } from "../../lib/crypto.js";
import { clearSessionCookie, patientCookieName, setSessionCookie } from "../../lib/cookies.js";
import { AppError } from "../../lib/errors.js";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { assertTurnstile } from "../../lib/turnstile.js";
import { createPatientSession, loadPatientSession } from "./session.js";

const PATIENT_SESSION_SECONDS = 30 * 60;
const PURPOSE = "patient_auth";

const identity = z.object({
  dni: z.string().trim().min(7).max(12),
  phone: z.string().trim().min(8).max(20),
  turnstileToken: z.string().min(1).max(2048),
});

const verifyBody = identity.extend({
  code: z.string().trim().min(6).max(6),
});

const generic = {
  ok: true as const,
  message: "Si los datos son correctos, te enviamos un código por WhatsApp.",
};

export async function registerPatientAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/auth/patient/otp/request", async (request) => {
    const body = identity.parse(request.body);
    await assertTurnstile(app.env, body.turnstileToken, request.ip);
    const dni = normalizeDni(body.dni);
    const phone = normalizeArPhone(body.phone);
    if (!dni || !phone) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "DNI o teléfono inválido.");
    }
    const dniHmac = hmacSha256(dni, app.env.SESSION_SECRET);
    const phoneHmac = hmacSha256(phone, app.env.SESSION_SECRET);
    await consumeRateLimit(app.redis, `rl:otp:ip:${sha256(request.ip)}`, 10, 15 * 60);
    await consumeRateLimit(app.redis, `rl:otp:dni:${dniHmac}`, 5, 15 * 60);
    await consumeRateLimit(app.redis, `rl:otp:phone:${phoneHmac}`, 3, 15 * 60);

    const patient = await app.prisma.patient.findUnique({ where: { dni } });
    if (patient && patient.phoneE164 !== phone) {
      return generic;
    }
    await app.otpService.issue({
      purpose: PURPOSE,
      subject: dni,
      destinationE164: phone,
      ip: request.ip,
      patientId: patient?.id ?? null,
    });
    if (app.env.NODE_ENV === "development") {
      const provider = app.whatsapp as { getLastOtpForTests?: (phone: string) => string | undefined };
      const devCode = provider.getLastOtpForTests?.(phone);
      return devCode ? { ...generic, devCode } : generic;
    }
    return generic;
  });

  app.post("/api/v1/auth/patient/otp/verify", async (request, reply) => {
    const body = verifyBody.parse(request.body);
    const dni = normalizeDni(body.dni);
    const phone = normalizeArPhone(body.phone);
    if (!dni || !phone) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "DNI o teléfono inválido.");
    }
    await consumeRateLimit(app.redis, `rl:otp-verify:ip:${sha256(request.ip)}`, 10, 15 * 60);
    await app.otpService.consume({
      purpose: PURPOSE,
      subject: dni,
      destinationE164: phone,
      code: body.code,
    });
    const dniHmac = hmacSha256(dni, app.env.SESSION_SECRET);
    const phoneHmac = hmacSha256(phone, app.env.SESSION_SECRET);
    const patient = await app.prisma.patient.findUnique({ where: { dni } });
    if (patient && patient.phoneE164 === phone) {
      await app.prisma.patient.update({
        where: { id: patient.id },
        data: { phoneVerifiedAt: new Date() },
      });
    }
    const token = randomToken();
    await createPatientSession(app.prisma, {
      dniHmac,
      phoneHmac,
      patientId: patient && patient.phoneE164 === phone ? patient.id : null,
      token,
      idleHours: PATIENT_SESSION_SECONDS / 3600,
      absoluteHours: PATIENT_SESSION_SECONDS / 3600,
      ip: request.ip,
    });
    setSessionCookie(reply, app.env, patientCookieName(app.env), token, PATIENT_SESSION_SECONDS);
    return { ok: true };
  });

  app.post("/api/v1/auth/patient/logout", async (request, reply) => {
    const token = request.cookies[patientCookieName(app.env)];
    const session = await loadPatientSession(app.prisma, token);
    if (session) {
      await app.prisma.session.update({
        where: { id: session.sessionId },
        data: { revokedAt: new Date() },
      });
    }
    clearSessionCookie(reply, app.env, patientCookieName(app.env));
    return { ok: true };
  });

  app.get("/api/v1/auth/patient/me", async (request) => {
    const session = await loadPatientSession(app.prisma, request.cookies[patientCookieName(app.env)]);
    if (!session) {
      throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "Necesita iniciar sesión.");
    }
    const patient = await app.prisma.patient.findFirst({
      where: { dniHmac: session.dniHmac, phoneHmac: session.phoneHmac },
      select: { givenName: true, familyName: true },
    });
    return {
      authenticated: true,
      givenName: patient?.givenName ?? null,
      familyName: patient?.familyName ?? null,
    };
  });
}
