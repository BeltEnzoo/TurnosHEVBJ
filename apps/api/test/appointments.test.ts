import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCivilDays, civilToday, prisma, weekdayMonday1, zonedDateTimeToUtc } from "@hep/db";
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

function patient(suffix: string) {
  return {
    givenName: "Lia",
    familyName: "Fase5",
    dni: `4${suffix}`.slice(0, 8),
    birthDate: "1990-01-15",
    phone: "+5491112345678",
  };
}

async function cleanup(): Promise<void> {
  const professionals = await prisma.professional.findMany({
    where: { familyName: "Fase5" },
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
        await prisma.notification.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await prisma.appointment.updateMany({
          where: { id: { in: appointmentIds } },
          data: { rescheduledFromId: null, rescheduledToId: null },
        });
        await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
      }
      await prisma.appointmentSlot.deleteMany({ where: { id: { in: slotIds } } });
    }
    await prisma.professionalSpecialty.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.professionalOffice.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.professional.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.holiday.deleteMany({ where: { name: { startsWith: "Fase5" } } });
  await prisma.patient.deleteMany({ where: { familyName: "Fase5" } });
  await prisma.office.deleteMany({ where: { code: { startsWith: "F5" } } });
  await prisma.specialty.deleteMany({ where: { slug: { startsWith: "fase5-" } } });
}

