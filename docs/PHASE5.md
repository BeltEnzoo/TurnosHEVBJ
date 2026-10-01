# Fase 5 — Motor de turnos

Estado: **cerrada**. Tests del motor en verde. Fase 6: [PHASE6.md](PHASE6.md).

Fuera de esta fase: auth HTTP de pacientes y portal (Fase 6), panel admin completo (Fase 7), panel médico (Fase 8), llamador, TV y WhatsApp oficial. La fila de notificación queda pendiente; no se envía el mensaje.

## Qué hace

- Alta manual sobre un cupo `REGULAR` en `AVAILABLE`. Transacción con `SELECT … FOR UPDATE`. El cupo pasa a `BOOKED` y el turno nace `CONFIRMED`, con historial y auditoría.
- Dos reservas simultáneas del mismo cupo: una gana y la otra responde 409.
- Cancelar un turno futuro, respetando `cancel_min_hours`, lo deja `CANCELLED` y devuelve el mismo cupo a `AVAILABLE`.
- Reprogramar cierra el turno anterior como `RESCHEDULED`, conserva el vínculo y confirma uno nuevo en otro cupo de la misma especialidad. La misma anticipación de `cancel_min_hours` aplica a la reprogramación.
- Completar o marcar ausente cierra el turno y no vuelve a ofrecer el cupo.
- El sobreturno inserta un cupo `EXTRA` ya `BOOKED` y el turno en la misma transacción. No comparte `starts_at` con otro cupo de ese profesional.
- Permiso `appointments:write` para `SUPER_ADMIN`, `ADMIN`, `SUPERVISOR` y `RECEPCION`. Un médico no reserva por esta vía.
- La respuesta de personal incluye la identidad necesaria para recepción. La auditoría y la notificación no guardan el DNI. `GET /api/v1/availability` sigue sin datos de pacientes.

## API de personal

- `POST|GET /api/v1/admin/appointments`
- `POST /api/v1/admin/appointments/:id/cancel`
- `POST /api/v1/admin/appointments/:id/reschedule`
- `POST /api/v1/admin/appointments/:id/complete`
- `POST /api/v1/admin/appointments/:id/no-show`
- `POST /api/v1/admin/slots/extra`
