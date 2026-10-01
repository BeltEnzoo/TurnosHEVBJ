import { randomBytes } from "node:crypto";
import { ERROR_CODES, normalizeArPhone, normalizeDni, normalizeEmail } from "@hep/shared";
import type { Prisma, PrismaClient } from "@hep/db";
import type { Redis } from "ioredis";
import { enqueueSendNotification } from "../whatsapp/queue.js";
import { addCivilDays, civilToday, hospitalCivilDate, zonedDateTimeToUtc } from "@hep/db";
import { hmacSha256 } from "../../lib/crypto.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import type { CatalogActor } from "../catalogs/service.js";

type AppointmentActor = CatalogActor & { actorType?: "STAFF" | "PATIENT" };

const PUBLIC_CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";
const CANCELLABLE = ["CONFIRMED", "CALLED"] as const;
const ATTENDANCE = ["CONFIRMED", "CALLED", "IN_PROGRESS"] as const;

type Db = PrismaClient | Prisma.TransactionClient;

export type PatientInput = {
  givenName: string;
  familyName: string;
  dni: string;
  birthDate: string;
  phone: string;
  email?: string | null;
};

type BookedView = {
  id: string;
  publicCode: string;
  status: string;
  kind: string;
  startsAt: Date;
  endsAt: Date;
  specialtyId: string;
  specialtyName: string;
  professionalId: string;
  professionalName: string;
  officeId: string;
  officeCode: string;
  officeName: string;
  patient: { id: string; givenName: string; familyName: string; dni: string; phoneE164: string };
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function uniqueTarget(error: unknown): string {
  if (typeof error !== "object" || error === null || !("meta" in error)) {
    return "";
  }
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return JSON.stringify(target ?? "");
}

function randomPublicCode(): string {
  const bytes = randomBytes(5);
  const chars = Array.from(bytes, (byte) => PUBLIC_CODE_ALPHABET[byte % PUBLIC_CODE_ALPHABET.length]!);
  return `${chars[0]}${chars[1]}-${chars[2]}${chars[3]}${chars[4]}`;
}

async function settingNumber(db: Db, key: string, fallback: number, min: number, max: number): Promise<number> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  const raw = row?.value;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= max) {
    return raw;
  }
  return fallback;
}

function assertNotice(startsAt: Date, now: Date, minHours: number): void {
  if (startsAt.getTime() <= now.getTime()) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya pasó.");
  }
  if (startsAt.getTime() - now.getTime() < minHours * 3_600_000) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "Hay que hacerlo con más anticipación.");
  }
}

async function assertInsideHorizon(db: Db, startsAt: Date, now: Date): Promise<void> {
  const horizon = await settingNumber(db, "booking_horizon_days", 45, 1, 90);
  const today = civilToday(now);
  const civil = hospitalCivilDate(startsAt);
  if (civil < today || civil >= addCivilDays(today, horizon)) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "El horario está fuera del horizonte de reserva.");
  }
}

async function assertOpenDay(
  db: Db,
  slot: { professionalId: string; officeId: string; startsAt: Date; endsAt: Date },
): Promise<void> {
  const civil = hospitalCivilDate(slot.startsAt);
  const holidays = await db.holiday.findMany({
    where: {
      OR: [{ appliesTo: "ALL" }, { officeId: slot.officeId }, { professionalId: slot.professionalId }],
    },
  });
  const closed = holidays.some((holiday) => holiday.date.toISOString().slice(0, 10) === civil);
  if (closed) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "Ese día no hay atención.");
  }
  const block = await db.scheduleBlock.findFirst({
    where: {
      startsAt: { lt: slot.endsAt },
      endsAt: { gt: slot.startsAt },
      OR: [{ professionalId: slot.professionalId }, { officeId: slot.officeId }],
    },
  });
  if (block) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "Ese horario está bloqueado.");
  }
}

async function lockSlots(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      "SELECT id FROM appointment_slots WHERE id = $1::uuid FOR UPDATE",
      id,
    );
    if (rows.length === 0) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "El horario no existe.");
    }
  }
}

async function upsertPatient(tx: Prisma.TransactionClient, input: PatientInput, secret: string) {
  const dni = normalizeDni(input.dni);
  const phone = normalizeArPhone(input.phone);
  if (!dni || !phone) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "DNI o teléfono inválido.");
  }
  const email = input.email ? normalizeEmail(input.email) : null;
  const birthDate = new Date(`${input.birthDate}T00:00:00.000Z`);
  const data = {
    givenName: input.givenName,
    familyName: input.familyName,
    dni,
    dniHmac: hmacSha256(dni, secret),
    birthDate,
    phoneE164: phone,
    phoneHmac: hmacSha256(phone, secret),
    email,
  };
  return tx.patient.upsert({
    where: { dni },
    create: data,
    update: {
      givenName: data.givenName,
      familyName: data.familyName,
      dniHmac: data.dniHmac,
      birthDate: data.birthDate,
      phoneE164: data.phoneE164,
      phoneHmac: data.phoneHmac,
      email: data.email,
    },
  });
}

