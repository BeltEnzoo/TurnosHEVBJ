# Testing

Pirámide: muchos unitarios de dominio, integración con Postgres de test, pocos E2E caros.

## Unitarios

- Transiciones de estado ilegales  
- Políticas de cancelación y recordatorio  
- Generación de slots (feriado, excepción, bloqueo)  
- Formato de código de turno  
- Masking de logs  
- RBAC matrix  

Framework: Vitest.

## Integración

Testcontainers o Postgres de CI.

Obligatorios:

- Dos reservas concurrentes del mismo slot → una 200 y una 409  
- Médico no opera turno ajeno  
- Display token no lee pacientes  
- OTP expirado / reintento  
- Webhook duplicado no duplica delivery  
- Cancelación reabre disponibilidad y encola waitlist job  
- Reprogramación deja historial y cierra el viejo en RESCHEDULED  

## E2E (Playwright)

1. Paciente reserva (WhatsApp mock) y ve código  
2. Médico llama y un segundo browser en `/llamador` muestra código + (TTS mockeable)  
3. Admin crea profesional, horario, aparece cupo  

Datos: seed de test, nunca prod.

## Seguridad

Antes de prod: checklist de [SECURITY.md](SECURITY.md) ejecutada, no solo leída. Incluir prueba de carrera de reserva automatizada (p. ej. 50 workers).

## Carga (Fase 19)

Dimensiones a estimar con el hospital: habitantes, médicos simultáneos, TVs, picos de las 7–9. Priorizar el endpoint de reserva y disponibilidad. WhatsApp se simula.

## Calidad de CI

PR bloqueado si falla lint, typecheck, unit o integration. Coverage no es vanidad: cubrir `AppointmentService` y policies cerca del 100% de ramas de estado.
