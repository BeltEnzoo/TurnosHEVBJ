import { createHmac, timingSafeEqual } from "node:crypto";
import { ERROR_CODES } from "@hep/shared";
import type { PrismaClient } from "@hep/db";
import type { Redis } from "ioredis";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";

const TIMESTAMP_SKEW_SECONDS = 300;
const EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;

const payloadSchema = z.object({
  providerEventId: z.string().regex(/^[A-Za-z0-9_.:-]{8,120}$/),
  providerMessageId: z.string().min(1).max(120),
  status: z.enum(["SENT", "DELIVERED", "READ", "FAILED"]),
  errorCode: z.string().regex(/^[A-Z0-9_]{1,40}$/).optional(),
});

const RANK: Record<string, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

export function webhookSignature(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function signaturesMatch(expected: string, received: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function unauthorized(): AppError {
  return new AppError(401, ERROR_CODES.UNAUTHORIZED, "Firma inválida.");
}

function shouldApply(current: string, next: string): boolean {
  if (current === next || current === "READ" || current === "FAILED") {
    return false;
  }
  if (next === "FAILED") {
    return true;
  }
  return (RANK[next] ?? 0) > (RANK[current] ?? 0);
}

export async function applyWhatsAppWebhook(input: {
  db: PrismaClient;
  redis: Redis;
  secret: string;
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
}): Promise<{ ok: true }> {
  if (input.secret.length < 16) {
    throw new AppError(503, ERROR_CODES.NOT_READY, "El webhook no está configurado.");
  }
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > TIMESTAMP_SKEW_SECONDS) {
    throw unauthorized();
  }
  if (!input.signature || !signaturesMatch(webhookSignature(input.secret, input.rawBody), input.signature)) {
    throw unauthorized();
  }
  let body: z.infer<typeof payloadSchema>;
  try {
    body = payloadSchema.parse(JSON.parse(input.rawBody));
  } catch {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Datos inválidos.");
  }
  const eventKey = `wa:evt:${body.providerEventId}`;
  const claimed = await input.redis.set(eventKey, "pending", "EX", 120, "NX");
  if (claimed !== "OK") {
    const current = await input.redis.get(eventKey);
    if (current === "done") {
      return { ok: true };
    }
    throw new AppError(503, ERROR_CODES.NOT_READY, "Intente nuevamente.");
  }
  try {
    const delivery = await input.db.notificationDelivery.findUnique({
      where: { providerMessageId: body.providerMessageId },
    });
    if (delivery && shouldApply(delivery.status, body.status)) {
      await input.db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: body.status,
          errorCode: body.status === "FAILED" ? (body.errorCode ?? "PROVIDER_FAILED") : null,
        },
      });
      if (body.status === "FAILED") {
        await input.db.notification.updateMany({
          where: { id: delivery.notificationId, status: "PENDING" },
          data: { status: "FAILED", failedAt: new Date() },
        });
      } else {
        await input.db.notification.updateMany({
          where: { id: delivery.notificationId, status: "PENDING" },
          data: { status: "SENT", sentAt: new Date() },
        });
      }
    }
    await input.redis.set(eventKey, "done", "EX", EVENT_TTL_SECONDS);
    return { ok: true };
  } catch (error) {
    await input.redis.del(eventKey);
    throw error;
  }
}