async function insertAppointment(
  tx: Prisma.TransactionClient,
  input: {
    slotId: string;
    patientId: string;
    kind: "REGULAR" | "EXTRA";
    actorUserId: string | null;
    createdByType?: "STAFF" | "PATIENT";
    rescheduledFromId?: string;
  },
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await tx.appointment.create({
        data: {
          publicCode: randomPublicCode(),
          slotId: input.slotId,
          patientId: input.patientId,
          status: "CONFIRMED",
          kind: input.kind,
          createdByType: input.createdByType ?? "STAFF",
          createdByUserId: input.actorUserId,
          rescheduledFromId: input.rescheduledFromId,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error) && uniqueTarget(error).includes("public_code") && attempt < 4) {
        continue;
      }
      if (isUniqueViolation(error)) {
        throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya no está disponible.");
      }
      throw error;
    }
  }
  throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya no está disponible.");
}

async function appendHistory(
  tx: Prisma.TransactionClient,
  input: {
    appointmentId: string;
    fromStatus: string | null;
    toStatus: string;
    actorId: string;
    actorType?: "STAFF" | "PATIENT";
  },
): Promise<void> {
  await tx.appointmentStatusHistory.create({
    data: {
      appointmentId: input.appointmentId,
      fromStatus: input.fromStatus as never,
      toStatus: input.toStatus as never,
      actorType: input.actorType ?? "STAFF",
      actorId: input.actorId,
    },
  });
}

function auditUserId(actor: { userId: string; actorType?: "STAFF" | "PATIENT" }): string | null {
  return actor.actorType === "PATIENT" ? null : actor.userId;
}

function present(row: {
  id: string;
  publicCode: string;
  status: string;
  kind: string;
  patient: { id: string; givenName: string; familyName: string; dni: string; phoneE164: string };
  slot: {
    startsAt: Date;
    endsAt: Date;
    specialtyId: string;
    professionalId: string;
    officeId: string;
    specialty: { name: string };
    professional: { givenName: string; familyName: string };
    office: { code: string; name: string };
  };
}): BookedView {
  return {
    id: row.id,
    publicCode: row.publicCode,
    status: row.status,
    kind: row.kind,
    startsAt: row.slot.startsAt,
    endsAt: row.slot.endsAt,
    specialtyId: row.slot.specialtyId,
    specialtyName: row.slot.specialty.name,
    professionalId: row.slot.professionalId,
    professionalName: `${row.slot.professional.givenName} ${row.slot.professional.familyName}`,
    officeId: row.slot.officeId,
    officeCode: row.slot.office.code,
    officeName: row.slot.office.name,
    patient: row.patient,
  };
}

const appointmentInclude = {
  patient: { select: { id: true, givenName: true, familyName: true, dni: true, phoneE164: true } },
  slot: {
    include: {
      office: { select: { code: true, name: true } },
      specialty: { select: { name: true } },
      professional: { select: { givenName: true, familyName: true } },
    },
  },
} as const;

async function loadView(db: Db, id: string): Promise<BookedView> {
  const row = await db.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude });
  return present(row);
}

export async function bookSlot(
  db: PrismaClient,
  input: { slotId: string; patient: PatientInput; sessionSecret: string },
  actor: AppointmentActor,
  now = new Date(),
): Promise<BookedView> {
  const booked = await db.$transaction(async (tx) => {
    await lockSlots(tx, [input.slotId]);
    const slot = await tx.appointmentSlot.findUnique({
      where: { id: input.slotId },
      include: { professional: true, specialty: true, office: true },
    });
    if (!slot) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "El horario no existe.");
    }
    if (slot.status !== "AVAILABLE" || slot.slotKind !== "REGULAR") {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya no está disponible.");
    }
    if (slot.professional.deactivatedAt || slot.specialty.deactivatedAt || slot.office.deactivatedAt) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El profesional, la especialidad o el consultorio no están activos.");
    }
    if (slot.startsAt.getTime() <= now.getTime()) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya pasó.");
    }
    await assertInsideHorizon(tx, slot.startsAt, now);
    await assertOpenDay(tx, slot);
    const patient = await upsertPatient(tx, input.patient, input.sessionSecret);
    const appointment = await insertAppointment(tx, {
      slotId: slot.id,
      patientId: patient.id,
      kind: "REGULAR",
      actorUserId: auditUserId(actor),
      createdByType: actor.actorType ?? "STAFF",
    });
    await appendHistory(tx, {
      appointmentId: appointment.id,
      fromStatus: null,
      toStatus: "CONFIRMED",
      actorId: actor.userId,
      actorType: actor.actorType ?? "STAFF",
    });
    await tx.appointmentSlot.update({ where: { id: slot.id }, data: { status: "BOOKED", holdExpiresAt: null } });
    await writeAudit(tx, {
      actorUserId: auditUserId(actor),
      actorType: actor.actorType ?? "STAFF",
      action: "appointment.book",
      entityType: "appointment",
      entityId: appointment.id,
      ipHash: actor.ipHash,
      userAgentTruncated: actor.userAgentTruncated,
      metadata: { slotId: slot.id, patientId: patient.id, kind: "REGULAR" },
    });
    return appointment.id;
  });
  return loadView(db, booked);
}

