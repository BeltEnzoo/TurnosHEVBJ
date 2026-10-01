import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "@hep/shared";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { hmacSha256, sha256 } from "../../lib/crypto.js";
import {
  clearSessionCookie,
  setSessionCookie,
  staffCookieName,
} from "../../lib/cookies.js";
import { loadStaffSession, requirePermission, requireStaff } from "./session.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const mfaCodeSchema = z.object({
  code: z.string().min(6).max(64),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/auth/staff/login", async (request, reply) => {
    await consumeRateLimit(app.redis, `rl:login:ip:${request.ip}`, 10, 15 * 60);
    const body = loginSchema.parse(request.body);
    await consumeRateLimit(
      app.redis,
      `rl:login:email:${hmacSha256(body.email.trim().toLowerCase(), app.env.SESSION_SECRET)}`,
      10,
      15 * 60,
    );
    const result = await app.staffAuth.login({
      email: body.email,
      password: body.password,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    setSessionCookie(
      reply,
      app.env,
      staffCookieName(app.env),
      result.token,
      app.env.SESSION_ABSOLUTE_HOURS * 3600,
    );
    return {
      mfaRequired: result.mfaRequired,
      mfaEnrollmentRequired: result.mfaEnrollmentRequired,
    };
  });

  app.post("/api/v1/auth/staff/mfa/enroll/start", async (request) => {
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(
      await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS),
      { mfa: false },
    );
    return app.staffAuth.startMfaEnrollment(staff.userId, staff.email);
  });

  app.post("/api/v1/auth/staff/mfa/enroll/confirm", async (request) => {
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(
      await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS),
      { mfa: false },
    );
    const body = mfaCodeSchema.parse(request.body);
    const result = await app.staffAuth.confirmMfaEnrollment(staff.userId, body.code);
    await app.prisma.session.update({
      where: { id: staff.sessionId },
      data: { mfaSatisfied: true },
    });
    return result;
  });

  app.post("/api/v1/auth/staff/mfa/verify", async (request) => {
    await consumeRateLimit(app.redis, `rl:mfa:ip:${request.ip}`, 20, 15 * 60);
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(
      await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS),
      { mfa: false },
    );
    const body = mfaCodeSchema.parse(request.body);
    await app.staffAuth.verifyMfa(staff.userId, staff.sessionId, body.code);
    return { ok: true };
  });

  app.get("/api/v1/auth/staff/me", async (request) => {
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS));
    return {
      id: staff.userId,
      email: staff.email,
      roles: staff.roles,
      permissions: staff.permissions,
    };
  });

  app.post("/api/v1/auth/staff/logout", async (request, reply) => {
    const name = staffCookieName(app.env);
    const token = request.cookies[name];
    if (token) {
      await app.staffAuth.logout(sha256(token));
    }
    clearSessionCookie(reply, app.env, name);
    return { ok: true };
  });

  app.post("/api/v1/auth/staff/logout-all", async (request, reply) => {
    const name = staffCookieName(app.env);
    const token = request.cookies[name];
    const staff = requireStaff(await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS));
    await app.staffAuth.logoutAll(staff.userId);
    clearSessionCookie(reply, app.env, name);
    return { ok: true };
  });

  app.get("/api/v1/admin/security-probe", async (request) => {
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS));
    requirePermission(staff, PERMISSIONS.USERS_MANAGE);
    return { ok: true };
  });
}
