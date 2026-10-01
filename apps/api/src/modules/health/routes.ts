import type { FastifyInstance } from "fastify";
import { ERROR_CODES } from "@hep/shared";
import { AppError } from "../../lib/errors.js";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/health", async () => ({ status: "ok" }));

  app.get("/api/v1/ready", async () => {
    const checks: Record<string, string> = {};
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      checks["db"] = "ok";
    } catch {
      checks["db"] = "down";
    }
    try {
      const pong = await app.redis.ping();
      checks["redis"] = pong === "PONG" ? "ok" : "down";
    } catch {
      checks["redis"] = "down";
    }
    const workerBeat = await app.redis.get("worker:heartbeat");
    checks["worker"] = workerBeat ? "ok" : "down";
    const ready = checks["db"] === "ok" && checks["redis"] === "ok";
    if (!ready) {
      throw new AppError(503, ERROR_CODES.NOT_READY, "Servicio no listo.");
    }
    return {
      status: checks["worker"] === "ok" ? "ok" : "degraded",
      checks,
    };
  });
}
