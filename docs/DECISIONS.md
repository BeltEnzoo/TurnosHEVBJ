# Decisiones de arquitectura

Este documento resume las decisiones de Fase 0, las alternativas evaluadas y lo que **requiere confirmación** antes de pasar a Fase 1.

Los ADR individuales están en [adrs/](adrs/).

## Prioridad usada para decidir

1. Seguridad  
2. Privacidad  
3. Integridad de los turnos  
4. Disponibilidad  
5. Mantenibilidad  
6. Experiencia de usuario  
7. Escalabilidad futura  
8. Costos razonables  

Si dos opciones son igual de seguras, se elige la más simple.

---

## Decisiones recomendadas

| ID | Decisión | Recomendación |
| --- | --- | --- |
| ADR-001 | Base de datos | PostgreSQL administrado |
| ADR-002 | Forma de la aplicación | Monolito modular (API + worker + web) |
| ADR-003 | Frontend | Next.js App Router + TypeScript |
| ADR-004 | Backend | Fastify + TypeScript, no serverless |
| ADR-005 | ORM | Prisma, migraciones versionadas |
| ADR-006 | Auth del personal | Sesión servidor + cookie HttpOnly. Ingreso con correo y contraseña, sin código de 6 dígitos |
| ADR-007 | Auth del paciente | DNI + teléfono + OTP WhatsApp. Sin contraseña |
| ADR-008 | Disponibilidad | Slots persistidos en ventana móvil + unique constraint |
| ADR-009 | Tiempo real | Socket.IO autenticado por display |
| ADR-010 | WhatsApp | API oficial (Meta Cloud API o BSP). Nunca WhatsApp Web |
| ADR-011 | Código en TV | Código aleatorio legible. Nunca nombre ni DNI |
| ADR-012 | Colas | Redis + BullMQ |
| ADR-013 | Hosting | Cloudflare + AWS `sa-east-1`. Revisión legal de transferencia |
| ADR-014 | Origen web/API | Mismo dominio vía reverse proxy. Evita CORS amplio |
| ADR-015 | Estados | Slot y Appointment son entidades distintas |

---

## Decisiones que requieren confirmación

Estas no se implementan hasta que el hospital / vos las aprueben. Las recomendaciones están justificadas, no son hechos consumados.

### 1. Residencia de los datos (legal)

**Problema:** No hay región de AWS/GCP/Azure en Argentina. La opción profesional más cercana es São Paulo (`sa-east-1` / `southamerica-east1`). Eso es transferencia internacional de datos personales.

**Recomendación:** AWS `sa-east-1` + cifrado + contrato de encargado + revisión legal.  
**Alternativa:** datacenter en Argentina (ARSAT u otro) si el hospital lo exige. Más caro y más operacional.  
**No recomendado:** Render/Railway/Vercel+Neon en EE.UU. o Europa sin análisis legal.

**Debe validar:** asesor legal/compliance del hospital.

### 2. Nombre y datos institucionales

El sistema usará configuración, no constantes. Falta definir:

- Nombre oficial del hospital
- Domicilio y teléfono de contacto (para comprobantes)
- Dominio (`turnos.hospital.gob.ar` u otro)
- Especialidades y consultorios reales (solo para producción; seed ficticio en dev)

### 3. Proveedor de WhatsApp

**Recomendación:** Meta Cloud API oficial, con Business Manager del hospital.  
**Alternativa válida:** BSP (360dialog, Twilio) si simplifica la verificación.  
Ambas son API oficial. WhatsApp Web automatizado queda prohibido.

**Impacto:** hay plazos de verificación Meta y aprobación de plantillas. Puede bloquear el piloto de notificaciones aunque el resto del sistema funcione.

### 4. MFA para recepción y médicos

**Decisión del hospital (2026-09-30):** Admisión, Sistemas, Administración y Superusuario entran con correo y contraseña. El código de 6 dígitos no se pide en cada inicio de sesión.

### 5. Política de cancelación del paciente

**Recomendación inicial configurable:** el paciente puede cancelar hasta 2 horas antes. Después, mensaje para comunicarse con el hospital. Reprogramación pública con la misma ventana.

### 6. Horizonte de turnos y duración

**Recomendación:**

- Ventana pública de reserva: 30 días (configurable)
- Duración de slot: por especialidad (default 20 minutos)
- Generación de slots: 45 días hacia adelante, job diario

### 7. OTP: ¿solo WhatsApp o también SMS?

**Recomendación v1:** solo WhatsApp. SMS suma costo, proveedor y superficie de ataque. Si el paciente no tiene WhatsApp, turno por recepción.

