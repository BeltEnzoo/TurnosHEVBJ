import { config } from "dotenv";
import { resolve } from "node:path";
import { loadEnv } from "@hep/config";
import { prisma } from "@hep/db";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { createWhatsAppProvider } from "./modules/whatsapp/provider.js";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const env = loadEnv();
process.env.TZ = env.TZ;

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const whatsapp = createWhatsAppProvider(env.WHATSAPP_PROVIDER);

const app = await buildApp({ env, prisma, redis, whatsapp });

try {
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
