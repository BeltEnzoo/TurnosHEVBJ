import type { FastifyInstance } from "fastify";
import { PERMISSIONS } from "@hep/shared";
import { staffCookieName } from "../../lib/cookies.js";
import { loadStaffSession, requirePermission, requireStaff } from "../auth/session.js";
import { listDisplaySnapshot, listDisplays, loadDisplayByToken, presentDisplay, touchDisplay, withHospitalName } from "./service.js";

export async function registerDisplayRoutes(app: FastifyInstance): Promise<void> {
  async function display(request: { headers: { authorization?: string } }) {
    return loadDisplayByToken(app.prisma, request.headers.authorization);
  }

  app.get("/api/v1/displays/me", async (request) => {
    return withHospitalName(app.prisma, presentDisplay(await display(request)));
  });

  app.get("/api/v1/displays/me/snapshot", async (request) => {
    const current = await display(request);
    return listDisplaySnapshot(app.prisma, current.id);
  });

  app.post("/api/v1/displays/me/heartbeat", async (request) => {
    const current = await display(request);
    return touchDisplay(app.prisma, current.id);
  });

  app.get("/api/v1/admin/displays", async (request) => {
    const token = request.cookies[staffCookieName(app.env)];
    const staff = requireStaff(await loadStaffSession(app.prisma, token, app.env.SESSION_IDLE_HOURS));
    requirePermission(staff, PERMISSIONS.DISPLAYS_MANAGE);
    return listDisplays(app.prisma);
  });
}
