import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hep/db";
import { ensureRbac, startTestApp } from "./helpers.js";

describe("health", () => {
  let ctx: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    await ensureRbac();
    ctx = await startTestApp();
    await ctx.redis.set("worker:heartbeat", "1", "EX", 30);
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.redis.quit();
    await prisma.$disconnect();
  });

  it("returns liveness without internals", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json())).not.toContain("DATABASE_URL");
  });

  it("returns readiness for db and redis", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json().checks.db).toBe("ok");
    expect(response.json().checks.redis).toBe("ok");
  });
});
