import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ERROR_CODES, PERMISSIONS } from "@hep/shared";
import { sha256, truncateUserAgent } from "../../lib/crypto.js";
import { patientCookieName, staffCookieName } from "../../lib/cookies.js";
import { AppError } from "../../lib/errors.js";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { loadPatientSession, loadStaffSession, requirePermission, requireStaff } from "../auth/session.js";
import {
  bookExtraSlot,
  bookForPatient,
  bookSlot,
  cancelAppointment,
  completeAppointment,
  getAppointment,
  listAppointments,
  listOwnAppointments,
  markNoShow,
  recordAppointmentNotice,
  requireOwnAppointment,
  rescheduleAppointment,
} from "./service.js";
import { cancelPendingReminders, scheduleAppointmentReminders } from "../whatsapp/reminders.js";
import { offerFreedSlot } from "../waitlist/service.js";
import { assertTurnstile } from "../../lib/turnstile.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const patientBody = z.object({
  givenName: z.string().trim().min(2).max(80),
  familyName: z.string().trim().min(2).max(80),
  dni: z.string().trim().min(7).max(12),
  birthDate: isoDate,
  phone: z.string().trim().min(8).max(20),
  email: z.string().trim().email().max(120).nullable().optional(),
});

const bookBody = z.object({
  slotId: z.string().uuid(),
  patient: patientBody,
});

const extraBody = z.object({
  professionalId: z.string().uuid(),
  specialtyId: z.string().uuid(),
  officeId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  patient: patientBody,
});

const cancelBody = z.object({
  reasonCode: z.enum(["PATIENT_REQUEST", "STAFF_REQUEST", "SCHEDULE_CHANGE", "OTHER_LOGISTICS"]),
});

const publicCodeQuery = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-KMNP-RT-Z2-46-9]{2}-[A-HJ-KMNP-RT-Z2-46-9]{3}$/);

const listQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    publicCode: publicCodeQuery.optional(),
    specialtyId: z.string().uuid().optional(),
    professionalId: z.string().uuid().optional(),
    status: z.enum(["CONFIRMED", "CALLED", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED", "RESCHEDULED", "EXPIRED"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    starting_after: z.string().uuid().optional(),
  })
  .refine((value) => (value.publicCode ? true : Boolean(value.from && value.to && value.from <= value.to)), {
    message: "range",
  });

function spanDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

