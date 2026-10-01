# ADR-004 — No usar WhatsApp Web automatizado

- Estado: propuesto
- Fecha: 2026-09-15

## Contexto

Se necesitan confirmaciones, recordatorios y estados de entrega. Existen librerías que automatizan WhatsApp Web.

## Decisión

Solo API oficial de WhatsApp Business (Meta Cloud API o BSP). Capa `WhatsAppService`. Credenciales en secretos, no en DB en claro. Webhooks con verificación de firma e idempotencia.

## Alternativas

- WhatsApp Web / Baileys: violación de términos, sesión frágil, riesgo de baneo, inaceptable en un hospital.
- SMS puro: peor UX y costo; se deja como canal futuro en el modelo `Notification`, no en v1.

## Consecuencias

- Hay onboarding de Meta (verificación, plantillas). El resto del sistema puede desarrollarse con un provider mock.
- Los mensajes transaccionales tienen costo y políticas; hay que medir envíos.
