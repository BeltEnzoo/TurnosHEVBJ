import type { Redis } from "ioredis";
import { ERROR_CODES } from "@hep/shared";
import { AppError } from "./errors.js";

export async function consumeRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  if (count > limit) {
    throw new AppError(
      429,
      ERROR_CODES.RATE_LIMITED,
      "Demasiados intentos. Espere unos minutos e intente nuevamente.",
    );
  }
}
