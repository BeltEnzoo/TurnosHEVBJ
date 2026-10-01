# Fase 11 — Avisos por WhatsApp

Estado: **cerrada**. Confirmar, cancelar o reprogramar un turno deja un aviso en cola. El worker lo envía con el proveedor de prueba. El proveedor oficial sigue sin conectar. Los recordatorios están en [PHASE12.md](PHASE12.md).

Fuera de esta fase: programar recordatorios, ofertas de lista de espera y elegir un vendor de WhatsApp.

## Qué hace

- El request de reserva no espera al envío. Crea la fila `PENDING` y encola `send-notification` en la cola `notifications`.
- Si la persona no aceptó WhatsApp, el aviso queda `CANCELLED` y no se envía.
- El mensaje lleva hospital, fecha, hora, especialidad, profesional y código. No lleva DNI, nacimiento, teléfono, motivo ni diagnóstico.
- Un aviso ya enviado no se manda de nuevo. Tras cuatro fallos queda `FAILED`, con reintentos de 1 minuto, 5 minutos, 30 minutos y 2 horas.
- `POST /api/v1/webhooks/whatsapp` exige HMAC del cuerpo crudo y una marca de tiempo. El mismo evento no se aplica dos veces. Actualiza el envío y no crea turnos.
- En el panel, Avisos muestra el estado. No hay botón de reenvío.

## Comprobación

Los tests cubren el envío único, el opt-out, el fallo al cuarto intento, la firma inválida y el evento repetido. El texto del aviso no incluye DNI ni teléfono.
