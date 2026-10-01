import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { addCivilDays, civilToday, prisma, weekdayMonday1, zonedDateTimeToUtc } from "@hep/db";
import { normalizeArPhone } from "@hep/shared";
import { hmacSha256, sha256 } from "../src/lib/crypto.js";
import { createUser, ensureRbac, resetAuthData, startTestApp } from "./helpers.js";

const password = "CorrectHorseBattery";
const secret = "test-session-secret-must-be-32-chars-min";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function sessionCookie(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: tokenHash(token),
      kind: "STAFF",
      mfaSatisfied: true,
      expiresAt: new Date(now + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(now + 8 * 60 * 60 * 1000),
    },
  });
  return `staff_session=${token}`;
}

function upcomingMonday(): string {
  let cursor = addCivilDays(civilToday(new Date()), 1);
  while (weekdayMonday1(cursor) !== 1) {
    cursor = addCivilDays(cursor, 1);
  }
  return cursor;
}

function connectDisplay(port: number, token: string): Socket {
  return io(`http://127.0.0.1:${port}/ws/displays`, {
    transports: ["websocket"],
    auth: { token },
    reconnection: false,
  });
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${event}`)), 4000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
    socket.once("connect_error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function cleanup(): Promise<void> {
  const displays = await prisma.display.findMany({ where: { name: { startsWith: "Fase9" } }, select: { id: true } });
  const displayIds = displays.map((row) => row.id);
  if (displayIds.length > 0) {
    await prisma.appointmentCallDisplay.deleteMany({ where: { displayId: { in: displayIds } } });
    await prisma.displayOffice.deleteMany({ where: { displayId: { in: displayIds } } });
    await prisma.display.deleteMany({ where: { id: { in: displayIds } } });
  }
  const professionals = await prisma.professional.findMany({ where: { familyName: "Fase9" }, select: { id: true } });
  const ids = professionals.map((row) => row.id);
  if (ids.length > 0) {
    const slots = await prisma.appointmentSlot.findMany({ where: { professionalId: { in: ids } }, select: { id: true } });
    const slotIds = slots.map((row) => row.id);
    if (slotIds.length > 0) {
      const appointments = await prisma.appointment.findMany({ where: { slotId: { in: slotIds } }, select: { id: true } });
      const appointmentIds = appointments.map((row) => row.id);
      if (appointmentIds.length > 0) {
        await prisma.appointmentCallDisplay.deleteMany({ where: { call: { appointmentId: { in: appointmentIds } } } });
        await prisma.appointmentCall.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await prisma.notification.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
      }
      await prisma.appointmentSlot.deleteMany({ where: { id: { in: slotIds } } });
    }
    await prisma.professional.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.patient.deleteMany({ where: { familyName: "Fase9" } });
  await prisma.office.deleteMany({ where: { code: { in: ["F9A", "F9B"] } } });
  await prisma.specialty.deleteMany({ where: { slug: "fase9-call" } });
}

describe("display caller", () => {
  let ctx: Awaited<ReturnType<typeof startTestApp>>;
  let port = 0;

  beforeAll(async () => {
    await ensureRbac();
    ctx = await startTestApp();
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const address = ctx.app.server.address();
    port = typeof address === "object" && address ? address.port : 0;
  });

  beforeEach(async () => {
    await cleanup();
    await resetAuthData();
    await ctx.redis.flushdb();
  });

  afterAll(async () => {
    await cleanup();
    await ctx.app.close();
    await ctx.redis.quit();
  });

  it("emits the public code only to displays of that office", async () => {
    const doctor = await createUser({ email: "medico-fase9@hospital.local", password, role: "MEDICO" });
    const admin = await createUser({ email: "admin-fase9@hospital.local", password, role: "ADMIN" });
    const specialty = await prisma.specialty.create({
      data: { name: "Fase9 clinica", slug: "fase9-call", defaultSlotMinutes: 20 },
    });
    const office = await prisma.office.create({ data: { name: "Consultorio fase9", code: "F9A" } });
    const otherOffice = await prisma.office.create({ data: { name: "Otro fase9", code: "F9B" } });
    const professional = await prisma.professional.create({
      data: { givenName: "Nora", familyName: "Fase9", userId: doctor.id },
    });
    const day = upcomingMonday();
    const slot = await prisma.appointmentSlot.create({
      data: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        startsAt: zonedDateTimeToUtc(day, 11 * 60),
        endsAt: zonedDateTimeToUtc(day, 11 * 60 + 20),
        status: "BOOKED",
      },
    });
    const phone = normalizeArPhone("+541166660009")!;
    const dni = "30111009";
    const patient = await prisma.patient.create({
      data: {
        givenName: "Lia",
        familyName: "Fase9",
        dni,
        dniHmac: hmacSha256(dni, secret),
        birthDate: new Date(Date.UTC(1991, 3, 2)),
        phoneE164: phone,
        phoneHmac: hmacSha256(phone, secret),
      },
    });
    const appointment = await prisma.appointment.create({
      data: {
        publicCode: "F9-2K4",
        slotId: slot.id,
        patientId: patient.id,
        status: "CONFIRMED",
        kind: "REGULAR",
        createdByType: "STAFF",
      },
    });
    const hallToken = randomBytes(24).toString("base64url");
    const otherToken = randomBytes(24).toString("base64url");
    const hall = await prisma.display.create({
      data: { name: "Fase9 Hall", tokenHash: sha256(hallToken), offices: { create: { officeId: office.id } } },
    });
    await prisma.display.create({
      data: { name: "Fase9 Otra", tokenHash: sha256(otherToken), offices: { create: { officeId: otherOffice.id } } },
    });

    const denied = connectDisplay(port, "not-a-valid-display-token");
    await expect(once(denied, "connect")).rejects.toThrow();
    denied.close();

    const listener = connectDisplay(port, hallToken);
    const other = connectDisplay(port, otherToken);
    const otherEvents: unknown[] = [];
    other.on("patient.called", (payload) => otherEvents.push(payload));
    await once(listener, "display.config");
    await once(other, "display.config");
    expect((await prisma.display.findUniqueOrThrow({ where: { id: hall.id } })).status).toBe("ONLINE");

    const incoming = once<{ publicCode: string; officeLabel: string; spokenText: string }>(listener, "patient.called");
    const called = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/call`,
      headers: { cookie: await sessionCookie(doctor.id) },
    });
    expect(called.statusCode).toBe(200);
    const event = await incoming;
    expect(event.publicCode).toBe("F9-2K4");
    expect(event.officeLabel).toBe("Consultorio fase9");
    expect(event.spokenText).toContain("F9-2K4");
    expect(JSON.stringify(event)).not.toContain(dni);
    expect(JSON.stringify(event)).not.toContain("Fase9");
    expect(JSON.stringify(event)).not.toContain("Lia");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(otherEvents).toHaveLength(0);
    const stored = await prisma.appointmentCall.findFirstOrThrow({ where: { appointmentId: appointment.id } });
    expect(stored.result).toBe("EMITTED");

    const snapshot = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/displays/me/snapshot",
      headers: { authorization: `Bearer ${hallToken}` },
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().items[0].publicCode).toBe("F9-2K4");
    expect(JSON.stringify(snapshot.json())).not.toContain(dni);
    expect(JSON.stringify(snapshot.json())).not.toContain("Lia");

    const listed = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/admin/displays",
      headers: { cookie: await sessionCookie(admin.id) },
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain(hallToken);
    expect(listed.json().items.some((item: { name: string }) => item.name === "Fase9 Hall")).toBe(true);

    const forbidden = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/admin/displays",
      headers: { cookie: await sessionCookie(doctor.id) },
    });
    expect(forbidden.statusCode).toBe(403);

    const beat = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/displays/me/heartbeat",
      headers: { authorization: `Bearer ${hallToken}` },
    });
    expect(beat.statusCode).toBe(200);
    expect(beat.json().status).toBe("ONLINE");

    listener.disconnect();
    other.disconnect();
    let status = "ONLINE";
    for (let attempt = 0; attempt < 20 && status !== "OFFLINE"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = (await prisma.display.findUniqueOrThrow({ where: { id: hall.id } })).status;
    }
    expect(status).toBe("OFFLINE");
  });
});
