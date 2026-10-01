import { Queue } from "bullmq";
import type { Redis } from "ioredis";

const queues = new WeakMap<Redis, Queue>();

export const NOTIFICATIONS_QUEUE = "notifications";
export const SEND_NOTIFICATION_JOB = "send-notification";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export function whatsAppBackoffDelay(attemptsMade: number): number {
  const index = Math.min(Math.max(attemptsMade, 1) - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index] ?? 60_000;
}

export function notificationsQueue(connection: Redis): Queue {
  const existing = queues.get(connection);
  if (existing) {
    return existing;
  }
  const queue = new Queue(NOTIFICATIONS_QUEUE, { connection });
  queues.set(connection, queue);
  return queue;
}

export async function closeNotificationsQueue(connection: Redis): Promise<void> {
  const queue = queues.get(connection);
  if (!queue) {
    return;
  }
  queues.delete(connection);
  await queue.close();
}

export async function enqueueSendNotification(
  connection: Redis,
  notificationId: string,
  delayMs = 0,
): Promise<void> {
  const delay = Math.max(0, Math.floor(delayMs));
  try {
    await notificationsQueue(connection).add(
      SEND_NOTIFICATION_JOB,
      { notificationId },
      {
        jobId: delay > 0 ? `${notificationId}-due` : notificationId,
        delay: delay > 0 ? delay : undefined,
        attempts: 4,
        backoff: { type: "custom" },
        removeOnComplete: true,
        removeOnFail: 200,
      },
    );
  } catch (error) {
    if (error instanceof Error && /already exists/i.test(error.message)) {
      return;
    }
    throw error;
  }
}
