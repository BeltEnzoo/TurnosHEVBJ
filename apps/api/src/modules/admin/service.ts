import argon2 from "argon2";
import { ERROR_CODES, ROLE_CODES, normalizeDni, type RoleCode } from "@hep/shared";
import type { Prisma, PrismaClient } from "@hep/db";
import { writeAudit } from "../../lib/audit.js";
import { randomToken } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";

const ASSIGNABLE_ROLES = new Set<string>(ROLE_CODES.filter((role) => role !== "DISPLAY"));

export type StaffActor = {
  userId: string;
  roles: string[];
  ipHash: string;
  userAgentTruncated: string | null;
};

const SETTING_KEYS = [
  "hospital_name",
  "cancel_min_hours",
  "booking_horizon_days",
  "max_active_appointments",
] as const;

type SettingKey = (typeof SETTING_KEYS)[number];

function assertCanTouchRole(actor: StaffActor, role: string): void {
  if (role === "SUPER_ADMIN" && !actor.roles.includes("SUPER_ADMIN")) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "Solo un superadministrador asigna ese rol.");
  }
  if (!ASSIGNABLE_ROLES.has(role)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Ese rol no se asigna desde el panel.");
  }
}

async function revokeStaffSessions(db: PrismaClient, userId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null, kind: "STAFF" },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function searchPatients(
  db: PrismaClient,
  input: { dni?: string; familyName?: string },
  actor: StaffActor,
) {
  const dni = input.dni ? normalizeDni(input.dni) : null;
  if (input.dni && !dni) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "DNI inválido.");
  }
  const familyName = input.familyName?.trim();
  if (!dni && (!familyName || familyName.length < 2)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Indicá un DNI o un apellido.");
  }

  const patients = await db.patient.findMany({
    where: dni ? { dni } : { familyName: { contains: familyName, mode: "insensitive" } },
    orderBy: { familyName: "asc" },
    take: 20,
    select: {
      id: true,
      givenName: true,
      familyName: true,
      dni: true,
      birthDate: true,
      phoneE164: true,
      email: true,
      phoneVerifiedAt: true,
    },
  });

  const items = [];
  for (const patient of patients) {
    const appointments = await db.appointment.findMany({
      where: { patientId: patient.id },
      orderBy: { slot: { startsAt: "desc" } },
      take: 20,
      include: {
        slot: { include: { specialty: true, professional: true, office: true } },
      },
    });
    items.push({
      id: patient.id,
      givenName: patient.givenName,
      familyName: patient.familyName,
      dni: patient.dni,
      birthDate: patient.birthDate.toISOString().slice(0, 10),
      phoneE164: patient.phoneE164,
      email: patient.email,
      phoneVerifiedAt: patient.phoneVerifiedAt,
      appointments: appointments.map((row) => ({
        id: row.id,
        publicCode: row.publicCode,
        status: row.status,
        startsAt: row.slot.startsAt,
        specialtyName: row.slot.specialty.name,
        professionalName: `${row.slot.professional.givenName} ${row.slot.professional.familyName}`,
        officeCode: row.slot.office.code,
      })),
    });
  }

  await writeAudit(db, {
    actorType: "STAFF",
    actorUserId: actor.userId,
    action: "patient.search",
    entityType: "patient",
    ipHash: actor.ipHash,
    userAgentTruncated: actor.userAgentTruncated,
    metadata: { match: dni ? "dni" : "name", resultCount: items.length },
  });

  return { items };
}

export async function listSettings(db: PrismaClient) {
  const rows = await db.systemSetting.findMany({
    where: { key: { in: [...SETTING_KEYS] } },
  });
  return {
    items: SETTING_KEYS.map((key) => ({
      key,
      value: rows.find((row) => row.key === key)?.value ?? null,
    })),
  };
}

