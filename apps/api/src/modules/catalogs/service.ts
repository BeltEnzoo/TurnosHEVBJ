import { ERROR_CODES } from "@hep/shared";
import type { Prisma, PrismaClient } from "@hep/db";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type CatalogActor = {
  userId: string;
  ipHash: string | null;
  userAgentTruncated: string | null;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

const NOT_FOUND = "No encontrado.";

function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El nombre no genera un identificador válido.");
  }
  return slug;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function page<T extends { id: string }>(
  rows: T[],
  limit: number,
): Promise<Page<T>> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

function cursor(startingAfter: string | undefined): { id?: { gt: string } } {
  return startingAfter ? { id: { gt: startingAfter } } : {};
}

export async function listPublicSpecialties(
  db: Db,
  input: { limit: number; startingAfter?: string },
): Promise<Page<{ id: string; name: string; slug: string; defaultSlotMinutes: number; sortOrder: number }>> {
  const rows = await db.specialty.findMany({
    where: { deactivatedAt: null, ...cursor(input.startingAfter) },
    orderBy: { id: "asc" },
    take: input.limit + 1,
    select: { id: true, name: true, slug: true, defaultSlotMinutes: true, sortOrder: true },
  });
  return page(rows, input.limit);
}

export async function listPublicProfessionals(
  db: Db,
  input: { limit: number; startingAfter?: string; specialtyId?: string },
): Promise<Page<{ id: string; givenName: string; familyName: string; specialtyIds: string[] }>> {
  const rows = await db.professional.findMany({
    where: {
      deactivatedAt: null,
      ...cursor(input.startingAfter),
      ...(input.specialtyId
        ? {
            specialties: {
              some: { specialtyId: input.specialtyId, specialty: { deactivatedAt: null } },
            },
          }
        : {}),
    },
    orderBy: { id: "asc" },
    take: input.limit + 1,
    select: {
      id: true,
      givenName: true,
      familyName: true,
      specialties: { select: { specialtyId: true } },
    },
  });
  return page(
    rows.map((row) => ({
      id: row.id,
      givenName: row.givenName,
      familyName: row.familyName,
      specialtyIds: row.specialties.map((item) => item.specialtyId),
    })),
    input.limit,
  );
}

async function requireSpecialty(db: Db, id: string) {
  const row = await db.specialty.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, NOT_FOUND);
  }
  return row;
}

export async function listAdminSpecialties(db: Db, input: { limit: number; startingAfter?: string }) {
  const rows = await db.specialty.findMany({
    where: cursor(input.startingAfter),
    orderBy: { id: "asc" },
    take: input.limit + 1,
  });
  return page(rows, input.limit);
}

export async function createSpecialty(
  db: PrismaClient,
  input: { name: string; defaultSlotMinutes: number; sortOrder: number },
  actor: CatalogActor,
) {
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.specialty.create({
        data: {
          name: input.name,
          slug: slugify(input.name),
          defaultSlotMinutes: input.defaultSlotMinutes,
          sortOrder: input.sortOrder,
        },
      });
      await writeAudit(tx, {
        actorType: "staff",
        actorUserId: actor.userId,
        action: "catalog.specialty.create",
        entityType: "specialty",
        entityId: created.id,
        ipHash: actor.ipHash,
        userAgentTruncated: actor.userAgentTruncated,
        metadata: { slug: created.slug },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ya existe una especialidad con ese nombre.");
    }
    throw error;
  }
}

export async function updateSpecialty(
  db: PrismaClient,
  id: string,
  input: { name?: string; defaultSlotMinutes?: number; sortOrder?: number; deactivated?: boolean },
  actor: CatalogActor,
) {
  await requireSpecialty(db, id);
  try {
    return await db.$transaction(async (tx) => {
      const updated = await tx.specialty.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name, slug: slugify(input.name) } : {}),
          ...(input.defaultSlotMinutes !== undefined ? { defaultSlotMinutes: input.defaultSlotMinutes } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.deactivated === true ? { deactivatedAt: new Date() } : {}),
          ...(input.deactivated === false ? { deactivatedAt: null } : {}),
        },
      });
      await writeAudit(tx, {
        actorType: "staff",
        actorUserId: actor.userId,
        action: "catalog.specialty.update",
        entityType: "specialty",
        entityId: id,
        ipHash: actor.ipHash,
        userAgentTruncated: actor.userAgentTruncated,
        metadata: { fields: Object.keys(input) },
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ya existe una especialidad con ese nombre.");
    }
    throw error;
  }
}

