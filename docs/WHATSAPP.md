# WhatsApp

Confirmación, cancelación, reprogramación, recordatorios y ofertas de lista de espera se encolan y el worker las envía. En development y test el proveedor es el mock. `OfficialWhatsAppProvider` sigue sin vendor.

## Proveedor

Interfaz `WhatsAppProvider`. Implementaciones: `MockWhatsAppProvider` (development/test) y `OfficialWhatsAppProvider` (producción, vendor aún no elegido). El resto del sistema depende solo de la interfaz. Prohibido automatizar WhatsApp Web. No se asume un BSP concreto hasta comparar costos, API, políticas y requisitos legales.

Credenciales: env / secret manager. Nunca en Git ni en columnas de texto plano.

## Cuándo se encola un mensaje

| Evento | Template key |
| --- | --- |
| Turno confirmado | `appointment_confirmation` |
| Recordatorio | `appointment_reminder` |
| Cancelación | `appointment_cancelled` |
| Reprogramación | `appointment_rescheduled` |
| Oferta lista de espera | `waitlist_offer` |

No se envía si `whatsapp_opt_in` es false. Recepción puede crear turno igual.

## Contenido (minimización)

Incluir: hospital, fecha, hora, especialidad, profesional, código de turno.  
No incluir: DNI, nacimiento, motivo, diagnósticos.

Los templates de Meta se aprueban por separado; el texto final debe coincidir con lo aprobado. Variables escapadas, sin inyección.

## Cola

BullMQ queue `notifications`. El request de reserva no espera a Meta.

Jobs:

- `send-notification`
- `schedule-reminders` (o reminders como delayed jobs al confirmar)
- `retry` con backoff (p. ej. 1m, 5m, 30m, 2h) y tope de intentos
- Idempotencia por `notifications.idempotency_key` (`type+appointmentId+offset`)

Recordatorios: offsets en settings (`[48h, 3h]`). No reenviar el mismo offset. No recordar turnos CANCELLED/RESCHEDULED/COMPLETED.

## Webhook

`POST /api/v1/webhooks/whatsapp`

1. Verificar firma  
2. Idempotencia de evento  
3. Actualizar `notification_deliveries` (sent/delivered/read/failed)  
4. No crear turnos desde el webhook en v1  

Botones CONFIRMAR/CANCELAR: diseño futuro. El modelo `Notification` y el webhook deben poder ruteaar `interactive` después sin rehacer el módulo.

## Operación y costos

Meta cobra conversaciones/plantillas según política vigente. El admin ve volúmenes y fallos, no necesariamente el precio exacto (si el BSP expone costo, campo opcional). Alertar tasa de fallo.

## Datos guardados

IDs de mensaje, timestamps, tipo, estado, error de proveedor, turno asociado. No el hilo completo de chat.