export async function registerAppointmentRoutes(app: FastifyInstance): Promise<void> {
  async function actor(request: {
    cookies: Record<string, string | undefined>;
    ip: string;
    headers: { "user-agent"?: string };
  }) {
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS));
    requirePermission(staff, PERMISSIONS.APPOINTMENTS_WRITE);
    await consumeRateLimit(app.redis, `rl:appointments:user:${staff.userId}`, 30, 60);
    return {
      userId: staff.userId,
      ipHash: sha256(request.ip),
      userAgentTruncated: truncateUserAgent(request.headers["user-agent"]),
    };
  }

  app.get("/api/v1/admin/appointments", async (request) => {
    await actor(request);
    const query = listQuery.parse(request.query);
    if (query.from && query.to && spanDays(query.from, query.to) > 45) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El rango máximo es de 45 días.");
    }
    return listAppointments(app.prisma, {
      from: query.from,
      to: query.to,
      specialtyId: query.specialtyId,
      professionalId: query.professionalId,
      status: query.status,
      publicCode: query.publicCode,
      limit: query.limit,
      startingAfter: query.starting_after,
    });
  });

  app.get("/api/v1/admin/appointments/:id", async (request) => {
    await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return getAppointment(app.prisma, params.id);
  });

  app.post("/api/v1/admin/appointments", async (request, reply) => {
    const who = await actor(request);
    const body = bookBody.parse(request.body);
    const created = await bookSlot(
      app.prisma,
      { slotId: body.slotId, patient: body.patient, sessionSecret: app.env.SESSION_SECRET },
      who,
    );
    await recordAppointmentNotice(app.prisma, created.id, "APPOINTMENT_CONFIRMATION", app.redis);
    await scheduleAppointmentReminders(app.prisma, created.id, app.redis);
    return reply.code(201).send(created);
  });

  app.post("/api/v1/admin/slots/extra", async (request, reply) => {
    const who = await actor(request);
    const body = extraBody.parse(request.body);
    const created = await bookExtraSlot(
      app.prisma,
      {
        professionalId: body.professionalId,
        specialtyId: body.specialtyId,
        officeId: body.officeId,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        patient: body.patient,
        sessionSecret: app.env.SESSION_SECRET,
      },
      who,
    );
    await recordAppointmentNotice(app.prisma, created.id, "APPOINTMENT_CONFIRMATION", app.redis);
    await scheduleAppointmentReminders(app.prisma, created.id, app.redis);
    return reply.code(201).send(created);
  });

  app.post("/api/v1/admin/appointments/:id/cancel", async (request) => {
    const who = await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = cancelBody.parse(request.body);
    const updated = await cancelAppointment(app.prisma, { appointmentId: params.id, reasonCode: body.reasonCode }, who);
    await cancelPendingReminders(app.prisma, updated.id);
    await recordAppointmentNotice(app.prisma, updated.id, "APPOINTMENT_CANCELLED", app.redis);
    const freed = await app.prisma.appointment.findUnique({ where: { id: updated.id }, select: { slotId: true } });
    if (freed) {
      await offerFreedSlot(app.prisma, app.redis, freed.slotId).catch(() => undefined);
    }
    return updated;
  });

  app.post("/api/v1/admin/appointments/:id/reschedule", async (request) => {
    const who = await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ newSlotId: z.string().uuid() }).parse(request.body);
    const created = await rescheduleAppointment(
      app.prisma,
      { appointmentId: params.id, newSlotId: body.newSlotId },
      who,
    );
    await cancelPendingReminders(app.prisma, params.id);
    await recordAppointmentNotice(app.prisma, created.id, "APPOINTMENT_RESCHEDULED", app.redis);
    await scheduleAppointmentReminders(app.prisma, created.id, app.redis);
    const freed = await app.prisma.appointment.findUnique({ where: { id: params.id }, select: { slotId: true } });
    if (freed) {
      await offerFreedSlot(app.prisma, app.redis, freed.slotId).catch(() => undefined);
    }
    return created;
  });

  app.post("/api/v1/admin/appointments/:id/complete", async (request) => {
    const who = await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const completed = await completeAppointment(app.prisma, params.id, who);
    await cancelPendingReminders(app.prisma, params.id);
    return completed;
  });

  app.post("/api/v1/admin/appointments/:id/no-show", async (request) => {
    const who = await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const missed = await markNoShow(app.prisma, params.id, who);
    await cancelPendingReminders(app.prisma, params.id);
    return missed;
  });

  async function patientSession(request: { cookies: Record<string, string | undefined> }) {
    const session = await loadPatientSession(app.prisma, request.cookies[patientCookieName(app.env)]);
    if (!session) {
      throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "Necesita iniciar sesión.");
    }
    return session;
  }

  const patientBook = z.object({
    slotId: z.string().uuid(),
    turnstileToken: z.string().min(1).max(2048),
    patient: patientBody,
  });

  app.get("/api/v1/me/appointments", async (request) => {
    const session = await patientSession(request);
    return listOwnAppointments(app.prisma, session);
  });

  app.post("/api/v1/appointments", async (request, reply) => {
    const session = await patientSession(request);
    const body = patientBook.parse(request.body);
    await assertTurnstile(app.env, body.turnstileToken, request.ip);
    await consumeRateLimit(app.redis, `rl:book:dni:${session.dniHmac}`, 8, 24 * 60 * 60);
    const created = await bookForPatient(app.prisma, {
      slotId: body.slotId,
      patient: body.patient,
      sessionSecret: app.env.SESSION_SECRET,
      dniHmac: session.dniHmac,
      phoneHmac: session.phoneHmac,
    });
    await recordAppointmentNotice(app.prisma, created.id, "APPOINTMENT_CONFIRMATION", app.redis);
    await scheduleAppointmentReminders(app.prisma, created.id, app.redis);
    return reply.code(201).send(created);
  });

  app.post("/api/v1/appointments/:id/cancel", async (request) => {
    const session = await patientSession(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const owned = await requireOwnAppointment(app.prisma, params.id, session);
    const updated = await cancelAppointment(
      app.prisma,
      { appointmentId: owned.id, reasonCode: "PATIENT_REQUEST" },
      {
        userId: owned.patientId,
        actorType: "PATIENT",
        ipHash: sha256(request.ip),
        userAgentTruncated: truncateUserAgent(request.headers["user-agent"]),
      },
    );
    await cancelPendingReminders(app.prisma, updated.id);
    await recordAppointmentNotice(app.prisma, updated.id, "APPOINTMENT_CANCELLED", app.redis);
    const freed = await app.prisma.appointment.findUnique({ where: { id: updated.id }, select: { slotId: true } });
    if (freed) {
      await offerFreedSlot(app.prisma, app.redis, freed.slotId).catch(() => undefined);
    }
    return {
      id: updated.id,
      publicCode: updated.publicCode,
      status: updated.status,
      startsAt: updated.startsAt,
      endsAt: updated.endsAt,
    };
  });

  app.post("/api/v1/appointments/:id/reschedule", async (request) => {
    const session = await patientSession(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ newSlotId: z.string().uuid() }).parse(request.body);
    const owned = await requireOwnAppointment(app.prisma, params.id, session);
    const created = await rescheduleAppointment(
      app.prisma,
      { appointmentId: owned.id, newSlotId: body.newSlotId },
      {
        userId: owned.patientId,
        actorType: "PATIENT",
        ipHash: sha256(request.ip),
        userAgentTruncated: truncateUserAgent(request.headers["user-agent"]),
      },
    );
    await cancelPendingReminders(app.prisma, params.id);
    await recordAppointmentNotice(app.prisma, created.id, "APPOINTMENT_RESCHEDULED", app.redis);
    await scheduleAppointmentReminders(app.prisma, created.id, app.redis);
    const freed = await app.prisma.appointment.findUnique({ where: { id: params.id }, select: { slotId: true } });
    if (freed) {
      await offerFreedSlot(app.prisma, app.redis, freed.slotId).catch(() => undefined);
    }
    return {
      id: created.id,
      publicCode: created.publicCode,
      status: created.status,
      startsAt: created.startsAt,
      endsAt: created.endsAt,
    };
  });
}
