# API HTTP y eventos

Base: `https://<dominio>/api/v1`  
Formato: JSON. Versionado en URL. OpenAPI se genera en Fase 1–2.

Autenticación:

- Staff: cookie de sesión.
- Paciente: cookie de sesión liviana post-OTP (corta, p. ej. 30 min) **o** token de un solo flujo de reserva. Preferir cookie `HttpOnly` de paciente, distinta de la staff, `Path=/`, sin acceso admin.
- Display: header `Authorization: Bearer <device-token>` solo en namespace `/displays/me` y upgrade WS.
- Webhooks: firma, no sesión.

IDs en path: UUID. El código público `KT-7M4` se usa en búsqueda explícita, no como único secreto.

## Convención de errores

```json
{
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "Ese horario ya no está disponible.",
    "details": []
  }
}
```

| HTTP | Uso |
| --- | --- |
| 400 | validación / estado ilegal |
| 401 | no autenticado |
| 403 | autenticado sin permiso |
| 404 | no existe o no enumerable |
| 409 | conflicto (doble reserva, transición) |
| 429 | rate limit |
| 500 | genérico al cliente |

`details` solo para errores de validación de campos. Nunca SQL ni stack.

Códigos de negocio estables: `SLOT_UNAVAILABLE`, `OTP_INVALID`, `TRANSITION_NOT_ALLOWED`, `CANCEL_WINDOW_CLOSED`, `MFA_REQUIRED`, `DISPLAY_REVOKED`.

## Paginación

Listados admin: cursor (`starting_after`) + `limit` (max 100).  
Filtros: fecha, profesional, especialidad, estado, texto. No `GET /patients` sin query.

## Recursos (diseño, no implementación)

### Auth staff

- `POST /auth/staff/login` → 401 genérico si falla (no “email no existe”)
- `POST /auth/staff/mfa` 
- `POST /auth/staff/logout`
- `POST /auth/staff/logout-all`
- `GET /auth/staff/me`

### Auth paciente

Implementado en Fase 6. Cookie `HttpOnly` de paciente, 30 minutos, distinta de la del personal.

- `POST /auth/patient/otp/request` DNI + teléfono + Turnstile. La respuesta no dice si el DNI existe.
- `POST /auth/patient/otp/verify`
- `POST /auth/patient/logout`
- `GET /auth/patient/me` nombre si ya hay ficha. Sin DNI.

### Catálogos públicos (mínimos)

Implementado en Fase 3 (solo activos; el profesional público no incluye matrícula ni `userId`):

- `GET /specialties`
- `GET /professionals?specialtyId=`
- `GET /availability?specialtyId&professionalId&from&to` implementado en Fase 4.  
  Respuesta: slots disponibles **sin** datos de otros pacientes. No revelar cuántos BOOKED.

### Turnos paciente

Portal de pacientes, Fase 6. La lista de espera sigue pendiente.

- `POST /appointments` body: slotId + datos personales + turnstileToken, con la cookie de paciente.
- `GET /me/appointments` solo los propios.
- `POST /appointments/:id/cancel`
- `POST /appointments/:id/reschedule` { newSlotId }
- `POST /waitlist` implementado en Fase 13. Requiere sesión de paciente. No asigna un cupo.
- `GET /me/waitlist`
- `POST /waitlist/offers/:id/accept` reserva el cupo si la oferta sigue vigente.
- `POST /waitlist/offers/:id/decline`

### Recepción / admin

