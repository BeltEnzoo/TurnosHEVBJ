import type { AppEnv } from "@hep/config";
import { ERROR_CODES } from "@hep/shared";
import { AppError } from "./errors.js";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function assertTurnstile(env: AppEnv, token: string | undefined, ip: string): Promise<void> {
  if (!token) {
    throw new AppError(400, ERROR_CODES.TURNSTILE_REQUIRED, "Confirmá que no sos un robot.");
  }
  if (env.TURNSTILE_SECRET_KEY.length === 0) {
    if (env.NODE_ENV === "production" || env.NODE_ENV === "staging") {
      throw new AppError(400, ERROR_CODES.TURNSTILE_REQUIRED, "Confirmá que no sos un robot.");
    }
    if (token !== "test-turnstile") {
      throw new AppError(400, ERROR_CODES.TURNSTILE_REQUIRED, "Confirmá que no sos un robot.");
    }
    return;
  }
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
    remoteip: ip,
  });
  const response = await fetch(SITEVERIFY, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new AppError(400, ERROR_CODES.TURNSTILE_REQUIRED, "Confirmá que no sos un robot.");
  }
  const payload = (await response.json()) as { success?: boolean };
  if (!payload.success) {
    throw new AppError(400, ERROR_CODES.TURNSTILE_REQUIRED, "Confirmá que no sos un robot.");
  }
}
