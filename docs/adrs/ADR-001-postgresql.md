# ADR-001 — PostgreSQL como base de datos

- Estado: propuesto
- Fecha: 2026-09-15

## Contexto

El sistema necesita integridad referencial, transacciones, constraints únicos contra doble reserva, índices de búsqueda y backups confiables. Los datos son personales (DNI, teléfono) y operativos de un hospital municipal.

## Decisión

Usar PostgreSQL administrado (RDS u equivalente) como única base transaccional. Prisma como ORM. Migraciones versionadas. Usuario de aplicación con privilegios mínimos. La DB no es pública.

## Alternativas

- MySQL/MariaDB: suficiente para CRUD, más débil en constraints parciales y ecosistema de este stack.
- MongoDB: no es adecuado como fuente de verdad de cupos únicos.
- SQLite: no para producción concurrente hospitalaria.

## Consecuencias

- Requiere operador/proveedor que ofrezca PITR y backups.
- El equipo debe conocer SQL lo suficiente para revisar índices y EXPLAIN, no solo el ORM.
