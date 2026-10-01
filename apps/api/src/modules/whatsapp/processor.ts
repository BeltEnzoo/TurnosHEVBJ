import type { PrismaClient } from "@hep/db";
import type { Redis } from "ioredis";
import { deliverNotification } from "./deliver.js";
import { enqueueSendNotification } from "./queue.js";
import type { WhatsAppProvider } from "./provider.js";

export async function processSendNotification(
  deps: { db: PrismaClient; redis: Redis; provider: WhatsAppProvider; providerName: string },
  notificationId: string,
): Promise<void> {
  const outcome = await deliverNotification(deps, notificationId);
  if (outcome.result === "deferred") {
    await enqueueSendNotification(deps.redis, notificationId, outcome.delayMs);
  }
}

export async function enqueueDueNotifications(db: PrismaClient, redis: Redis): Promise<void> {
  const due = await db.notification.findMany({
    where: {
      status: "PENDING",
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 25,
  });
  for (const row of due) {
    await enqueueSendNotification(redis, row.id);
  }
}
