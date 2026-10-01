import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCivilDays, civilToday, prisma, weekdayMonday1, zonedDateTimeToUtc } from "@hep/db";
import { normalizeArPhone } from "@hep/shared";
import { cookieFrom, ensureRbac, resetAuthData, startTestApp } from "./helpers.js";

function upcomingMonday(): string {
  let cursor = addCivilDays(civilToday(new Date()), 1);
  while (weekdayMonday1(cursor) !== 1) {
    cursor = addCivilDays(cursor, 1);
  }
  return cursor;
}

function person(dni: string, phone: string) {
  return {
    givenName: "Lia",
    familyName: "Fase6",
    dni,
    birthDate: "1990-01-15",
    phone,
  };
}

async function cleanup(): Promise<void> {
  const patients = await prisma.patient.findMany({ where: { familyName: "Fase6" }, select: { id: true } });
  const patientIds = patients.map((row) => row.id);
  if (patientIds.length > 0) {
    const appointments = await prisma.appointment.findMany({
      where: { patientId: { in: patientIds } },
      select: { id: true, slotId: true },
    });
    const appointmentIds = appointments.map((row) => row.id);
    const slotIds = appointments.map((row) => row.slotId);
    if (appointmentIds.length > 0) {
      await prisma.notification.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
      await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
      await prisma.appointment.updateMany({
        where: { id: { in: appointmentIds } },
        data: { rescheduledFromId: null, rescheduledToId: null },
      });
      await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
    }
    if (slotIds.length > 0) {
      await prisma.appointmentSlot.deleteMany({ where: { id: { in: slotIds } } });
    }
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
  }
  const professionals = await prisma.professional.findMany({ where: { familyName: "Fase6" }, select: { id: true } });
  const ids = professionals.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.appointmentSlot.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.professionalSpecialty.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.professionalOffice.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.professional.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.office.deleteMany({ where: { code: { startsWith: "F6" } } });
  await prisma.specialty.deleteMany({ where: { slug: { startsWith: "fase6-" } } });
}

