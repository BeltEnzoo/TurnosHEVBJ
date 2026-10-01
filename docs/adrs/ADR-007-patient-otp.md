# ADR-007 — Identificación de pacientes sin contraseña

- Estado: propuesto
- Fecha: 2026-09-15

## Contexto

El público incluye personas mayores. Una cuenta con email y password genera abandono y soporte. Al mismo tiempo hay riesgo de enumeración, bots y suplantación.

## Decisión

No hay password de paciente en v1. Para reservar o consultar: DNI + número de teléfono + Cloudflare Turnstile + OTP de un solo uso enviado por WhatsApp al número declarado. OTP guardado como hash, TTL corto, intentos limitados. Rate limit por IP, DNI y teléfono.

El paciente queda vinculado a `patients.phone_verified_at`. Cambiar el teléfono requiere recepción (auditado). Magic link por email queda fuera: el email es opcional.

## Alternativas

- Cuenta tradicional: más control, peor adopción.
- Solo DNI: enumerable y suplantable.
- Mi Argentina / AFIP: integración pesada y fuera de alcance v1; se deja nota de futuro.

## Consecuencias

- Un teléfono familiar puede usarse para turnos de varios DNI. Mitigar con tope de turnos activos por DNI y por teléfono.
- Sin WhatsApp, el canal es recepción.