export async function bookExtraSlot(
  db: PrismaClient,
  input: {
    professionalId: string;
    specialtyId: string;
    officeId: string;
    startsAt: Date;
    endsAt: Date;
    patient: PatientInput;
    sessionSecret: string;
  },
  actor: AppointmentActor,
  now = new Date(),
): Promise<BookedView> {
  if (input.endsAt.getTime() <= input.startsAt.getTime() || input.endsAt.getTime() - input.startsAt.getTime() > 4 * 3_600_000) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "La duración del sobreturno es inválida.");
  }
  const booked = await db.$transaction(async (tx) => {
    const [professional, specialty, office, specialtyLink, officeLink] = await Promise.all([
      tx.professional.findUnique({ where: { id: input.professionalId } }),
      tx.specialty.findUnique({ where: { id: input.specialtyId } }),
      tx.office.findUnique({ where: { id: input.officeId } }),
      tx.professionalSpecialty.findUnique({
        where: { professionalId_specialtyId: { professionalId: input.professionalId, specialtyId: input.specialtyId } },
      }),
      tx.professionalOffice.findUnique({
        where: { professionalId_officeId: { professionalId: input.professionalId, officeId: input.officeId } },
      }),
    ]);
    if (!professional || professional.deactivatedAt || !specialty || specialty.deactivatedAt || !office || office.deactivatedAt || !specialtyLink || !officeLink) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El profesional, la especialidad o el consultorio no están activos.");
    }
    if (input.startsAt.getTime() <= now.getTime()) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya pasó.");
    }
    await assertInsideHorizon(tx, input.startsAt, now);
    await assertOpenDay(tx, {
      professionalId: input.professionalId,
      officeId: input.officeId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    const clash = await tx.appointmentSlot.findFirst({
      where: { professionalId: input.professionalId, startsAt: input.startsAt },
    });
    if (clash) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ese horario ya tiene un cupo.");
    }
    const patient = await upsertPatient(tx, input.patient, input.sessionSecret);
    let slot;
    try {
      slot = await tx.appointmentSlot.create({
        data: {
          professionalId: input.professionalId,
          specialtyId: input.specialtyId,
          officeId: input.officeId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          status: "BOOKED",
          slotKind: "EXTRA",
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, ERROR_CODES.CONFLICT, "Ese horario ya tiene un cupo.");
      }
      throw error;
    }
    const appointment = await insertAppointment(tx, {
      slotId: slot.id,
      patientId: patient.id,
      kind: "EXTRA",
      actorUserId: auditUserId(actor),
      createdByType: actor.actorType ?? "STAFF",
    });
    await appendHistory(tx, {
      appointmentId: appointment.id,
      fromStatus: null,
      toStatus: "CONFIRMED",
      actorId: actor.userId,
      actorType: actor.actorType ?? "STAFF",
    });
    await writeAudit(tx, {
      actorUserId: auditUserId(actor),
      actorType: actor.actorType ?? "STAFF",
      action: "appointment.extra",
      entityType: "appointment",
      entityId: appointment.id,
      ipHash: actor.ipHash,
      userAgentTruncated: actor.userAgentTruncated,
      metadata: { slotId: slot.id, patientId: patient.id, kind: "EXTRA" },
    });
    return appointment.id;
  });
  return loadView(db, booked);
}

async function activeAppointment(tx: Prisma.TransactionClient, id: string) {
  const appointment = await tx.appointment.findUnique({
    where: { id },
    include: { slot: true },
  });
  if (!appointment) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "El turno no existe.");
  }
  return appointment;
}