describe("patient portal", () => {
  let ctx: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    await ensureRbac();
    ctx = await startTestApp();
  });

  beforeEach(async () => {
    await cleanup();
    await resetAuthData();
    await ctx.redis.flushdb();
    await prisma.otpRequest.deleteMany();
  });

  afterAll(async () => {
    await cleanup();
    await ctx.app.close();
    await ctx.redis.quit();
  });

  async function catalogAndSlot(minutes: number) {
    const specialty = await prisma.specialty.create({
      data: { name: "Fase6 clinica", slug: `fase6-${Date.now()}-${minutes}`, defaultSlotMinutes: 30 },
    });
    const professional = await prisma.professional.create({
      data: { givenName: "Nora", familyName: "Fase6" },
    });
    const office = await prisma.office.create({
      data: { name: "Consultorio fase6", code: `F6${Date.now().toString().slice(-4)}` },
    });
    await prisma.professionalSpecialty.create({ data: { professionalId: professional.id, specialtyId: specialty.id } });
    await prisma.professionalOffice.create({ data: { professionalId: professional.id, officeId: office.id } });
    const day = upcomingMonday();
    const startsAt = zonedDateTimeToUtc(day, minutes);
    const slot = await prisma.appointmentSlot.create({
      data: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
        status: "AVAILABLE",
        slotKind: "REGULAR",
      },
    });
    return { specialty, professional, office, slot, day };
  }

  async function login(dni: string, phone: string): Promise<string> {
    const requested = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/patient/otp/request",
      payload: { dni, phone, turnstileToken: "test-turnstile" },
    });
    expect(requested.statusCode).toBe(200);
    expect(JSON.stringify(requested.json())).not.toMatch(/\d{6}/);
    const normalized = normalizeArPhone(phone);
    const code = ctx.whatsapp.getLastOtpForTests(normalized!);
    expect(code).toMatch(/^\d{6}$/);
    const verified = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/patient/otp/verify",
      payload: { dni, phone, code, turnstileToken: "test-turnstile" },
    });
    expect(verified.statusCode).toBe(200);
    const setCookie = cookieFrom(verified, "patient_session");
    expect(setCookie).toContain("HttpOnly");
    return setCookie!.split(";")[0]!;
  }

  it("books, hides other patients, and reschedules with a verified session", async () => {
    const first = await catalogAndSlot(9 * 60);
    const second = await prisma.appointmentSlot.create({
      data: {
        professionalId: first.professional.id,
        specialtyId: first.specialty.id,
        officeId: first.office.id,
        startsAt: zonedDateTimeToUtc(first.day, 9 * 60 + 30),
        endsAt: new Date(zonedDateTimeToUtc(first.day, 9 * 60 + 30).getTime() + 30 * 60 * 1000),
        status: "AVAILABLE",
        slotKind: "REGULAR",
      },
    });
    const cookie = await login("30111001", "+5491111111111");
    const missing = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      headers: { cookie },
      payload: { slotId: first.slot.id, patient: person("30111001", "+5491111111111") },
    });
    expect(missing.statusCode).toBe(400);

    const booked = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      headers: { cookie },
      payload: {
        slotId: first.slot.id,
        turnstileToken: "test-turnstile",
        patient: person("30111001", "+5491111111111"),
      },
    });
    expect(booked.statusCode).toBe(201);
    expect(booked.json().status).toBe("CONFIRMED");
    expect(booked.json().publicCode).toMatch(/^[A-HJ-KMNP-RT-Z2-46-9]{2}-[A-HJ-KMNP-RT-Z2-46-9]{3}$/);
    expect(JSON.stringify(booked.json())).not.toContain("30111001");
    const audits = await prisma.auditLog.findMany({ where: { action: "appointment.book", actorType: "PATIENT" } });
    expect(JSON.stringify(audits)).not.toContain("30111001");

    const other = await login("30111002", "+5491122222222");
    const hidden = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me/appointments",
      headers: { cookie: other },
    });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().items).toEqual([]);
    const stolen = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/appointments/${booked.json().id}/cancel`,
      headers: { cookie: other },
    });
    expect(stolen.statusCode).toBe(404);

    const moved = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/appointments/${booked.json().id}/reschedule`,
      headers: { cookie },
      payload: { newSlotId: second.id },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().status).toBe("CONFIRMED");
    const mine = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me/appointments",
      headers: { cookie },
    });
    const codes = (mine.json().items as Array<{ publicCode: string; status: string }>).map((item) => item.status);
    expect(codes).toContain("CONFIRMED");
    expect(codes).toContain("RESCHEDULED");
  });

  it("does not send an OTP when the phone does not match the DNI, and enforces the active cap", async () => {
    await prisma.patient.create({
      data: {
        givenName: "Lia",
        familyName: "Fase6",
        dni: "30111003",
        dniHmac: "pending",
        birthDate: new Date("1990-01-15T00:00:00.000Z"),
        phoneE164: "+541111111113",
        phoneHmac: "pending-phone",
      },
    });
    const mismatch = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/patient/otp/request",
      payload: { dni: "30111003", phone: "+5491144444444", turnstileToken: "test-turnstile" },
    });
    expect(mismatch.statusCode).toBe(200);
    expect(mismatch.json().message).toContain("WhatsApp");
    expect(ctx.whatsapp.getLastOtpForTests(normalizeArPhone("+5491144444444")!)).toBeUndefined();

    const slot = await catalogAndSlot(11 * 60);
    const previous = await prisma.systemSetting.findUnique({ where: { key: "max_active_appointments" } });
    await prisma.systemSetting.upsert({
      where: { key: "max_active_appointments" },
      create: { key: "max_active_appointments", value: 1 },
      update: { value: 1 },
    });
    try {
      const cookie = await login("30111004", "+5491155555555");
      const first = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/appointments",
        headers: { cookie },
        payload: {
          slotId: slot.slot.id,
          turnstileToken: "test-turnstile",
          patient: person("30111004", "+5491155555555"),
        },
      });
      expect(first.statusCode).toBe(201);
      const extra = await catalogAndSlot(12 * 60);
      const second = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/appointments",
        headers: { cookie },
        payload: {
          slotId: extra.slot.id,
          turnstileToken: "test-turnstile",
          patient: person("30111004", "+5491155555555"),
        },
      });
      expect(second.statusCode).toBe(409);
    } finally {
      await prisma.systemSetting.upsert({
        where: { key: "max_active_appointments" },
        create: { key: "max_active_appointments", value: previous?.value ?? 3 },
        update: { value: previous?.value ?? 3 },
      });
    }
  });
});
