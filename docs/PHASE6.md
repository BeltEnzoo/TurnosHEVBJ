# Fase 6 — Portal de pacientes

Estado: **cerrada**. Tests de API en verde. El portal en `/portal` reserva, lista y cancela. Fase 7: [PHASE7.md](PHASE7.md).

Fuera de esta fase: panel admin (Fase 7), panel médico (Fase 8), llamador, TV, WhatsApp oficial y lista de espera. El mensaje de turno queda pendiente; no se envía.

## Qué hace

- Identificación sin contraseña: DNI + teléfono + Turnstile + OTP por el proveedor de WhatsApp configurado. En desarrollo y test, sin clave de Turnstile, se acepta el token `test-turnstile`.
- La respuesta del pedido de código es siempre la misma. Si el DNI ya existe con otro teléfono, no se envía el código. Cambiar el teléfono es por recepción.
- Al verificar, queda una cookie `HttpOnly` de paciente, distinta de la del personal, por 30 minutos.
- Reservar usa el mismo bloqueo del motor: cupo `AVAILABLE`, horizonte, feriados, bloqueos y tope `max_active_appointments` (default 3) por DNI y por teléfono.
- Un paciente no ve ni cancela turnos de otro. Si el turno no es suyo, la respuesta es 404.
- Cancelar y reprogramar respetan `cancel_min_hours`.
- El comprobante muestra el código. La auditoría y la respuesta pública no incluyen el DNI.

## API

- `POST /api/v1/auth/patient/otp/request`
- `POST /api/v1/auth/patient/otp/verify`
- `POST /api/v1/auth/patient/logout`
- `GET /api/v1/auth/patient/me`
- `POST /api/v1/appointments`
- `GET /api/v1/me/appointments`
- `POST /api/v1/appointments/:id/cancel`
- `POST /api/v1/appointments/:id/reschedule`

La pantalla real está en `/portal` cuando la demo visual está apagada. `pnpm demo:ui` sigue siendo ficticia.
