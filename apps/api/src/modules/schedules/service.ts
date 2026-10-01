import { ERROR_CODES } from "@hep/shared";
import type { PrismaClient } from "@hep/db";
import { addCivilDays, regenerateAvailableSlots, zonedDateTimeToUtc } from "@hep/db";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import type { CatalogActor } from "../catalogs/service.js";

function timeValue(hhmm: string): Date {
  const [hour, minute] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
}

function dayValue(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function formatTime(value: Date): string {
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function formatDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function assertActiveCatalog(
  db: PrismaClient,
  input: { professionalId: string; specialtyId: string; officeId: string },
): Promise<void> {
  const [professional, specialty, office, specialtyLink, officeLink] = await Promise.all([
    db.professional.findUnique({ where: { id: input.professionalId } }),
    db.specialty.findUnique({ where: { id: input.specialtyId } }),
    db.office.findUnique({ where: { id: input.officeId } }),
    db.professionalSpecialty.findUnique({
      where: {
        professionalId_specialtyId: {
          professionalId: input.professionalId,
          specialtyId: input.specialtyId,
        },
      },
    }),
    db.professionalOffice.findUnique({
      where: {
        professionalId_officeId: {
          professionalId: input.professionalId,
          officeId: input.officeId,
        },
      },
    }),
  ]);
  if (!professional || professional.deactivatedAt || !specialty || specialty.deactivatedAt || !office || office.deactivatedAt) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El profesional, la especialidad o el consultorio no están activos.");
  }
  if (!specialtyLink || !officeLink) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El profesional no está asignado a esa especialidad o consultorio.");
  }
}

function presentSchedule<T extends { startTime: Date; endTime: Date; validFrom: Date; validTo: Date | null }>(row: T) {
  return {
    ...row,
    startTime: formatTime(row.startTime),
    endTime: formatTime(row.endTime),
    validFrom: formatDay(row.validFrom),
    validTo: row.validTo ? formatDay(row.validTo) : null,
  };
}

export async function createWeeklySchedule(
  db: PrismaClient,
  input: {
    professionalId: string;
    specialtyId: string;
    officeId: string;
    weekday: number;
    startTime: string;
    endTime: string;
    slotMinutes: number;
    validFrom: string;
    validTo: string | null;
  },
  actor: CatalogActor,
) {
  if (input.endTime <= input.startTime) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El horario de fin tiene que ser posterior al de inicio.");
  }
  if (input.validTo && input.validTo < input.validFrom) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "La vigencia es inválida.");
  }
  await assertActiveCatalog(db, input);
  const created = await db.weeklySchedule.create({
    data: {
      professionalId: input.professionalId,
      specialtyId: input.specialtyId,
      officeId: input.officeId,
      weekday: input.weekday,
      startTime: timeValue(input.startTime),
      endTime: timeValue(input.endTime),
      slotMinutes: input.slotMinutes,
      validFrom: dayValue(input.validFrom),
      validTo: input.validTo ? dayValue(input.validTo) : null,
    },
  });
  const slots = await regenerateAvailableSlots(db);
  await writeAudit(db, {
    actorType: "staff",
    actorUserId: actor.userId,
    action: "schedule.weekly.create",
    entityType: "weekly_schedule",
    entityId: created.id,
    ipHash: actor.ipHash,
    userAgentTruncated: actor.userAgentTruncated,
    metadata: { slotsCreated: slots.created, slotsRemoved: slots.removed },
  });
  return presentSchedule(created);
}

export async function updateWeeklySchedule(
  db: PrismaClient,
  id: string,
  input: { deactivated?: boolean },
  actor: CatalogActor,
) {
  const existing = await db.weeklySchedule.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "No encontrado.");
  }
  const updated = await db.weeklySchedule.update({
    where: { id },
    data: {
      ...(input.deactivated === true ? { deactivatedAt: new Date() } : {}),
      ...(input.deactivated === false ? { deactivatedAt: null } : {}),
    },
  });
  const slots = await regenerateAvailableSlots(db);
  await writeAudit(db, {
    actorType: "staff",
    actorUserId: actor.userId,
    action: "schedule.weekly.update",
    entityType: "weekly_schedule",
    entityId: id,
    ipHash: actor.ipHash,
    userAgentTruncated: actor.userAgentTruncated,
    metadata: { fields: Object.keys(input), slotsCreated: slots.created, slotsRemoved: slots.removed },
  });
  return presentSchedule(updated);
}

export async function listWeeklySchedules(db: PrismaClient, professionalId?: string) {
  const rows = await db.weeklySchedule.findMany({
    where: professionalId ? { professionalId } : {},
    orderBy: { id: "asc" },
    take: 100,
  });
  return { items: rows.map(presentSchedule) };
}

function assertException(input: {
  closed: boolean;
  startTime?: string | null;
  endTime?: string | null;
  professionalId?: string | null;
  officeId?: string | null;
  specialtyId?: string | null;
}): void {
  if (!input.professionalId && !input.officeId && !input.specialtyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "La excepción tiene que indicar profesional, consultorio o especialidad.");
  }
  if (!input.closed && (!input.startTime || !input.endTime || input.endTime <= input.startTime)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El horario excepcional es inválido.");
  }
}