describe("appointment engine", () => {
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
      data: { name: "Fase5 clinica", slug: `fase5-${Date.now()}`, defaultSlotMinutes: 30 },
    });
    const professional = await prisma.professional.create({
      data: { givenName: "Nora", familyName: "Fase5" },
    });
    const office = await prisma.office.create({
      data: { name: "Consultorio fase5", code: `F5${Date.now().toString().slice(-4)}` },
    });
    await prisma.professionalSpecialty.create({
      data: { professionalId: professional.id, specialtyId: specialty.id },
    });
    await prisma.professionalOffice.create({
      data: { professionalId: professional.id, officeId: office.id },
    });
    return { specialty, professional, office };
  }

  async function slot(input: {
    professionalId: string;
    specialtyId: string;
    officeId: string;
    day: string;
    minutes: number;
  }) {
    const startsAt = zonedDateTimeToUtc(input.day, input.minutes);
    return prisma.appointmentSlot.create({
      data: {
        professionalId: input.professionalId,
        specialtyId: input.specialtyId,
        officeId: input.officeId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
        status: "AVAILABLE",
        slotKind: "REGULAR",
      },
    });
  }

  it("books one slot under concurrency, cancels it back to available, and reschedules", async () => {
    const { specialty, professional, office } = await catalog();
    const day = upcomingMonday();
    const first = await slot({
      professionalId: professional.id,
      specialtyId: specialty.id,
      officeId: office.id,
      day,
      minutes: 9 * 60,
    });
    const second = await slot({
      professionalId: professional.id,
      specialtyId: specialty.id,
      officeId: office.id,
      day,
      minutes: 9 * 60 + 30,
    });
    const reception = await createUser({
      email: "recepcion-fase5@hospital.local",
      password: "CorrectHorseBattery",
      role: "RECEPCION",
    });
    const cookie = await sessionCookie(reception.id, false);
    const stamp = Date.now().toString().slice(-7);
    const payload = { slotId: first.id, patient: patient(stamp) };
    const [left, right] = await Promise.all([
      ctx.app.inject({ method: "POST", url: "/api/v1/admin/appointments", headers: { cookie }, payload }),
      ctx.app.inject({
        method: "POST",
        url: "/api/v1/admin/appointments",
        headers: { cookie },
        payload: { slotId: first.id, patient: patient(`${stamp}9`) },
      }),
    ]);
    const codes = [left.statusCode, right.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const booked = (left.statusCode === 201 ? left : right).json() as {
      id: string;
      publicCode: string;
      status: string;
      patient: { dni: string };
    };
    expect(booked.status).toBe("CONFIRMED");
    expect(booked.publicCode).toMatch(/^[A-HJ-KMNP-RT-Z2-46-9]{2}-[A-HJ-KMNP-RT-Z2-46-9]{3}$/);
    const stored = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.status).toBe("BOOKED");
    const notice = await prisma.notification.findFirst({ where: { appointmentId: booked.id } });
    expect(notice?.status).toBe("PENDING");
    expect(JSON.stringify(notice?.params)).not.toContain(booked.patient.dni);
    const audits = await prisma.auditLog.findMany({ where: { action: "appointment.book" } });
    expect(JSON.stringify(audits)).not.toContain(booked.patient.dni);

    const hidden = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/availability?specialtyId=${specialty.id}&from=${day}&to=${day}`,
    });
    const openIds = (hidden.json().items as Array<{ id: string }>).map((item) => item.id);
    expect(openIds).toEqual([second.id]);
    expect(JSON.stringify(hidden.json())).not.toContain(booked.patient.dni);

    const cancelled = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/admin/appointments/${booked.id}/cancel`,
      headers: { cookie },
      payload: { reasonCode: "STAFF_REQUEST" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");
    const reopened = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: first.id } });
    expect(reopened.status).toBe("AVAILABLE");

    const again = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/appointments",
      headers: { cookie },
      payload,
    });
    expect(again.statusCode).toBe(201);
    const moved = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/admin/appointments/${again.json().id}/reschedule`,
      headers: { cookie },
      payload: { newSlotId: second.id },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().status).toBe("CONFIRMED");
    const previous = await prisma.appointment.findUniqueOrThrow({ where: { id: again.json().id } });
    expect(previous.status).toBe("RESCHEDULED");
    expect(previous.rescheduledToId).toBe(moved.json().id);
    expect((await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("AVAILABLE");
    expect((await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("BOOKED");

    const done = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/admin/appointments/${moved.json().id}/complete`,
      headers: { cookie },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe("COMPLETED");
    expect((await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("BOOKED");

    const medico = await createUser({
      email: "medico-fase5@hospital.local",
      password: "CorrectHorseBattery",
      role: "MEDICO",
    });
    const forbidden = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/appointments",
      headers: { cookie: await sessionCookie(medico.id, false) },
      payload: { slotId: first.id, patient: patient("1234567") },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("rejects a holiday, keeps the cancel window, and books an extra slot in one transaction", async () => {
    const { specialty, professional, office } = await catalog();
    const day = upcomingMonday();
    const open = await slot({
      professionalId: professional.id,
      specialtyId: specialty.id,
      officeId: office.id,
      day,
      minutes: 10 * 60,
    });
    const reception = await createUser({
      email: "recepcion-fase5b@hospital.local",
      password: "CorrectHorseBattery",
      role: "RECEPCION",
    });
    const cookie = await sessionCookie(reception.id, false);
    await prisma.holiday.create({
      data: { date: new Date(`${day}T00:00:00.000Z`), name: "Fase5 feriado", appliesTo: "ALL" },
    });
    const blocked = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/appointments",
      headers: { cookie },
      payload: { slotId: open.id, patient: patient(Date.now().toString().slice(-7)) },
    });
    expect(blocked.statusCode).toBe(409);
    await prisma.holiday.deleteMany({ where: { name: "Fase5 feriado" } });

    const previous = await prisma.systemSetting.findUnique({ where: { key: "cancel_min_hours" } });
    await prisma.systemSetting.upsert({
      where: { key: "cancel_min_hours" },
      create: { key: "cancel_min_hours", value: 168 },
      update: { value: 168 },
    });
    try {
      const booked = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/admin/appointments",
        headers: { cookie },
        payload: { slotId: open.id, patient: patient(Date.now().toString().slice(-7)) },
      });
      expect(booked.statusCode).toBe(201);
      const tooSoon = await ctx.app.inject({
        method: "POST",
        url: `/api/v1/admin/appointments/${booked.json().id}/cancel`,
        headers: { cookie },
        payload: { reasonCode: "PATIENT_REQUEST" },
      });
      expect(tooSoon.statusCode).toBe(409);
      expect((await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("BOOKED");
    } finally {
      await prisma.systemSetting.upsert({
        where: { key: "cancel_min_hours" },
        create: { key: "cancel_min_hours", value: previous?.value ?? 2 },
        update: { value: previous?.value ?? 2 },
      });
    }

    const startsAt = new Date(open.startsAt.getTime() + 5 * 60 * 1000);
    const extra = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/slots/extra",
      headers: { cookie },
      payload: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 10 * 60 * 1000).toISOString(),
        patient: patient("7654321"),
      },
    });
    expect(extra.statusCode).toBe(201);
    expect(extra.json().kind).toBe("EXTRA");
    const sameStart = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/slots/extra",
      headers: { cookie },
      payload: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 10 * 60 * 1000).toISOString(),
        patient: patient("7654322"),
      },
    });
    expect(sameStart.statusCode).toBe(409);
    const extraRow = await prisma.appointment.findUniqueOrThrow({
      where: { id: extra.json().id },
      include: { slot: true },
    });
    expect(extraRow.slot.slotKind).toBe("EXTRA");
    expect(extraRow.slot.status).toBe("BOOKED");
  });
});
