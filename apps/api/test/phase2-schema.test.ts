import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@hep/db";
import { hmacSha256 } from "../src/lib/crypto.js";

const SECRET = "phase2-schema-test-secret-32chars-min";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

describe("phase 2 schema constraints", () => {
  const ids: {
    specialtyId?: string;
    professionalId?: string;
    officeId?: string;
    patientId?: string;
    slotId?: string;
    extraSlotId?: string;
  } = {};

  afterAll(async () => {
    await prisma.appointmentStatusHistory.deleteMany({
      where: { appointment: { patient: { dni: "30111222" } } },
    });
    await prisma.appointment.deleteMany({ where: { patient: { dni: "30111222" } } });
    await prisma.appointmentSlot.deleteMany({
      where: { professionalId: ids.professionalId },
    });
    if (ids.patientId) {
      await prisma.patient.deleteMany({ where: { id: ids.patientId } });
    }
    if (ids.professionalId) {
      await prisma.professional.deleteMany({ where: { id: ids.professionalId } });
    }
    if (ids.officeId) {
      await prisma.office.deleteMany({ where: { id: ids.officeId } });
    }
    if (ids.specialtyId) {
      await prisma.specialty.deleteMany({ where: { id: ids.specialtyId } });
    }
  });

  it("keeps one active appointment per slot and one regular slot per start", async () => {
    const specialty = await prisma.specialty.create({
      data: { name: "Schema test", slug: `schema-test-${Date.now()}`, defaultSlotMinutes: 20 },
    });
    const professional = await prisma.professional.create({
      data: { givenName: "Schema", familyName: "Test", licenseNumber: `DEV-SCHEMA-${Date.now()}` },
    });
    const office = await prisma.office.create({
      data: { name: "Consultorio schema", code: `SX${Date.now().toString().slice(-6)}` },
    });
    const patient = await prisma.patient.create({
      data: {
        givenName: "Paciente",
        familyName: "Schema",
        dni: "30111222",
        dniHmac: hmacSha256("30111222", SECRET),
        birthDate: new Date(Date.UTC(1990, 0, 15)),
        phoneE164: "+541112345678",
        phoneHmac: hmacSha256("+541112345678", SECRET),
      },
    });
    ids.specialtyId = specialty.id;
    ids.professionalId = professional.id;
    ids.officeId = office.id;
    ids.patientId = patient.id;

    const startsAt = new Date("2026-10-06T12:00:00.000Z");
    const endsAt = new Date("2026-10-06T12:20:00.000Z");
    const slot = await prisma.appointmentSlot.create({
      data: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        startsAt,
        endsAt,
        status: "AVAILABLE",
        slotKind: "REGULAR",
      },
    });
    ids.slotId = slot.id;

    await expect(
      prisma.appointmentSlot.create({
        data: {
          professionalId: professional.id,
          specialtyId: specialty.id,
          officeId: office.id,
          startsAt,
          endsAt,
          status: "AVAILABLE",
          slotKind: "REGULAR",
        },
      }),
    ).rejects.toSatisfy(isUniqueViolation);

    const extra = await prisma.appointmentSlot.create({
      data: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        startsAt,
        endsAt,
        status: "AVAILABLE",
        slotKind: "EXTRA",
      },
    });
    ids.extraSlotId = extra.id;

    const first = await prisma.appointment.create({
      data: {
        publicCode: "KT-7M4",
        slotId: slot.id,
        patientId: patient.id,
        status: "CONFIRMED",
        kind: "REGULAR",
        createdByType: "STAFF",
      },
    });
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.activeSlotKey).toBe(slot.id);

    await expect(
      prisma.appointment.create({
        data: {
          publicCode: "AB-234",
          slotId: slot.id,
          patientId: patient.id,
          status: "CONFIRMED",
          kind: "REGULAR",
          createdByType: "PATIENT",
        },
      }),
    ).rejects.toSatisfy(isUniqueViolation);

    await prisma.appointment.update({
      where: { id: first.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReasonCode: "PATIENT_REQUEST" },
    });
    const cancelled = await prisma.appointment.findUniqueOrThrow({ where: { id: first.id } });
    expect(cancelled.activeSlotKey).toBeNull();

    const second = await prisma.appointment.create({
      data: {
        publicCode: "AB-234",
        slotId: slot.id,
        patientId: patient.id,
        status: "CONFIRMED",
        kind: "REGULAR",
        createdByType: "PATIENT",
      },
    });
    expect(second.activeSlotKey).toBe(slot.id);

    await expect(
      prisma.patient.create({
        data: {
          givenName: "Otro",
          familyName: "Schema",
          dni: "30111222",
          dniHmac: hmacSha256("30111222", "other-secret"),
          birthDate: new Date(Date.UTC(1991, 1, 2)),
          phoneE164: "+541199999999",
          phoneHmac: hmacSha256("+541199999999", SECRET),
        },
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });
});