export async function cancelAppointment(
  db: PrismaClient,
  input: { appointmentId: string; reasonCode: "PATIENT_REQUEST" | "STAFF_REQUEST" | "SCHEDULE_CHANGE" | "OTHER_LOGISTICS" },
  actor: AppointmentActor,
  now = new Date(),
): Promise<BookedView> {
  const id = await db.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({ where: { id: input.appointmentId }, select: { slotId: true } });
    if (!current) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "El turno no existe.");
    }
    await lockSlots(tx, [current.slotId]);
    const appointment = await activeAppointment(tx, input.appointmentId);
    if (!CANCELLABLE.includes(appointment.status as (typeof CANCELLABLE)[number])) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ese turno no se puede cancelar.");
    }
    const minHours = await settingNumber(tx, "cancel_min_hours", 2, 0, 168);
    assertNotice(appointment.slot.startsAt, now, minHours);
    await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: "CANCELLED", cancelledAt: now, cancelReasonCode: input.reasonCode },
    });
    await appendHistory(tx, {
      appointmentId: appointment.id,
      fromStatus: appointment.status,
      toStatus: "CANCELLED",
      actorId: actor.userId,
      actorType: actor.actorType ?? "STAFF",
    });
    await tx.appointmentSlot.update({
      where: { id: appointment.slotId },
      data: { status: "AVAILABLE", holdExpiresAt: null },
    });
    await writeAudit(tx, {
      actorUserId: auditUserId(actor),
      actorType: actor.actorType ?? "STAFF",
      action: "appointment.cancel",
      entityType: "appointment",
      entityId: appointment.id,
      ipHash: actor.ipHash,
      userAgentTruncated: actor.userAgentTruncated,
      metadata: { reasonCode: input.reasonCode },
    });
    return appointment.id;
  });
  return loadView(db, id);
}

export async function rescheduleAppointment(
  db: PrismaClient,
  input: { appointmentId: string; newSlotId: string },
  actor: AppointmentActor,
  now = new Date(),
): Promise<BookedView> {
  const createdId = await db.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({ where: { id: input.appointmentId }, select: { slotId: true } });
    if (!current) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "El turno no existe.");
    }
    if (current.slotId === input.newSlotId) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Elija otro horario.");
    }
    await lockSlots(tx, [current.slotId, input.newSlotId]);
    const appointment = await activeAppointment(tx, input.appointmentId);
    if (!CANCELLABLE.includes(appointment.status as (typeof CANCELLABLE)[number])) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ese turno no se puede reprogramar.");
    }
    const minHours = await settingNumber(tx, "cancel_min_hours", 2, 0, 168);
    assertNotice(appointment.slot.startsAt, now, minHours);
    const next = await tx.appointmentSlot.findUnique({
      where: { id: input.newSlotId },
      include: { professional: true, specialty: true, office: true },
    });
    if (!next) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "El horario no existe.");
    }
    if (next.status !== "AVAILABLE" || next.slotKind !== "REGULAR") {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya no está disponible.");
    }
    if (next.specialtyId !== appointment.slot.specialtyId) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El horario es de otra especialidad.");
    }
    if (next.professional.deactivatedAt || next.specialty.deactivatedAt || next.office.deactivatedAt) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El profesional, la especialidad o el consultorio no están activos.");
    }
    if (next.startsAt.getTime() <= now.getTime()) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya pasó.");
    }
    await assertInsideHorizon(tx, next.startsAt, now);
    await assertOpenDay(tx, next);
    const created = await insertAppointment(tx, {
      slotId: next.id,
      patientId: appointment.patientId,
      kind: "REGULAR",
      actorUserId: auditUserId(actor),
      createdByType: actor.actorType ?? "STAFF",
      rescheduledFromId: appointment.id,
    });
    await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: "RESCHEDULED", rescheduledToId: created.id },
    });
    await appendHistory(tx, {
      appointmentId: appointment.id,
      fromStatus: appointment.status,
      toStatus: "RESCHEDULED",
      actorId: actor.userId,
      actorType: actor.actorType ?? "STAFF",
    });
    await appendHistory(tx, {
      appointmentId: created.id,
      fromStatus: null,
      toStatus: "CONFIRMED",
      actorId: actor.userId,
      actorType: actor.actorType ?? "STAFF",
    });
    await tx.appointmentSlot.update({
      where: { id: appointment.slotId },
      data: { status: "AVAILABLE", holdExpiresAt: null },
    });
    await tx.appointmentSlot.update({ where: { id: next.id }, data: { status: "BOOKED", holdExpiresAt: null } });
    await writeAudit(tx, {
      actorUserId: auditUserId(actor),
      actorType: actor.actorType ?? "STAFF",
      action: "appointment.reschedule",
      entityType: "appointment",
      entityId: created.id,
      ipHash: actor.ipHash,
      userAgentTruncated: actor.userAgentTruncated,
      metadata: { fromAppointmentId: appointment.id, slotId: next.id },
    });
    return created.id;
  });
  return loadView(db, createdId);
}

async function closeAttendance(
  db: PrismaClient,
  input: { appointmentId: string; status: "COMPLETED" | "NO_SHOW"; action: string },
  actor: AppointmentActor,
): Promise<BookedView> {
  const id = await db.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({ where: { id: input.appointmentId }, select: { slotId: true } });
    if (!current) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "El turno no existe.");
    }
    await lockSlots(tx, [current.slotId]);
    const appointment = await activeAppointment(tx, input.appointmentId);
    if (!ATTENDANCE.includes(appointment.status as (typeof ATTENDANCE)[number])) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ese turno ya está cerrado.");
    }
    await tx.appointment.update({ where: { id: appointment.id }, data: { status: input.status } });
    await appendHistory(tx, {
      appointmentId: appointment.id,
      fromStatus: appointment.status,
      toStatus: input.status,
      actorId: actor.userId,
      actorType: actor.actorType ?? "STAFF",
    });
    await writeAudit(tx, {
      actorUserId: auditUserId(actor),
      actorType: actor.actorType ?? "STAFF",
      action: input.action,
      entityType: "appointment",
      entityId: appointment.id,
      ipHash: actor.ipHash,
      userAgentTruncated: actor.userAgentTruncated,
      metadata: { status: input.status },
    });
    return appointment.id;
  });
  return loadView(db, id);
}

