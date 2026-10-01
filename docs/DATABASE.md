# Modelo de datos

PostgreSQL 16+. Prisma. UUIDs (`uuid`) como PK salvo donde se indique. `created_at`/`updated_at` en tablas mutables. Soft-delete (`deactivated_at`) en catálogos; no borrar profesionales con historia.

Zona horaria de negocio: `America/Argentina/Buenos_Aires`. Instante: `timestamptz`.

## ERD lógico

```text
roles 1---* role_permissions *---1 permissions
users *---* roles (user_roles)
users 1---* sessions
users 1---* mfa_totp (0..1)

patients 1---* appointments
patients 1---* otp_requests
patients 1---* waitlist_entries

specialties 1---* professional_specialties *---1 professionals
professionals 1---1 users (cuenta staff opcionalmente vinculada)
professionals *---* offices (professional_offices)

offices 1---* display_offices *---1 displays
offices 1---* weekly_schedules
professionals 1---* weekly_schedules
specialties 1---* weekly_schedules

weekly_schedules 1---* appointment_slots
schedule_exceptions, holidays, office_blocks → afectan generación

appointment_slots 1---0..1 appointments
appointments 1---* appointment_status_history
appointments 1---* appointment_calls
appointments 1---0..1 appointments (rescheduled_from_id)

appointments 1---* notifications 1---* notification_deliveries
notification_templates

waitlist_entries 1---* waitlist_offers

audit_logs (append-only)
system_settings
```

## Catálogo de tablas

### Identidad y acceso

**users** — personal. `email` unique, `password_hash`, `is_active`, `failed_login_count`, `locked_until`, `last_login_at`. Sin PII de pacientes.

**roles**, **permissions**, **user_roles**, **role_permissions**

**sessions** — `id`, `user_id`, `token_hash`, `expires_at`, `ip_hash`, `user_agent_hash`, `revoked_at`. IP completa opcional según política legal; preferir hash o truncado.

**mfa_totp** — `user_id` unique, `secret_encrypted`, `confirmed_at`, `recovery_codes_hashes[]`.

**otp_requests** — `purpose`, `subject_hmac`, `destination_hmac`, `code_hash`, `expires_at`, `attempts`, `max_attempts`, `consumed_at`, `invalidated_at`, `ip_hash`, `patient_id` nullable. El OTP puede existir antes de la fila `patients`; cuando la identidad ya está creada, `patient_id` la vincula. No reemplaza a `subject_hmac`.

### Pacientes

**patients**

- `id` UUID
- `given_name`, `family_name`
- `dni` (v1 en claro con acceso restringido; v1.1 índice ciego)
- `dni_hmac` unique (para lookup)
- `birth_date` date
- `phone_e164`
- `phone_verified_at`
- `email` nullable
- `whatsapp_opt_in` bool default true (el alta implica aviso de canal)
- **No** campos de diagnóstico, obra social no requerida v1, no adjuntos

Índice: `dni_hmac`, `phone_e164` (o hmac).

### Organización

**specialties** — `name`, `slug`, `default_slot_minutes`, `sort_order`, `deactivated_at`

**professionals** — `user_id` unique nullable hasta que se crea la cuenta, `given_name`, `family_name`, `license_number` nullable, `deactivated_at`

**professional_specialties** — unique (professional_id, specialty_id)

**offices** — `name` (“Consultorio 3”), `code`, `location_label`, `deactivated_at`

**professional_offices** — asignación; el horario concreto está en weekly_schedules

**displays** — `name`, `location`, `status` (ONLINE/OFFLINE/MAINTENANCE), `token_hash`, `voice_enabled`, `voice_locale`, `voice_rate`, `volume`, `repeat_count`, `display_duration_ms`, `last_seen_at`, `deactivated_at`

**display_offices** — unique (display_id, office_id)

### Agenda

**weekly_schedules** — `professional_id`, `specialty_id`, `office_id`, `weekday` (0–6, lunes=1 documentado), `start_time`, `end_time` (time without tz, interpretados en TZ del hospital), `slot_minutes`, `valid_from`, `valid_to`, `deactivated_at`

**schedule_exceptions** — día puntual: no atiende, o horario excepcional (start/end). `reason` corto no clínico.

**holidays** — fecha, nombre, `applies_to` ALL|OFFICE|PROFESSIONAL

**schedule_blocks** — bloqueos de intervalo (`starts_at`, `ends_at`) por profesional u oficina

### Cupos y turnos

**appointment_slots**

- `id` UUID
- `professional_id`, `specialty_id`, `office_id`
- `starts_at` timestamptz, `ends_at`
- `status`: AVAILABLE | HELD | BOOKED | BLOCKED | CANCELLED_SLOT
- `slot_kind`: REGULAR | EXTRA
- `hold_expires_at` nullable
- `source_schedule_id` nullable

Constraints:

```sql
UNIQUE (professional_id, starts_at, slot_kind)
```

Un `REGULAR` y un `EXTRA` pueden compartir el mismo inicio. Un segundo regular en ese instante no. Reabrir el horario cambia el estado de la misma fila.

**appointments**

