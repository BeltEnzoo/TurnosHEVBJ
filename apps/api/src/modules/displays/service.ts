import type { PrismaClient } from "@hep/db";
import { AppError } from "../../lib/errors.js";
import { ERROR_CODES } from "@hep/shared";
import { sha256 } from "../../lib/crypto.js";
import type { DisplayHub, PatientCalledEvent } from "./hub.js";

const SNAPSHOT_MINUTES = 30;
const DEFAULT_TEMPLATE = "Turno {code}. Dirigirse al {office}.";

export async function loadDisplayByToken(db: PrismaClient, authorization: string | undefined) {
  const token = bearer(authorization);
  if (!token) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "No autorizado.");
  }
  const display = await db.display.findFirst({
    where: { tokenHash: sha256(token), deactivatedAt: null },
    include: {
      offices: { include: { office: { select: { id: true, code: true, name: true } } } },
    },
  });
  if (!display || display.status === "MAINTENANCE") {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "No autorizado.");
  }
  return display;
}

export function presentDisplay(display: {
  id: string;
  name: string;
  location: string | null;
  status: string;
  voiceEnabled: boolean;
  voiceLocale: string;
  voiceRate: number;
  volume: number;
  repeatCount: number;
  displayDurationMs: number;
  offices: Array<{ office: { code: string; name: string } }>;
}) {
  return {
    id: display.id,
    name: display.name,
    location: display.location,
    status: display.status,
    voice: {
      enabled: display.voiceEnabled,
      locale: display.voiceLocale,
      rate: display.voiceRate,
      volume: display.volume,
      repeatCount: display.repeatCount,
      displayDurationMs: display.displayDurationMs,
    },
    offices: display.offices.map((link) => ({ code: link.office.code, name: link.office.name })),
  };
}

export async function withHospitalName<T extends object>(db: PrismaClient, body: T): Promise<T & { hospitalName: string }> {
  const row = await db.systemSetting.findUnique({ where: { key: "hospital_name" } });
  const hospitalName = typeof row?.value === "string" && row.value.trim() ? row.value.trim() : "Hospital";
  return { ...body, hospitalName };
}

export async function touchDisplay(db: PrismaClient, displayId: string): Promise<{ status: "ONLINE" }> {
  await db.display.update({
    where: { id: displayId },
    data: { status: "ONLINE", lastSeenAt: new Date() },
  });
  return { status: "ONLINE" };
}

export async function listDisplaySnapshot(db: PrismaClient, displayId: string) {
  const display = await db.display.findUniqueOrThrow({
    where: { id: displayId },
    include: { offices: { select: { officeId: true } } },
  });
  const officeIds = display.offices.map((link) => link.officeId);
  if (officeIds.length === 0) {
    return { items: [] as PatientCalledEvent[] };
  }
  const template = await spokenTemplate(db);
  const since = new Date(Date.now() - SNAPSHOT_MINUTES * 60 * 1000);
  const calls = await db.appointmentCall.findMany({
    where: {
      createdAt: { gte: since },
      appointment: { slot: { officeId: { in: officeIds } } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      createdAt: true,
      appointment: {
        select: {
          publicCode: true,
          slot: { select: { office: { select: { name: true } } } },
        },
      },
    },
  });
  return {
    items: calls.reverse().map((call) =>
      calledEvent(template, {
        callId: call.id,
        publicCode: call.appointment.publicCode,
        officeLabel: call.appointment.slot.office.name,
        ts: call.createdAt,
      }),
    ),
  };
}

export async function listDisplays(db: PrismaClient) {
  const rows = await db.display.findMany({
    where: { deactivatedAt: null },
    orderBy: { name: "asc" },
    take: 100,
    select: {
      id: true,
      name: true,
      location: true,
      status: true,
      lastSeenAt: true,
      offices: { select: { office: { select: { code: true, name: true } } } },
    },
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      location: row.location,
      status: row.status,
      lastSeenAt: row.lastSeenAt,
      offices: row.offices.map((link) => link.office),
    })),
  };
}

export async function publishAppointmentCall(db: PrismaClient, hub: DisplayHub, callId: string): Promise<void> {
  const call = await db.appointmentCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      createdAt: true,
      appointment: {
        select: {
          publicCode: true,
          slot: { select: { officeId: true, office: { select: { name: true } } } },
        },
      },
    },
  });
  if (!call) {
    return;
  }
  const displays = await db.display.findMany({
    where: {
      deactivatedAt: null,
      status: { not: "MAINTENANCE" },
      offices: { some: { officeId: call.appointment.slot.officeId } },
    },
    select: { id: true },
  });
  const connected = displays.filter((display) => hub.hasListeners(display.id));
  if (connected.length === 0) {
    return;
  }
  const payload = calledEvent(await spokenTemplate(db), {
    callId: call.id,
    publicCode: call.appointment.publicCode,
    officeLabel: call.appointment.slot.office.name,
    ts: call.createdAt,
  });
  for (const display of connected) {
    hub.emitCalled(display.id, payload);
  }
  await db.appointmentCall.update({ where: { id: call.id }, data: { result: "EMITTED" } });
  await db.appointmentCallDisplay.createMany({
    data: connected.map((display) => ({ callId: call.id, displayId: display.id })),
    skipDuplicates: true,
  });
}

function calledEvent(
  template: string,
  input: { callId: string; publicCode: string; officeLabel: string; ts: Date },
): PatientCalledEvent {
  return {
    callId: input.callId,
    publicCode: input.publicCode,
    officeLabel: input.officeLabel,
    spokenText: template.replaceAll("{code}", input.publicCode).replaceAll("{office}", input.officeLabel),
    ts: input.ts.toISOString(),
  };
}

async function spokenTemplate(db: PrismaClient): Promise<string> {
  const row = await db.systemSetting.findUnique({ where: { key: "tts_template" } });
  return typeof row?.value === "string" && row.value.includes("{code}") ? row.value : DEFAULT_TEMPLATE;
}

function bearer(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  if (token.length < 16 || token.length > 200) {
    return null;
  }
  return token;
}
