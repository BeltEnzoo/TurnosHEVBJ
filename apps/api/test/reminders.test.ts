import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hep/db";
import { startTestApp } from "./helpers.js";
import { processSendNotification } from "../src/modules/whatsapp/processor.js";
import {
  cancelPendingReminders,
  scheduleAppointmentReminders,
} from "../src/modules/whatsapp/reminders.js";

const DNI = "28111991";
const PHONE = "+5491190022001";

async function cleanup(): Promise<void> {
  const patients = await prisma.patient.findMany({ where: { familyName: "Fase12" }, select: { id: true } });
  const ids = patients.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.notificationDelivery.deleteMany({ where: { notification: { patientId: { in: ids } } } });
    await prisma.notification.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.appointment.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.patient.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.appointmentSlot.deleteMany({ where: { office: { code: "F12Z" } } });
  await prisma.professional.deleteMany({ where: { familyName: "Clinica12" } });
  await prisma.office.deleteMany({ where: { code: "F12Z" } });
  await prisma.specialty.deleteMany({ where: { slug: "fase12-clinica" } });
}

describe("appointment reminders", () => {
  let ctx: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    await cleanup();
    ctx = await startTestApp();
  });

  afterAll(async () => {
    await cleanup();
    await ctx.app.close();
    await ctx.redis.quit();
  });

  it("schedules one row per offset and does not send a cancelled reminder", async () => {
    const specialty = await prisma.specialty.create({
      data: { name: "Clinica", slug: "fase12-clinica", defaultSlotMinutes: 20 },
    });
    const office = await prisma.office.create({ data: { name: "Consultorio 12", code: "F12Z" } });
    const professional = await prisma.professional.create({ data: { givenName: "Nora", familyName: "Clinica12" } });
    const startsAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const slot = await prisma.appointmentSlot.create({
      data: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 20 * 60 * 1000),
        status: "BOOKED",
      },
    });
    const patient = await prisma.patient.create({
      data: {
        givenName: "Ana",
        familyName: "Fase12",
        dni: DNI,
        dniHmac: `hmac-${DNI}`,
        birthDate: new Date("1991-02-02T00:00:00.000Z"),
        phoneE164: PHONE,
        phoneHmac: `hmac-${PHONE}`,
        whatsappOptIn: true,
      },
    });
    const appointment = await prisma.appointment.create({
      data: {
        publicCode: "R4-8K2",
        slotId: slot.id,
        patientId: patient.id,
        status: "CONFIRMED",
        kind: "REGULAR",
        createdByType: "STAFF",
      },
    });

    await scheduleAppointmentReminders(prisma, appointment.id, ctx.redis);
    await scheduleAppointmentReminders(prisma, appointment.id, ctx.redis);
    const reminders = await prisma.notification.findMany({
      where: { appointmentId: appointment.id, type: "APPOINTMENT_REMINDER" },
      orderBy: { idempotencyKey: "asc" },
    });
    expect(reminders.map((row) => row.idempotencyKey)).toEqual([
      `APPOINTMENT_REMINDER:${appointment.id}:3`,
      `APPOINTMENT_REMINDER:${appointment.id}:48`,
    ]);
    expect(reminders.every((row) => row.status === "PENDING")).toBe(true);
    const rendered = JSON.stringify(reminders.map((row) => row.params));
    expect(rendered).not.toContain(DNI);
    expect(rendered).not.toContain(PHONE);
    expect(rendered).not.toContain("Fase12");

    const soon = reminders.find((row) => row.idempotencyKey.endsWith(":3"));
    expect(soon).toBeTruthy();
    await prisma.notification.update({
      where: { id: soon!.id },
      data: { scheduledAt: new Date(Date.now() - 1000) },
    });
    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED" } });
    await processSendNotification(
      { db: prisma, redis: ctx.redis, provider: ctx.whatsapp, providerName: "mock" },
      soon!.id,
    );
    expect(ctx.whatsapp.sent).toHaveLength(0);
    const skipped = await prisma.notification.findUniqueOrThrow({ where: { id: soon!.id } });
    expect(skipped.status).toBe("CANCELLED");

    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "CONFIRMED" } });
    await cancelPendingReminders(prisma, appointment.id);
    const left = await prisma.notification.count({
      where: { appointmentId: appointment.id, type: "APPOINTMENT_REMINDER", status: "PENDING" },
    });
    expect(left).toBe(0);
  });
});
