import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@hep/db";
import { normalizeArPhone } from "@hep/shared";
import { AppError } from "../src/lib/errors.js";
import { ensureRbac, resetAuthData, startTestApp } from "./helpers.js";

function sentPhone(phoneE164: string): string {
  return normalizeArPhone(phoneE164) ?? phoneE164;
}

describe("OTP service", () => {
  let ctx: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    await ensureRbac();
    ctx = await startTestApp();
  });

  beforeEach(async () => {
    await resetAuthData();
    await ctx.redis.flushdb();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.redis.quit();
  });

  const fixture = {
    purpose: "TEST_OTP",
    subject: "fixture-subject-a",
    destinationE164: "+5491112345678",
    ip: "127.0.0.1",
  };

  it("validates the patient OTP request instead of hiding the route", async () => {
    const request = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/patient/otp/request",
      payload: {},
    });
    expect(request.statusCode).toBe(400);
  });

  it("stores OTP hashed, invalidates the previous code, and is single-use", async () => {
    await ctx.app.otpService.issue(fixture);
    const firstCode = ctx.whatsapp.getLastOtpForTests(sentPhone("+5491112345678"));
    expect(firstCode).toMatch(/^\d{6}$/);

    const stored = await prisma.otpRequest.findMany();
    expect(stored[0]?.codeHash).not.toBe(firstCode);

    await ctx.app.otpService.issue(fixture);
    const secondCode = ctx.whatsapp.getLastOtpForTests(sentPhone("+5491112345678"));

    await expect(
      ctx.app.otpService.consume({ ...fixture, code: firstCode! }),
    ).rejects.toBeInstanceOf(AppError);

    await ctx.app.otpService.consume({ ...fixture, code: secondCode! });

    await expect(
      ctx.app.otpService.consume({ ...fixture, code: secondCode! }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects after max attempts", async () => {
    await ctx.app.otpService.issue({
      ...fixture,
      subject: "fixture-subject-b",
      destinationE164: "+5491199988877",
    });
    for (let i = 0; i < 5; i += 1) {
      await expect(
        ctx.app.otpService.consume({
          ...fixture,
          subject: "fixture-subject-b",
          destinationE164: "+5491199988877",
          code: "000000",
        }),
      ).rejects.toBeInstanceOf(AppError);
    }
    const real = ctx.whatsapp.getLastOtpForTests(sentPhone("+5491199988877"));
    await expect(
      ctx.app.otpService.consume({
        ...fixture,
        subject: "fixture-subject-b",
        destinationE164: "+5491199988877",
        code: real!,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
