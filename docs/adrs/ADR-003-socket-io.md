# ADR-003 — Tiempo real con Socket.IO

- Estado: propuesto
- Fecha: 2026-09-15

## Contexto

El llamador de TV debe recibir el evento en segundos, reconectar en Wi‑Fi inestable y no saturar con polling. Puede haber varias TVs.

## Decisión

Socket.IO sobre el proceso Fastify, autenticación en el handshake con token de display, rooms por `displayId`. Heartbeat para `ONLINE`/`OFFLINE`. Snapshot de llamados recientes al reconectar. Adapter Redis reservado para el día con más de una instancia API.

## Alternativas

- WebSocket nativo: menos reconexión/fallback.
- SSE: no hay canal de ack `CallDisplayed` futuro.
- Polling 1s: inaceptable a escala y en TV.

## Consecuencias

- El API debe ser un proceso de larga duración, no serverless clásico.
- El llamado se persiste antes de emitir: la TV nunca es fuente de verdad.
