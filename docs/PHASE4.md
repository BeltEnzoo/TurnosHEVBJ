# Fase 4 — Horarios y disponibilidad

Estado: **cerrada**. Tests de agenda en verde. Fase 5: [PHASE5.md](PHASE5.md).

Fuera de esta fase: reservar, cancelar y reprogramar turnos (Fase 5), auth HTTP de pacientes, TV, llamador y WhatsApp oficial. El sobreturno que inserta un cupo EXTRA y lo reserva en la misma transacción es Fase 5.

## Qué hace

- Agenda semanal, excepciones, feriados y bloqueos. Permiso `schedules:write` para `SUPER_ADMIN`, `ADMIN` y `SUPERVISOR`. Recepción no escribe.
- Al guardar, se materializan cupos `REGULAR` en `AVAILABLE` dentro del horizonte `booking_horizon_days` (default 45), en `America/Argentina/Buenos_Aires`. Lunes es el día 1.
- Un feriado, una excepción cerrada o un bloqueo no generan ese cupo.
- Una excepción con horario reemplaza la franja de ese día.
- Los cupos `BOOKED` o `HELD` no se modifican ni se borran al regenerar.
- El worker corre el mismo regenerado todos los días a las 03:00, hora del hospital, para correr la ventana.
- `GET /api/v1/availability` devuelve solo cupos disponibles: horario, profesional, especialidad y consultorio. No dice cuántos están ocupados ni trae datos de pacientes.

## API de personal

- `POST|GET|PATCH /api/v1/admin/schedules`
- `POST /api/v1/admin/schedule-exceptions`
- `POST /api/v1/admin/holidays`
- `POST /api/v1/admin/schedule-blocks`
- `POST /api/v1/admin/slots/regenerate`