async function assertIdsExist(
  found: number,
  expected: number,
  message: string,
): Promise<void> {
  if (found !== expected) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, message);
  }
}

async function replaceProfessionalLinks(
  tx: Prisma.TransactionClient,
  professionalId: string,
  specialtyIds: string[] | undefined,
  officeIds: string[] | undefined,
): Promise<void> {
  if (specialtyIds) {
    const unique = [...new Set(specialtyIds)];
    const found = await tx.specialty.findMany({ where: { id: { in: unique } }, select: { id: true } });
    await assertIdsExist(found.length, unique.length, "Hay una especialidad inexistente.");
    await tx.professionalSpecialty.deleteMany({ where: { professionalId } });
    if (unique.length > 0) {
      await tx.professionalSpecialty.createMany({
        data: unique.map((specialtyId) => ({ professionalId, specialtyId })),
      });
    }
  }
  if (officeIds) {
    const unique = [...new Set(officeIds)];
    const found = await tx.office.findMany({ where: { id: { in: unique } }, select: { id: true } });
    await assertIdsExist(found.length, unique.length, "Hay un consultorio inexistente.");
    await tx.professionalOffice.deleteMany({ where: { professionalId } });
    if (unique.length > 0) {
      await tx.professionalOffice.createMany({
        data: unique.map((officeId) => ({ professionalId, officeId })),
      });
    }
  }
}

async function assertLinkableUser(db: Db, userId: string, professionalId?: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { roles: { select: { role: { select: { code: true } } } } },
  });
  if (!user || !user.isActive || user.deactivatedAt) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "El usuario no está disponible para vincular.");
  }
  if (!user.roles.some((item) => item.role.code === "MEDICO")) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "La cuenta tiene que ser de un médico.");
  }
  const taken = await db.professional.findUnique({ where: { userId } });
  if (taken && taken.id !== professionalId) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "Ese usuario ya está vinculado a otro profesional.");
  }
}

export async function listLinkableMedicos(db: Db) {
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      deactivatedAt: null,
      roles: { some: { role: { code: "MEDICO" } } },
    },
    select: { id: true, email: true, professional: { select: { id: true } } },
    orderBy: { email: "asc" },
    take: 100,
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      email: row.email,
      professionalId: row.professional?.id ?? null,
    })),
  };
}

const professionalSelect = {
  id: true,
  givenName: true,
  familyName: true,
  licenseNumber: true,
  userId: true,
  deactivatedAt: true,
  specialties: { select: { specialtyId: true } },
  offices: { select: { officeId: true } },
} as const;

function presentProfessional<T extends {
  specialties: { specialtyId: string }[];
  offices: { officeId: string }[];
}>(row: T) {
  const { specialties, offices, ...rest } = row;
  return {
    ...rest,
    specialtyIds: specialties.map((item) => item.specialtyId),
    officeIds: offices.map((item) => item.officeId),
  };
}

export async function listAdminProfessionals(db: Db, input: { limit: number; startingAfter?: string }) {
  const rows = await db.professional.findMany({
    where: cursor(input.startingAfter),
    orderBy: { id: "asc" },
    take: input.limit + 1,
    select: professionalSelect,
  });
  return page(rows.map(presentProfessional), input.limit);
}

export async function createProfessional(
  db: PrismaClient,
  input: {
    givenName: string;
    familyName: string;
    licenseNumber: string | null;
    specialtyIds: string[];
    officeIds: string[];
    userId: string | null;
  },
  actor: CatalogActor,
) {
  if (input.userId) {
    await assertLinkableUser(db, input.userId);
  }
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.professional.create({
        data: {
          givenName: input.givenName,
          familyName: input.familyName,
          licenseNumber: input.licenseNumber,
          userId: input.userId,
        },
      });
      await replaceProfessionalLinks(tx, created.id, input.specialtyIds, input.officeIds);
      await writeAudit(tx, {
        actorType: "staff",
        actorUserId: actor.userId,
        action: "catalog.professional.create",
        entityType: "professional",
        entityId: created.id,
        ipHash: actor.ipHash,
        userAgentTruncated: actor.userAgentTruncated,
        metadata: { linkedUser: Boolean(input.userId) },
      });
      const row = await tx.professional.findUniqueOrThrow({
        where: { id: created.id },
        select: professionalSelect,
      });
      return presentProfessional(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ese usuario ya está vinculado a otro profesional.");
    }
    throw error;
  }
}

