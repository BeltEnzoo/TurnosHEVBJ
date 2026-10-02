import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@hep/db";
import { normalizeArPhone } from "@hep/shared";
import { hmacSha256 } from "../src/lib/crypto.js";
import { createUser, ensureRbac, resetAuthData, startTestApp } from "./helpers.js";

const password = "CorrectHorseBattery";
const secret = "test-session-secret-must-be-32-chars-min";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function sessionCookie(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: tokenHash(token),
      kind: "STAFF",
      mfaSatisfied: true,
      expiresAt: new Date(now + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(now + 8 * 60 * 60 * 1000),
    },
  });
  return `staff_session=${token}`;
}

async function cleanup(): Promise<void> {
  const patients = await prisma.patient.findMany({ where: { familyName: "Fase7" }, select: { id: true } });
  const ids = patients.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.notification.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.patient.deleteMany({ where: { id: { in: ids } } });
  }
}

describe("admin panel", () => {
  let ctx: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    await ensureRbac();
    ctx = await startTestApp();
  });

  beforeEach(async () => {
    await cleanup();
    await resetAuthData();
    await ctx.redis.flushdb();
  });

  afterAll(async () => {
    await cleanup();
    await ctx.app.close();
    await ctx.redis.quit();
  });

  it("keeps user management and settings behind the right roles", async () => {
    const reception = await createUser({
      email: "recepcion-fase7@hospital.local",
      password,
      role: "RECEPCION",
    });
    const receptionCookie = await sessionCookie(reception.id);
    const hidden = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/admin/users",
      headers: { cookie: receptionCookie },
    });
    expect(hidden.statusCode).toBe(403);

    const admin = await createUser({
      email: "admin-fase7@hospital.local",
      password,
      role: "ADMIN",
    });
    const adminCookie = await sessionCookie(admin.id);
    const deniedRole = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: { cookie: adminCookie },
      payload: { email: "otro-fase7@hospital.local", password: "OtraClaveSegura1", role: "SUPER_ADMIN" },
    });
    expect(deniedRole.statusCode).toBe(403);

    const deniedSettings = await ctx.app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: { cookie: adminCookie },
      payload: { cancel_min_hours: 4 },
    });
    expect(deniedSettings.statusCode).toBe(403);

    const superAdmin = await createUser({
      email: "super-fase7@hospital.local",
      password,
      role: "SUPER_ADMIN",
    });
    const superCookie = await sessionCookie(superAdmin.id);
    const professional = await prisma.professional.create({
      data: { givenName: "Fase", familyName: "Siete" },
    });
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: { cookie: superCookie },
      payload: {
        email: "medico-fase7@hospital.local",
        password: "ClaveDeMedico12",
        role: "MEDICO",
        professionalId: professional.id,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().professional.familyName).toBe("Siete");
    await prisma.professional.delete({ where: { id: professional.id } });
    const audits = await prisma.auditLog.findMany({ where: { action: "user.create" } });
    expect(JSON.stringify(audits)).not.toContain("ClaveDeMedico12");

    const previous = await prisma.systemSetting.findUnique({ where: { key: "cancel_min_hours" } });
    const patched = await ctx.app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: { cookie: superCookie },
      payload: { cancel_min_hours: 5 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().items.find((item: { key: string }) => item.key === "cancel_min_hours").value).toBe(5);
    await prisma.systemSetting.upsert({
      where: { key: "cancel_min_hours" },
      create: { key: "cancel_min_hours", value: previous?.value ?? 2 },
      update: { value: previous?.value ?? 2 },
    });
  });

  it("searches a patient without storing the DNI in the audit", async () => {
    const phone = normalizeArPhone("+541155550007");
    const dni = "30111007";
    await prisma.patient.create({
      data: {
        givenName: "Nora",
        familyName: "Fase7",
        dni,
        dniHmac: hmacSha256(dni, secret),
        birthDate: new Date(Date.UTC(1988, 1, 2)),
        phoneE164: phone!,
        phoneHmac: hmacSha256(phone!, secret),
      },
    });
    const reception = await createUser({
      email: "busca-fase7@hospital.local",
      password,
      role: "RECEPCION",
    });
    const cookie = await sessionCookie(reception.id);
    const found = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/patients/search",
      headers: { cookie },
      payload: { dni },
    });
    expect(found.statusCode).toBe(200);
    expect(found.json().items).toHaveLength(1);
    expect(found.json().items[0].familyName).toBe("Fase7");

    const audits = await prisma.auditLog.findMany({ where: { action: "patient.search" } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(dni);

    const patient = await prisma.patient.findFirstOrThrow({ where: { familyName: "Fase7" } });
    await prisma.notification.create({
      data: {
        type: "APPOINTMENT_CONFIRMATION",
        channel: "WHATSAPP",
        patientId: patient.id,
        status: "PENDING",
        idempotencyKey: `fase7-${patient.id}`,
        params: { publicCode: "AB-234", dni },
      },
    });
    const notices = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/admin/notifications",
      headers: { cookie },
    });
    expect(notices.statusCode).toBe(200);
    expect(JSON.stringify(notices.json())).not.toContain(dni);
    expect(notices.json().items[0].publicCode).toBe("AB-234");
  });
});
