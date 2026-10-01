import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "@hep/shared";
import { sha256, truncateUserAgent } from "../../lib/crypto.js";
import { staffCookieName } from "../../lib/cookies.js";
import { loadStaffSession, requirePermission, requireStaff } from "../auth/session.js";
import {
  callOwnAppointment,
  completeOwnAppointment,
  listDoctorAgenda,
  markOwnNoShow,
  startOwnAppointment,
} from "../appointments/service.js";
import { publishAppointmentCall } from "../displays/service.js";
import { cancelPendingReminders } from "../whatsapp/reminders.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function publish(
  request: { log: { error: (obj: unknown, msg: string) => void } },
  app: FastifyInstance,
  callId: string,
  debounced: boolean,
): Promise<void> {
  if (debounced) {
    return;
  }
  try {
    await publishAppointmentCall(app.prisma, app.displays, callId);
  } catch (error) {
    request.log.error({ err: error }, "display emit failed");
  }
}

export async function registerMedicoRoutes(app: FastifyInstance): Promise<void> {
  async function actor(request: {
    cookies: Record<string, string | undefined>;
    ip: string;
    headers: { "user-agent"?: string };
  }) {
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS));
    requirePermission(staff, PERMISSIONS.APPOINTMENTS_CALL_OWN);
    return {
      userId: staff.userId,
      ipHash: sha256(request.ip),
      userAgentTruncated: truncateUserAgent(request.headers["user-agent"]),
    };
  }

  app.get("/api/v1/medico/agenda", async (request) => {
    const who = await actor(request);
    const query = z.object({ date: isoDate }).parse(request.query);
    return listDoctorAgenda(app.prisma, who.userId, query.date);
  });

  app.post("/api/v1/appointments/:id/call", async (request) => {
    const who = await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const view = await callOwnAppointment(app.prisma, { appointmentId: params.id, recall: false }, who);
    await publish(request, app, view.callId, view.debounced);
    return view;
  });

  app.post("/api/v1/appointments/:id/recall", async (request) => {
    const who = await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const view = await callOwnAppointment(app.prisma, { appointmentId: params.id, recall: true }, who);
    await publish(request, app, view.callId, view.debounced);
    return view;
  });

  app.post("/api/v1/appointments/:id/in-progress", async (request) => {
    const who = await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return startOwnAppointment(app.prisma, params.id, who);
  });

  app.post("/api/v1/appointments/:id/complete", async (request) => {
    const who = await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const completed = await completeOwnAppointment(app.prisma, params.id, who);
    await cancelPendingReminders(app.prisma, params.id);
    return completed;
  });

  app.post("/api/v1/appointments/:id/no-show", async (request) => {
    const who = await actor(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const missed = await markOwnNoShow(app.prisma, params.id, who);
    await cancelPendingReminders(app.prisma, params.id);
    return missed;
  });
}
