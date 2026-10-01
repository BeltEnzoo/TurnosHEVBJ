import type { FastifyReply } from "fastify";
import type { AppEnv } from "@hep/config";

export function staffCookieName(env: AppEnv): string {
  return env.COOKIE_SECURE ? "__Host-staff_session" : "staff_session";
}

export function patientCookieName(env: AppEnv): string {
  return env.COOKIE_SECURE ? "__Host-patient_session" : "patient_session";
}

export function setSessionCookie(
  reply: FastifyReply,
  env: AppEnv,
  name: string,
  token: string,
  maxAgeSeconds: number,
): void {
  reply.setCookie(name, token, {
    path: "/",
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply, env: AppEnv, name: string): void {
  reply.clearCookie(name, {
    path: "/",
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
  });
}
