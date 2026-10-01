# ADR-002 — Monolito modular, no microservicios

- Estado: propuesto
- Fecha: 2026-09-15

## Contexto

Hay muchos bounded contexts (auth, turnos, WhatsApp, displays) pero un solo equipo pequeño y un hospital de tamaño chico/mediano. El requerimiento pide profesionalismo y también simplicidad.

## Decisión

Un repositorio, un modelo de datos, dos procesos (`api`, `worker`) y módulos internos. Crecer por módulos. Extraer un servicio solo si un cuello de botella real lo justifica (p. ej. TTS server-side en el futuro).

## Alternativas

- Microservicios: multiplican fallos parciales, auth distribuida y costo operativo.
- Modular monolith + Next.js API routes only: complica WebSockets y workers.
- Un único proceso que también procesa jobs: un pico de WhatsApp tumba HTTP.

## Consecuencias

- Deploy más simple, transacciones ACID entre módulos.
- Disciplina de límites de módulo para no volver a un “ball of mud”.
