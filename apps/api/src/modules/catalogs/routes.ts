import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "@hep/shared";
import { sha256, truncateUserAgent } from "../../lib/crypto.js";
import { staffCookieName } from "../../lib/cookies.js";
import { loadStaffSession, requireAnyPermission, requirePermission, requireStaff } from "../auth/session.js";
import {
  createOffice,
  createProfessional,
  createSpecialty,
  listAdminOffices,
  listAdminProfessionals,
  listLinkableMedicos,
  listAdminSpecialties,
  listPublicProfessionals,
  listPublicSpecialties,
  updateOffice,
  updateProfessional,
  updateSpecialty,
  type CatalogActor,
} from "./service.js";

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  starting_after: z.string().uuid().optional(),
});

const nameSchema = z.string().trim().min(2).max(80);

const specialtyCreate = z.object({
  name: nameSchema,
  defaultSlotMinutes: z.number().int().min(5).max(180),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const specialtyPatch = z
  .object({
    name: nameSchema.optional(),
    defaultSlotMinutes: z.number().int().min(5).max(180).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    deactivated: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

const idList = z.array(z.string().uuid()).max(20);

const professionalBody = z.object({
  givenName: nameSchema,
  familyName: nameSchema,
  licenseNumber: z.string().trim().max(40).nullable().optional(),
  specialtyIds: idList.default([]),
  officeIds: idList.default([]),
  userId: z.string().uuid().nullable().optional(),
});

const professionalPatch = z
  .object({
    givenName: nameSchema.optional(),
    familyName: nameSchema.optional(),
    licenseNumber: z.string().trim().max(40).nullable().optional(),
    specialtyIds: idList.optional(),
    officeIds: idList.optional(),
    userId: z.string().uuid().nullable().optional(),
    deactivated: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

const officeCode = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9-]+$/)
  .transform((value) => value.toUpperCase());

const officeCreate = z.object({
  name: nameSchema,
  code: officeCode,
  locationLabel: z.string().trim().max(120).nullable().optional(),
});

const officePatch = z
  .object({
    name: nameSchema.optional(),
    code: officeCode.optional(),
    locationLabel: z.string().trim().max(120).nullable().optional(),
    deactivated: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

const idParam = z.object({ id: z.string().uuid() });

function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  async function staffOf(request: { cookies: Record<string, string | undefined>; ip: string; headers: { "user-agent"?: string } }) {
    const token = request.cookies[staffCookieName(app.env)];
    return requireStaff(await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS));
  }

  async function actor(request: { cookies: Record<string, string | undefined>; ip: string; headers: { "user-agent"?: string } }): Promise<CatalogActor> {
    const staff = await staffOf(request);
    requirePermission(staff, PERMISSIONS.CATALOGS_WRITE);
    return {
      userId: staff.userId,
      ipHash: sha256(request.ip),
      userAgentTruncated: truncateUserAgent(request.headers["user-agent"]),
    };
  }

  async function reader(request: { cookies: Record<string, string | undefined>; ip: string; headers: { "user-agent"?: string } }): Promise<void> {
    const staff = await staffOf(request);
    requireAnyPermission(staff, [PERMISSIONS.CATALOGS_WRITE, PERMISSIONS.SCHEDULES_WRITE, PERMISSIONS.APPOINTMENTS_WRITE]);
  }

  app.get("/api/v1/specialties", async (request) => {
    const query = pageQuery.parse(request.query);
    return listPublicSpecialties(app.prisma, { limit: query.limit, startingAfter: query.starting_after });
  });

  app.get("/api/v1/professionals", async (request) => {
    const query = pageQuery
      .extend({ specialtyId: z.string().uuid().optional() })
      .parse(request.query);
    return listPublicProfessionals(app.prisma, {
      limit: query.limit,
      startingAfter: query.starting_after,
      specialtyId: query.specialtyId,
    });
  });

  app.get("/api/v1/admin/specialties", async (request) => {
    await reader(request);
    const query = pageQuery.parse(request.query);
    return listAdminSpecialties(app.prisma, { limit: query.limit, startingAfter: query.starting_after });
  });

  app.post("/api/v1/admin/specialties", async (request, reply) => {
    const who = await actor(request);
    const body = specialtyCreate.parse(request.body);
    const created = await createSpecialty(app.prisma, body, who);
    return reply.code(201).send(created);
  });

  app.patch("/api/v1/admin/specialties/:id", async (request) => {
    const who = await actor(request);
    const params = idParam.parse(request.params);
    const body = specialtyPatch.parse(request.body);
    return updateSpecialty(app.prisma, params.id, body, who);
  });

  app.get("/api/v1/admin/professionals/linkable-users", async (request) => {
    await actor(request);
    return listLinkableMedicos(app.prisma);
  });

  app.get("/api/v1/admin/professionals", async (request) => {
    await reader(request);
    const query = pageQuery.parse(request.query);
    return listAdminProfessionals(app.prisma, { limit: query.limit, startingAfter: query.starting_after });
  });

  app.post("/api/v1/admin/professionals", async (request, reply) => {
    const who = await actor(request);
    const body = professionalBody.parse(request.body);
    const created = await createProfessional(
      app.prisma,
      {
        givenName: body.givenName,
        familyName: body.familyName,
        licenseNumber: blankToNull(body.licenseNumber) ?? null,
        specialtyIds: body.specialtyIds,
        officeIds: body.officeIds,
        userId: body.userId ?? null,
      },
      who,
    );
    return reply.code(201).send(created);
  });

  app.patch("/api/v1/admin/professionals/:id", async (request) => {
    const who = await actor(request);
    const params = idParam.parse(request.params);
    const body = professionalPatch.parse(request.body);
    return updateProfessional(
      app.prisma,
      params.id,
      {
        ...body,
        licenseNumber: blankToNull(body.licenseNumber),
      },
      who,
    );
  });

  app.get("/api/v1/admin/offices", async (request) => {
    await reader(request);
    const query = pageQuery.parse(request.query);
    return listAdminOffices(app.prisma, { limit: query.limit, startingAfter: query.starting_after });
  });

  app.post("/api/v1/admin/offices", async (request, reply) => {
    const who = await actor(request);
    const body = officeCreate.parse(request.body);
    const created = await createOffice(
      app.prisma,
      { name: body.name, code: body.code, locationLabel: blankToNull(body.locationLabel) ?? null },
      who,
    );
    return reply.code(201).send(created);
  });

  app.patch("/api/v1/admin/offices/:id", async (request) => {
    const who = await actor(request);
    const params = idParam.parse(request.params);
    const body = officePatch.parse(request.body);
    return updateOffice(
      app.prisma,
      params.id,
      { ...body, locationLabel: blankToNull(body.locationLabel) },
      who,
    );
  });
}