export function completeAppointment(db: PrismaClient, appointmentId: string, actor: CatalogActor): Promise<BookedView> {
  return closeAttendance(db, { appointmentId, status: "COMPLETED", action: "appointment.complete" }, actor);
}

export function markNoShow(db: PrismaClient, appointmentId: string, actor: CatalogActor): Promise<BookedView> {
  return closeAttendance(db, { appointmentId, status: "NO_SHOW", action: "appointment.no_show" }, actor);
}

const FUTURE_ACTIVE = ["CONFIRMED", "CALLED", "IN_PROGRESS"] as const;

export type PublicAppointment = {
  id: string;
  publicCode: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  specialtyName: string;
  professionalName: string;
  officeCode: string;
  officeName: string;
};

async function assertPatientCapacity(
  tx: Prisma.TransactionClient,
  input: { patientId: string; phoneHmac: string; professionalId: string; startsAt: Date; endsAt: Date; now: Date },
): Promise<void> {
  const max = await settingNumber(tx, "max_active_appointments", 3, 1, 10);
  const activeWhere = {
    status: { in: [...FUTURE_ACTIVE] },
    slot: { startsAt: { gt: input.now } },
  };
  const [byPatient, byPhone, overlap] = await Promise.all([
    tx.appointment.count({ where: { patientId: input.patientId, ...activeWhere } }),
    tx.appointment.count({
      where: { patient: { phoneHmac: input.phoneHmac }, ...activeWhere },
    }),
    tx.appointment.findFirst({
      where: {
        patientId: input.patientId,
        status: { in: [...FUTURE_ACTIVE] },
        slot: {
          professionalId: input.professionalId,
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
        },
      },
    }),
  ]);
  if (byPatient >= max || byPhone >= max) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "Ya alcanzaste el máximo de turnos activos.");
  }
  if (overlap) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "Ya tenés un turno con ese profesional en ese horario.");
  }
}

export async function bookForPatient(
  db: PrismaClient,
  input: { slotId: string; patient: PatientInput; sessionSecret: string; dniHmac: string; phoneHmac: string },
  now = new Date(),
): Promise<PublicAppointment> {
  const dni = normalizeDni(input.patient.dni);
  const phone = normalizeArPhone(input.patient.phone);
  if (!dni || !phone) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "DNI o teléfono inválido.");
  }
  if (hmacSha256(dni, input.sessionSecret) !== input.dniHmac || hmacSha256(phone, input.sessionSecret) !== input.phoneHmac) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "La sesión no corresponde a esos datos.");
  }
  const booked = await db.$transaction(async (tx) => {
    await lockSlots(tx, [input.slotId]);
    const slot = await tx.appointmentSlot.findUnique({
      where: { id: input.slotId },
      include: { professional: true, specialty: true, office: true },
    });
    if (!slot) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "El horario no existe.");
    }
    if (slot.status !== "AVAILABLE" || slot.slotKind !== "REGULAR") {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya no está disponible.");
    }
    if (slot.professional.deactivatedAt || slot.specialty.deactivatedAt || slot.office.deactivatedAt) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El profesional, la especialidad o el consultorio no están activos.");
    }
    if (slot.startsAt.getTime() <= now.getTime()) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya pasó.");
    }
    await assertInsideHorizon(tx, slot.startsAt, now);
    await assertOpenDay(tx, slot);
    const existing = await tx.patient.findUnique({ where: { dni } });
    if (existing && existing.phoneE164 !== phone) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ese teléfono no coincide. Para cambiarlo, acercate a recepción.");
    }
    const email = input.patient.email ? normalizeEmail(input.patient.email) : null;
    const patient = existing
      ? await tx.patient.update({
          where: { id: existing.id },
          data: {
            givenName: input.patient.givenName,
            familyName: input.patient.familyName,
            birthDate: new Date(`${input.patient.birthDate}T00:00:00.000Z`),
            email,
            phoneVerifiedAt: now,
          },
        })
      : await tx.patient.create({
          data: {
            givenName: input.patient.givenName,
            familyName: input.patient.familyName,
            dni,
            dniHmac: input.dniHmac,
            birthDate: new Date(`${input.patient.birthDate}T00:00:00.000Z`),
            phoneE164: phone,
            phoneHmac: input.phoneHmac,
            email,
            phoneVerifiedAt: now,
          },
        });
    await assertPatientCapacity(tx, {
      patientId: patient.id,
      phoneHmac: input.phoneHmac,
      professionalId: slot.professionalId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      now,
    });
    const appointment = await insertAppointment(tx, {
      slotId: slot.id,
      patientId: patient.id,
      kind: "REGULAR",
      actorUserId: null,
      createdByType: "PATIENT",
    });
    await appendHistory(tx, {
      appointmentId: appointment.id,
      fromStatus: null,
      toStatus: "CONFIRMED",
      actorId: patient.id,
      actorType: "PATIENT",
    });
    await tx.appointmentSlot.update({ where: { id: slot.id }, data: { status: "BOOKED", holdExpiresAt: null } });
    await writeAudit(tx, {
      actorType: "PATIENT",
      action: "appointment.book",
      entityType: "appointment",
      entityId: appointment.id,
      metadata: { slotId: slot.id, patientId: patient.id, kind: "REGULAR" },
    });
    return appointment.id;
  });
  return loadPublic(db, booked);
}

