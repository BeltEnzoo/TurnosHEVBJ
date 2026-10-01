import { z } from "zod";

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  APP_NAME: z.string().default("Sistema de Turnos"),
  HOSPITAL_NAME: z.string().default("Hospital Municipal"),
  PUBLIC_APP_URL: z.string().url(),
  API_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(3001),
  TZ: z.string().default("America/Argentina/Buenos_Aires"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().min(32),
  COOKIE_SECURE: booleanFromEnv.default(false),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  TURNSTILE_SITE_KEY: z.string().optional().default(""),
  TURNSTILE_SECRET_KEY: z.string().optional().default(""),
  WHATSAPP_PROVIDER: z.enum(["mock", "official"]).default("mock"),
  WHATSAPP_WEBHOOK_SECRET: z.string().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ALLOWED_ORIGINS: csv,
  ALLOW_DEV_SEED: booleanFromEnv.default(false),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(10).optional(),
  SEED_ADMISION_EMAIL: z.string().email().optional(),
  SEED_ADMISION_PASSWORD: z.string().min(10).optional(),
  SEED_SISTEMAS_EMAIL: z.string().email().optional(),
  SEED_SISTEMAS_PASSWORD: z.string().min(10).optional(),
  SEED_ADMINISTRACION_EMAIL: z.string().email().optional(),
  SEED_ADMINISTRACION_PASSWORD: z.string().min(10).optional(),
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(8),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().positive().default(12),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  TRUST_PROXY: booleanFromEnv.default(false),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(details)}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" || env.NODE_ENV === "staging") {
    if (env.WHATSAPP_PROVIDER === "mock" && env.NODE_ENV === "production") {
      throw new Error("WHATSAPP_PROVIDER=mock is not allowed in production");
    }
    if (env.WHATSAPP_PROVIDER === "official" && env.WHATSAPP_WEBHOOK_SECRET.length < 16) {
      throw new Error("WHATSAPP_WEBHOOK_SECRET is required when the official provider is enabled");
    }
    if (!env.COOKIE_SECURE) {
      throw new Error("COOKIE_SECURE must be true in staging/production");
    }
    if (env.TURNSTILE_SECRET_KEY.length === 0) {
      throw new Error("TURNSTILE_SECRET_KEY is required in staging/production");
    }
    if (env.ALLOW_DEV_SEED) {
      throw new Error("ALLOW_DEV_SEED is not allowed in staging/production");
    }
  }
  if (env.ALLOW_DEV_SEED && env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new Error("ALLOW_DEV_SEED is only allowed in development or test");
  }
  return env;
}

export {
  DEV_SEED_EMAIL,
  assertDevSeedUserAllowed,
  databaseHostname,
  isDevSeedLoginForbidden,
  isLocalDatabaseHost,
} from "./seed-policy.js";
