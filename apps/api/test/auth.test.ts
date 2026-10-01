import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cookieFrom,
  createUser,
  ensureRbac,
  resetAuthData,
  startTestApp,
} from "./helpers.js";
import { prisma } from "@hep/db";

const password = "CorrectHorseBattery";

describe("staff auth", () => {
  let ctx: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    await ensureRbac();
    ctx = await startTestApp();
  });

  beforeEach(async () => {
    await resetAuthData();
    await ctx.redis.flushdb();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.redis.quit();
    await prisma.$disconnect();
  });

  it("rejects invalid credentials with a generic error", async () => {
    await createUser({ email: "admin@hospital.local", password, role: "ADMIN" });
    const missing = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "nobody@hospital.local", password: "nope" },
    });
    const wrong = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "admin@hospital.local", password: "nope" },
    });
    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(missing.json().error.message).toBe(wrong.json().error.message);
    expect(JSON.stringify(missing.json())).not.toMatch(/password/i);
  });

  it("sets an HttpOnly session cookie and opens the panel with email and password", async () => {
    await createUser({ email: "admin@hospital.local", password, role: "SUPER_ADMIN" });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "admin@hospital.local", password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().mfaRequired).toBe(false);
    expect(login.json().mfaEnrollmentRequired).toBe(false);
    const cookie = cookieFrom(login, "staff_session");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/localStorage/);

    const me = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/auth/staff/me",
      headers: { cookie: cookie!.split(";")[0] },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().roles).toContain("SUPER_ADMIN");
  });

  it("enrolls TOTP and then allows the admin probe", async () => {
    await createUser({ email: "admin@hospital.local", password, role: "ADMIN" });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "admin@hospital.local", password },
    });
    const sessionCookie = cookieFrom(login, "staff_session")!.split(";")[0]!;
    const start = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/mfa/enroll/start",
      headers: { cookie: sessionCookie },
    });
    expect(start.statusCode).toBe(200);
    const otpauthUrl = String(start.json().otpauthUrl);
    const secret = new URL(otpauthUrl).searchParams.get("secret");
    expect(secret).toBeTruthy();
    const totp = new TOTP({ secret: Secret.fromBase32(secret!), digits: 6, period: 30 });
    const confirm = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/mfa/enroll/confirm",
      headers: { cookie: sessionCookie },
      payload: { code: totp.generate() },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().recoveryCodes).toHaveLength(8);

    const probe = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/admin/security-probe",
      headers: { cookie: sessionCookie },
    });
    expect(probe.statusCode).toBe(200);
  });

  it("forbids reception from the admin probe", async () => {
    await createUser({ email: "desk@hospital.local", password, role: "RECEPCION" });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "desk@hospital.local", password },
    });
    const sessionCookie = cookieFrom(login, "staff_session")!.split(";")[0]!;
    const probe = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/admin/security-probe",
      headers: { cookie: sessionCookie },
    });
    expect(probe.statusCode).toBe(403);
  });

  it("locks the account after repeated failures", async () => {
    await createUser({ email: "admin@hospital.local", password, role: "ADMIN" });
    for (let i = 0; i < 5; i += 1) {
      await ctx.app.inject({
        method: "POST",
        url: "/api/v1/auth/staff/login",
        payload: { email: "admin@hospital.local", password: "wrong-password" },
      });
    }
    const locked = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "admin@hospital.local", password },
    });
    expect(locked.statusCode).toBe(401);
  });

  it("rate limits login by IP", async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/auth/staff/login",
        payload: { email: "rate@hospital.local", password: "x" },
      });
      expect(response.statusCode).toBe(401);
    }
    const limited = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "rate@hospital.local", password: "x" },
    });
    expect(limited.statusCode).toBe(429);
  });

  it("does not reset login rate limit by spoofing X-Forwarded-For", async () => {
    for (let i = 0; i < 10; i += 1) {
      await ctx.app.inject({
        method: "POST",
        url: "/api/v1/auth/staff/login",
        headers: { "x-forwarded-for": `203.0.113.${i}` },
        payload: { email: `spoof${i}@hospital.local`, password: "x" },
      });
    }
    const limited = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      headers: { "x-forwarded-for": "198.51.100.9" },
      payload: { email: "spoof-final@hospital.local", password: "x" },
    });
    expect(limited.statusCode).toBe(429);
  });

  it("revokes the session on logout", async () => {
    await createUser({ email: "desk@hospital.local", password, role: "RECEPCION" });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "desk@hospital.local", password },
    });
    const sessionCookie = cookieFrom(login, "staff_session")!.split(";")[0]!;
    await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/logout",
      headers: { cookie: sessionCookie },
    });
    const me = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/auth/staff/me",
      headers: { cookie: sessionCookie },
    });
    expect(me.statusCode).toBe(401);
  });
});
