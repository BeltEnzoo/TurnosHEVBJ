import { createHash, createHmac } from "node:crypto";
import { config } from "dotenv";
import { resolve } from "node:path";
import argon2 from "argon2";
import { loadEnv, assertDevSeedUserAllowed } from "@hep/config";
import { normalizeArPhone, PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from "@hep/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "./index.js";

function hmacSha256(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

config({ path: resolve(import.meta.dirname, "../../../.env") });

const ROLE_NAMES: Record<(typeof ROLE_CODES)[number], string> = {
  SUPER_ADMIN: "Superusuario",
  ADMINISTRACION: "Administración",
  SISTEMAS: "Sistemas",
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  RECEPCION: "Admisión",
  MEDICO: "Médico",
  DISPLAY: "Pantalla",
};

async function seed() {
  const env = loadEnv();

  for (const code of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, name: code },
      update: { name: code },
    });
  }

  for (const code of ROLE_CODES) {
    const role = await prisma.role.upsert({
      where: { code },
      create: { code, name: ROLE_NAMES[code] },
      update: { name: ROLE_NAMES[code] },
    });
    const permissionCodes = ROLE_PERMISSIONS[code];
    const permissions = await prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
      });
    }
  }

  const settings: Array<{ key: string; value: unknown }> = [
    { key: "cancel_min_hours", value: 2 },
    { key: "max_active_appointments", value: 3 },
    { key: "booking_horizon_days", value: 45 },
    { key: "reminder_offsets_hours", value: [48, 3] },
    { key: "otp_ttl_seconds", value: env.OTP_TTL_SECONDS },
    { key: "otp_max_attempts", value: env.OTP_MAX_ATTEMPTS },
    { key: "tts_template", value: "Turno {code}, consultorio {office}" },
  ];
  for (const setting of settings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, value: setting.value as Prisma.InputJsonValue },
      update: {},
    });
  }

  if (!env.ALLOW_DEV_SEED) {
    return;
  }
  assertDevSeedUserAllowed(env);
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required when ALLOW_DEV_SEED=true");
  }

  await upsertStaff(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD, "SUPER_ADMIN");
  if (env.SEED_ADMISION_EMAIL && env.SEED_ADMISION_PASSWORD) {
    await upsertStaff(env.SEED_ADMISION_EMAIL, env.SEED_ADMISION_PASSWORD, "RECEPCION");
  }
  if (env.SEED_SISTEMAS_EMAIL && env.SEED_SISTEMAS_PASSWORD) {
    await upsertStaff(env.SEED_SISTEMAS_EMAIL, env.SEED_SISTEMAS_PASSWORD, "SISTEMAS");
  }
  if (env.SEED_ADMINISTRACION_EMAIL && env.SEED_ADMINISTRACION_PASSWORD) {
    await upsertStaff(env.SEED_ADMINISTRACION_EMAIL, env.SEED_ADMINISTRACION_PASSWORD, "ADMINISTRACION");
  }

  await seedFictionalCatalog(env.SESSION_SECRET);
}

async function upsertStaff(
  email: string,
  password: string,
  roleCode: (typeof ROLE_CODES)[number],
): Promise<void> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, isActive: true },
    update: {
      passwordHash,
      isActive: true,
      deactivatedAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });
}

