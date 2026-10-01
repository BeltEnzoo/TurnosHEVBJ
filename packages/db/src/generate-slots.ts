import type { Prisma, PrismaClient } from "@prisma/client";

export const HOSPITAL_TZ = "America/Argentina/Buenos_Aires";

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type SlotDraft = {
  professionalId: string;
  specialtyId: string;
  officeId: string;
  sourceScheduleId: string;
  startsAt: Date;
  endsAt: Date;
};

export type RegenerateResult = {
  created: number;
  updated: number;
  removed: number;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function zonedParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HOSPITAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  let hour = read("hour");
  if (hour === 24) {
    hour = 0;
  }
  return { year: read("year"), month: read("month"), day: read("day"), hour, minute: read("minute") };
}

export function civilToday(now: Date): string {
  return hospitalCivilDate(now);
}

export function hospitalCivilDate(date: Date): string {
  const parts = zonedParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function addCivilDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function weekdayMonday1(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  const probe = new Date(Date.UTC(year!, month! - 1, day!, 15, 0, 0));
  const label = new Intl.DateTimeFormat("en-US", { timeZone: HOSPITAL_TZ, weekday: "short" }).format(probe);
  return WEEKDAY[label] ?? 0;
}

export function zonedDateTimeToUtc(isoDate: string, minutesFromMidnight: number): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  let utc = new Date(Date.UTC(year!, month! - 1, day!, hour, minute, 0));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const got = zonedParts(utc);
    const gotMs = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
    const wantMs = Date.UTC(year!, month! - 1, day!, hour, minute);
    utc = new Date(utc.getTime() + (wantMs - gotMs));
  }
  return utc;
}

function civilDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function minutesOf(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

function datesFrom(start: string, untilExclusive: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  while (cursor < untilExclusive) {
    dates.push(cursor);
    cursor = addCivilDays(cursor, 1);
  }
  return dates;
}

type ScheduleRow = Prisma.WeeklyScheduleGetPayload<{
  include: {
    professional: { select: { deactivatedAt: true } };
    specialty: { select: { deactivatedAt: true } };
    office: { select: { deactivatedAt: true } };
  };
}>;

type ExceptionRow = {
  date: Date;
  professionalId: string | null;
  officeId: string | null;
  specialtyId: string | null;
  closed: boolean;
  startTime: Date | null;
  endTime: Date | null;
};

type HolidayRow = {
  date: Date;
  appliesTo: "ALL" | "OFFICE" | "PROFESSIONAL";
  officeId: string | null;
  professionalId: string | null;
};

type BlockRow = {
  professionalId: string | null;
  officeId: string | null;
  startsAt: Date;
  endsAt: Date;
};

function exceptionMatches(row: ExceptionRow, schedule: ScheduleRow, isoDate: string): boolean {
  if (civilDate(row.date) !== isoDate) {
    return false;
  }
  if (!row.professionalId && !row.officeId && !row.specialtyId) {
    return false;
  }
  if (row.professionalId && row.professionalId !== schedule.professionalId) {
    return false;
  }
  if (row.officeId && row.officeId !== schedule.officeId) {
    return false;
  }
  if (row.specialtyId && row.specialtyId !== schedule.specialtyId) {
    return false;
  }
  return true;
}

function specificity(row: ExceptionRow): number {
  return Number(Boolean(row.professionalId)) + Number(Boolean(row.officeId)) + Number(Boolean(row.specialtyId));
}

function holidayBlocks(row: HolidayRow, schedule: ScheduleRow, isoDate: string): boolean {
  if (civilDate(row.date) !== isoDate) {
    return false;
  }
  if (row.appliesTo === "ALL") {
    return true;
  }
  if (row.appliesTo === "OFFICE") {
    return row.officeId === schedule.officeId;
  }
  return row.professionalId === schedule.professionalId;
}

function blockApplies(row: BlockRow, professionalId: string, officeId: string, startsAt: Date, endsAt: Date): boolean {
  if (row.professionalId && row.professionalId !== professionalId) {
    return false;
  }
  if (row.officeId && row.officeId !== officeId) {
    return false;
  }
  return startsAt < row.endsAt && row.startsAt < endsAt;
}

function desiredSlots(
  schedules: ScheduleRow[],
  exceptions: ExceptionRow[],
  holidays: HolidayRow[],
  blocks: BlockRow[],
  dates: string[],
  now: Date,
): Map<string, SlotDraft> {
  const desired = new Map<string, SlotDraft>();
  for (const schedule of schedules) {
    if (schedule.professional.deactivatedAt || schedule.specialty.deactivatedAt || schedule.office.deactivatedAt) {
      continue;
    }
    const validFrom = civilDate(schedule.validFrom);
    const validTo = schedule.validTo ? civilDate(schedule.validTo) : null;
    for (const isoDate of dates) {
      if (isoDate < validFrom || (validTo && isoDate > validTo)) {
        continue;
      }
      if (weekdayMonday1(isoDate) !== schedule.weekday) {
        continue;
      }
      if (holidays.some((holiday) => holidayBlocks(holiday, schedule, isoDate))) {
        continue;
      }
      const matching = exceptions.filter((row) => exceptionMatches(row, schedule, isoDate));
      const closed = matching.filter((row) => row.closed).sort((a, b) => specificity(b) - specificity(a))[0];
      if (closed) {
        continue;
      }
      const open = matching
        .filter((row) => !row.closed && row.startTime && row.endTime)
        .sort((a, b) => specificity(b) - specificity(a))[0];
      const startMinutes = open?.startTime ? minutesOf(open.startTime) : minutesOf(schedule.startTime);
      const endMinutes = open?.endTime ? minutesOf(open.endTime) : minutesOf(schedule.endTime);
      for (let cursor = startMinutes; cursor + schedule.slotMinutes <= endMinutes; cursor += schedule.slotMinutes) {
        const startsAt = zonedDateTimeToUtc(isoDate, cursor);
        const endsAt = zonedDateTimeToUtc(isoDate, cursor + schedule.slotMinutes);
        if (startsAt.getTime() < now.getTime()) {
          continue;
        }
        if (blocks.some((block) => blockApplies(block, schedule.professionalId, schedule.officeId, startsAt, endsAt))) {
          continue;
        }
        const key = `${schedule.professionalId}|${startsAt.toISOString()}`;
        if (desired.has(key)) {
          continue;
        }
        desired.set(key, {
          professionalId: schedule.professionalId,
          specialtyId: schedule.specialtyId,
          officeId: schedule.officeId,
          sourceScheduleId: schedule.id,
          startsAt,
          endsAt,
        });
      }
    }
  }
  return desired;
}

export async function regenerateAvailableSlots(
  db: PrismaClient,
  options: { now?: Date; horizonDays?: number } = {},
): Promise<RegenerateResult> {
  const now = options.now ?? new Date();
  return db.$transaction(async (tx) => {
    let horizonDays = options.horizonDays;
    if (horizonDays === undefined) {
      const setting = await tx.systemSetting.findUnique({ where: { key: "booking_horizon_days" } });
      const raw = setting?.value;
      horizonDays = typeof raw === "number" && raw >= 1 && raw <= 90 ? raw : 45;
    }
    const today = civilToday(now);
    const until = addCivilDays(today, horizonDays);
    const dates = datesFrom(today, until);
    const schedules = await tx.weeklySchedule.findMany({
      where: { deactivatedAt: null },
      include: {
        professional: { select: { deactivatedAt: true } },
        specialty: { select: { deactivatedAt: true } },
        office: { select: { deactivatedAt: true } },
      },
      orderBy: { id: "asc" },
    });
    const [exceptions, holidays, blocks] = await Promise.all([
      tx.scheduleException.findMany(),
      tx.holiday.findMany(),
      tx.scheduleBlock.findMany(),
    ]);
    const desired = desiredSlots(schedules, exceptions, holidays, blocks, dates, now);
    const existing = await tx.appointmentSlot.findMany({
      where: { slotKind: "REGULAR", startsAt: { gte: now, lt: zonedDateTimeToUtc(until, 0) } },
      include: { _count: { select: { appointments: true } } },
    });
    let created = 0;
    let updated = 0;
    let removed = 0;
    const seen = new Set<string>();
    for (const slot of existing) {
      const key = `${slot.professionalId}|${slot.startsAt.toISOString()}`;
      seen.add(key);
      const next = desired.get(key);
      if (slot.status === "BOOKED" || slot.status === "HELD") {
        continue;
      }
      if (!next) {
        if (slot._count.appointments === 0) {
          await tx.appointmentSlot.delete({ where: { id: slot.id } });
        } else {
          await tx.appointmentSlot.update({ where: { id: slot.id }, data: { status: "CANCELLED_SLOT" } });
        }
        removed += 1;
        continue;
      }
      await tx.appointmentSlot.update({
        where: { id: slot.id },
        data: {
          specialtyId: next.specialtyId,
          officeId: next.officeId,
          endsAt: next.endsAt,
          sourceScheduleId: next.sourceScheduleId,
          status: "AVAILABLE",
          holdExpiresAt: null,
        },
      });
      updated += 1;
    }
    for (const [key, next] of desired) {
      if (seen.has(key)) {
        continue;
      }
      await tx.appointmentSlot.create({
        data: {
          professionalId: next.professionalId,
          specialtyId: next.specialtyId,
          officeId: next.officeId,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          status: "AVAILABLE",
          slotKind: "REGULAR",
          sourceScheduleId: next.sourceScheduleId,
        },
      });
      created += 1;
    }
    return { created, updated, removed };
  }, { timeout: 20000 });
}
