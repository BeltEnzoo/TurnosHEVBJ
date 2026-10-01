import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@hep/db";
import { createUser, ensureRbac, resetAuthData, startTestApp } from "./helpers.js";

const password = "CorrectHorseBattery";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function sessionCookie(userId: string, mfaSatisfied: boolean): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: tokenHash(token),
      kind: "STAFF",
      mfaSatisfied,
      expiresAt: new Date(now + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(now + 8 * 60 * 60 * 1000),
    },
  });
  return `staff_session=${token}`;
}

async function cleanupCatalog(): Promise<void> {
  await prisma.professionalSpecialty.deleteMany({ where: { professional: { familyName: "Fase3" } } });
  await prisma.professionalOffice.deleteMany({ where: { professional: { familyName: "Fase3" } } });
  await prisma.professional.deleteMany({ where: { familyName: "Fase3" } });
  await prisma.office.deleteMany({ where: { code: { startsWith: "F3" } } });
  await prisma.specialty.deleteMany({ where: { slug: { startsWith: "fase3-" } } });
}

describe("catalogs", () => {
  let ctx: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    await ensureRbac();
    ctx = await startTestApp();
  });

  beforeEach(async () => {
    await cleanupCatalog();
    await resetAuthData();
    await ctx.redis.flushdb();
  });

  afterAll(async () => {
    await cleanupCatalog();
    await ctx.app.close();
    await ctx.redis.quit();
  });

  it("lets an admin manage specialties and hides inactive ones from the public list", async () => {
    const anon = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/specialties",
      payload: { name: "Fase3 clinica", defaultSlotMinutes: 20 },
    });
    expect(anon.statusCode).toBe(401);

    const reception = await createUser({
      email: "recepcion-fase3@hospital.local",
      password,
      role: "RECEPCION",
    });
    const receptionCookie = await sessionCookie(reception.id, true);
    const forbidden = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/specialties",
      headers: { cookie: receptionCookie },
      payload: { name: "Fase3 clinica", defaultSlotMinutes: 20 },
    });
    expect(forbidden.statusCode).toBe(403);

    const admin = await createUser({
      email: "admin-fase3@hospital.local",
      password,
      role: "ADMIN",
    });
    const cookie = await sessionCookie(admin.id, true);
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/specialties",
      headers: { cookie },
      payload: { name: "Fase3 clinica", defaultSlotMinutes: 20 },
    });
    expect(created.statusCode).toBe(201);
    const specialtyId = created.json().id as string;
    expect(created.json().slug).toBe("fase3-clinica");

    const duplicate = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/specialties",
      headers: { cookie },
      payload: { name: "Fase3 clinica", defaultSlotMinutes: 15 },
    });
    expect(duplicate.statusCode).toBe(409);

    const pub = await ctx.app.inject({ method: "GET", url: "/api/v1/specialties?limit=100" });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().items.some((item: { id: string }) => item.id === specialtyId)).toBe(true);

    const office = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/offices",
      headers: { cookie },
      payload: { name: "Fase3 consultorio", code: "f3a", locationLabel: "Planta baja" },
    });
    expect(office.statusCode).toBe(201);
    expect(office.json().code).toBe("F3A");

    const professional = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/professionals",
      headers: { cookie },
      payload: {
        givenName: "Laura",
        familyName: "Fase3",
        licenseNumber: "DEV-F3",
        specialtyIds: [specialtyId],
        officeIds: [office.json().id],
      },
    });
    expect(professional.statusCode).toBe(201);
    expect(professional.json().licenseNumber).toBe("DEV-F3");

    const listed = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/professionals?specialtyId=${specialtyId}&limit=100`,
    });
    expect(listed.statusCode).toBe(200);
    const body = JSON.stringify(listed.json());
    expect(body).toContain("Laura");
    expect(body).not.toContain("DEV-F3");
    expect(body).not.toContain("userId");

    const deactivated = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/admin/specialties/${specialtyId}`,
      headers: { cookie },
      payload: { deactivated: true },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().deactivatedAt).toBeTruthy();

    const hidden = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/professionals?specialtyId=${specialtyId}&limit=100`,
    });
    expect(hidden.json().items).toEqual([]);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "catalog.specialty.create", entityId: specialtyId },
    });
    expect(audit?.actorUserId).toBe(admin.id);
  });
});
