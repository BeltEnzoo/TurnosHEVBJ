# Seguridad y privacidad

La seguridad se implementa en backend, red y datos. Ocultar un botón no es un control.

**Aviso:** este documento describe controles técnicos. No certifica cumplimiento de la Ley 25.326 ni de normativa sanitaria. Toda retención, transferencia internacional, consentimiento y encargados de tratamiento deben validarse con el responsable legal/compliance del hospital.

## 1. Activos a proteger

- Identidad de pacientes (nombre, DNI, nacimiento, teléfono, email)
- Agenda y asistencia (quién se atendió, ausencias)
- Cuentas del personal y sesiones
- Tokens de TV y de WhatsApp
- Auditoría (evidencia)

No es un activo de este sistema la historia clínica: **no se carga**.

## 2. Principios

Security by design, privacy by design, least privilege, defense in depth, minimización, separación de ambientes, validación de servidor, transacciones para operaciones críticas.

## 3. Autenticación

### Personal

- Identificador: email corporativo (no se reutilizan cuentas).
- Secretos: Argon2id, pepper opcional en secret manager.
- Sesión opaca aleatoria, hash en `sessions`, cookie `HttpOnly` + `Secure` + `SameSite=Lax`.
- Idle timeout y absolute timeout configurables (propuesta: 8 h idle staff clínico, 4 h admin; absolute 12 h).
- Ingreso del personal: correo y contraseña. El código TOTP no se pide al iniciar sesión (decisión del hospital, 2026-09-30; ADR-006 queda en pausa para el uso diario).
- Lockout progresivo tras N fallos + rate limit por IP y por cuenta.
- Reset de credenciales: flujo staff autenticado por admin o email de recuperación con token de un uso (si hay email). Forzar logout = borrar sesiones.
- Al cambiar privilegios: invalidar sesiones o re-evaluar RBAC en cada request (se re-evalúa siempre; además se pueden revocar).

### Pacientes

Ver ADR-007. OTP de 6 dígitos, hash, TTL 5 minutos, 5 intentos, un OTP activo por destino. No se registra el código en logs ni audit metadata.

### Displays

Token de 32+ bytes, mostrado una vez al emitir, almacenado como hash. Rotación y revocación por admin. Compromiso de TV = revocar, no “cambiar la clave del hospital”.

## 4. Autorización (RBAC + BOLA)

Cada ruta declara permisos. Cada recurso verifica ownership o alcance.

Ejemplos obligatorios de tests:

- Médico A no GET/PATCH turno de médico B → 404 o 403 (preferir 404 para no enumerar).
- Paciente OTP de DNI X no lista turnos de DNI Y.
- Display no tiene rutas `/patients`.
- Recepción no cambia `system_settings` críticos.
- Export CSV requiere permiso `reports:export` y deja audit.

Tabla de permisos v1 (no exhaustiva, estable):

| Permiso | SUPER_ADMIN | ADMINISTRACION | SISTEMAS | ADMIN | SUPERVISOR | RECEPCION | MEDICO | DISPLAY |
| --- | --- | --- | --- | --- | --- | --- |
| settings:write | sí | no | sí | no | no | no | no | no |
| users:manage | sí | no | sí | limitado | no | no | no | no |
| catalogs:write | sí | sí | no | sí | no | no | no | no |
| schedules:write | sí | sí | no | sí | sí | no | no | no |
| appointments:write | sí | no | no | sí | sí | sí | no | no |
| appointments:call:own | sí | no | no | sí | sí | no | sí | no |
| patients:read | sí | no | no | sí | sí | sí | own-day | no |
| reports:read | sí | sí | no | sí | sí | sí | no | no |
| reports:export | sí | no | no | sí | no | no | no | no |
| displays:manage | sí | no | sí | sí | no | no | no | no |
| calls:subscribe:assigned | no | no | no | no | no | no | no | sí |

`patients:read` del médico: solo pacientes de sus turnos del rango consultado, no buscador general de DNI.

## 5. Protección de datos

### En tránsito

TLS 1.2+ terminado en Cloudflare/ALB. HTTP→HTTPS. HSTS en producción. DB y Redis solo en red privada, TLS al motor si el proveedor lo ofrece.

### En reposo

Cifrado de volumen RDS. Backups cifrados.  
Cifrado a nivel de campo (DNI, teléfono, email) con AES-GCM + índice ciego HMAC para búsqueda de DNI: **diseñado para Fase 17**, no bloquea el schema de Fase 2. v1: minimización + acceso + audit + cifrado de disco. Flag legal si exigen field-level desde el día uno.

### Minimización por UI

