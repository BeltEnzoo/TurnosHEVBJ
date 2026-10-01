# ADR-008 — Slots persistidos en ventana móvil

- Estado: propuesto
- Fecha: 2026-09-15

## Contexto

Hay que impedir doble reserva a nivel de base, no solo en aplicación. Generar años de filas es ruido. Calcular slots 100% al vuelo debilita el `UNIQUE`.

## Decisión

`appointment_slots` materializados para un horizonte configurable (propuesta: 45 días). Job nocturno y regeneración al cambiar agenda. Unique `(professional_id, starts_at)` donde el slot no está anulado. Reserva con `SELECT FOR UPDATE`.

Sobreturno = insertar slot `EXTRA` en la misma transacción.

## Alternativas

- Solo recurrencia virtual: más código, más riesgo de carrera.
- Materializar 1 año: tablas grandes sin beneficio.

## Consecuencias

- Cambios de agenda deben invalidar o regenerar slots AVAILABLE futuros, nunca tocar BOOKED.
- El job de generación es parte de la disponibilidad, no un detalle de cron olvidable.
