import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addCivilDays, zonedDateTimeToUtc } from "@hep/db";
import { PERMISSIONS, ROLE_CODES, type RoleCode } from "@hep/shared";
import { sha256, truncateUserAgent } from "../../lib/crypto.js";
import { staffCookieName } from "../../lib/cookies.js";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { loadStaffSession, requireAnyPermission, requirePermission, requireStaff } from "../auth/session.js";
import {
  createStaffUser,
  deleteStaffUser,
  appointmentSummary,
  listAudit,
  listNotifications,
  listSettings,
  listProfessionalsForAccounts,
  listUsers,
  resetStaffPassword,
  revokeUserSessions,
  searchPatients,
  updateSettings,
  updateStaffUser,
  type StaffActor,
} from "./service.js";

const roleSchema = z.enum(ROLE_CODES);

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  async function actor(
    request: { cookies: Record<string, string | undefined>; ip: string; headers: { "user-agent"?: string } },
    permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS],
  ): Promise<StaffActor> {
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS));
    requirePermission(staff, permission);
    return {
      userId: staff.userId,
      roles: staff.roles,
      ipHash: sha256(request.ip),
      userAgentTruncated: truncateUserAgent(request.headers["user-agent"]),
    };
  }

  app.post("/api/v1/admin/patients/search", async (request) => {
    const who = await actor(request, PERMISSIONS.APPOINTMENTS_WRITE);
    await consumeRateLimit(app.redis, `rl:patients:user:${who.userId}`, 30, 15 * 60);
    const body = z
      .object({
        dni: z.string().trim().min(7).max(12).optional(),
        familyName: z.string().trim().min(2).max(80).optional(),
      })
      .parse(request.body);
    return searchPatients(app.prisma, body, who);
  });

  app.get("/api/v1/admin/settings", async (request) => {
    await actor(request, PERMISSIONS.SETTINGS_WRITE);
    return listSettings(app.prisma);
  });

  app.patch("/api/v1/admin/settings", async (request) => {
    const who = await actor(request, PERMISSIONS.SETTINGS_WRITE);
    const body = z
      .object({
        hospital_name: z.string().trim().min(2).max(80).optional(),
        cancel_min_hours: z.number().int().min(0).max(168).optional(),
        booking_horizon_days: z.number().int().min(1).max(90).optional(),
        max_active_appointments: z.number().int().min(1).max(10).optional(),
      })
      .refine((value) => Object.keys(value).length > 0)
      .parse(request.body);
    return updateSettings(app.prisma, body, who);
  });

  app.get("/api/v1/admin/users", async (request) => {
    await actor(request, PERMISSIONS.USERS_MANAGE);
    return listUsers(app.prisma);
  });

  app.get("/api/v1/admin/users/professionals", async (request) => {
    await actor(request, PERMISSIONS.USERS_MANAGE);
    return listProfessionalsForAccounts(app.prisma);
  });

  app.post("/api/v1/admin/users", async (request, reply) => {
    const who = await actor(request, PERMISSIONS.USERS_MANAGE);
    const body = z
      .object({
        email: z.string().trim().email().max(120),
        password: z.string().min(12).max(200),
        role: roleSchema,
        professionalId: z.string().uuid().optional(),
      })
      .parse(request.body);
    const created = await createStaffUser(
      app.prisma,
      { ...body, role: body.role as RoleCode, professionalId: body.professionalId },
      who,
    );
    return reply.code(201).send(created);
  });

  app.patch("/api/v1/admin/users/:id", async (request) => {
    const who = await actor(request, PERMISSIONS.USERS_MANAGE);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        isActive: z.boolean().optional(),
        role: roleSchema.optional(),
      })
      .refine((value) => Object.keys(value).length > 0)
      .parse(request.body);
    return updateStaffUser(
      app.prisma,
      params.id,
      { isActive: body.isActive, role: body.role as RoleCode | undefined },
      who,
    );
  });

  app.delete("/api/v1/admin/users/:id", async (request) => {
    const who = await actor(request, PERMISSIONS.USERS_MANAGE);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return deleteStaffUser(app.prisma, params.id, who);
  });

  app.post("/api/v1/admin/users/:id/reset-password", async (request) => {
    const who = await actor(request, PERMISSIONS.USERS_MANAGE);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return resetStaffPassword(app.prisma, params.id, who);
  });

  app.post("/api/v1/admin/users/:id/revoke-sessions", async (request) => {
    const who = await actor(request, PERMISSIONS.USERS_MANAGE);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return revokeUserSessions(app.prisma, params.id, who);
  });

  app.get("/api/v1/admin/notifications", async (request) => {
    await actor(request, PERMISSIONS.APPOINTMENTS_WRITE);
    const query = z
      .object({
        status: z.enum(["PENDING", "SENT", "FAILED", "CANCELLED"]).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return listNotifications(app.prisma, query);
  });

  app.get("/api/v1/admin/reports/summary", async (request) => {
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS));
    requireAnyPermission(staff, [PERMISSIONS.REPORTS_READ, PERMISSIONS.APPOINTMENTS_WRITE]);
    const query = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(request.query);
    return appointmentSummary(app.prisma, {
      from: zonedDateTimeToUtc(query.from, 0),
      to: zonedDateTimeToUtc(addCivilDays(query.to, 1), 0),
    });
  });

  app.get("/api/v1/admin/audit", async (request) => {
    await actor(request, PERMISSIONS.AUDIT_READ);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    return listAudit(app.prisma, query.limit);
  });
}