- `id` UUID
- `public_code` unique (texto, formato ADR-005)
- `slot_id` (histórico; no único: un cupo puede tener un turno cancelado y otro activo)
- `active_slot_key` unique, mantenida por trigger: vale `slot_id` solo en `CONFIRMED` | `CALLED` | `IN_PROGRESS`
- `patient_id`
- `status` (ver máquina de estados)
- `kind` REGULAR | EXTRA
- `created_by_type` PATIENT | STAFF
- `created_by_user_id` nullable
- `cancelled_at`, `cancel_reason_code` (no texto clínico libre)
- `rescheduled_from_id`, `rescheduled_to_id`
- `notes_internal` — **prohibido** diagnóstico; si existe, solo logística (“traer estudios”) y debe revisarse legalmente. Preferible no tenerlo en v1.

**appointment_status_history** — `appointment_id`, `from_status`, `to_status`, `actor_type`, `actor_id`, `at`

**appointment_calls** — cada LLAMAR / VOLVER A LLAMAR. `display_ids[]` o tabla de destinos, `result` EMITTED | DISPLAY_OFFLINE (el emitido al bus, no “el paciente escuchó”).

### Espera y notificaciones

**waitlist_entries** — patient, specialty, professional nullable, `created_at`, `status` ACTIVE|FULFILLED|CANCELLED|EXPIRED

**waitlist_offers** — entry, slot, `expires_at`, `status` PENDING|ACCEPTED|EXPIRED|DECLINED

**notification_templates** — `key`, `channel`, `body`, `locale`, `updated_by`, versionado simple

**notifications** — `type`, `channel`, `appointment_id`, `patient_id`, `status`, `scheduled_at`, `sent_at`, `failed_at`, `attempts`, `idempotency_key` unique

**notification_deliveries** — `provider`, `provider_message_id` unique nullable, `status` QUEUED|SENT|DELIVERED|READ|FAILED, `error_code`, timestamps. **No** guardar el cuerpo completo si el template+params bastan. Params: fecha, hora, especialidad, profesional, código.

### Auditoría y config

**audit_logs** — `id`, `at`, `actor_user_id` nullable, `actor_type`, `action`, `entity_type`, `entity_id`, `ip_hash`, `user_agent_truncated`, `metadata` jsonb (sin secretos). Insert-only. Rol DB sin UPDATE/DELETE para la app.

**system_settings** — key/value versionado, audit al cambiar. Ejemplos: `cancel_min_hours`, `reminder_offsets_hours` `[48,3]`, `booking_horizon_days`, `otp_ttl_seconds`, `hospital_name`, `tts_template`.

## Máquina de estados

### Slot

```text
AVAILABLE → HELD → AVAILABLE (timeout)
AVAILABLE → BOOKED
AVAILABLE → BLOCKED
HELD → BOOKED
HELD → AVAILABLE
BLOCKED → AVAILABLE (desbloqueo)
BOOKED → (inmutable; la cancelación puede reabrir un NUEVO slot AVAILABLE
          equivalente si la política lo permite, no reusar la fila BOOKED)
```

Al cancelar un turno futuro, la fila del cupo vuelve a `AVAILABLE` y el turno queda `CANCELLED`. No se inserta un cupo gemelo. El turno cancelado conserva `slot_id`; `active_slot_key` pasa a null y el cupo puede reservarse otra vez.

### Appointment

Estados v1:

| Estado | Significado |
| --- | --- |
| CONFIRMED | Reserva exitosa |
| CALLED | Al menos un llamado a TV |
| IN_PROGRESS | Atención iniciada (opcional) |
| COMPLETED | Atendido |
| NO_SHOW | Ausente |
| CANCELLED | Cancelado |
| RESCHEDULED | Cerrado porque existe uno nuevo |
| EXPIRED | Hold abandonado; rara vez hay fila appointment |

Transiciones permitidas:

```text
CONFIRMED → CALLED | CANCELLED | RESCHEDULED | NO_SHOW | COMPLETED
CALLED → CALLED (recall, no cambia estado) | IN_PROGRESS | COMPLETED | NO_SHOW | CANCELLED
IN_PROGRESS → COMPLETED | NO_SHOW
```

Terminales: COMPLETED, NO_SHOW, CANCELLED, RESCHEDULED, EXPIRED.

Invalidar en código **y** (opcional) constraint/trigger. La capa `AppointmentService` es la autoridad.

RESERVED no se usa en appointment: el hold es del slot.

AVAILABLE no es estado de appointment.

## Índices adicionales

- `appointments (patient_id, starts_at desc)` via join slot
- `appointments (public_code)`
- `appointments (status, slot.starts_at)` para agenda del día
- `appointment_slots (professional_id, starts_at)`
- `appointment_slots (status, starts_at)` disponibles
- `audit_logs (at)`, `(actor_user_id, at)`, `(entity_type, entity_id)`
- `notifications (status, scheduled_at)` para el worker

## Semilla de desarrollo

Ficticia: Hospital de demostración, 4 especialidades, 6 profesionales, 4 consultorios, 2 displays, feriados de ejemplo, pacientes “Juan Perez” DNI 30000001, etc. Passwords solo en `.env` local. Nunca prod dump hacia dev.

## Lo que no se modela ahora

HC, alergias, medicamentos, archivos, pagos, obras sociales (se puede agregar `coverage_label` más adelante si recepción lo necesita, no en v1).
