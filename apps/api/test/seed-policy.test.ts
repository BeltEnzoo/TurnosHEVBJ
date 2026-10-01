import { describe, expect, it } from "vitest";
import {
  assertDevSeedUserAllowed,
  isDevSeedLoginForbidden,
  isLocalDatabaseHost,
  loadEnv,
} from "@hep/config";

describe("dev seed policy", () => {
  const localEnv = {
    NODE_ENV: "development",
    ALLOW_DEV_SEED: true,
    DATABASE_URL: "postgresql://turnos:turnos_dev@localhost:5432/turnos_dev",
  };

  it("allows a local development seed", () => {
    expect(() => assertDevSeedUserAllowed(localEnv)).not.toThrow();
    expect(isLocalDatabaseHost(localEnv.DATABASE_URL)).toBe(true);
  });

  it("forbids seed users in staging and production", () => {
    expect(() =>
      assertDevSeedUserAllowed({ ...localEnv, NODE_ENV: "production" }),
    ).toThrow(/forbidden/);
    expect(() =>
      assertDevSeedUserAllowed({ ...localEnv, NODE_ENV: "staging" }),
    ).toThrow(/forbidden/);
  });

  it("forbids seed against a remote database even in development", () => {
    expect(() =>
      assertDevSeedUserAllowed({
        ...localEnv,
        DATABASE_URL: "postgresql://turnos:secret@db.example.com:5432/turnos",
      }),
    ).toThrow(/not a local/);
  });

  it("blocks the development admin email from logging in on staging/production", () => {
    expect(isDevSeedLoginForbidden("admin@hospital.local", "production")).toBe(true);
    expect(isDevSeedLoginForbidden("admin@hospital.local", "staging")).toBe(true);
    expect(isDevSeedLoginForbidden("admin@hospital.local", "development")).toBe(false);
    expect(isDevSeedLoginForbidden("otro@hospital.local", "production")).toBe(false);
  });

  it("rejects ALLOW_DEV_SEED when NODE_ENV is production", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        PUBLIC_APP_URL: "https://turnos.example.gob.ar",
        API_URL: "https://turnos.example.gob.ar",
        DATABASE_URL: "postgresql://app:secret@db.internal:5432/turnos",
        REDIS_URL: "redis://redis.internal:6379",
        SESSION_SECRET: "production-session-secret-must-be-32-chars",
        FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
        COOKIE_SECURE: "true",
        TURNSTILE_SECRET_KEY: "turnstile-secret",
        WHATSAPP_PROVIDER: "official",
        WHATSAPP_WEBHOOK_SECRET: "production-webhook-secret",
        ALLOW_DEV_SEED: "true",
      }),
    ).toThrow(/ALLOW_DEV_SEED/);
  });

  it("requires a webhook secret when the official provider is enabled", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        PUBLIC_APP_URL: "https://turnos.example.gob.ar",
        API_URL: "https://turnos.example.gob.ar",
        DATABASE_URL: "postgresql://app:secret@db.internal:5432/turnos",
        REDIS_URL: "redis://redis.internal:6379",
        SESSION_SECRET: "production-session-secret-must-be-32-chars",
        FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
        COOKIE_SECURE: "true",
        TURNSTILE_SECRET_KEY: "turnstile-secret",
        WHATSAPP_PROVIDER: "official",
        ALLOW_DEV_SEED: "false",
      }),
    ).toThrow(/WHATSAPP_WEBHOOK_SECRET/);
  });
});
