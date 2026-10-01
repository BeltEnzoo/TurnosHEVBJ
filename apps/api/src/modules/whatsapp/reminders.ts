import type { PrismaClient } from "@hep/db";
import type { Redis } from "ioredis";
import { enqueueSendNotification } from "./queue.js";

const DEFAULT_OFFSETS = [48, 3];

export async function reminderOffsets(db: PrismaClient): Promise<number[]> {
  const row = await db.systemSetting.findUnique({ where: { key: "reminder_offsets_hours" } });
  if (!Array.isArray(row?.value)) {
    return DEFAULT_OFFSETS;
  }
  const hours = row.value.filter((item): item is number => typeof item === "number" && item > 0 && item <= 168);
  const unique = [...new Set(hours)];
  return unique.length > 0 ? unique : DEFAULT_OFFSETS;
}

export async function scheduleAppointmentReminders(
  db: PrismaClient,
  appointmentId: string,
  redis?: Redis,
  now = new Date(),
): Promise<void> {
  const row = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { select: { whatsappOptIn: true } },
      slot: { include: { specialty: true, professional: true, office: true } },
    },
  });
  if (!row || row.status !== "CONFIRMED") {
    return;
  }
  const offsets = await reminderOffsets(db);
  for (const hours of offsets) {
    const scheduledAt = new Date(row.slot.startsAt.getTime() - hours * 60 * 60 * 1000);
    if (scheduledAt.getTime() <= now.getTime()) {
      continue;
    }
    const idempotencyKey = `APPOINTMENT_REMINDER:${row.id}:${hours}`;
    const existing = await db.notification.findUnique({ where: { idempotencyKey } });
    if (existing) {
      continue;
    }
    try {
      const notice = await db.notification.create({
        data: {
          type: "APPOINTMENT_REMINDER",
          channel: "WHATSAPP",
          appointmentId: row.id,
          patientId: row.patientId,
          status: row.patient.whatsappOptIn ? "PENDING" : "CANCELLED",
          scheduledAt: row.patient.whatsappOptIn ? scheduledAt : null,
          idempotencyKey,
          params: {
            publicCode: row.publicCode,
            specialtyName: row.slot.specialty.name,
            professionalName: `${row.slot.professional.givenName} ${row.slot.professional.familyName}`,
            officeCode: row.slot.office.code,
            startsAt: row.slot.startsAt.toISOString(),
            offsetHours: hours,
          },
        },
      });
      if (redis && notice.status === "PENDING") {
        await enqueueSendNotification(redis, notice.id, scheduledAt.getTime() - now.getTime());
      }
    } catch {
      // La clave única evita un segundo aviso del mismo offset.
    }
  }
}

export async function cancelPendingReminders(db: PrismaClient, appointmentId: string): Promise<void> {
  await db.notification.updateMany({
    where: { appointmentId, type: "APPOINTMENT_REMINDER", status: "PENDING" },
    data: { status: "CANCELLED" },
  });
}

export async function ensureUpcomingReminders(db: PrismaClient, redis: Redis, now = new Date()): Promise<{ checked: number }> {
  const offsets = await reminderOffsets(db);
  const maxHours = Math.max(...offsets);
  const until = new Date(now.getTime() + (maxHours + 24) * 60 * 60 * 1000);
  const rows = await db.appointment.findMany({
    where: {
      status: "CONFIRMED",
      slot: { startsAt: { gt: now, lte: until } },
    },
    select: { id: true },
    take: 100,
    orderBy: { id: "asc" },
  });
  for (const row of rows) {
    await scheduleAppointmentReminders(db, row.id, redis, now);
  }
  return { checked: rows.length };
}
