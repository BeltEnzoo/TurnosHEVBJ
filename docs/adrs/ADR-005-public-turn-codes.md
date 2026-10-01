# ADR-005 — Códigos de turno en TV, nunca el nombre

- Estado: propuesto
- Fecha: 2026-09-15

## Contexto

La TV es un espacio público. Mostrar “María González, DNI …” es exposición innecesaria. El código secuencial tipo `A-184` es legible pero ordenable y correlacionable.

## Decisión

IDs internos UUID. Código de turno público aleatorio, alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L, 5/S), formato `XX-XXX` (ejemplo `KT-7M4`). La TV muestra código + consultorio. El panel médico sí ve identidad. Llamar por nombre queda como setting explícito futuro, default off, auditado si alguna vez se enciende.

## Alternativas

- Secuencial por día: más fácil de dictar, filtra demanda y puede permitir inferir el siguiente.
- Nombre de pila: sigue siendo identificable en un pueblo chico.

## Consecuencias

- El comprobante WhatsApp y el portal deben enfatizar el código.
- Recepción puede buscar por código o DNI (esto último auditado).
