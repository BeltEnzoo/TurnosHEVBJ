import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCivilDays, civilToday, prisma, zonedDateTimeToUtc } from "@hep/db";
import { startTestApp } from "./helpers.js";
import { acceptWaitlistOffer, joinWaitlist, offerFreedSlot } from "../src/modules/waitlist/service.js";

const DNI_A = "29111001";
const DNI_B = "29111002";

async function cleanup(): Promise<void> {
  const patients = await prisma.patient.findMany({ where: { familyName: "Fase13" }, select: { id: true } });
  const ids = patients.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.waitlistOffer.deleteMany({ where: { entry: { patientId: { in: ids } } } });
    await prisma.waitlistEntry.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.notificationDelivery.deleteMany({ where: { notification: { patientId: { in: ids } } } });
    await prisma.notification.deleteMany({ where: { patientId: { in: ids } } });
    const appointments = await prisma.appointment.findMany({ where: { patientId: { in: ids } }, select: { id: true } });
    const appointmentIds = appointments.map((row) => row.id);
    if (appointmentIds.length > 0) {
      await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
    }
    await prisma.appointment.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.patient.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.appointmentSlot.deleteMany({ where: { office: { code: "F13Z" } } });
  await prisma.professional.deleteMany({ where: { familyName: "Clinica13" } });
  await prisma.office.deleteMany({ where: { code: "F13Z" } });
  await prisma.specialty.deleteMany({ where: { slug: "fase13-clinica" } });
}

describe("waitlist", () => {
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

  it("offers the oldest person and only books when they accept", async () => {
    const specialty = await prisma.specialty.create({
      data: { name: "Clinica", slug: "fase13-clinica", defaultSlotMinutes: 20 },
    });
    const office = await prisma.office.create({ data: { name: "Consultorio 13", code: "F13Z" } });
    const professional = await prisma.professional.create({ data: { givenName: "Nora", familyName: "Clinica13" } });
    const startsAt = zonedDateTimeToUtc(addCivilDays(civilToday(new Date()), 3), 10 * 60);
    const slot = await prisma.appointmentSlot.create({
      data: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 20 * 60 * 1000),
        status: "AVAILABLE",
      },
    });
    const first = await prisma.patient.create({
      data: {
        givenName: "Ana",
        familyName: "Fase13",
        dni: DNI_A,
        dniHmac: `hmac-${DNI_A}`,
        birthDate: new Date("1992-03-03T00:00:00.000Z"),
        phoneE164: "+5491190033001",
        phoneHmac: "hmac-phone-13a",
        whatsappOptIn: true,
      },
    });
    const second = await prisma.patient.create({
      data: {
        givenName: "Luis",
        familyName: "Fase13",
        dni: DNI_B,
        dniHmac: `hmac-${DNI_B}`,
        birthDate: new Date("1993-03-03T00:00:00.000Z"),
        phoneE164: "+5491190033002",
        phoneHmac: "hmac-phone-13b",
        whatsappOptIn: true,
      },
    });
    const older = await joinWaitlist(prisma, { patientId: first.id, specialtyId: specialty.id });
    await joinWaitlist(prisma, { patientId: second.id, specialtyId: specialty.id });
    await offerFreedSlot(prisma, ctx.redis, slot.id);
    const offers = await prisma.waitlistOffer.findMany({ where: { slotId: slot.id } });
    expect(offers).toHaveLength(1);
    expect(offers[0]?.entryId).toBe(older.id);
    expect(offers[0]?.status).toBe("PENDING");
    const stillOpen = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(stillOpen.status).toBe("AVAILABLE");
    const notice = await prisma.notification.findFirstOrThrow({ where: { patientId: first.id, type: "WAITLIST_OFFER" } });
    expect(JSON.stringify(notice.params)).not.toContain(DNI_A);
    expect(JSON.stringify(notice.params)).not.toContain("+5491190033001");

    const accepted = await acceptWaitlistOffer(prisma, { offerId: offers[0]!.id, patientId: first.id });
    const booked = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(booked.status).toBe("BOOKED");
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: accepted.appointmentId } });
    expect(appointment.patientId).toBe(first.id);
    expect(appointment.status).toBe("CONFIRMED");
    const entry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: older.id } });
    expect(entry.status).toBe("FULFILLED");
  });
});
