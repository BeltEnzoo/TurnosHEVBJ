import { ERROR_CODES } from "@hep/shared";
import type { PrismaClient } from "@hep/db";
import type { Redis } from "ioredis";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { bookAvailableSlotInTransaction } from "../appointments/service.js";
import { enqueueSendNotification } from "../whatsapp/queue.js";

const OFFER_MS = 15 * 60 * 1000;

export async function joinWaitlist(
  db: PrismaClient,
  input: { patientId: string; specialtyId: string; professionalId?: string | null },
): Promise<{ id: string; status: "ACTIVE" }> {
  const specialty = await db.specialty.findUnique({ where: { id: input.specialtyId } });
  if (!specialty || specialty.deactivatedAt) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "La especialidad no existe.");
  }
  const professionalId = input.professionalId ?? null;
  if (professionalId) {
    const professional = await db.professional.findUnique({ where: { id: professionalId } });
    if (!professional || professional.deactivatedAt) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "El profesional no existe.");
    }
  }
  const existing = await db.waitlistEntry.findFirst({
    where: { patientId: input.patientId, specialtyId: input.specialtyId, professionalId, status: "ACTIVE" },
  });
  if (existing) {
    return { id: existing.id, status: "ACTIVE" };
  }
  const created = await db.waitlistEntry.create({
    data: {
      patientId: input.patientId,
      specialtyId: input.specialtyId,
      professionalId,
      status: "ACTIVE",
    },
  });
  return { id: created.id, status: "ACTIVE" };
}

export async function listOwnWaitlist(db: PrismaClient, patientId: string) {
  const rows = await db.waitlistEntry.findMany({
    where: { patientId, status: { in: ["ACTIVE", "FULFILLED"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      specialty: { select: { name: true } },
      professional: { select: { givenName: true, familyName: true } },
      offers: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { slot: { select: { startsAt: true, endsAt: true } } },
      },
    },
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      specialtyName: row.specialty.name,
      professionalName: row.professional ? `${row.professional.givenName} ${row.professional.familyName}` : null,
      offer: row.offers[0]
        ? {
            id: row.offers[0].id,
            status: row.offers[0].status,
            expiresAt: row.offers[0].expiresAt,
            startsAt: row.offers[0].slot.startsAt,
            endsAt: row.offers[0].slot.endsAt,
          }
        : null,
    })),
  };
}

async function notifyOffer(
  db: PrismaClient,
  redis: Redis | undefined,
  input: {
    offerId: string;
    patientId: string;
    optedIn: boolean;
    publicCode: string;
    specialtyName: string;
    professionalName: string;
    officeCode: string;
    startsAt: Date;
  },
): Promise<void> {
  try {
    const notice = await db.notification.create({
      data: {
        type: "WAITLIST_OFFER",
        channel: "WHATSAPP",
        patientId: input.patientId,
        status: input.optedIn ? "PENDING" : "CANCELLED",
        scheduledAt: input.optedIn ? new Date() : null,
        idempotencyKey: `WAITLIST_OFFER:${input.offerId}`,
        params: {
          publicCode: input.publicCode,
          specialtyName: input.specialtyName,
          professionalName: input.professionalName,
          officeCode: input.officeCode,
          startsAt: input.startsAt.toISOString(),
        },
      },
    });
    if (redis && notice.status === "PENDING") {
      await enqueueSendNotification(redis, notice.id);
    }
  } catch {
    await writeAudit(db, {
      actorType: "SYSTEM",
      action: "notification.enqueue_failed",
      entityType: "waitlist_offer",
      entityId: input.offerId,
      metadata: { type: "WAITLIST_OFFER" },
    }).catch(() => undefined);
  }
}

