# Fase 15 — Auditoría

Estado: **cerrada**. Quien tiene `audit:read` ve las acciones recientes sin el detalle ni datos de pacientes.

## Qué hace

- `GET /api/v1/admin/audit` devuelve fecha, acción, tipo de actor y tipo de entidad.
- No devuelve metadata, hash de IP ni agente.
- La pantalla `/admin/auditoria` lista esos campos.

## Comprobación

La selección de columnas deja afuera metadata e IP.
