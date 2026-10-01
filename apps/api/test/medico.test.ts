import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCivilDays, civilToday, prisma, weekdayMonday1, zonedDateTimeToUtc } from "@hep/db";
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

function upcomingMonday(): string {
  let cursor = addCivilDays(civilToday(new Date()), 1);
  while (weekdayMonday1(cursor) !== 1) {
    cursor = addCivilDays(cursor, 1);
  }
  return cursor;
}

async function cleanup(): Promise<void> {
  const professionals = await prisma.professional.findMany({
    where: { familyName: "Fase8" },
    select: { id: true },
  });
  const ids = professionals.map((row) => row.id);
  if (ids.length > 0) {
    const slots = await prisma.appointmentSlot.findMany({
      where: { professionalId: { in: ids } },
      select: { id: true },
    });
    const slotIds = slots.map((row) => row.id);
    if (slotIds.length > 0) {
      const appointments = await prisma.appointment.findMany({
        where: { slotId: { in: slotIds } },
        select: { id: true },
      });
      const appointmentIds = appointments.map((row) => row.id);
      if (appointmentIds.length > 0) {
        await prisma.appointmentCall.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await prisma.notification.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
      }
      await prisma.appointmentSlot.deleteMany({ where: { id: { in: slotIds } } });
    }
    await prisma.professional.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.patient.deleteMany({ where: { familyName: "Fase8" } });
  await prisma.office.deleteMany({ where: { code: "F8MED" } });
  await prisma.specialty.deleteMany({ where: { slug: "fase8-med" } });
}

describe("medical panel", () => {
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

  it("lets a doctor call only their own appointments and debounces a double tap", async () => {
    const doctor = await createUser({ email: "medico-fase8@hospital.local", password, role: "MEDICO" });
    const other = await createUser({ email: "otro-fase8@hospital.local", password, role: "MEDICO" });
    const reception = await createUser({ email: "recepcion-fase8@hospital.local", password, role: "RECEPCION" });
    const specialty = await prisma.specialty.create({
      data: { name: "Fase8 clinica", slug: "fase8-med", defaultSlotMinutes: 20 },
    });
    const office = await prisma.office.create({ data: { name: "Consultorio fase8", code: "F8MED" } });
    const professional = await prisma.professional.create({
      data: { givenName: "Nora", familyName: "Fase8", userId: doctor.id },
    });
    await prisma.professional.create({
      data: { givenName: "Luis", familyName: "Fase8", userId: other.id },
    });
    const day = upcomingMonday();
    const slot = await prisma.appointmentSlot.create({
      data: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        startsAt: zonedDateTimeToUtc(day, 15 * 60),
        endsAt: zonedDateTimeToUtc(day, 15 * 60 + 20),
        status: "BOOKED",
      },
    });
    const phone = normalizeArPhone("+541166660008")!;
    const dni = "30111008";
    const patient = await prisma.patient.create({
      data: {
        givenName: "Lia",
        familyName: "Fase8",
        dni,
        dniHmac: hmacSha256(dni, secret),
        birthDate: new Date(Date.UTC(1991, 3, 2)),
        phoneE164: phone,
        phoneHmac: hmacSha256(phone, secret),
      },
    });
    const appointment = await prisma.appointment.create({
      data: {
        publicCode: "F8-7M4",
        slotId: slot.id,
        patientId: patient.id,
        status: "CONFIRMED",
        kind: "REGULAR",
        createdByType: "STAFF",
      },
    });

    const cookie = await sessionCookie(doctor.id);
    const agenda = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/medico/agenda?date=${day}`,
      headers: { cookie },
    });
    expect(agenda.statusCode).toBe(200);
    expect(agenda.json().items).toHaveLength(1);
    expect(agenda.json().items[0].patient.familyName).toBe("Fase8");
    expect(JSON.stringify(agenda.json())).not.toContain(dni);

    const otherAgenda = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/medico/agenda?date=${day}`,
      headers: { cookie: await sessionCookie(other.id) },
    });
    expect(otherAgenda.statusCode).toBe(200);
    expect(otherAgenda.json().items).toHaveLength(0);

    const forbidden = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/call`,
      headers: { cookie: await sessionCookie(reception.id) },
      payload: { professionalId: professional.id },
    });
    expect(forbidden.statusCode).toBe(403);

    const hidden = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/call`,
      headers: { cookie: await sessionCookie(other.id) },
    });
    expect(hidden.statusCode).toBe(404);

    const called = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/call`,
      headers: { cookie },
      payload: { professionalId: "ignored" },
    });
    expect(called.statusCode).toBe(200);
    expect(called.json().status).toBe("CALLED");
    expect(called.json().debounced).toBe(false);
    expect(JSON.stringify(called.json())).not.toContain(dni);

    const again = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/call`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().debounced).toBe(true);
    expect(await prisma.appointmentCall.count({ where: { appointmentId: appointment.id } })).toBe(1);
    const stored = await prisma.appointmentCall.findFirstOrThrow({ where: { appointmentId: appointment.id } });
    expect(stored.result).toBe("DISPLAY_OFFLINE");

    const recalled = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recall`,
      headers: { cookie },
    });
    expect(recalled.statusCode).toBe(200);
    expect(recalled.json().status).toBe("CALLED");
    expect(await prisma.appointmentCall.count({ where: { appointmentId: appointment.id } })).toBe(2);

    const started = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/in-progress`,
      headers: { cookie },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().status).toBe("IN_PROGRESS");

    const done = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/complete`,
      headers: { cookie },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe("COMPLETED");
    expect(JSON.stringify(done.json())).not.toContain(dni);
  });
});
