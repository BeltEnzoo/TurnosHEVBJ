import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCivilDays, civilToday, prisma, weekdayMonday1 } from "@hep/db";
import { createUser, ensureRbac, resetAuthData, startTestApp } from "./helpers.js";

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

function upcomingMonday(): string {
  let cursor = addCivilDays(civilToday(new Date()), 1);
  while (weekdayMonday1(cursor) !== 1) {
    cursor = addCivilDays(cursor, 1);
  }
  return cursor;
}

async function cleanup(): Promise<void> {
  const professionals = await prisma.professional.findMany({
    where: { familyName: "Fase4" },
    select: { id: true },
  });
  const ids = professionals.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.appointmentSlot.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.scheduleBlock.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.scheduleException.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.holiday.deleteMany({ where: { OR: [{ professionalId: { in: ids } }, { name: { startsWith: "Fase4" } }] } });
    await prisma.weeklySchedule.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.professionalSpecialty.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.professionalOffice.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.professional.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.holiday.deleteMany({ where: { name: { startsWith: "Fase4" } } });
  await prisma.office.deleteMany({ where: { code: { startsWith: "F4" } } });
  await prisma.specialty.deleteMany({ where: { slug: { startsWith: "fase4-" } } });
}

describe("schedules and availability", () => {
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

  async function catalog() {
    const specialty = await prisma.specialty.create({
      data: { name: "Fase4 clinica", slug: `fase4-${Date.now()}`, defaultSlotMinutes: 30 },
    });
    const professional = await prisma.professional.create({
      data: { givenName: "Nora", familyName: "Fase4" },
    });
    const office = await prisma.office.create({
      data: { name: "Consultorio fase4", code: `F4${Date.now().toString().slice(-4)}` },
    });
    await prisma.professionalSpecialty.create({
      data: { professionalId: professional.id, specialtyId: specialty.id },
    });
    await prisma.professionalOffice.create({
      data: { professionalId: professional.id, officeId: office.id },
    });
    return { specialty, professional, office };
  }

  it("materializes available slots and omits them on a holiday", async () => {
    const { specialty, professional, office } = await catalog();
    const day = upcomingMonday();
    const supervisor = await createUser({
      email: "supervisor-fase4@hospital.local",
      password: "CorrectHorseBattery",
      role: "SUPERVISOR",
    });
    const cookie = await sessionCookie(supervisor.id, false);
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/schedules",
      headers: { cookie },
      payload: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        weekday: 1,
        startTime: "09:00",
        endTime: "10:00",
        slotMinutes: 30,
        validFrom: day,
        validTo: day,
      },
    });
    expect(created.statusCode).toBe(201);

    const open = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/availability?specialtyId=${specialty.id}&from=${day}&to=${day}`,
    });
    expect(open.statusCode).toBe(200);
    const items = open.json().items as Array<{ startsAt: string; officeCode: string }>;
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.startsAt.slice(11, 16))).toEqual(["12:00", "12:30"]);
    expect(JSON.stringify(open.json())).not.toContain("BOOKED");
    expect(items[0]?.officeCode).toBe(office.code);

    const holiday = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/holidays",
      headers: { cookie },
      payload: { date: day, name: "Fase4 feriado", appliesTo: "ALL" },
    });
    expect(holiday.statusCode).toBe(201);

    const closed = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/availability?specialtyId=${specialty.id}&from=${day}&to=${day}`,
    });
    expect(closed.json().items).toEqual([]);
  });

  it("keeps a booked slot when the weekly schedule is deactivated", async () => {
    const { specialty, professional, office } = await catalog();
    const day = upcomingMonday();
    const supervisor = await createUser({
      email: "supervisor-fase4b@hospital.local",
      password: "CorrectHorseBattery",
      role: "SUPERVISOR",
    });
    const cookie = await sessionCookie(supervisor.id, false);
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/schedules",
      headers: { cookie },
      payload: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        weekday: 1,
        startTime: "09:00",
        endTime: "10:00",
        slotMinutes: 30,
        validFrom: day,
        validTo: day,
      },
    });
    expect(created.statusCode).toBe(201);
    const slots = await prisma.appointmentSlot.findMany({
      where: { professionalId: professional.id },
      orderBy: { startsAt: "asc" },
    });
    expect(slots).toHaveLength(2);
    await prisma.appointmentSlot.update({ where: { id: slots[0]!.id }, data: { status: "BOOKED" } });

    const deactivated = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/admin/schedules/${created.json().id}`,
      headers: { cookie },
      payload: { deactivated: true },
    });
    expect(deactivated.statusCode).toBe(200);

    const remaining = await prisma.appointmentSlot.findMany({ where: { professionalId: professional.id } });
    expect(remaining.map((slot) => slot.id)).toEqual([slots[0]!.id]);
    expect(remaining[0]?.status).toBe("BOOKED");

    const reception = await createUser({
      email: "recepcion-fase4@hospital.local",
      password: "CorrectHorseBattery",
      role: "RECEPCION",
    });
    const forbidden = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/schedules",
      headers: { cookie: await sessionCookie(reception.id, true) },
      payload: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        weekday: 1,
        startTime: "11:00",
        endTime: "12:00",
        slotMinutes: 30,
        validFrom: day,
        validTo: day,
      },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
