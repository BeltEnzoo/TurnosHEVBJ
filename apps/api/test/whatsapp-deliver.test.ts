import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@hep/db";
import { startTestApp } from "./helpers.js";
import { processSendNotification } from "../src/modules/whatsapp/processor.js";
import type { WhatsAppProvider, WhatsAppSendInput, WhatsAppSendResult } from "../src/modules/whatsapp/provider.js";
import { notificationsQueue } from "../src/modules/whatsapp/queue.js";
import { recordAppointmentNotice } from "../src/modules/appointments/service.js";
import { applyWhatsAppWebhook, webhookSignature } from "../src/modules/whatsapp/webhook.js";

const SECRET = "test-webhook-secret-32chars";
const DNI = "27111991";
const PHONE = "+5491190011001";

class FailProvider implements WhatsAppProvider {
  calls = 0;
  async send(_input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    this.calls += 1;
    throw new Error("provider down");
  }
}

async function cleanup(): Promise<void> {
  const patients = await prisma.patient.findMany({
    where: { familyName: "Fase11" },
    select: { id: true },
  });
  const ids = patients.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.notificationDelivery.deleteMany({ where: { notification: { patientId: { in: ids } } } });
    await prisma.notification.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.appointment.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.patient.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.appointmentSlot.deleteMany({ where: { office: { code: "F11Z" } } });
  await prisma.professional.deleteMany({ where: { familyName: "Clinica11" } });
  await prisma.office.deleteMany({ where: { code: "F11Z" } });
  await prisma.specialty.deleteMany({ where: { slug: "fase11-clinica" } });
}

