import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ERROR_CODES } from "@hep/shared";
import { patientCookieName } from "../../lib/cookies.js";
import { AppError } from "../../lib/errors.js";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { loadPatientSession } from "../auth/session.js";
import { recordAppointmentNotice } from "../appointments/service.js";
import { scheduleAppointmentReminders } from "../whatsapp/reminders.js";
import { acceptWaitlistOffer, declineWaitlistOffer, joinWaitlist, listOwnWaitlist, offerFreedSlot } from "./service.js";

export async function registerWaitlistRoutes(app: FastifyInstance): Promise<void> {
  async function patient(request: { cookies: Record<string, string | undefined> }) {
    const session = await loadPatientSession(app.prisma, request.cookies[patientCookieName(app.env)]);
    if (!session?.patientId) {
      throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "Necesita iniciar sesión.");
    }
    return { id: session.patientId };
  }

  app.get("/api/v1/me/waitlist", async (request) => {
    const who = await patient(request);
    return listOwnWaitlist(app.prisma, who.id);
  });

  app.post("/api/v1/waitlist", async (request, reply) => {
    const who = await patient(request);
    await consumeRateLimit(app.redis, `rl:waitlist:${who.id}`, 8, 60 * 60);
    const body = z
      .object({
        specialtyId: z.string().uuid(),
        professionalId: z.string().uuid().nullable().optional(),
      })
      .parse(request.body);
    const created = await joinWaitlist(app.prisma, {
      patientId: who.id,
      specialtyId: body.specialtyId,
      professionalId: body.professionalId,
    });
    return reply.code(201).send(created);
  });

  app.post("/api/v1/waitlist/offers/:id/accept", async (request) => {
    const who = await patient(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const accepted = await acceptWaitlistOffer(app.prisma, { offerId: params.id, patientId: who.id });
    await recordAppointmentNotice(app.prisma, accepted.appointmentId, "APPOINTMENT_CONFIRMATION", app.redis);
    await scheduleAppointmentReminders(app.prisma, accepted.appointmentId, app.redis);
    const view = await app.prisma.appointment.findUnique({
      where: { id: accepted.appointmentId },
      select: { id: true, publicCode: true, status: true, slot: { select: { startsAt: true, endsAt: true } } },
    });
    return {
      id: view?.id,
      publicCode: view?.publicCode,
      status: view?.status,
      startsAt: view?.slot.startsAt,
      endsAt: view?.slot.endsAt,
    };
  });

  app.post("/api/v1/waitlist/offers/:id/decline", async (request) => {
    const who = await patient(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const declined = await declineWaitlistOffer(app.prisma, { offerId: params.id, patientId: who.id });
    await offerFreedSlot(app.prisma, app.redis, declined.slotId);
    return { ok: true };
  });
}
