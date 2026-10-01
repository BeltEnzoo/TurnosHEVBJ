import { config } from "dotenv";
import { resolve } from "node:path";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "@hep/config";
import { prisma, regenerateAvailableSlots } from "@hep/db";
import { createWhatsAppProvider } from "../../api/src/modules/whatsapp/provider.js";
import { enqueueDueNotifications, processSendNotification } from "../../api/src/modules/whatsapp/processor.js";
import { ensureUpcomingReminders } from "../../api/src/modules/whatsapp/reminders.js";
import { expireWaitlistOffers } from "../../api/src/modules/waitlist/service.js";
import { closeNotificationsQueue, NOTIFICATIONS_QUEUE, whatsAppBackoffDelay } from "../../api/src/modules/whatsapp/queue.js";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const env = loadEnv();
process.env.TZ = env.TZ;

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const heartbeat = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const notificationsQueueRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const notificationsWorkerRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const whatsapp = createWhatsAppProvider(env.WHATSAPP_PROVIDER);

const queue = new Queue("system", { connection });
const worker = new Worker(
  "system",
  async (job) => {
    if (job.name === "ping") {
      return { ok: true, at: new Date().toISOString() };
    }
    if (job.name === "regenerate-slots") {
      return regenerateAvailableSlots(prisma);
    }
    if (job.name === "schedule-reminders") {
      return ensureUpcomingReminders(prisma, notificationsQueueRedis);
    }
    return { ignored: true };
  },
  { connection },
);

const notificationsWorker = new Worker(
  NOTIFICATIONS_QUEUE,
  async (job) => {
    const notificationId = job.data?.notificationId;
    if (job.name !== "send-notification" || typeof notificationId !== "string" || !/^[0-9a-f-]{36}$/i.test(notificationId)) {
      return;
    }
    await processSendNotification(
      {
        db: prisma,
        redis: notificationsQueueRedis,
        provider: whatsapp,
        providerName: env.WHATSAPP_PROVIDER,
      },
      notificationId,
    );
  },
  {
    connection: notificationsWorkerRedis,
    settings: {
      backoffStrategy: (attemptsMade) => whatsAppBackoffDelay(attemptsMade),
    },
  },
);

const beat = setInterval(() => {
  void heartbeat.set("worker:heartbeat", Date.now().toString(), "EX", 30);
}, 5000);
const sweep = setInterval(() => {
  void enqueueDueNotifications(prisma, notificationsQueueRedis).catch(() => undefined);
  void expireWaitlistOffers(prisma, notificationsQueueRedis).catch(() => undefined);
}, 30_000);
void expireWaitlistOffers(prisma, notificationsQueueRedis).catch(() => undefined);
void enqueueDueNotifications(prisma, notificationsQueueRedis).catch(() => undefined);
void heartbeat.set("worker:heartbeat", Date.now().toString(), "EX", 30);
void queue.add("ping", {}, { repeat: { every: 60_000 } });
void queue.add(
  "regenerate-slots",
  {},
  { repeat: { pattern: "0 3 * * *", tz: "America/Argentina/Buenos_Aires" }, attempts: 3 },
);
void queue.add("schedule-reminders", {}, { repeat: { every: 15 * 60_000 }, attempts: 2 });

const shutdown = async () => {
  clearInterval(beat);
  clearInterval(sweep);
  await notificationsWorker.close();
  await closeNotificationsQueue(notificationsQueueRedis);
  await worker.close();
  await queue.close();
  await connection.quit();
  await heartbeat.quit();
  await notificationsQueueRedis.quit();
  await notificationsWorkerRedis.quit();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
