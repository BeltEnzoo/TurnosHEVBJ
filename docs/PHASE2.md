# Fase 2 — Schema Prisma, migraciones y seed ficticio

Estado: **cerrada**. Migración `20260928140000_phase2_schema`, seed ficticio y test de constraints en verde. Fase 3: [PHASE3.md](PHASE3.md).

Fuera de esta fase: ABM HTTP de catálogos (Fase 3), generación de horarios (Fase 4), motor de reservas (Fase 5), auth HTTP de pacientes (Fase 6), TV, llamador y WhatsApp oficial.

El modelo lógico de partida es [DATABASE.md](DATABASE.md).

## Qué entra

- Tablas de pacientes, organización, agenda, cupos, turnos, espera, notificaciones y sus relaciones.
- `otp_requests.patient_id` y `sessions.patient_id` opcionales. El OTP puede emitirse antes de que exista la fila del paciente; el vínculo se completa cuando la identidad ya está creada. No hay endpoints HTTP de pacientes.
- Seed de desarrollo: 4 especialidades, 6 profesionales, 4 consultorios, 2 pantallas, un feriado de ejemplo y dos pacientes ficticios que comparten teléfono (un teléfono familiar, dos DNI). Sigue detrás de `ALLOW_DEV_SEED` y base local.

## Decisiones de integridad

- Un DNI, un paciente: `dni` y `dni_hmac` únicos. El teléfono no es único.
- PII guardada y por qué: nombre, DNI, fecha de nacimiento y teléfono (hace falta para identificar y para WhatsApp). Email opcional. No hay diagnóstico, obra social ni notas clínicas. `notes_internal` no existe en v1.
- DNI en claro en v1, con `dni_hmac` para búsqueda. El cifrado de campo queda para Fase 17.
- Un cupo regular activo por `(professional_id, starts_at)`. Un extra puede compartir ese instante (`slot_kind`). Reabrir un horario es cambiar el estado del mismo cupo, no insertar otro regular.
- `appointments.slot_id` no es único global: un turno cancelado deja historia y el cupo puede reservarse de nuevo. La migración instala un trigger que copia `slot_id` a `active_slot_key` solo en `CONFIRMED`, `CALLED` e `IN_PROGRESS`. Esa columna es única. Los estados terminales la dejan en null.
- Código público `XX-XXX` sin caracteres ambiguos, único, con check en la base.
- Auditoría: `audit_logs` sigue append-only, como en Fase 1. No hay rol de base separado en el entorno de desarrollo.

## Qué no hace esta fase

No hay servicios de reserva, ni generación de cupos, ni pantallas nuevas, ni OTP de pacientes por HTTP.