### 8. Lista de espera: ¿por especialidad, profesional, o ambos?

**Recomendación:** ambos, con matching: primero mismo profesional+especialidad, si no hay, misma especialidad. Nunca autoasignar. Oferta con vencimiento (p. ej. 30 minutos).

### 9. ¿Un paciente puede tener más de un turno el mismo día?

**Recomendación:** sí, en distintas especialidades. No, dos turnos solapados con el mismo profesional. Tope configurable (default 3 turnos futuros activos).

### 10. Sobreturnos en el mismo minuto

**Recomendación:** un profesional no tiene dos turnos en el mismo `starts_at`. El sobreturno usa un horario distinto (09:35 si 09:30 está ocupado). Evita ambigüedad en el llamador.

### 11. ¿El médico ve nombre y DNI?

**Recomendación:** sí, en el panel médico (necesario para atender). La TV no. Recepción sí, con búsqueda acotada y auditada.

### 12. Infraestructura “simple” vs “hospitalaria”

**Recomendación de producción:** AWS (RDS + Redis + 2 servicios Docker: api/web y worker) detrás de Cloudflare.  
**Aceptable para piloto interno:** un único VM con Docker Compose **solo en staging/piloto**, no como arquitectura final.

---

## Contradicciones o tensiones detectadas en el requerimiento

### A. Facilidad para personas mayores vs anti-suplantación

El requerimiento pide no forzar cuentas con contraseña y a la vez impedir suplantación.  
**Resolución:** identidad liviana (DNI + teléfono verificado por OTP), no cuenta tradicional. El riesgo residual (teléfono compartido, SIM swap) se mitiga con rate limit, Turnstile, tope de turnos y que el cambio de teléfono se haga en recepción.

### B. “AVAILABLE” como estado de turno

AVAILABLE describe un **hueco de agenda**, no un turno existente.  
**Resolución:** `AppointmentSlot` tiene AVAILABLE/HELD/BOOKED/BLOCKED. `Appointment` nace en CONFIRMED (o se abandona el HELD). Ver [DATABASE.md](DATABASE.md).

### C. Slots dinámicos vs no doble reserva

Slots 100% virtuales complican el unique constraint. Pre-generar años de slots ensucia la DB.  
**Resolución:** persistir una **ventana móvil** (ADR-008).

### D. Next.js full-stack vs WebSockets y workers

Next.js en hosting serverless no es adecuado para Socket.IO persistente ni para BullMQ.  
**Resolución:** Next.js para UI; Fastify de larga duración para API, WS y el worker aparte.

### E. UUID vs código legible

UUID no se dicta en una sala de espera. Código secuencial (`A-184`) filtra volumen y orden.  
**Resolución:** UUID interno + código público aleatorio legible.

### F. IN_PROGRESS vs no tener check-in

Sin kiosco/check-in, IN_PROGRESS es opcional.  
**Resolución v1:** el médico puede pasar CALLED → COMPLETED / NO_SHOW. IN_PROGRESS existe en el modelo para no romper el futuro check-in, pero no es obligatorio.

### G. TV_DISPLAY como rol de usuario humano

Una TV no es un empleado.  
**Resolución:** identidad de dispositivo (`displays` + token hash), con un principal de autorización equivalente a permisos mínimos de display. No se usa la cuenta de un admin.

### H. Cumplimiento legal vs cumplimiento técnico

El texto lo deja claro y se respeta: la arquitectura **facilita** Ley 25.326; no certifica cumplimiento.

### I. Estadísticas vs minimización

Los reportes usan agregados. Las exportaciones nominadas son permiso aparte, auditadas, nunca públicas.

---

## Alternativas explícitamente descartadas

| Idea | Por qué no |
| --- | --- |
| WhatsApp Web / Baileys / scraping | Frágil, contra términos, inaceptable en hospital |
| JWT en localStorage | XSS = robo de sesión |
| `Access-Control-Allow-Origin: *` en API autenticada | Amplía CSRF/exfiltración |
| Microservicios / Kubernetes / Kafka | Sobreingeniería para este tamaño |
| Event sourcing completo | Complejidad sin beneficio ahora |
| Historia clínica en este sistema | Fuera de alcance y de riesgo legal |
| Llamar por nombre en TV | Violación de minimización / exposición pública |
| Confiar en “ocultar el botón” | No es autorización |
| Usuario de DB `postgres` para la app | Exceso de privilegio |
| Datos reales en development | Prohibido |
| Polling agresivo en TVs | Innecesario y frágil |
| Unique constraint como única defensa, sin transacción | Insuficiente; se usan las dos |