| UI | Puede ver |
| --- | --- |
| TV | código, consultorio, nombre de hospital |
| Paciente | sus turnos, código, especialidad, profesional, fecha/hora |
| Médico | identidad del paciente de su turno |
| Recepción | identidad + contacto para gestionar |
| WhatsApp | fecha, hora, especialidad, profesional, código. Sin DNI |

### Logs

Estructurados JSON. Masking: DNI `********42`, teléfono `******1234`. Nunca passwords, OTP, tokens, Authorization, cookies. PII no se manda a Sentry/Datadog sin DPA y filtro.

## 6. Validación y abuso

- Zod en todas las entradas (params, query, body, webhooks).
- DNI: dígitos, longitud 7–8, checksum si se adopta (documentar false negatives).
- Teléfono: E.164, default país AR (`+54`).
- Rate limit (Redis): login, OTP, reserva, webhooks, búsqueda.
- Turnstile en OTP y confirmación pública; no en cada navegación.
- Idempotency-Key en webhooks y en creación de notificaciones.

## 7. OWASP — controles mapeados

| Riesgo | Control |
| --- | --- |
| Broken access control | RBAC + BOLA tests |
| Cryptographic failures | TLS, Argon2id, no secretos en Git |
| Injection | Prisma, cero concatenación SQL |
| Insecure design | estados explícitos, locks |
| Security misconfiguration | headers, CORS explícito, hardening checklist |
| Vulnerable components | npm audit, Renovate |
| Auth failures | lockout, MFA, sesiones revocables |
| Integrity failures | migraciones, no prod manual |
| Logging failures | audit + no PII en logs |
| SSRF | webhooks no fetchan URLs de usuario |

## 8. Headers (producción)

Propuesta inicial (ajustar CSP al hallar assets reales):

- `Content-Security-Policy`: default-src 'self'; script-src 'self'; connect-src 'self' wss://<dominio>; frame-ancestors 'none'; base-uri 'self'; form-action 'self'. Turnstile requerirá dominios Cloudflare en script/frame.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`: geolocation=(), camera=(), microphone=() (salvo que TTS nativo no lo necesite; no pedir mic)
- `Strict-Transport-Security`: max-age=15552000; includeSubDomains
- `X-Frame-Options: DENY` (backup de frame-ancestors)

No `dangerouslySetInnerHTML` en React. Textos de templates escapados.

## 9. CSRF y CORS

Same-origin via reverse proxy: el browser habla solo con `https://turnos.<dominio>`.  
CORS default deny. Si un día hay app móvil nativa, se diseña auth aparte, no se abre `*`.

Mutaciones: método seguro + SameSite + match de Origin.

## 10. Webhooks

`POST /api/v1/webhooks/whatsapp`: raw body para HMAC, `X-Hub-Signature-256` (o el del BSP), timestamp de tolerancia, idempotency por `provider_event_id`. No ejecutar acciones de negocio si la firma falla (401/403). Rate limit. No filtrar secretos en errores.

## 11. Secretos

`.env` local gitignored. Producción: AWS Secrets Manager o equivalentes del host. Rotación de `SESSION_SECRET` invalida sesiones (documentar). Nunca secretos en `NEXT_PUBLIC_*` salvo Turnstile site key.

## 12. Infraestructura

Ver [DEPLOYMENT.md](DEPLOYMENT.md). SSH por llave, sin password, sin usuario `root` para la app, security groups, DB no internet, parches controlados.

## 13. Retención (propuesta a validar legalmente)

| Dato | Propuesta |
| --- | --- |
| Paciente sin turnos futuros y último turno > 5 años | anonimizar o eliminar según instrucción del hospital |
| Turnos | 5 años (estadística + reclamos) |
| Audit | 24 meses |
| Notificaciones/WhatsApp meta | 12 meses |
| Logs de aplicación | 30–90 días |
| OTP rows | borrar al expirar / 24 h máx |
| Sesiones | al vencer |

El hospital debe firmar esta tabla. No borrar evidencia si hay proceso legal abierto: excepción documentada.

## 14. Consentimiento y terceros

WhatsApp/Meta es encargado/subencargado. Hay que informar al paciente que el comprobante sale por WhatsApp (tercero). Configurar: si el paciente no consiente WhatsApp, el turno puede crearse igual en recepción y no se encola mensaje.

Cloudflare ve IP. AWS ve datos en São Paulo si se confirma esa región. Todo esto va a evaluación legal.

## 15. Checklist previo a producción

Ver [DEPLOYMENT.md](DEPLOYMENT.md) sección checklist. Incluye IDOR, race de reserva, webhook spoofing, enumeración, MFA, backups restaurados, secretos, HTTPS, DB privada, rate limit, logs sin PII.