- CRUD `/admin/specialties|professionals|offices` implementado en Fase 3 (`catalogs:write`, sin borrado físico).
- Agenda semanal, excepciones, feriados, bloqueos y regeneración de cupos: Fase 4 (`schedules:write`). Displays siguen pendientes.
- `POST /admin/slots/extra` sobreturno, implementado en Fase 5: inserta un cupo `EXTRA` y lo reserva en la misma transacción. No comparte `starts_at` con otro cupo del mismo profesional.
- `GET /admin/appointments` filtros, Fase 5 (`appointments:write`).
- `POST /admin/appointments` alta manual sobre un cupo `AVAILABLE`, Fase 5.
- `POST /admin/appointments/:id/cancel|reschedule|complete|no-show` Fase 5. Llamar y pasar a atención son fases del panel médico y del llamador.
- `POST /admin/patients/search` { dni o familyName }, Fase 7. Auditado, sin guardar el DNI. No es un listado abierto.
- `GET /admin/appointments/:id` historial de estados, Fase 7.
- `GET /admin/notifications` cola sin teléfono ni DNI, Fase 7. El reenvío queda para WhatsApp.
- `GET|PATCH /admin/settings` nombre del hospital, cancelación, horizonte y tope de turnos. Solo `settings:write`.
- `GET|POST /admin/users`, `PATCH /admin/users/:id`, `POST /admin/users/:id/reset-password|revoke-sessions`, Fase 7. Solo `SUPER_ADMIN` asigna `SUPER_ADMIN`.
- `GET /admin/reports/summary?from=&to=` totales por estado y especialidad, Fase 14. Sin nombre ni DNI.
- `GET /admin/audit` acciones recientes, Fase 15. Sin metadata ni IP. Permiso `audit:read`.
- `POST /admin/reports/export` queda fuera: una exportación puede llevar datos de pacientes y necesita una definición aparte.

### Médico

Implementado en Fase 8. Permiso `appointments:call:own`. El profesional sale de la cuenta; un `professionalId` del cliente se ignora. La respuesta no incluye DNI ni teléfono. Desde la Fase 9 el llamado se emite a las pantallas conectadas del consultorio; si no hay ninguna, el resultado queda `DISPLAY_OFFLINE`.

- `GET /medico/agenda?date=`
- `POST /appointments/:id/call`
- `POST /appointments/:id/recall`
- `POST /appointments/:id/in-progress`
- `POST /appointments/:id/complete`
- `POST /appointments/:id/no-show`

Un segundo llamado del mismo turno en menos de 5 segundos no crea otra fila, salvo `recall`.

### Display HTTP

Implementado en Fase 9. Autenticación `Authorization: Bearer` con el token de la pantalla. La respuesta no incluye pacientes.

- `GET /displays/me` config de voz y consultorios
- `GET /displays/me/snapshot` llamados de los últimos 30 minutos
- `POST /displays/me/heartbeat`
- `GET /admin/displays` estado, sin token. Permiso `displays:manage`
- `POST /displays/me/events` opcional `CallDisplayed`

### Webhooks

- `POST /webhooks/whatsapp` implementado en Fase 11. Firma HMAC del cuerpo crudo, idempotencia por evento y actualización del envío. No crea turnos.

### Health

- `GET /health` liveness (no detalles)
- `GET /ready` checks DB/Redis; no público o IP allowlist. Sin connection strings.

## WebSocket

Implementado en Fase 9. Namespace `/ws/displays`. Handshake: `{ auth: { token } }`. Transporte websocket.

Eventos servidor → TV:

- `patient.called` `{ callId, publicCode, officeLabel, spokenText, ts }`
- `display.config` 
- `ping`

Eventos TV → servidor:

- `pong`
- `call.displayed` `{ callId }` (Fase 10+, opcional)

Rooms: `display:<id>`. Un display no se suscribe a otro. El médico no usa este namespace.

## Eventos internos (in-process / cola)

No event sourcing. Bus interno o encolado:

`AppointmentConfirmed`, `AppointmentCancelled`, `AppointmentRescheduled`, `PatientCalled`, `AppointmentCompleted`, `AppointmentNoShow`, `NotificationRequested`, `WaitlistSlotFreed`.

Handlers: notificaciones, waitlist, métricas. Fallo del handler no rollback del turno ya commit.

## Idempotencia

- Webhooks: `provider_event_id` unique.
- Worker WhatsApp: `notifications.idempotency_key`.
- `call` con mismo turno en < 5 s sin `recall`: 409 o 200 con el call existente.

## Rate limiting (propuesta)

| Ámbito | Límite inicial (ajustar en piloto) |
| --- | --- |
| login staff / IP | 10 / 15 min |
| OTP request / teléfono | 3 / 15 min |
| OTP request / IP | 10 / 15 min |
| reserva / DNI | 8 / día |
| disponibilidad pública / IP | 120 / min |
| webhook | 100 / s con burst, más firma |

429 con `Retry-After`. No bloquear un hospital entero detrás de NAT: combinar IP + identidad.
