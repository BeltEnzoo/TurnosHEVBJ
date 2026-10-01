# Fase 13 — Lista de espera

Estado: **cerrada**. Si no hay horario, la persona autenticada puede anotarse. Al liberarse un cupo se ofrece al más antiguo de esa especialidad y no se reserva hasta que confirma.

## Qué hace

- `POST /api/v1/waitlist` con la sesión del paciente. La especialidad es obligatoria y el profesional es opcional.
- Cancelar un turno regular deja el cupo libre y crea una oferta de 15 minutos para la primera persona en espera que coincida.
- La oferta no asigna el cupo. `POST /api/v1/waitlist/offers/:id/accept` lo reserva en la misma transacción, si sigue disponible y la oferta no venció.
- Rechazar o dejar vencer la oferta pasa a la siguiente persona.
- El aviso es `WAITLIST_OFFER`. No incluye DNI ni teléfono.

## Comprobación

El test ofrece el cupo a quien se anotó primero, lo deja disponible y solo lo reserva cuando esa persona acepta.
