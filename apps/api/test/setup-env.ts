process.env.NODE_ENV ??= "test";
process.env.PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.API_URL ??= "http://localhost:3001";
process.env.DATABASE_URL ??=
  "postgresql://turnos:turnos_dev@localhost:5432/turnos_dev";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??= "test-session-secret-must-be-32-chars-min";
process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.COOKIE_SECURE ??= "false";
process.env.WHATSAPP_PROVIDER ??= "mock";
process.env.TZ ??= "America/Argentina/Buenos_Aires";