async function seedFictionalCatalog(sessionSecret: string): Promise<void> {
  const specialties = [
    { slug: "clinica-medica", name: "Clínica médica", defaultSlotMinutes: 20, sortOrder: 1 },
    { slug: "pediatria", name: "Pediatría", defaultSlotMinutes: 20, sortOrder: 2 },
    { slug: "ginecologia", name: "Ginecología", defaultSlotMinutes: 30, sortOrder: 3 },
    { slug: "traumatologia", name: "Traumatología", defaultSlotMinutes: 20, sortOrder: 4 },
  ];
  for (const specialty of specialties) {
    await prisma.specialty.upsert({
      where: { slug: specialty.slug },
      create: specialty,
      update: {
        name: specialty.name,
        defaultSlotMinutes: specialty.defaultSlotMinutes,
        sortOrder: specialty.sortOrder,
        deactivatedAt: null,
      },
    });
  }

  const professionals = [
    { givenName: "Laura", familyName: "Benitez", licenseNumber: "DEV-1001" },
    { givenName: "Martin", familyName: "Acosta", licenseNumber: "DEV-1002" },
    { givenName: "Sofia", familyName: "Ledesma", licenseNumber: "DEV-1003" },
    { givenName: "Diego", familyName: "Ferreyra", licenseNumber: "DEV-1004" },
    { givenName: "Carla", familyName: "Nuñez", licenseNumber: "DEV-1005" },
    { givenName: "Pablo", familyName: "Quiroga", licenseNumber: "DEV-1006" },
  ];
  for (const professional of professionals) {
    const existing = await prisma.professional.findFirst({
      where: { licenseNumber: professional.licenseNumber },
    });
    if (!existing) {
      await prisma.professional.create({ data: professional });
    }
  }

  const offices = [
    { code: "C1", name: "Consultorio 1", locationLabel: "Planta baja" },
    { code: "C2", name: "Consultorio 2", locationLabel: "Planta baja" },
    { code: "C3", name: "Consultorio 3", locationLabel: "Primer piso" },
    { code: "C4", name: "Consultorio 4", locationLabel: "Primer piso" },
  ];
  for (const office of offices) {
    await prisma.office.upsert({
      where: { code: office.code },
      create: office,
      update: { name: office.name, locationLabel: office.locationLabel, deactivatedAt: null },
    });
  }

  const displays = [
    { name: "TV Hall", location: "Hall de entrada" },
    { name: "TV Guardia", location: "Guardia" },
  ];
  for (const display of displays) {
    const existing = await prisma.display.findFirst({ where: { name: display.name } });
    if (!existing) {
      await prisma.display.create({
        data: {
          ...display,
          tokenHash: sha256(`dev-display:${display.name}`),
          status: "OFFLINE",
        },
      });
    }
  }

  const clinica = await prisma.specialty.findUniqueOrThrow({ where: { slug: "clinica-medica" } });
  const pediatria = await prisma.specialty.findUniqueOrThrow({ where: { slug: "pediatria" } });
  const ginecologia = await prisma.specialty.findUniqueOrThrow({ where: { slug: "ginecologia" } });
  const traumatologia = await prisma.specialty.findUniqueOrThrow({ where: { slug: "traumatologia" } });
  const byLicense = async (licenseNumber: string) =>
    prisma.professional.findFirstOrThrow({ where: { licenseNumber } });
  const links: Array<[string, string]> = [
    ["DEV-1001", clinica.id],
    ["DEV-1002", clinica.id],
    ["DEV-1003", pediatria.id],
    ["DEV-1004", ginecologia.id],
    ["DEV-1005", traumatologia.id],
    ["DEV-1006", traumatologia.id],
  ];
  for (const [licenseNumber, specialtyId] of links) {
    const professional = await byLicense(licenseNumber);
    await prisma.professionalSpecialty.upsert({
      where: {
        professionalId_specialtyId: { professionalId: professional.id, specialtyId },
      },
      create: { professionalId: professional.id, specialtyId },
      update: {},
    });
  }

  const officeCodes = ["C1", "C2", "C3", "C4", "C1", "C2"];
  for (const [index, licenseNumber] of ["DEV-1001", "DEV-1002", "DEV-1003", "DEV-1004", "DEV-1005", "DEV-1006"].entries()) {
    const professional = await byLicense(licenseNumber);
    const office = await prisma.office.findUniqueOrThrow({ where: { code: officeCodes[index]! } });
    await prisma.professionalOffice.upsert({
      where: {
        professionalId_officeId: { professionalId: professional.id, officeId: office.id },
      },
      create: { professionalId: professional.id, officeId: office.id },
      update: {},
    });
  }

  const hall = await prisma.display.findFirstOrThrow({ where: { name: "TV Hall" } });
  const guardia = await prisma.display.findFirstOrThrow({ where: { name: "TV Guardia" } });
  await prisma.displayOffice.deleteMany({ where: { displayId: guardia.id } });
  const waitingRoomOffices = await prisma.office.findMany({
    where: { deactivatedAt: null },
    select: { id: true },
  });
  for (const office of waitingRoomOffices) {
    await prisma.displayOffice.upsert({
      where: { displayId_officeId: { displayId: hall.id, officeId: office.id } },
      create: { displayId: hall.id, officeId: office.id },
      update: {},
    });
  }

  const holidayDate = new Date(Date.UTC(2026, 4, 25));
  const existingHoliday = await prisma.holiday.findFirst({
    where: { date: holidayDate, name: "Feriado de ejemplo", appliesTo: "ALL" },
  });
  if (!existingHoliday) {
    await prisma.holiday.create({
      data: { date: holidayDate, name: "Feriado de ejemplo", appliesTo: "ALL" },
    });
  }

  const sharedPhone = normalizeArPhone("+541100000001");
  if (!sharedPhone) {
    throw new Error("Dev seed phone could not be normalized");
  }
  const patients = [
    { givenName: "Juan", familyName: "Perez", dni: "30000001", birthDate: new Date(Date.UTC(1985, 2, 10)) },
    { givenName: "Ana", familyName: "Gomez", dni: "30000002", birthDate: new Date(Date.UTC(1992, 7, 4)) },
  ];
  for (const patient of patients) {
    await prisma.patient.upsert({
      where: { dni: patient.dni },
      create: {
        ...patient,
        dniHmac: hmacSha256(patient.dni, sessionSecret),
        phoneE164: sharedPhone,
        phoneHmac: hmacSha256(sharedPhone, sessionSecret),
        email: null,
        whatsappOptIn: true,
      },
      update: {
        givenName: patient.givenName,
        familyName: patient.familyName,
        dniHmac: hmacSha256(patient.dni, sessionSecret),
        phoneE164: sharedPhone,
        phoneHmac: hmacSha256(sharedPhone, sessionSecret),
      },
    });
  }

  await prisma.systemSetting.upsert({
    where: { key: "hospital_name" },
    create: { key: "hospital_name", value: "Hospital Eva Perón" },
    update: {},
  });
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : "seed failed");
    await prisma.$disconnect();
    process.exit(1);
  });