export async function updateProfessional(
  db: PrismaClient,
  id: string,
  input: {
    givenName?: string;
    familyName?: string;
    licenseNumber?: string | null;
    specialtyIds?: string[];
    officeIds?: string[];
    userId?: string | null;
    deactivated?: boolean;
  },
  actor: CatalogActor,
) {
  const existing = await db.professional.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, NOT_FOUND);
  }
  if (input.userId) {
    await assertLinkableUser(db, input.userId, id);
  }
  try {
    return await db.$transaction(async (tx) => {
      await tx.professional.update({
        where: { id },
        data: {
          ...(input.givenName !== undefined ? { givenName: input.givenName } : {}),
          ...(input.familyName !== undefined ? { familyName: input.familyName } : {}),
          ...(input.licenseNumber !== undefined ? { licenseNumber: input.licenseNumber } : {}),
          ...(input.userId !== undefined ? { userId: input.userId } : {}),
          ...(input.deactivated === true ? { deactivatedAt: new Date() } : {}),
          ...(input.deactivated === false ? { deactivatedAt: null } : {}),
        },
      });
      await replaceProfessionalLinks(tx, id, input.specialtyIds, input.officeIds);
      await writeAudit(tx, {
        actorType: "staff",
        actorUserId: actor.userId,
        action: "catalog.professional.update",
        entityType: "professional",
        entityId: id,
        ipHash: actor.ipHash,
        userAgentTruncated: actor.userAgentTruncated,
        metadata: { fields: Object.keys(input) },
      });
      const row = await tx.professional.findUniqueOrThrow({ where: { id }, select: professionalSelect });
      return presentProfessional(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ese usuario ya está vinculado a otro profesional.");
    }
    throw error;
  }
}

export async function listAdminOffices(db: Db, input: { limit: number; startingAfter?: string }) {
  const rows = await db.office.findMany({
    where: cursor(input.startingAfter),
    orderBy: { id: "asc" },
    take: input.limit + 1,
    select: { id: true, name: true, code: true, locationLabel: true, deactivatedAt: true },
  });
  return page(rows, input.limit);
}

export async function createOffice(
  db: PrismaClient,
  input: { name: string; code: string; locationLabel: string | null },
  actor: CatalogActor,
) {
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.office.create({
        data: { name: input.name, code: input.code, locationLabel: input.locationLabel },
      });
      const hall = await tx.display.findFirst({ where: { name: "TV Hall", deactivatedAt: null } });
      if (hall) {
        await tx.displayOffice.create({ data: { displayId: hall.id, officeId: created.id } });
      }
      await writeAudit(tx, {
        actorType: "staff",
        actorUserId: actor.userId,
        action: "catalog.office.create",
        entityType: "office",
        entityId: created.id,
        ipHash: actor.ipHash,
        userAgentTruncated: actor.userAgentTruncated,
        metadata: { code: created.code },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ya existe un consultorio con ese código.");
    }
    throw error;
  }
}

export async function updateOffice(
  db: PrismaClient,
  id: string,
  input: { name?: string; code?: string; locationLabel?: string | null; deactivated?: boolean },
  actor: CatalogActor,
) {
  const existing = await db.office.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, NOT_FOUND);
  }
  try {
    return await db.$transaction(async (tx) => {
      const updated = await tx.office.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.locationLabel !== undefined ? { locationLabel: input.locationLabel } : {}),
          ...(input.deactivated === true ? { deactivatedAt: new Date() } : {}),
          ...(input.deactivated === false ? { deactivatedAt: null } : {}),
        },
      });
      await writeAudit(tx, {
        actorType: "staff",
        actorUserId: actor.userId,
        action: "catalog.office.update",
        entityType: "office",
        entityId: id,
        ipHash: actor.ipHash,
        userAgentTruncated: actor.userAgentTruncated,
        metadata: { fields: Object.keys(input) },
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "Ya existe un consultorio con ese código.");
    }
    throw error;
  }
}
