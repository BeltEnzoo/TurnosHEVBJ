# Recuperación ante desastres

Valores **propuestos** para un hospital municipal pequeño/mediano. El hospital debe aceptarlos.

| Objetivo | Valor propuesto | Significado |
| --- | --- | --- |
| RPO | 15 minutos | máxima pérdida de datos (PITR) |
| RTO | 4 horas | tiempo para volver a operar turnos |

Fuera de horario, el hospital puede volver a papel/teléfono; eso no reemplaza el RTO, lo mitiga.

## Escenarios

### Muere el contenedor/API

Orquestador relanza. Sesiones en PostgreSQL. TVs reconectan. RTO minutos.

### Muere Redis

Turnos siguen. Deja de haber jobs nuevos y pub/sub WS multi-nodo. Acción: recrear Redis, reencolar `notifications` PENDING desde DB. Alertar.

### Falla WhatsApp

Turnos intactos. Reintentos. Comunicación alternativa: cartel en el portal y recepción.

### Se pierde PostgreSQL (zona o borrado)

1. No improvisar writes  
2. Restaurar RDS desde snapshot + WAL al último minuto sano  
3. Verificar checksum de conteos  
4. Reapuntar API  
5. Invalidar? sesiones pueden sobrevivir si se restauró data; rotar `SESSION_SECRET` si hubo compromiso  

Pérdida: hasta RPO. Turnos tomados en esos minutos pueden no existir: recepción los re-carga.

### Se pierde el código

Git remoto. Build reproducible. Infra documentada.

### Compromiso de una TV

Revocar token. Rotar no afecta otras TVs.

### Compromiso de cuenta admin

Revocar sesiones, desactivar usuario, auditar acciones desde `last_login`, rotar secretos si hubo acceso a settings no a AWS (son planos distintos).

### Compromiso de AWS

Plan de incidente: cortar WAF, rotar todos los secretos, legal, restaurar a snapshot pre-incidente. Este plan se detalla en Fase 18, no se finge completo ahora.

## Contactos (a completar)

- Responsable técnico  
- Responsable hospitalario  
- Proveedor cloud  
- Asesor legal  

No guardar estos teléfonos solo en un Slack personal.
