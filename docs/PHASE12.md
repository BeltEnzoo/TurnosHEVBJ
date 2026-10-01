# Fase 12 — Recordatorios

Estado: **cerrada**. Al confirmar un turno se programan los avisos de 48 horas y de 3 horas, según `reminder_offsets_hours`. El worker los envía cuando llega el horario. Fase 13 es la lista de espera.

## Qué hace

- Cada offset genera una fila propia. La clave es `APPOINTMENT_REMINDER`, el turno y las horas, así que no se repite.
- Si el offset ya pasó al reservar, no se crea.
- Cancelar, reprogramar, atender o marcar ausente anula los recordatorios que siguen pendientes.
- Al enviarlo, si el turno ya no está confirmado, no sale.
- El mensaje usa los mismos datos que la confirmación: hospital, fecha, hora, especialidad, profesional y código.

## Comprobación

El test programa los dos offsets, ignora el segundo intento y no envía el aviso si el turno se canceló.
