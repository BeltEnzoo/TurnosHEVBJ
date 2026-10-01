import type { PrismaClient } from "@hep/db";
import type { Redis } from "ioredis";
import type { WhatsAppMessageType, WhatsAppProvider } from "./provider.js";

const MAX_ATTEMPTS = 4;

const TEMPLATE: Record<string, WhatsAppMessageType> = {
  APPOINTMENT_CONFIRMATION: "appointment_confirmation",
  APPOINTMENT_REMINDER: "appointment_reminder",
  APPOINTMENT_CANCELLED: "appointment_cancelled",
  APPOINTMENT_RESCHEDULED: "appointment_rescheduled",
  WAITLIST_OFFER: "waitlist_offer",
};

export type DeliverResult =
  | { result: "sent" }
  | { result: "skipped" }
  | { result: "failed" }
  | { result: "deferred"; delayMs: number };

function textField(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 120) : "";
}

export function appointmentMessageParams(raw: unknown, hospital: string): Record<string, string> {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const startsAt = typeof source.startsAt === "string" ? new Date(source.startsAt) : null;
  const valid = startsAt !== null && !Number.isNaN(startsAt.getTime());
  const date = valid
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(startsAt)
    : "";
  const time = valid
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(startsAt)
    : "";
  return {
    hospital,
    date,
    time,
    specialty: textField(source.specialtyName),
    professional: textField(source.professionalName),
    code: textField(source.publicCode),
  };
}

async function hospitalName(db: PrismaClient): Promise<string> {
  const row = await db.systemSetting.findUnique({ where: { key: "hospital_name" } });
  return typeof row?.value === "string" && row.value.trim() ? row.value.trim() : "Hospital";
}

export async function deliverNotification(
  deps: { db: PrismaClient; redis: Redis; provider: WhatsAppProvider; providerName: string },
  notificationId: string,
  now = new Date(),
): Promise<DeliverResult> {
  const lockKey = `wa:lock:${notificationId}`;
  const locked = await deps.redis.set(lockKey, "1", "EX", 120, "NX");
  if (locked !== "OK") {
    return { result: "skipped" };
  }
  try {
    const notice = await deps.db.notification.findUnique({
      where: { id: notificationId },
      include: { patient: { select: { phoneE164: true, whatsappOptIn: true } } },
    });
    if (!notice || notice.status !== "PENDING") {
      return { result: "skipped" };
    }
    if (!notice.patient.whatsappOptIn) {
      await deps.db.notification.update({
        where: { id: notice.id },
        data: { status: "CANCELLED" },
      });
      return { result: "skipped" };
    }
    if (notice.type === "APPOINTMENT_REMINDER") {
      const appointment = notice.appointmentId
        ? await deps.db.appointment.findUnique({
            where: { id: notice.appointmentId },
            select: { status: true, slot: { select: { startsAt: true } } },
          })
        : null;
      if (!appointment || appointment.status !== "CONFIRMED" || appointment.slot.startsAt.getTime() <= now.getTime()) {
        await deps.db.notification.update({
          where: { id: notice.id },
          data: { status: "CANCELLED" },
        });
        return { result: "skipped" };
      }
    }
    if (notice.scheduledAt && notice.scheduledAt.getTime() > now.getTime()) {
      return { result: "deferred", delayMs: notice.scheduledAt.getTime() - now.getTime() };
    }
    const messageType = TEMPLATE[notice.type];
    if (!messageType || !notice.patient.phoneE164.startsWith("+") || notice.attempts >= MAX_ATTEMPTS) {
      await deps.db.notification.update({
        where: { id: notice.id },
        data: { status: "FAILED", failedAt: now },
      });
      return { result: "failed" };
    }
    try {
      const sent = await deps.provider.send({
        toE164: notice.patient.phoneE164,
        type: messageType,
        templateKey: messageType,
        params: appointmentMessageParams(notice.params, await hospitalName(deps.db)),
        idempotencyKey: notice.idempotencyKey,
      });
      await deps.db.notificationDelivery.create({
        data: {
          notificationId: notice.id,
          provider: deps.providerName,
          providerMessageId: sent.providerMessageId,
          status: "SENT",
        },
      });
      await deps.db.notification.update({
        where: { id: notice.id },
        data: { status: "SENT", sentAt: now, attempts: { increment: 1 } },
      });
      return { result: "sent" };
    } catch (error) {
      if (isUniqueConstraint(error)) {
        await deps.db.notification.update({
          where: { id: notice.id },
          data: { status: "SENT", sentAt: now },
        });
        return { result: "sent" };
      }
      const attempts = notice.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await deps.db.notification.update({
          where: { id: notice.id },
          data: { status: "FAILED", failedAt: now, attempts },
        });
        await deps.db.notificationDelivery.create({
          data: {
            notificationId: notice.id,
            provider: deps.providerName,
            status: "FAILED",
            errorCode: "SEND_FAILED",
          },
        });
        return { result: "failed" };
      }
      await deps.db.notification.update({
        where: { id: notice.id },
        data: { attempts },
      });
      throw new Error("whatsapp send failed");
    }
  } finally {
    await deps.redis.del(lockKey);
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
