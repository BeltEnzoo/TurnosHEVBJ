import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient } from "@prisma/client";
export type { Prisma, SessionKind } from "@prisma/client";
export {
  regenerateAvailableSlots,
  HOSPITAL_TZ,
  addCivilDays,
  civilToday,
  hospitalCivilDate,
  weekdayMonday1,
  zonedDateTimeToUtc,
} from "./generate-slots.js";