export async function bookAvailableSlotInTransaction(
  tx: Prisma.TransactionClient,
  input: { slotId: string; patientId: string; now?: Date },
): Promise<string> {
  const now = input.now ?? new Date();
  await lockSlots(tx, [input.slotId]);
  const slot = await tx.appointmentSlot.findUnique({
    where: { id: input.slotId },
    include: { professional: true, specialty: true, office: true },
  });
  if (!slot) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "El horario no existe.");
  }
  if (slot.status !== "AVAILABLE" || slot.slotKind !== "REGULAR") {
    throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya no está disponible.");
  }
  if (slot.professional.deactivatedAt || slot.specialty.deactivatedAt || slot.office.deactivatedAt) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "El profesional, la especialidad o el consultorio no están activos.");
  }
  if (slot.startsAt.getTime() <= now.getTime()) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "El horario ya pasó.");
  }
  const patient = await tx.patient.findUnique({ where: { id: input.patientId } });
  if (!patient) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "El paciente no existe.");
  }
  await assertInsideHorizon(tx, slot.startsAt, now);
  await assertOpenDay(tx, slot);
  await assertPatientCapacity(tx, {
    patientId: patient.id,
    phoneHmac: patient.phoneHmac,
    professionalId: slot.professionalId,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    now,
  });
  const appointment = await insertAppointment(tx, {
    slotId: slot.id,
    patientId: patient.id,
    kind: "REGULAR",
    actorUserId: null,
    createdByType: "PATIENT",
  });
  await appendHistory(tx, {
    appointmentId: appointment.id,
    fromStatus: null,
    toStatus: "CONFIRMED",
    actorId: patient.id,
    actorType: "PATIENT",
  });
  await tx.appointmentSlot.update({ where: { id: slot.id }, data: { status: "BOOKED", holdExpiresAt: null } });
  await writeAudit(tx, {
    actorType: "PATIENT",
    action: "appointment.book",
    entityType: "appointment",
    entityId: appointment.id,
    metadata: { slotId: slot.id, patientId: patient.id, kind: "REGULAR", source: "waitlist" },
  });
  return appointment.id;
}

async function loadPublic(db: Db, id: string): Promise<PublicAppointment> {
  const row = await db.appointment.findUniqueOrThrow({
    where: { id },
    include: {
      slot: { include: { specialty: true, professional: true, office: true } },
    },
  });
  return {
    id: row.id,
    publicCode: row.publicCode,
    status: row.status,
    startsAt: row.slot.startsAt,
    endsAt: row.slot.endsAt,
    specialtyName: row.slot.specialty.name,
    professionalName: `${row.slot.professional.givenName} ${row.slot.professional.familyName}`,
    officeCode: row.slot.office.code,
    officeName: row.slot.office.name,
  };
}

export async function listOwnAppointments(db: PrismaClient, session: { dniHmac: string; phoneHmac: string }, now = new Date()): Promise<{ items: PublicAppointment[] }> {
  const today = zonedDateTimeToUtc(civilToday(now), 0);
  const rows = await db.appointment.findMany({
    where: {
      patient: { dniHmac: session.dniHmac, phoneHmac: session.phoneHmac },
      slot: { startsAt: { gte: today } },
    },
    include: { slot: { include: { specialty: true, professional: true, office: true } } },
    orderBy: { slot: { startsAt: "asc" } },
    take: 20,
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      publicCode: row.publicCode,
      status: row.status,
      startsAt: row.slot.startsAt,
      endsAt: row.slot.endsAt,
      specialtyName: row.slot.specialty.name,
      professionalName: `${row.slot.professional.givenName} ${row.slot.professional.familyName}`,
      officeCode: row.slot.office.code,
      officeName: row.slot.office.name,
    })),
  };
}