export async function updateSettings(
  db: PrismaClient,
  values: Partial<Record<SettingKey, string | number>>,
  actor: StaffActor,
) {
  const keys = Object.keys(values) as SettingKey[];
  if (keys.length === 0) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "No hay cambios.");
  }
  for (const key of keys) {
    await db.systemSetting.upsert({
      where: { key },
      create: { key, value: values[key] as Prisma.InputJsonValue, updatedBy: actor.userId },
      update: { value: values[key] as Prisma.InputJsonValue, updatedBy: actor.userId },
    });
  }
  await writeAudit(db, {
    actorType: "STAFF",
    actorUserId: actor.userId,
    action: "settings.update",
    entityType: "system_setting",
    ipHash: actor.ipHash,
    userAgentTruncated: actor.userAgentTruncated,
    metadata: { keys },
  });
  return listSettings(db);
}

const userSelect = {
  id: true,
  email: true,
  isActive: true,
  failedLoginCount: true,
  lockedUntil: true,
  lastLoginAt: true,
  deactivatedAt: true,
  roles: { select: { role: { select: { code: true } } } },
} as const;

function presentUser(row: {
  id: string;
  email: string;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  deactivatedAt: Date | null;
  roles: { role: { code: string } }[];
}) {
  return {
    id: row.id,
    email: row.email,
    isActive: row.isActive,
    failedLoginCount: row.failedLoginCount,
    lockedUntil: row.lockedUntil,
    lastLoginAt: row.lastLoginAt,
    deactivatedAt: row.deactivatedAt,
    roles: row.roles.map((item) => item.role.code),
  };
}

export async function listUsers(db: PrismaClient) {
  const rows = await db.user.findMany({
    orderBy: { email: "asc" },
    take: 100,
    select: userSelect,
  });
  return { items: rows.map(presentUser) };
}

export async function createStaffUser(
  db: PrismaClient,
  input: { email: string; password: string; role: RoleCode },
  actor: StaffActor,
) {
  assertCanTouchRole(actor, input.role);
  const email = input.email.trim().toLowerCase();
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  try {
    const user = await db.user.create({
      data: { email, passwordHash, isActive: true },
    });
    const role = await db.role.findUniqueOrThrow({ where: { code: input.role } });
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
    await writeAudit(db, {
      actorType: "STAFF",
      actorUserId: actor.userId,
      action: "user.create",
      entityType: "user",
      entityId: user.id,
      ipHash: actor.ipHash,
      userAgentTruncated: actor.userAgentTruncated,
      metadata: { role: input.role },
    });
    const created = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: userSelect });
    return presentUser(created);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ese correo ya está registrado.");
    }
    throw error;
  }
}

async function loadManagedUser(db: PrismaClient, id: string) {
  const user = await db.user.findUnique({ where: { id }, select: userSelect });
  if (!user) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "El usuario no existe.");
  }
  return user;
}

