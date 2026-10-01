# Fase 1 — Base, autenticación del personal y seguridad

Estado: **cerrada**. Tests de integración (20) y typecheck en verde contra Docker en esta PC. Fase 2: [PHASE2.md](PHASE2.md).

Requisitos de producto: [REQUIREMENTS.md](REQUIREMENTS.md) (prevalece).  
Fuera de esta fase: turnos, entidad `patients`, auth HTTP de pacientes, horarios, llamador, TV, lista de espera, WhatsApp oficial, Socket.IO, modelo ER completo.

## Qué está implementado

- Monorepo pnpm: `apps/web`, `apps/api`, `apps/worker`, `packages/config|db|shared`.
- Docker Compose: PostgreSQL 16 + Redis 7.
- Fastify API con Helmet, CORS explícito, cookies, logs Pino redactados, `/api/v1/health` y `/api/v1/ready`.
- Next.js: landing + login staff + enrolamiento/verificación MFA. Rewrite `/api/v1` → API.
- Worker BullMQ: heartbeat en Redis + cola `system` (sin jobs de negocio).
- Auth **staff**: email/password Argon2id, sesión opaca, cookie HttpOnly + SameSite, idle y absolute timeout, logout y logout-all (revocación).
- MFA TOTP obligatorio para `SUPER_ADMIN` y `ADMIN` antes de `/me` y rutas administrativas.
- RBAC en backend (`/api/v1/admin/security-probe` exige `users:manage`).
- Rate limiting de login/MFA en Redis (IP + email hmac). `TRUST_PROXY` default `false` (no se fía de `X-Forwarded-For` salvo configuración explícita).
- `OtpService` genérico: hash, TTL, un solo uso, invalidación del anterior, máximo de intentos. **Sin endpoints HTTP de pacientes.**
- `WhatsAppProvider` + `MockWhatsAppProvider`. `OfficialWhatsAppProvider` no está cableado a un vendor.
- Seed de roles/permisos/settings. Usuario admin ficticio **solo** development/test, DB local, `ALLOW_DEV_SEED=true`.
- CI GitHub Actions (install, migrate, seed, typecheck, test) con Postgres y Redis.

## Qué fue testeado (código)

| Área | Cómo | ¿Requiere Docker? |
| --- | --- | --- |
| Mock WhatsApp / idempotencia | Vitest | No |
| Política de seed (staging/prod/host remoto) | Vitest | No |
| Login, enumeración genérica, cookie, lockout | Vitest + inject | Sí (Postgres+Redis) |
| MFA TOTP + probe admin | Vitest + inject | Sí |
| RBAC recepción vs admin | Vitest + inject | Sí |
| Rate limit login + anti spoof `X-Forwarded-For` | Vitest + inject | Sí |
| Logout / sesión revocada | Vitest + inject | Sí |
| OTP genérico (hash, invalidación, un uso, intentos) | Vitest sobre `OtpService` | Sí |
| HTTP paciente OTP ausente (404) | Vitest + inject | Sí |
| Health/ready | Vitest + inject | Sí |

Typecheck del monorepo: verificado en la máquina de desarrollo.  
Tests de integración: **pendientes de que Docker Desktop esté instalado en esta PC**. CI los ejecutará en cada PR.

## Cómo verificar en esta PC

```bash
docker compose up -d postgres redis
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm test
pnpm typecheck
pnpm dev
```

Seed local (solo development, DB en localhost): `admin@hospital.local` / `DevAdmin1234!`. Es un usuario **ficticio**. Hay que enrolar MFA al primer ingreso.

## Usuario seed — aislamiento

`admin@hospital.local` no es una cuenta de hospital real.

Impedimentos técnicos:

1. `loadEnv` rechaza `ALLOW_DEV_SEED` en `staging` y `production`.
2. `assertDevSeedUserAllowed` vuelve a rechazar seed de usuarios si el entorno no es `development`/`test`, si `ALLOW_DEV_SEED` es false, o si el host de `DATABASE_URL` no es local (`localhost`, `127.0.0.1`, `::1`, `postgres`).
3. En `staging`/`production`, el login de `admin@hospital.local` (y del email de `SEED_ADMIN_EMAIL` si estuviera definido) se rechaza con el mismo error genérico que credenciales inválidas.

El seed de **roles y settings** sí puede correr en cualquier ambiente; el usuario admin ficticio no.

## Decisiones tomadas en Fase 1

- Socket.IO no se instaló (no hay llamador).
- OTP de negocio no usa BullMQ; el worker existe para heartbeat. Las notificaciones de turnos irán a cola en su fase.
- Redis caído: no hay fallback in-memory de rate limit (el intento de login falla; `/ready` no está listo). Es fail-closed, no fail-open.
- `trustProxy` apagado por defecto para que no se evada el rate limit con `X-Forwarded-For`.
- Columnas de `otp_requests`: `subject_hmac` y `destination_hmac` (genéricas). No modelan DNI/teléfono de paciente.

## Deliberadamente postergado a Fase 2+

- ERD completo y Prisma de turnos/pacientes/agenda/displays.
- Entidad `patients` e identidad definitiva del paciente.
- Endpoints HTTP de OTP / sesión de paciente.
- Elección del proveedor oficial de WhatsApp.
- Residencia de datos / AWS (requiere dictamen legal).
- Playwright E2E del login (esqueleto no bloqueante).
- PITR / RPO 15 min / RTO 4 h (producción administrada).

## Revisión de seguridad de Fase 1 (puntos pedidos)

| Punto | Estado |
| --- | --- |
| Secretos hardcodeados de producción | No. Placeholders de `.env.example` y password de seed son ficticios y de desarrollo. |
| Tokens/passwords reales en el repo | No. `.env` está en `.gitignore` (`!.env.example` permitido). |
| Seed aislado | Sí, ver sección anterior. |
| Cookies | `HttpOnly`, `Path=/`, `SameSite` (default Lax), `Secure` si `COOKIE_SECURE` (obligatorio en staging/production). Nombre `__Host-staff_session` cuando hay Secure. |
| Sesiones revocables | `revoked_at`; logout y logout-all. |
| Idle + absolute timeout | `SESSION_IDLE_HOURS` / `SESSION_ABSOLUTE_HOURS`; sliding idle sin pasar el absoluto. |
| MFA no evitable por otra ruta | `/me` y `/admin/security-probe` exigen `mfaSatisfied` para roles sensibles. Solo MFA enroll/verify y logout operan con sesión incompleta. |
| RBAC en backend | `requirePermission`; la UI no autoriza. |
| Rate limit no trivial por un header | Límite por IP real + hmac de email; `TRUST_PROXY=false` por defecto. |
| Logs | Pino redacta cookie, authorization, password, otp, code, token. |
| Enumeración de staff | Mismo mensaje `Credenciales inválidas.` si el email existe o no. |
| Errores | 500 genérico, sin stack al cliente. |

No es una auditoría completa (IDOR de turnos, WhatsApp, etc. no aplican todavía).

## Criterio para cerrar Fase 1

1. `pnpm test` en verde contra Docker (esta PC o CI).
2. `pnpm typecheck` en verde.
3. Confirmación de que el seed no corre en staging/producción.
4. No hay HTTP de auth de pacientes.

Cuando eso esté confirmado, se puede iniciar Fase 2 **empezando por el ERD/Prisma**, sin lógica de turnos todavía.
