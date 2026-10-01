import argon2 from "argon2";
import { loadEnv, type AppEnv } from "@hep/config";
import { prisma } from "@hep/db";
import { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from "@hep/shared";
import { Redis } from "ioredis";
import { buildApp } from "../src/app.js";
import { MockWhatsAppProvider } from "../src/modules/whatsapp/provider.js";

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): AppEnv {
  const source: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PUBLIC_APP_URL: "http://localhost:3000",
    API_URL: "http://localhost:3001",
    API_PORT: "3001",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://turnos:turnos_dev@localhost:5432/turnos_dev",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    SESSION_SECRET: "test-session-secret-must-be-32-chars-min",
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    COOKIE_SECURE: "false",
    TRUST_PROXY: "false",
    WHATSAPP_PROVIDER: "mock",
    ALLOW_DEV_SEED: "false",
    LOGIN_MAX_ATTEMPTS: "5",
    LOGIN_LOCK_MINUTES: "15",
    OTP_TTL_SECONDS: "300",
    OTP_MAX_ATTEMPTS: "5",
    ...overrides,
  };
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
  return loadEnv(source);
}

export async function ensureRbac(): Promise<void> {
  for (const code of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, name: code },
      update: {},
    });
  }
  for (const code of ROLE_CODES) {
    const role = await prisma.role.upsert({
      where: { code },
      create: { code, name: code },
      update: {},
    });
    const permissions = await prisma.permission.findMany({
      where: { code: { in: ROLE_PERMISSIONS[code] } },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
      });
    }
  }
}

export async function resetAuthData(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.otpRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.mfaTotp.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.user.deleteMany();
}

export async function createUser(input: {
  email: string;
  password: string;
  role: (typeof ROLE_CODES)[number];
}) {
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, isActive: true },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: input.role } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

export async function startTestApp(envOverrides: Partial<NodeJS.ProcessEnv> = {}) {
  const env = testEnv(envOverrides);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  await redis.flushdb();
  const whatsapp = new MockWhatsAppProvider();
  const app = await buildApp({ env, prisma, redis, whatsapp });
  return { app, env, redis, whatsapp };
}

export function cookieFrom(response: { headers: Record<string, unknown> }, name: string): string | null {
  const raw = response.headers["set-cookie"];
  const parts = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const match = parts.find((item) => item.startsWith(`${name}=`));
  return match ?? null;
}