export async function updateStaffUser(
  db: PrismaClient,
  id: string,
  input: { isActive?: boolean; role?: RoleCode },
  actor: StaffActor,
) {
  const user = await loadManagedUser(db, id);
  if (user.roles.some((item) => item.role.code === "SUPER_ADMIN")) {
    assertCanTouchRole(actor, "SUPER_ADMIN");
  }
  if (input.role) {
    assertCanTouchRole(actor, input.role);
  }
  if (id === actor.userId && (input.role || input.isActive === false)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "No podés cambiar tu propio rol ni desactivarte.");
  }
  if (input.role) {
    const role = await db.role.findUniqueOrThrow({ where: { code: input.role } });
    await db.$transaction([
      db.userRole.deleteMany({ where: { userId: id } }),
      db.userRole.create({ data: { userId: id, roleId: role.id } }),
    ]);
  }
  if (input.isActive === false) {
    await db.user.update({
      where: { id },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    await revokeStaffSessions(db, id);
  }
  if (input.isActive === true) {
    await db.user.update({
      where: { id },
      data: { isActive: true, deactivatedAt: null, failedLoginCount: 0, lockedUntil: null },
    });
  }
  await writeAudit(db, {
    actorType: "STAFF",
    actorUserId: actor.userId,
    action: "user.update",
    entityType: "user",
    entityId: id,
    ipHash: actor.ipHash,
    userAgentTruncated: actor.userAgentTruncated,
    metadata: {
      role: input.role ?? null,
      isActive: input.isActive ?? null,
    },
  });
  const updated = await loadManagedUser(db, id);
  return presentUser(updated);
}

export async function resetStaffPassword(db: PrismaClient, id: string, actor: StaffActor) {
  const user = await loadManagedUser(db, id);
  if (user.roles.some((item) => item.role.code === "SUPER_ADMIN")) {
    assertCanTouchRole(actor, "SUPER_ADMIN");
  }
  const temporaryPassword = randomToken(18);
  const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
  await db.user.update({
    where: { id },
    data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
  });
  await revokeStaffSessions(db, id);
  await writeAudit(db, {
    actorType: "STAFF",
    actorUserId: actor.userId,
    action: "user.password_reset",
    entityType: "user",
    entityId: id,
    ipHash: actor.ipHash,
    userAgentTruncated: actor.userAgentTruncated,
  });
  return { temporaryPassword };
}

export async function revokeUserSessions(db: PrismaClient, id: string, actor: StaffActor) {
  const user = await loadManagedUser(db, id);
  if (user.roles.some((item) => item.role.code === "SUPER_ADMIN")) {
    assertCanTouchRole(actor, "SUPER_ADMIN");
  }
  const revoked = await revokeStaffSessions(db, id);
  await writeAudit(db, {
    actorType: "STAFF",
    actorUserId: actor.userId,
    action: "user.sessions_revoke",
    entityType: "user",
    entityId: id,
    ipHash: actor.ipHash,
    userAgentTruncated: actor.userAgentTruncated,
    metadata: { revoked },
  });
  return { revoked };
}

export async function appointmentSummary(db: PrismaClient, input: { from: Date; to: Date }) {
  const rows = await db.appointment.findMany({
    where: { slot: { startsAt: { gte: input.from, lt: input.to } } },
    select: { status: true, slot: { select: { specialty: { select: { name: true } } } } },
    take: 5000,
  });
  const byStatus: Record<string, number> = {};
  const bySpecialty: Record<string, number> = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    const name = row.slot.specialty.name;
    bySpecialty[name] = (bySpecialty[name] ?? 0) + 1;
  }
  return { from: input.from, to: input.to, total: rows.length, byStatus, bySpecialty };
}

export async function listAudit(db: PrismaClient, limit: number) {
  const rows = await db.auditLog.findMany({
    orderBy: { at: "desc" },
    take: limit,
    select: { id: true, at: true, actorType: true, action: true, entityType: true, entityId: true },
  });
  return { items: rows };
}

export async function listNotifications(db: PrismaClient, input: { status?: string; limit: number }) {
  const rows = await db.notification.findMany({
    where: input.status ? { status: input.status as never } : {},
    orderBy: { createdAt: "desc" },
    take: input.limit,
    select: {
      id: true,
      type: true,
      channel: true,
      status: true,
      scheduledAt: true,
      sentAt: true,
      failedAt: true,
      attempts: true,
      appointmentId: true,
      params: true,
    },
  });
  return {
    items: rows.map((row) => {
      const params = row.params;
      const publicCode =
        params && typeof params === "object" && !Array.isArray(params) && typeof (params as { publicCode?: unknown }).publicCode === "string"
          ? (params as { publicCode: string }).publicCode
          : null;
      return {
        id: row.id,
        type: row.type,
        channel: row.channel,
        status: row.status,
        scheduledAt: row.scheduledAt,
        sentAt: row.sentAt,
        failedAt: row.failedAt,
        attempts: row.attempts,
        appointmentId: row.appointmentId,
        publicCode,
      };
    }),
  };
}