export async function offerFreedSlot(db: PrismaClient, redis: Redis | undefined, slotId: string, now = new Date()): Promise<void> {
  const slot = await db.appointmentSlot.findUnique({
    where: { id: slotId },
    include: { specialty: true, professional: true, office: true },
  });
  if (!slot || slot.status !== "AVAILABLE" || slot.slotKind !== "REGULAR" || slot.startsAt.getTime() <= now.getTime()) {
    return;
  }
  const created = await db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe<Array<{ id: string }>>("SELECT id FROM appointment_slots WHERE id = $1::uuid FOR UPDATE", slotId);
    const current = await tx.appointmentSlot.findUnique({ where: { id: slotId } });
    if (!current || current.status !== "AVAILABLE") {
      return null;
    }
    const pending = await tx.waitlistOffer.findFirst({
      where: { slotId, status: "PENDING", expiresAt: { gt: now } },
    });
    if (pending) {
      return null;
    }
    const used = await tx.waitlistOffer.findMany({
      where: { slotId, status: { in: ["EXPIRED", "DECLINED", "ACCEPTED"] } },
      select: { entryId: true },
    });
    const skip = new Set(used.map((row) => row.entryId));
    const candidates = await tx.waitlistEntry.findMany({
      where: {
        status: "ACTIVE",
        specialtyId: slot.specialtyId,
        OR: [{ professionalId: null }, { professionalId: slot.professionalId }],
      },
      orderBy: { createdAt: "asc" },
      take: 30,
      include: { patient: { select: { whatsappOptIn: true } } },
    });
    const entry = candidates.find((candidate) => !skip.has(candidate.id));
    if (!entry) {
      return null;
    }
    const offer = await tx.waitlistOffer.create({
      data: {
        entryId: entry.id,
        slotId,
        expiresAt: new Date(now.getTime() + OFFER_MS),
        status: "PENDING",
      },
    });
    return { offer, entry };
  });
  if (!created) {
    return;
  }
  await notifyOffer(db, redis, {
    offerId: created.offer.id,
    patientId: created.entry.patientId,
    optedIn: created.entry.patient.whatsappOptIn,
    publicCode: "OFERTA",
    specialtyName: slot.specialty.name,
    professionalName: `${slot.professional.givenName} ${slot.professional.familyName}`,
    officeCode: slot.office.code,
    startsAt: slot.startsAt,
  });
}

export async function acceptWaitlistOffer(
  db: PrismaClient,
  input: { offerId: string; patientId: string },
  now = new Date(),
): Promise<{ appointmentId: string }> {
  return db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe<Array<{ id: string }>>("SELECT id FROM waitlist_offers WHERE id = $1::uuid FOR UPDATE", input.offerId);
    const offer = await tx.waitlistOffer.findUnique({
      where: { id: input.offerId },
      include: { entry: true },
    });
    if (!offer || offer.entry.patientId !== input.patientId) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "La oferta no existe.");
    }
    if (offer.status !== "PENDING" || offer.expiresAt.getTime() <= now.getTime()) {
      if (offer.status === "PENDING") {
        await tx.waitlistOffer.update({ where: { id: offer.id }, data: { status: "EXPIRED" } });
      }
      throw new AppError(409, ERROR_CODES.CONFLICT, "La oferta ya no está vigente.");
    }
    const appointmentId = await bookAvailableSlotInTransaction(tx, {
      slotId: offer.slotId,
      patientId: input.patientId,
      now,
    });
    await tx.waitlistOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
    await tx.waitlistEntry.update({ where: { id: offer.entryId }, data: { status: "FULFILLED" } });
    await tx.waitlistOffer.updateMany({
      where: { slotId: offer.slotId, status: "PENDING", id: { not: offer.id } },
      data: { status: "EXPIRED" },
    });
    return { appointmentId };
  });
}

export async function declineWaitlistOffer(db: PrismaClient, input: { offerId: string; patientId: string }): Promise<{ slotId: string }> {
  const offer = await db.waitlistOffer.findUnique({
    where: { id: input.offerId },
    include: { entry: { select: { patientId: true } } },
  });
  if (!offer || offer.entry.patientId !== input.patientId) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "La oferta no existe.");
  }
  if (offer.status !== "PENDING") {
    throw new AppError(409, ERROR_CODES.CONFLICT, "La oferta ya no está vigente.");
  }
  await db.waitlistOffer.update({ where: { id: offer.id }, data: { status: "DECLINED" } });
  return { slotId: offer.slotId };
}

export async function expireWaitlistOffers(db: PrismaClient, redis: Redis | undefined, now = new Date()): Promise<void> {
  const due = await db.waitlistOffer.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    select: { id: true, slotId: true },
    take: 50,
  });
  if (due.length === 0) {
    return;
  }
  await db.waitlistOffer.updateMany({
    where: { id: { in: due.map((row) => row.id) }, status: "PENDING" },
    data: { status: "EXPIRED" },
  });
  const slots = [...new Set(due.map((row) => row.slotId))];
  for (const slotId of slots) {
    await offerFreedSlot(db, redis, slotId, now);
  }
}
