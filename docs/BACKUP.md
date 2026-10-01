# Backups

## Qué se respalda

1. PostgreSQL (datos de negocio) — crítico  
2. Secretos (procedimiento de acceso, no el valor en Git)  
3. Código (Git remoto)  
4. Redis: **no** es fuente de verdad; no se respalda como datos de turnos. Jobs pendientes se pueden re-encolar desde DB (`notifications` PENDING)

## Política mínima

| Tipo | Frecuencia | Retención propuesta |
| --- | --- | --- |
| Continuo PITR | todo el tiempo | 7–15 días |
| Snapshot diario | 01:00 ART | 14 días |
| Snapshot semanal | domingo | 8 semanas |
| Snapshot mensual | día 1 | 12 meses |

Backups automáticos del proveedor RDS **más** copia periódica a un bucket/cuenta distinta (ransomware / borrado de cuenta).

Cifrado en reposo. Acceso al restore: `SUPER_ADMIN` operativo + procedimiento. La app no tiene permiso de borrar backups.

## Qué no alcanza

Un dump `pg_dump` en el mismo disco de la API. Un backup nunca restaurado.

## Prueba de restauración

Cada 90 días (staging):

1. Crear instancia nueva  
2. Restaurar snapshot + PITR a un minuto  
3. Arrancar API contra esa DB  
4. Verificar conteo de turnos del día X y login admin  
5. Registrar el ejercicio en [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)

Sin esa prueba, el backup no se considera confiable.

## Datos personales

Los backups contienen PII. Misma política de acceso y retención legal que producción. Destruir copias vencidas. No bajar backups a laptops.
