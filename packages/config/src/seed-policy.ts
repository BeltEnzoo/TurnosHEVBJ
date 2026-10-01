export const DEV_SEED_EMAIL = "admin@hospital.local";

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

export function databaseHostname(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isLocalDatabaseHost(databaseUrl: string): boolean {
  return LOCAL_DB_HOSTS.has(databaseHostname(databaseUrl));
}

export function assertDevSeedUserAllowed(env: {
  NODE_ENV: string;
  ALLOW_DEV_SEED: boolean;
  DATABASE_URL: string;
}): void {
  if (env.NODE_ENV === "production" || env.NODE_ENV === "staging") {
    throw new Error("Dev seed users are forbidden in staging and production.");
  }
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new Error("Dev seed users are only allowed in development or test.");
  }
  if (!env.ALLOW_DEV_SEED) {
    throw new Error("ALLOW_DEV_SEED is not enabled.");
  }
  if (!isLocalDatabaseHost(env.DATABASE_URL)) {
    throw new Error(
      `Dev seed refused: database host '${databaseHostname(env.DATABASE_URL)}' is not a local development host.`,
    );
  }
}

export function isDevSeedLoginForbidden(
  email: string,
  nodeEnv: string,
  seedEmail?: string,
): boolean {
  if (nodeEnv !== "production" && nodeEnv !== "staging") {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  if (normalized === DEV_SEED_EMAIL) {
    return true;
  }
  return Boolean(seedEmail && normalized === seedEmail.trim().toLowerCase());
}