describe("whatsapp delivery", () => {
  let ctx: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    await cleanup();
    ctx = await startTestApp({ WHATSAPP_WEBHOOK_SECRET: SECRET });
  });

  afterAll(async () => {
    await cleanup();
    await ctx.app.close();
    await ctx.redis.quit();
  });

  it("queues a confirmation and the worker sends it once, without DNI", async () => {
    const specialty = await prisma.specialty.create({
      data: { name: "Clinica", slug: "fase11-clinica", defaultSlotMinutes: 20 },
    });
    const office = await prisma.office.create({ data: { name: "Consultorio 11", code: "F11Z" } });
    const professional = await prisma.professional.create({
      data: { givenName: "Nora", familyName: "Clinica11" },
    });
    const startsAt = new Date("2035-03-16T14:30:00.000Z");
    const slot = await prisma.appointmentSlot.create({
      data: {
        professionalId: professional.id,
        specialtyId: specialty.id,
        officeId: office.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 20 * 60 * 1000),
        status: "BOOKED",
      },
    });
    const patient = await prisma.patient.create({
      data: {
        givenName: "Ana",
        familyName: "Fase11",
        dni: DNI,
        dniHmac: `hmac-${DNI}`,
        birthDate: new Date("1990-04-02T00:00:00.000Z"),
        phoneE164: PHONE,
        phoneHmac: `hmac-${PHONE}`,
        whatsappOptIn: true,
      },
    });
    const beforeAppointments = await prisma.appointment.count();
    const appointment = await prisma.appointment.create({
      data: {
        publicCode: "F2-K4M",
        slotId: slot.id,
        patientId: patient.id,
        status: "CONFIRMED",
        kind: "REGULAR",
        createdByType: "STAFF",
      },
    });

    await recordAppointmentNotice(ctx.app.prisma, appointment.id, "APPOINTMENT_CONFIRMATION", ctx.redis);
    expect(ctx.whatsapp.sent).toHaveLength(0);
    const notice = await prisma.notification.findFirstOrThrow({ where: { appointmentId: appointment.id } });
    expect(notice.status).toBe("PENDING");
    const job = await notificationsQueue(ctx.redis).getJob(notice.id);
    expect(job?.name).toBe("send-notification");

    await processSendNotification(
      { db: prisma, redis: ctx.redis, provider: ctx.whatsapp, providerName: "mock" },
      notice.id,
    );
    const sent = await prisma.notification.findUniqueOrThrow({ where: { id: notice.id } });
    expect(sent.status).toBe("SENT");
    expect(ctx.whatsapp.sent).toHaveLength(1);
    const message = ctx.whatsapp.sent[0];
    expect(message?.toE164).toBe(PHONE);
    expect(message?.templateKey).toBe("appointment_confirmation");
    expect(Object.keys(message?.params ?? {}).sort()).toEqual([
      "code",
      "date",
      "hospital",
      "professional",
      "specialty",
      "time",
    ]);
    expect(message?.params.code).toBe("F2-K4M");
    expect(message?.params.specialty).toBe("Clinica");
    expect(message?.params.professional).toBe("Nora Clinica11");
    const rendered = JSON.stringify(message?.params);
    expect(rendered).not.toContain(DNI);
    expect(rendered).not.toContain("Fase11");
    expect(rendered).not.toContain(PHONE);
    expect(rendered).not.toContain("F11Z");
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({ where: { notificationId: notice.id } });
    expect(delivery.status).toBe("SENT");

    await processSendNotification(
      { db: prisma, redis: ctx.redis, provider: ctx.whatsapp, providerName: "mock" },
      notice.id,
    );
    expect(ctx.whatsapp.sent).toHaveLength(1);

    const raw = JSON.stringify({
      providerEventId: "evt-phase11-delivered",
      providerMessageId: delivery.providerMessageId,
      status: "DELIVERED",
    });
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": webhookSignature(SECRET, raw),
        "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      payload: raw,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(PHONE);
    expect(response.body).not.toContain(DNI);
    expect(response.body).not.toContain(SECRET);
    const updated = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(updated.status).toBe("DELIVERED");

    const replay = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": webhookSignature(SECRET, raw),
        "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      payload: raw,
    });
    expect(replay.statusCode).toBe(200);
    const afterReplay = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(afterReplay.status).toBe("DELIVERED");
    expect(afterReplay.updatedAt.toISOString()).toBe(updated.updatedAt.toISOString());

    const badRaw = JSON.stringify({
      providerEventId: "evt-phase11-bad-sign",
      providerMessageId: delivery.providerMessageId,
      status: "READ",
    });
    const bad = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      payload: badRaw,
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.body).not.toContain(SECRET);
    const stillDelivered = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(stillDelivered.status).toBe("DELIVERED");

    const unknown = JSON.stringify({
      providerEventId: "evt-phase11-unknown",
      providerMessageId: "missing-message",
      status: "DELIVERED",
    });
    const ignored = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": webhookSignature(SECRET, unknown),
        "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      payload: unknown,
    });
    expect(ignored.statusCode).toBe(200);
    expect(await prisma.appointment.count()).toBe(beforeAppointments + 1);

    await prisma.patient.update({ where: { id: patient.id }, data: { whatsappOptIn: false } });
    await recordAppointmentNotice(ctx.app.prisma, appointment.id, "APPOINTMENT_CANCELLED", ctx.redis);
    const cancelled = await prisma.notification.findFirstOrThrow({
      where: { appointmentId: appointment.id, type: "APPOINTMENT_CANCELLED" },
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(ctx.whatsapp.sent).toHaveLength(1);
    const cancelJob = await notificationsQueue(ctx.redis).getJob(cancelled.id);
    expect(cancelJob).toBeUndefined();
  });

  it("marks the notice failed after four provider errors", async () => {
    const patient = await prisma.patient.create({
      data: {
        givenName: "Luis",
        familyName: "Fase11",
        dni: "27111992",
        dniHmac: "hmac-27111992",
        birthDate: new Date("1988-01-01T00:00:00.000Z"),
        phoneE164: "+5491190011002",
        phoneHmac: "hmac-phone-2",
        whatsappOptIn: true,
      },
    });
    const notice = await prisma.notification.create({
      data: {
        type: "APPOINTMENT_CONFIRMATION",
        channel: "WHATSAPP",
        patientId: patient.id,
        status: "PENDING",
        idempotencyKey: `fail:${patient.id}`,
        params: { publicCode: "F2-K4M" },
      },
    });
    const provider = new FailProvider();
    const deps = { db: prisma, redis: ctx.redis, provider, providerName: "mock" };
    await expect(processSendNotification(deps, notice.id)).rejects.toThrow(/whatsapp send failed/);
    await expect(processSendNotification(deps, notice.id)).rejects.toThrow(/whatsapp send failed/);
    await expect(processSendNotification(deps, notice.id)).rejects.toThrow(/whatsapp send failed/);
    await processSendNotification(deps, notice.id);
    const failed = await prisma.notification.findUniqueOrThrow({ where: { id: notice.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.attempts).toBe(4);
    expect(provider.calls).toBe(4);
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({ where: { notificationId: notice.id } });
    expect(delivery.errorCode).toBe("SEND_FAILED");
    expect(delivery.providerMessageId).toBeNull();
  });

  it("rejects a webhook when the secret is missing", async () => {
    await expect(
      applyWhatsAppWebhook({
        db: prisma,
        redis: ctx.redis,
        secret: "",
        rawBody: "{}",
        signature: "sha256=abc",
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
