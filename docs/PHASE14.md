# Fase 14 — Estadísticas

Estado: **cerrada**. El personal con `appointments:write` consulta totales por estado y por especialidad en un rango de fechas.

## Qué hace

- `GET /api/v1/admin/reports/summary?from=&to=` cuenta turnos. No devuelve nombre, DNI ni teléfono.
- La pantalla `/admin/estadisticas` pide el rango y muestra esos totales.

## Comprobación

La consulta arma los totales en el servidor a partir del estado y la especialidad del cupo.
