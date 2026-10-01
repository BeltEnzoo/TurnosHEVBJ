import type { AppEnv } from "@hep/config";
import type { PrismaClient } from "@hep/db";
import type { Redis } from "ioredis";
import type { OtpService } from "./modules/otp/otp-service.js";
import type { StaffAuthService } from "./modules/auth/staff-auth.js";
import type { WhatsAppProvider } from "./modules/whatsapp/provider.js";
import type { DisplayHub } from "./modules/displays/hub.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }

  interface FastifyInstance {
    env: AppEnv;
    prisma: PrismaClient;
    redis: Redis;
    staffAuth: StaffAuthService;
    otpService: OtpService;
    whatsapp: WhatsAppProvider;
    displays: DisplayHub;
  }
}

export {};
