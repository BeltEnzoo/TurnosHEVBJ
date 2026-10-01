import type { FastifyInstance } from "fastify";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { applyWhatsAppWebhook } from "./webhook.js";

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function registerWhatsAppRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/webhooks/whatsapp", { bodyLimit: 8192 }, async (request) => {
    await consumeRateLimit(app.redis, `rl:wa:hook:${request.ip}`, 60, 60);
    return applyWhatsAppWebhook({
      db: app.prisma,
      redis: app.redis,
      secret: app.env.WHATSAPP_WEBHOOK_SECRET,
      rawBody: request.rawBody ?? "",
      signature: headerValue(request.headers["x-hub-signature-256"]),
      timestamp: headerValue(request.headers["x-webhook-timestamp"]),
    });
  });
}