export async function requireOwnAppointment(
  db: PrismaClient,
  appointmentId: string,
  session: { dniHmac: string; phoneHmac: string },
): Promise<{ id: string; patientId: string }> {
  const row = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { patient: { select: { id: true, dniHmac: true, phoneHmac: true } } },
  });
  if (!row || row.patient.dniHmac !== session.dniHmac || row.patient.phoneHmac !== session.phoneHmac) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "El turno no existe.");
  }
  return { id: row.id, patientId: row.patient.id };
}

export async function listAppointments(
  db: PrismaClient,
  query: {
    from?: string;
    to?: string;
    specialtyId?: string;
    professionalId?: string;
    status?: string;
    publicCode?: string;
    limit: number;
    startingAfter?: string;
  },
): Promise<{ items: BookedView[]; nextCursor: string | null }> {
  const rows = await db.appointment.findMany({
    where: {
      ...(query.publicCode ? { publicCode: query.publicCode } : {}),
      ...(query.startingAfter ? { id: { gt: query.startingAfter } } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.from && query.to
        ? {
            slot: {
              startsAt: {
                gte: zonedDateTimeToUtc(query.from, 0),
                lt: zonedDateTimeToUtc(addCivilDays(query.to, 1), 0),
              },
              ...(query.specialtyId ? { specialtyId: query.specialtyId } : {}),
              ...(query.professionalId ? { professionalId: query.professionalId } : {}),
            },
          }
        : {}),
    },
    include: appointmentInclude,
    orderBy: { id: "asc" },
    take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  const items = (hasMore ? rows.slice(0, query.limit) : rows).map(present);
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function getAppointment(db: PrismaClient, id: string): Promise<BookedView & {
  history: Array<{ fromStatus: string | null; toStatus: string; actorType: string; at: Date }>;
}> {
  const row = await db.appointment.findUnique({
    where: { id },
    include: {
      ...appointmentInclude,
      statusHistory: { orderBy: { at: "asc" } },
    },
  });
  if (!row) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "El turno no existe.");
  }
  return {
    ...present(row),
    history: row.statusHistory.map((item) => ({
      fromStatus: item.fromStatus,
      toStatus: item.toStatus,
      actorType: item.actorType,
      at: item.at,
    })),
  };
}

export async function recordAppointmentNotice(
  db: PrismaClient,
  appointmentId: string,
  type: "APPOINTMENT_CONFIRMATION" | "APPOINTMENT_CANCELLED" | "APPOINTMENT_RESCHEDULED",
  redis?: Redis,
): Promise<void> {
  let noticeId: string | null = null;
  try {
    const row = await db.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { whatsappOptIn: true } },
        slot: { include: { specialty: true, professional: true, office: true } },
      },
    });
    if (!row) {
      return;
    }
    const optedIn = row.patient.whatsappOptIn;
    const notice = await db.notification.create({
      data: {
        type,
        channel: "WHATSAPP",
        appointmentId: row.id,
        patientId: row.patientId,
        status: optedIn ? "PENDING" : "CANCELLED",
        scheduledAt: optedIn ? new Date() : null,
        idempotencyKey: `${row.id}:${type}`,
        params: {
          publicCode: row.publicCode,
          specialtyName: row.slot.specialty.name,
          professionalName: `${row.slot.professional.givenName} ${row.slot.professional.familyName}`,
          officeCode: row.slot.office.code,
          startsAt: row.slot.startsAt.toISOString(),
        },
      },
    });
    noticeId = optedIn ? notice.id : null;
  } catch {
    await writeAudit(db, {
      actorType: "SYSTEM",
      action: "notification.enqueue_failed",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { type },
    }).catch(() => undefined);
    return;
  }
  if (!redis || !noticeId) {
    return;
  }
  try {
    await enqueueSendNotification(redis, noticeId);
  } catch {
    await writeAudit(db, {
      actorType: "SYSTEM",
      action: "notification.enqueue_failed",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { type, stage: "queue" },
    }).catch(() => undefined);
  }
}

export type DoctorAppointment = {
  id: string;
  publicCode: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  specialtyName: string;
  officeCode: string;
  officeName: string;
  patient: { givenName: string; familyName: string };
};

function toDoctorAppointment(view: BookedView): DoctorAppointment {
  return {
    id: view.id,
    publicCode: view.publicCode,
    status: view.status,
    startsAt: view.startsAt,
    endsAt: view.endsAt,
    specialtyName: view.specialtyName,
    officeCode: view.officeCode,
    officeName: view.officeName,
    patient: { givenName: view.patient.givenName, familyName: view.patient.familyName },
  };
}

async function linkedProfessional(db: Db, userId: string) {
  const professional = await db.professional.findUnique({ where: { userId } });
  if (!professional || professional.deactivatedAt) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "Su usuario no está vinculado a un profesional.");
  }
  return professional;
}

