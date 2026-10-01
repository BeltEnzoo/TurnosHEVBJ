# Requisitos del proyecto (normativos)

Estado: **aprobados**. No son sugerencias. Si un cambio de implementación los contradice, hay que detenerse y documentar la alternativa.

Este archivo prevalece sobre comentarios en código. La arquitectura de [ARCHITECTURE.md](ARCHITECTURE.md) queda aprobada con estas condiciones.

## Arquitectura

- Monolito modular.
- Next.js para interfaces.
- Fastify para API, backend y WebSocket (Socket.IO se agrega en la fase del llamador; el proceso API es el mismo).
- PostgreSQL + Prisma: fuente de verdad.
- Redis + BullMQ: trabajos en segundo plano.
- Socket.IO: llamado en tiempo real (no en Fase 1).
- Prohibido salvo necesidad técnica real, documentada y aprobada: microservicios, Kubernetes, Kafka, event sourcing.
- Prohibido: WhatsApp Web automatizado.

## Datos y privacidad

- Los datos de pacientes son personales. Seguridad y privacidad son requisitos críticos.
- Minimizar almacenamiento y exposición.
- No almacenar información clínica innecesaria para turnos. Esto no es historia clínica.
- TV: nunca nombre completo, DNI, teléfono, fecha de nacimiento ni información médica.
- Identificación en sala de espera: códigos de turno opacos/aleatorios.
- Ubicación de producción: definir según normativa argentina. Infraestructura fuera de Argentina requiere justificación y medidas documentadas **antes** de usarla.

## Autenticación y seguridad — personal interno

Cuentas individuales. RBAC real en backend. El personal entra con correo y contraseña; el código de 6 dígitos no se pide en cada inicio de sesión. Puestos: Admisión, Sistemas, Administración y Superusuario. Sesiones seguras, revocables, con expiración. Cookies `HttpOnly` / `Secure` (producción) / `SameSite`. No guardar tokens sensibles en `localStorage`. Rate limiting, anti brute-force, validación estricta, IDOR/BOLA, CORS explícito, CSRF cuando corresponda, headers de seguridad, secretos fuera del código. Logs sin passwords, tokens, OTP, API keys ni PII innecesaria.

## Autenticación — pacientes

Requisito de **producto** (no de la Fase 1): DNI + OTP por WhatsApp. OTP de corta duración, un solo uso, invalidación del OTP anterior al emitir uno nuevo, límite de intentos, rate limiting, anti-enumeración, anti-abuso, Turnstile (o equivalente) cuando corresponda. OTP nunca en texto plano.

**Fase 1:** no hay autenticación de pacientes ni endpoints HTTP de OTP. Existe un `OtpService` genérico (hash, TTL, un uso, invalidación, intentos) reutilizable. El modelo `patients`, la identidad del paciente y su relación con OTP se definen en Fase 2.

## Alcance por fase

Este archivo es la fuente de verdad del producto. Lo que aún no está en la fase actual no se considera implementado.

- Fase 1: base del repo, auth del personal, RBAC, MFA, sesiones, rate limit, observabilidad mínima, OTP genérico **sin** auth de pacientes.
- Fase 2+: modelo ER completo, `patients`, turnos y el resto según el plan de fases.

## WhatsApp

Abstracción `WhatsAppProvider`. Implementaciones: `MockWhatsAppProvider` (dev/test) y más adelante `OfficialWhatsAppProvider`. El dominio no depende del proveedor concreto. No elegir proveedor oficial hasta comparar costos, API, políticas y requisitos legales.

Mensajes mínimos: confirmación, recordatorio, cancelación, reprogramación, lista de espera. Idempotencia. Webhooks: autenticidad, payload, idempotencia, anti-abuso.

## Turnos (fases posteriores)

`appointment_slots` y `appointments` separados. `AVAILABLE` es del slot. Doble reserva impedida por PostgreSQL (transacciones, locks, UNIQUE) más tests de concurrencia. Estados controlados. Reprogramar conserva historial. Sobreturnos identificados y auditados. Políticas de cancelación, horizonte, recordatorios y reprogramación: configurables, no hardcodeadas.

## Médicos y llamador (fases posteriores)

Llamar: auth → autorización → ownership → estado → persistir evento → auditoría → WebSocket → TV → TTS. TV offline no anula el registro. Médico solo sus turnos salvo permiso explícito.

## TV (fases posteriores)

Device token propio, alta/asignación/revocación/rotación, `last_seen_at`, online/offline, datos mínimos, reconexión, cola TTS, adapter de voz intercambiable.

## Base de datos

Modelo ER revisable antes de lógica de negocio de turnos. Atención a PK, índices, FK, UNIQUE, integridad, soft-delete de catálogos, timestamps, timezone `America/Argentina/Buenos_Aires`, historial de estados, auditoría.

## Auditoría, backups, testing, entornos, observabilidad

Según el requerimiento aprobado. RPO 15 min / RTO 4 h en **producción** (PITR gestionado). Development local no cumple PITR y no debe fingirlo.

## Fases

Trabajar **una fase a la vez**. No avanzar automáticamente. Software actual: ver [PHASE17.md](PHASE17.md). Staging y producción: ver [PHASE18.md](PHASE18.md).
