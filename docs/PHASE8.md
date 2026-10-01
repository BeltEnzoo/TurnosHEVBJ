# Fase 8 — Panel médico

Estado: **cerrada**. Tests de API en verde (31). El ingreso de un médico abre `/medico`, la agenda del día carga y llamar pasa el turno a Llamado. Fase 9: [PHASE9.md](PHASE9.md).

Fuera de esta fase: llamador en tiempo real y TV (el llamado se registra, no se emite a pantallas), WhatsApp oficial, lista de espera y estadísticas.

## Qué hace

- Cada profesional entra con su cuenta. `/medico` muestra solo su agenda del día, con salto a otra fecha.
- La fila trae hora, código, estado y nombre. No trae DNI ni teléfono.
- Llamar pasa el turno a `CALLED` y deja una fila en `appointment_calls`. Un segundo toque en menos de 5 segundos no duplica el llamado. Volver a llamar sí agrega otra fila.
- Después se puede iniciar atención, marcar atendido o ausente. Ausente pide confirmación en la pantalla.
- Si el turno no es de ese profesional, la respuesta es 404.
- El resultado del llamado queda `DISPLAY_OFFLINE` hasta el llamador en tiempo real. El médico igual puede llamar.

## API

- `GET /api/v1/medico/agenda?date=`
- `POST /api/v1/appointments/:id/call`
- `POST /api/v1/appointments/:id/recall`
- `POST /api/v1/appointments/:id/in-progress`
- `POST /api/v1/appointments/:id/complete`
- `POST /api/v1/appointments/:id/no-show`

Permiso `appointments:call:own`. El profesional se toma de la cuenta, no de un id enviado por el cliente.

`pnpm demo:ui` sigue siendo ficticia.