async function ownAppointmentId(tx: Prisma.TransactionClient, userId: string, appointmentId: string): Promise<string> {
  const professional = await linkedProfessional(tx, userId);
  const row = await tx.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, slot: { select: { professionalId: true, id: true } } },
  });
  if (!row || row.slot.professionalId !== professional.id) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "El turno no existe.");
  }
  await lockSlots(tx, [row.slot.id]);
  return row.id;
}

export async function listDoctorAgenda(db: PrismaClient, userId: string, date: string): Promise<{
  date: string;
  professionalName: string;
  items: DoctorAppointment[];
}> {
  const professional = await linkedProfessional(db, userId);
  const rows = await db.appointment.findMany({
    where: {
      status: { in: ["CONFIRMED", "CALLED", "IN_PROGRESS", "COMPLETED", "NO_SHOW"] },
      slot: {
        professionalId: professional.id,
        startsAt: {
          gte: zonedDateTimeToUtc(date, 0),
          lt: zonedDateTimeToUtc(addCivilDays(date, 1), 0),
        },
      },
    },
    include: appointmentInclude,
    orderBy: { slot: { startsAt: "asc" } },
    take: 100,
  });
  return {
    date,
    professionalName: `${professional.givenName} ${professional.familyName}`,
    items: rows.map((row) => toDoctorAppointment(present(row))),
  };
}

export async function callOwnAppointment(
  db: PrismaClient,
  input: { appointmentId: string; recall: boolean },
  actor: AppointmentActor,
  now = new Date(),
): Promise<DoctorAppointment & { callId: string; debounced: boolean }> {
  const result = await db.$transaction(async (tx) => {
    const appointmentId = await ownAppointmentId(tx, actor.userId, input.appointmentId);
    const appointment = await activeAppointment(tx, appointmentId);
    if (appointment.status !== "CONFIRMED" && appointment.status !== "CALLED") {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ese turno no se puede llamar.");
    }
    if (!input.recall) {
      const recent = await tx.appointmentCall.findFirst({
        where: { appointmentId, createdAt: { gt: new Date(now.getTime() - 5_000) } },
        orderBy: { createdAt: "desc" },
      });
      if (recent) {
        return { appointmentId, callId: recent.id, debounced: true };
      }
    }
    const call = await tx.appointmentCall.create({
      data: {
        appointmentId,
        actorUserId: actor.userId,
        result: "DISPLAY_OFFLINE",
      },
    });
    if (appointment.status === "CONFIRMED") {
      await tx.appointment.update({ where: { id: appointmentId }, data: { status: "CALLED" } });
      await appendHistory(tx, {
        appointmentId,
        fromStatus: "CONFIRMED",
        toStatus: "CALLED",
        actorId: actor.userId,
      });
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorType: "STAFF",
      action: input.recall ? "appointment.recall" : "appointment.call",
      entityType: "appointment",
      entityId: appointmentId,
      ipHash: actor.ipHash,
      userAgentTruncated: actor.userAgentTruncated,
      metadata: { result: "DISPLAY_OFFLINE" },
    });
    return { appointmentId, callId: call.id, debounced: false };
  });
  const view = toDoctorAppointment(await loadView(db, result.appointmentId));
  return { ...view, callId: result.callId, debounced: result.debounced };
}

export async function startOwnAppointment(db: PrismaClient, appointmentId: string, actor: AppointmentActor): Promise<DoctorAppointment> {
  const id = await db.$transaction(async (tx) => {
    const ownedId = await ownAppointmentId(tx, actor.userId, appointmentId);
    const appointment = await activeAppointment(tx, ownedId);
    if (appointment.status !== "CALLED") {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Primero hay que llamar al paciente.");
    }
    await tx.appointment.update({ where: { id: ownedId }, data: { status: "IN_PROGRESS" } });
    await appendHistory(tx, {
      appointmentId: ownedId,
      fromStatus: "CALLED",
      toStatus: "IN_PROGRESS",
      actorId: actor.userId,
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorType: "STAFF",
      action: "appointment.in_progress",
      entityType: "appointment",
      entityId: ownedId,
      ipHash: actor.ipHash,
      userAgentTruncated: actor.userAgentTruncated,
    });
    return ownedId;
  });
  return toDoctorAppointment(await loadView(db, id));
}

export async function completeOwnAppointment(db: PrismaClient, appointmentId: string, actor: AppointmentActor): Promise<DoctorAppointment> {
  await db.$transaction(async (tx) => {
    await ownAppointmentId(tx, actor.userId, appointmentId);
  });
  return toDoctorAppointment(await completeAppointment(db, appointmentId, actor));
}

export async function markOwnNoShow(db: PrismaClient, appointmentId: string, actor: AppointmentActor): Promise<DoctorAppointment> {
  await db.$transaction(async (tx) => {
    await ownAppointmentId(tx, actor.userId, appointmentId);
  });
  return toDoctorAppointment(await markNoShow(db, appointmentId, actor));
}
