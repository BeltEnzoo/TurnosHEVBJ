import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ERROR_CODES, PERMISSIONS } from "@hep/shared";
import { regenerateAvailableSlots } from "@hep/db";
import { writeAudit } from "../../lib/audit.js";
import { sha256, truncateUserAgent } from "../../lib/crypto.js";
import { staffCookieName } from "../../lib/cookies.js";
import { AppError } from "../../lib/errors.js";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { loadStaffSession, requirePermission, requireStaff } from "../auth/session.js";
import {
  createHoliday,
  createScheduleBlock,
  createScheduleException,
  createWeeklySchedule,
  listAvailability,
  listWeeklySchedules,
  updateWeeklySchedule,
} from "./service.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optionalId = z.string().uuid().nullable().optional();

const scheduleCreate = z.object({
  professionalId: z.string().uuid(),
  specialtyId: z.string().uuid(),
  officeId: z.string().uuid(),
  weekday: z.number().int().min(0).max(6),
  startTime: hhmm,
  endTime: hhmm,
  slotMinutes: z.number().int().min(5).max(180),
  validFrom: isoDate,
  validTo: isoDate.nullable().optional(),
});

const exceptionCreate = z.object({
  date: isoDate,
  professionalId: optionalId,
  officeId: optionalId,
  specialtyId: optionalId,
  closed: z.boolean().default(true),
  startTime: hhmm.nullable().optional(),
  endTime: hhmm.nullable().optional(),
  reason: z.string().trim().max(120).nullable().optional(),
});

const holidayCreate = z.object({
  date: isoDate,
  name: z.string().trim().min(2).max(80),
  appliesTo: z.enum(["ALL", "OFFICE", "PROFESSIONAL"]),
  officeId: optionalId,
  professionalId: optionalId,
});

const blockCreate = z.object({
  professionalId: optionalId,
  officeId: optionalId,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().trim().max(120).nullable().optional(),
});

const availabilityQuery = z
  .object({
    specialtyId: z.string().uuid(),
    professionalId: z.string().uuid().optional(),
    from: isoDate,
    to: isoDate,
  })
  .refine((value) => value.from <= value.to, { message: "range" });

function spanDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

export async function registerScheduleRoutes(app: FastifyInstance): Promise<void> {
  async function actor(request: {
    cookies: Record<string, string | undefined>;
    ip: string;
    headers: { "user-agent"?: string };
  }) {
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS));
    requirePermission(staff, PERMISSIONS.SCHEDULES_WRITE);
    return {
      userId: staff.userId,
      ipHash: sha256(request.ip),
      userAgentTruncated: truncateUserAgent(request.headers["user-agent"]),
    };
  }

  app.get("/api/v1/availability", async (request) => {
    await consumeRateLimit(app.redis, `rl:availability:ip:${request.ip}`, 120, 60);
    const query = availabilityQuery.parse(request.query);
    if (spanDays(query.from, query.to) > 89) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El rango máximo es de 90 días.");
    }
    return listAvailability(app.prisma, query);
  });

  app.get("/api/v1/booking-horizon", async (request) => {
    await consumeRateLimit(app.redis, `rl:availability:ip:${request.ip}`, 120, 60);
    const row = await app.prisma.systemSetting.findUnique({ where: { key: "booking_horizon_days" } });
    const raw = row?.value;
    const days = typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 90 ? raw : 45;
    return { days };
  });

  app.get("/api/v1/admin/schedules", async (request) => {
    await actor(request);
    const query = z.object({ professionalId: z.string().uuid().optional() }).parse(request.query);
    return listWeeklySchedules(app.prisma, query.professionalId);
  });

  app.post("/api/v1/admin/schedules", async (request, reply) => {
    const who = await actor(request);
    const body = scheduleCreate.parse(request.body);
    const created = await createWeeklySchedule(
      app.prisma,
      { ...body, validTo: body.validTo ?? null },
      who,
    );
    return reply.code(201).send(created);
  });

  app.patch("/api/v1/admin/schedules/:id", async (request) => {
    const who = await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ deactivated: z.boolean() }).parse(request.body);
    return updateWeeklySchedule(app.prisma, params.id, body, who);
  });

  app.post("/api/v1/admin/schedule-exceptions", async (request, reply) => {
    const who = await actor(request);
    const body = exceptionCreate.parse(request.body);
    const created = await createScheduleException(
      app.prisma,
      {
        date: body.date,
        professionalId: body.professionalId ?? null,
        officeId: body.officeId ?? null,
        specialtyId: body.specialtyId ?? null,
        closed: body.closed,
        startTime: body.startTime ?? null,
        endTime: body.endTime ?? null,
        reason: body.reason ?? null,
      },
      who,
    );
    return reply.code(201).send(created);
  });

  app.post("/api/v1/admin/holidays", async (request, reply) => {
    const who = await actor(request);
    const body = holidayCreate.parse(request.body);
    const created = await createHoliday(
      app.prisma,
      {
        ...body,
        officeId: body.officeId ?? null,
        professionalId: body.professionalId ?? null,
      },
      who,
    );
    return reply.code(201).send(created);
  });

  app.post("/api/v1/admin/schedule-blocks", async (request, reply) => {
    const who = await actor(request);
    const body = blockCreate.parse(request.body);
    const created = await createScheduleBlock(
      app.prisma,
      {
        professionalId: body.professionalId ?? null,
        officeId: body.officeId ?? null,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        reason: body.reason ?? null,
      },
      who,
    );
    return reply.code(201).send(created);
  });

  app.post("/api/v1/admin/slots/regenerate", async (request) => {
    const who = await actor(request);
    const result = await regenerateAvailableSlots(app.prisma);
    await writeAudit(app.prisma, {
      actorType: "staff",
      actorUserId: who.userId,
      action: "schedule.slots.regenerate",
      entityType: "appointment_slot",
      ipHash: who.ipHash,
      userAgentTruncated: who.userAgentTruncated,
      metadata: result,
    });
    return result;
  });
}
