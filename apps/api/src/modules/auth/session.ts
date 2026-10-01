import { ERROR_CODES, SENSITIVE_ROLES, type PermissionCode, type RoleCode } from "@hep/shared";
import type { PrismaClient } from "@hep/db";
import { sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";

export type StaffContext = {
  sessionId: string;
  userId: string;
  email: string;
  roles: RoleCode[];
  permissions: PermissionCode[];
  mfaSatisfied: boolean;
};

export type PatientContext = {
  sessionId: string;
  dniHmac: string;
  phoneHmac: string;
  patientId: string | null;
};

/** Patient HTTP auth is not implemented in Fase 1. These helpers stay unused until Fase 2 defines `patients`. */

export async function loadStaffSession(
  prisma: PrismaClient,
  token: string | undefined,
  idleHours: number,
): Promise<StaffContext | null> {
  if (!token) {
    return null;
  }
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        },
      },
    },
  });
  if (!session || session.kind !== "STAFF" || !session.user) {
    return null;
  }
  if (session.revokedAt) {
    return null;
  }
  const now = Date.now();
  if (session.expiresAt.getTime() < now || session.absoluteExpiresAt.getTime() < now) {
    return null;
  }
  if (!session.user.isActive || session.user.deactivatedAt) {
    return null;
  }
  const slid = new Date(now + idleHours * 3600 * 1000);
  const expiresAt = slid < session.absoluteExpiresAt ? slid : session.absoluteExpiresAt;
  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date(), expiresAt },
  });

  const roles = session.user.roles.map((item) => item.role.code as RoleCode);
  const permissions = [
    ...new Set(
      session.user.roles.flatMap((item) =>
        item.role.permissions.map((rel) => rel.permission.code as PermissionCode),
      ),
    ),
  ];
  return {
    sessionId: session.id,
    userId: session.user.id,
    email: session.user.email,
    roles,
    permissions,
    mfaSatisfied: session.mfaSatisfied,
  };
}

export function requireStaff(staff: StaffContext | null, options?: { mfa?: boolean }): StaffContext {
  if (!staff) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "Necesita iniciar sesión.");
  }
  if (options?.mfa !== false && !staff.mfaSatisfied) {
    const sensitive = staff.roles.some((role) => SENSITIVE_ROLES.includes(role));
    if (sensitive) {
      throw new AppError(401, ERROR_CODES.MFA_REQUIRED, "Debe completar MFA.");
    }
  }
  return staff;
}

export function requirePermission(staff: StaffContext, permission: PermissionCode): void {
  requireAnyPermission(staff, [permission]);
}

export function requireAnyPermission(staff: StaffContext, permissions: PermissionCode[]): void {
  if (staff.roles.includes("SUPER_ADMIN")) {
    return;
  }
  if (!permissions.some((permission) => staff.permissions.includes(permission))) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "No tiene permiso para esta acción.");
  }
}

export async function createPatientSession(
  prisma: PrismaClient,
  input: {
    dniHmac: string;
    phoneHmac: string;
    patientId?: string | null;
    token: string;
    idleHours: number;
    absoluteHours: number;
    ip: string;
  },
): Promise<void> {
  const now = Date.now();
  await prisma.session.create({
    data: {
      kind: "PATIENT",
      tokenHash: sha256(input.token),
      patientId: input.patientId ?? null,
      patientDniHmac: input.dniHmac,
      patientPhoneHmac: input.phoneHmac,
      mfaSatisfied: true,
      expiresAt: new Date(now + input.idleHours * 3600 * 1000),
      absoluteExpiresAt: new Date(now + input.absoluteHours * 3600 * 1000),
      ipHash: sha256(input.ip),
    },
  });
}

export async function loadPatientSession(
  prisma: PrismaClient,
  token: string | undefined,
): Promise<PatientContext | null> {
  if (!token) {
    return null;
  }
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
  });
  if (!session || session.kind !== "PATIENT" || session.revokedAt) {
    return null;
  }
  const now = Date.now();
  if (session.expiresAt.getTime() < now || session.absoluteExpiresAt.getTime() < now) {
    return null;
  }
  if (!session.patientDniHmac || !session.patientPhoneHmac) {
    return null;
  }
  return {
    sessionId: session.id,
    dniHmac: session.patientDniHmac,
    phoneHmac: session.patientPhoneHmac,
    patientId: session.patientId,
  };
}