export async function createScheduleException(
  db: PrismaClient,
  input: {
    date: string;
    professionalId: string | null;
    officeId: string | null;
    specialtyId: string | null;
    closed: boolean;
    startTime: string | null;
    endTime: string | null;
    reason: string | null;
  },
  actor: CatalogActor,
) {
  assertException(input);
  const created = await db.scheduleException.create({
    data: {
      date: dayValue(input.date),
      professionalId: input.professionalId,
      officeId: input.officeId,
      specialtyId: input.specialtyId,
      closed: input.closed,
      startTime: input.startTime ? timeValue(input.startTime) : null,
      endTime: input.endTime ? timeValue(input.endTime) : null,
      reason: input.reason,
    },
  });
  const slots = await regenerateAvailableSlots(db);
  await writeAudit(db, {
    actorType: "staff",
    actorUserId: actor.userId,
    action: "schedule.exception.create",
    entityType: "schedule_exception",
    entityId: created.id,
    ipHash: actor.ipHash,
    userAgentTruncated: actor.userAgentTruncated,
    metadata: { date: input.date, closed: input.closed, slotsRemoved: slots.removed },
  });
  return {
    ...created,
    date: formatDay(created.date),
    startTime: created.startTime ? formatTime(created.startTime) : null,
    endTime: created.endTime ? formatTime(created.endTime) : null,
  };
}

export async function createHoliday(
  db: PrismaClient,
  input: {
    date: string;
    name: string;
    appliesTo: "ALL" | "OFFICE" | "PROFESSIONAL";
    officeId: string | null;
    professionalId: string | null;
  },
  actor: CatalogActor,
) {
  if (input.appliesTo === "ALL" && (input.officeId || input.professionalId)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Un feriado general no lleva consultorio ni profesional.");
  }
  if (input.appliesTo === "OFFICE" && (!input.officeId || input.professionalId)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El feriado de consultorio es inválido.");
  }
  if (input.appliesTo === "PROFESSIONAL" && (!input.professionalId || input.officeId)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El feriado de profesional es inválido.");
  }
  const created = await db.holiday.create({
    data: {
      date: dayValue(input.date),
      name: input.name,
      appliesTo: input.appliesTo,
      officeId: input.officeId,
      professionalId: input.professionalId,
    },
  });
  await regenerateAvailableSlots(db);
  await writeAudit(db, {
    actorType: "staff",
    actorUserId: actor.userId,
    action: "schedule.holiday.create",
    entityType: "holiday",
    entityId: created.id,
    ipHash: actor.ipHash,
    userAgentTruncated: actor.userAgentTruncated,
    metadata: { date: input.date, appliesTo: input.appliesTo },
  });
  return { ...created, date: formatDay(created.date) };
}

export async function createScheduleBlock(
  db: PrismaClient,
  input: {
    professionalId: string | null;
    officeId: string | null;
    startsAt: string;
    endsAt: string;
    reason: string | null;
  },
  actor: CatalogActor,
) {
  if (!input.professionalId && !input.officeId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El bloqueo tiene que indicar profesional o consultorio.");
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El intervalo del bloqueo es inválido.");
  }
  const created = await db.scheduleBlock.create({
    data: {
      professionalId: input.professionalId,
      officeId: input.officeId,
      startsAt,
      endsAt,
      reason: input.reason,
    },
  });
  await regenerateAvailableSlots(db);
  await writeAudit(db, {
    actorType: "staff",
    actorUserId: actor.userId,
    action: "schedule.block.create",
    entityType: "schedule_block",
    entityId: created.id,
    ipHash: actor.ipHash,
    userAgentTruncated: actor.userAgentTruncated,
    metadata: { startsAt: input.startsAt, endsAt: input.endsAt },
  });
  return created;
}

export async function listAvailability(
  db: PrismaClient,
  input: { specialtyId: string; professionalId?: string; from: string; to: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const rangeStart = zonedDateTimeToUtc(input.from, 0);
  const rangeEnd = zonedDateTimeToUtc(addCivilDays(input.to, 1), 0);
  const rows = await db.appointmentSlot.findMany({
    where: {
      status: "AVAILABLE",
      slotKind: "REGULAR",
      specialtyId: input.specialtyId,
      ...(input.professionalId ? { professionalId: input.professionalId } : {}),
      startsAt: { gte: now > rangeStart ? now : rangeStart, lt: rangeEnd },
    },
    orderBy: { startsAt: "asc" },
    take: 200,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      professionalId: true,
      specialtyId: true,
      officeId: true,
      office: { select: { name: true, code: true } },
    },
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      professionalId: row.professionalId,
      specialtyId: row.specialtyId,
      officeId: row.officeId,
      officeName: row.office.name,
      officeCode: row.office.code,
    })),
  };
}
