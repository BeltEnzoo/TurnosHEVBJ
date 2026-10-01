import { Readable } from "node:stream";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { ZodError } from "zod";
import { ERROR_CODES } from "@hep/shared";
import type { AppEnv } from "@hep/config";
import type { PrismaClient } from "@hep/db";
import type { Redis } from "ioredis";
import { AppError } from "./lib/errors.js";
import { StaffAuthService } from "./modules/auth/staff-auth.js";
import { OtpService } from "./modules/otp/otp-service.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerPatientAuthRoutes } from "./modules/auth/patient-routes.js";
import { registerCatalogRoutes } from "./modules/catalogs/routes.js";
import { registerScheduleRoutes } from "./modules/schedules/routes.js";
import { registerAdminRoutes } from "./modules/admin/routes.js";
import { registerMedicoRoutes } from "./modules/medico/routes.js";
import { registerDisplayRoutes } from "./modules/displays/routes.js";
import { attachDisplayHub } from "./modules/displays/hub.js";
import { registerAppointmentRoutes } from "./modules/appointments/routes.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import { closeNotificationsQueue } from "./modules/whatsapp/queue.js";
import { registerWhatsAppRoutes } from "./modules/whatsapp/routes.js";
import { registerWaitlistRoutes } from "./modules/waitlist/routes.js";
import type { WhatsAppProvider } from "./modules/whatsapp/provider.js";
import "./types.js";

export type BuildAppInput = {
  env: AppEnv;
  prisma: PrismaClient;
  redis: Redis;
  whatsapp: WhatsAppProvider;
};

export async function buildApp(input: BuildAppInput) {
  const app = Fastify({
    logger: {
      level: input.env.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers[\"x-hub-signature-256\"]",
          "req.body.password",
          "req.body.code",
          "req.body.otp",
          "req.body.token",
          "req.body.dni",
          "req.body.phone",
          "req.body.patient.dni",
          "req.body.patient.phone",
          "req.body.patient.email",
          "req.body.familyName",
          "temporaryPassword",
          "password",
          "code",
          "otp",
          "token",
          "turnstileToken",
          "secret",
        ],
        censor: "[redacted]",
      },
    },
    genReqId: () => crypto.randomUUID(),
    trustProxy: input.env.TRUST_PROXY,
  });

  app.decorate("env", input.env);
  app.decorate("prisma", input.prisma);
  app.decorate("redis", input.redis);
  app.decorate("whatsapp", input.whatsapp);
  app.decorate("staffAuth", new StaffAuthService(input.prisma, input.env));
  app.decorate("otpService", new OtpService(input.prisma, input.env, input.whatsapp));

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: input.env.COOKIE_SECURE,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });

  await app.register(cors, {
    origin: [input.env.PUBLIC_APP_URL, ...input.env.CORS_ALLOWED_ORIGINS],
    credentials: true,
    maxAge: 600,
  });

  await app.register(cookie);

  app.addHook("preParsing", async (request, _reply, payload) => {
    const path = request.url.split("?")[0];
    if (path !== "/api/v1/webhooks/whatsapp") {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);
    request.rawBody = raw.toString("utf8");
    return Readable.from([raw]);
  });

  app.addHook("preHandler", async (request) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      return;
    }
    const path = request.url.split("?")[0];
    if (path === "/api/v1/webhooks/whatsapp") {
      return;
    }
    const origin = request.headers.origin;
    if (!origin) {
      return;
    }
    const allowed = new Set([input.env.PUBLIC_APP_URL, ...input.env.CORS_ALLOWED_ORIGINS]);
    if (!allowed.has(origin)) {
      throw new AppError(403, ERROR_CODES.ORIGIN_FORBIDDEN, "Origen no permitido.");
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: "Datos inválidos." },
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    request.log.error({ err: error });
    return reply.code(500).send({
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "Ha ocurrido un error. Intente nuevamente.",
      },
    });
  });

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerPatientAuthRoutes(app);
  await registerCatalogRoutes(app);
  await registerScheduleRoutes(app);
  await registerAppointmentRoutes(app);
  await registerAdminRoutes(app);
  await registerMedicoRoutes(app);
  await registerDisplayRoutes(app);
  await registerWhatsAppRoutes(app);
  await registerWaitlistRoutes(app);
  const hub = attachDisplayHub(app.server, input.prisma, [
    input.env.PUBLIC_APP_URL,
    ...input.env.CORS_ALLOWED_ORIGINS,
  ]);
  app.decorate("displays", hub);
  app.addHook("onClose", async () => {
    await closeNotificationsQueue(input.redis);
    await hub.close();
  });
  return app;
}
