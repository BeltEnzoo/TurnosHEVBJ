# Arquitectura — Sistema de turnos hospitalario

Estado: **aprobada** (2026-09-15), con requisitos normativos en [REQUIREMENTS.md](REQUIREMENTS.md).  
Implementación **fase por fase**. Actual: [PHASE17.md](PHASE17.md). Staging, piloto y producción: [PHASE18.md](PHASE18.md).

## 1. Qué es y qué no es

Es un sistema de **gestión de turnos, agenda, llamado en sala de espera y notificaciones**.  
No es historia clínica, no es facturación, no es laboratorio, no es telemedicina.

PostgreSQL es la fuente de verdad de turnos, pacientes, profesionales, horarios y estados. WhatsApp, televisores y navegadores son canales.

## 2. Usuarios y superficies

| Superficie | Quién | Prioridad de UX |
| --- | --- | --- |
| Portal público `/` | Habitantes del pueblo | Mobile-first, pasos mínimos, alto contraste |
| Panel admin `/admin` | Dirección, administración, recepción | Desktop |
| Panel médico `/medico` | Cada profesional, cuenta individual | Desktop y tablet, pocos clics |
| Llamador `/llamador` | Televisores de espera | TV, letras grandes, sin PII |
| API `/api/v1` | Las superficies anteriores | No pública documentada para terceros en v1 |
| Worker | Procesos internos | Sin UI |

## 3. Diagrama lógico

```text
                    Internet
                        |
                 Cloudflare
              (TLS, WAF, Turnstile, DDoS)
                        |
                 Reverse proxy
              (mismo dominio de origen)
              /         |          \
         Next.js     Fastify      Socket.IO
         (web)       (API)        (llamador)
                        |
          +-------------+--------------+
          |             |              |
     PostgreSQL       Redis        BullMQ worker
     (verdad)      (cola, rate     (WhatsApp,
                    limit, pubsub)  recordatorios,
                                    generación slots)
                          |
                   WhatsApp Cloud API
```

Flujos principales:

```text
Paciente → Portal → API → transacción DB → evento NotificationRequested
                                              → cola → worker → WhatsApp

Médico → Panel → API (call) → DB + audit → Socket.IO room del display
                                              → TV (código + TTS)

Admin → Panel → API → DB (agenda, catálogos, displays, reportes)
```

## 4. Monolito modular

Un solo backend desplegable, código separado por módulos. Un proceso `api` (HTTP + WebSocket) y un proceso `worker` (jobs). Misma base de código, distinto entrypoint.

Módulos:

| Módulo | Responsabilidad |
| --- | --- |
| `config` | Settings, feature flags, nombre hospital, ventanas |
| `auth` | Sesiones staff, MFA, OTP pacientes, lockout |
| `users` | Cuentas del hospital, activar/desactivar, revocar sesiones |
| `rbac` | Roles, permisos, checks de backend |
| `patients` | Identidad mínima del paciente |
| `professionals` | Profesionales y asociación a especialidades/consultorios |
| `specialties` | Especialidades |
| `offices` | Consultorios |
| `schedules` | Agenda semanal, excepciones, feriados, bloqueos |
| `appointments` | Reservas, estados, cancelación, reprogramación, sobreturnos |
| `availability` | Generación y consulta de slots |
| `waitlist` | Lista de espera y ofertas con TTL |
| `calling` | Llamados, rellamados, cola lógica por display |
| `displays` | TVs, tokens, heartbeat, mapping a consultorios |
| `notifications` | Modelo genérico de notificación |
| `whatsapp` | Adaptador de proveedor, webhooks, plantillas |
| `audit` | Append-only de acciones sensibles |
| `reports` | Agregados y exportaciones autorizadas |
| `health` | `/health`, `/ready` |

No es microservicios. Los módulos se llaman por funciones de aplicación, no por HTTP interno.

## 5. Estructura de carpetas propuesta

Monorepo `pnpm` + TypeScript estricto:

```text
apps/
  web/                 Next.js (portales)
  api/                 Fastify (HTTP + Socket.IO)
  worker/              BullMQ processors
packages/
  db/                  Prisma schema, cliente, migraciones
  shared/              Zod, permisos, estados, errores, i18n keys
  config/              schema de env
docs/                  esta documentación
infra/                 docker-compose, futuros Terraform
```

Dentro de `apps/api/src/modules/<nombre>/`:

```text
domain.ts          tipos y transiciones
service.ts         reglas de negocio
repository.ts      Prisma
routes.ts          HTTP
policy.ts          autorización
schemas.ts         Zod de entrada/salida
```

La UI no contiene reglas de reserva, transiciones ni permisos reales.

## 6. Stack y por qué

| Capa | Elección | Por qué | Descartado |
| --- | --- | --- | --- |
| Lenguaje | TypeScript end-to-end | Un solo modelo mental, Cursor productivo, tipos en API y UI | Python/Django (válido, pero dos lenguajes) |
| Web | Next.js App Router | SSR/SEO del portal, routing, ecosistema, App Router maduro | SPA Vite sola (peor portal público) |
| API | Fastify | Proceso largo (WS + cookies), menos magia que Nest, OpenAPI vía plugin | Nest (más ceremonia), Next Route Handlers como único backend (WS/workers flojos en serverless) |
| DB | PostgreSQL | Constraints, transacciones, índices, PITR, estándar hospitalario de facto | MySQL/Mongo (integridad más débil para este dominio) |
| ORM | Prisma | Migraciones, schema explícito, buen DX. SQL parametrizado | Drizzle (también válido; Prisma gana en onboarding) |
| Auth staff | Sesión opaca en DB + cookie | Revocación real, no JWT eterno | JWT en localStorage |
| Auth paciente | OTP WhatsApp | UX para personas mayores | Cuentas con password |
| Cola | Redis + BullMQ | Retrasos, reintentos, idempotencia, separado del request HTTP | Jobs dentro del request, cron en el API process |
| Realtime | Socket.IO | Reconexión, rooms, adapter Redis el día que haya 2 nodos | SSE (unidireccional), polling |
| Validación | Zod | Un schema, runtime + tipos | validar solo en UI |
| Hash de secretos | Argon2id | Contraseñas e tokens hasheados | bcrypt aceptable; texto plano prohibido |
| WAF / bot | Cloudflare Turnstile | Sin recaptcha invasivo en cada click | CAPTCHA en todo |
| Infra | Cloudflare + AWS sa-east-1 | WAF, RDS, VPC, backups, región cercana | K8s, serverless puro |

Detalle de auth, RBAC y headers: [SECURITY.md](SECURITY.md).  
Detalle de datos: [DATABASE.md](DATABASE.md).  
Detalle de API: [API.md](API.md).

## 7. Autenticación (resumen)

Tres identidades distintas:

1. **Personal del hospital** — correo de trabajo y contraseña. Sin código de 6 dígitos en cada ingreso. Cuentas individuales, nunca `usuario_medicos`.
2. **Paciente** — no hay password. Flujo: DNI + teléfono + Turnstile + OTP WhatsApp. Consulta de turnos: mismo desafío. Cambio de teléfono: recepción.
3. **Display** — token de dispositivo de alta entropía, hasheado en DB, revocable, sin acceso a pacientes.

Cookies de sesión staff: `HttpOnly`, `Secure` en prod, `SameSite=Lax`, path acotado, rotación al login, revocación masiva.

CSRF: same-origin (proxy único) + `SameSite` + comprobación de header `Origin`/`Host` en mutaciones. Tokens CSRF extra si algún día hay origen cruzado.

## 8. RBAC

Roles v1:

| Rol | Alcance |
| --- | --- |
| `SUPER_ADMIN` | Superusuario. Ve y controla todo. Los secretos siguen fuera de la base |
| `ADMINISTRACION` | Especialidades, profesionales, consultorios, agenda, estadísticas y auditoría |
| `SISTEMAS` | Usuarios, pantallas, configuración y auditoría |
| `RECEPCION` | Admisión: mostrador, turnos, pacientes, avisos y estadísticas |
| `ADMIN` | Rol anterior, se conserva. Catálogos, agendas, turnos, pantallas y usuarios que no son superusuario |
| `SUPERVISOR` | Rol anterior, se conserva. Agenda, turnos y auditoría |
| `MEDICO` | Solo su agenda, llamar, atendido, ausente |
| `DISPLAY` | Recibir eventos de llamados de sus consultorios |

Los permisos son strings estables (`appointments:call:own`). El frontend oculta botones **y** el backend responde 403. Object-level: un médico no opera `/appointments/:id` ajeno (IDOR).

## 9. API

REST versionada bajo `/api/v1`. OpenAPI generado desde schemas Zod/Fastify.  
IDs internos UUID. Códigos de turno públicos aparte. Paginación cursor para listados grandes. Errores estables `{ code, message, details? }` sin stack traces.

Ver [API.md](API.md).

## 10. Integridad de turnos (crítico)

Reservar no es “leer si está libre e insertar”.

Algoritmo de reserva:

1. Captcha/Turnstile + rate limit (IP, DNI, teléfono).
2. OTP verificado.
3. `BEGIN`
4. `SELECT ... FROM appointment_slots WHERE id = $slot FOR UPDATE`
5. Verificar AVAILABLE, profesional activo, especialidad, no feriado, no excepción, dentro de política.
6. Marcar slot `BOOKED`, insertar `appointments` CONFIRMED, historial, audit.
7. `COMMIT`
8. Encolar notificación. Si el enqueue falla, el turno **igual existe** (se reintenta el job).

Defensa en profundidad:

- Unique index `(professional_id, starts_at)` en slots activos
- Unique `appointments.slot_id`
- Transacción + `FOR UPDATE`
- Estado de slot, no booleano

Hold opcional: slot `HELD` con TTL 5–10 min durante OTP. Job libera holds vencidos. Unique sigue valiendo.

## 11. Horarios y generación de slots

Modelo: plantilla semanal + excepciones + feriados globales + bloqueos.

Job diario (y al guardar agenda) materializa slots de la ventana configurada. No se generan años enteros. No se reserva un horario que no tenga slot persistido en estado AVAILABLE (salvo sobreturno creado por staff autorizado, que inserta un slot EXTRA y lo reserva en la misma transacción).

## 12. Llamador en tiempo real

`POST /api/v1/appointments/:id/call` (médico dueño del turno):

1. Auth + rol + ownership.
2. Transición permitida CONFIRMED|CALLED → CALLED.
3. Insertar `appointment_calls` (cada rellamado es una fila).
4. Audit.
5. Emitir `PatientCalled` al room Socket.IO de los displays que incluyen ese consultorio.

Si el WebSocket falla, el llamado **quedó registrado**. El admin ve display `OFFLINE`. La TV, al reconectar, pide snapshot de llamados recientes.

Anti-doble tap: debounce servidor (p. ej. 5 s para el mismo turno salvo `recall=true` explícito).

Diseño TV/TTS: [TV_DISPLAY.md](TV_DISPLAY.md).

## 13. WhatsApp y colas

```text
Cambio de turno en DB
        → Notification (PENDING, scheduled_at)
        → BullMQ
        → WhatsAppService (interfaz)
        → proveedor
        → webhook de estado (firma verificada, idempotente)
```

El worker no espera dentro del request HTTP del paciente.  
Proveedor intercambiable. Tokens solo en secret manager.  
Plantillas aprobadas por Meta. Cuerpos no se loguean en claro.

Ver [WHATSAPP.md](WHATSAPP.md).

## 14. Lista de espera

Si no hay slot: el paciente puede anotarse (especialidad y opcionalmente profesional).  
Al cancelarse un turno elegible: job busca candidatos, envía oferta, **no asigna**. La oferta expira. El primero que confirma con OTP gana el slot (misma transacción de reserva). Política default: FIFO dentro del matching.

## 15. Auditoría

Tabla append-only `audit_logs`. Acciones de auth, RBAC, turnos, agenda, displays, templates, exportaciones. Metadata sin secretos ni PII completa (masking). Retención: propuesta 24 meses, validar legalmente.

## 16. Seguridad e infraestructura (resumen)

Defense in depth: Cloudflare → proxy → app (no-root) → VPC → PostgreSQL (usuario mínimo, TLS).  
Rate limiting por endpoint. Turnstile en OTP y reserva. Headers (CSP, HSTS, etc.). Zod en borde. Prisma parametrizado. Logs estructurados con masking.

Ver [SECURITY.md](SECURITY.md), [DEPLOYMENT.md](DEPLOYMENT.md).

## 17. Fechas

Almacenar instantes en `timestamptz` (UTC). Interpretar agenda civil en `America/Argentina/Buenos_Aires`. Argentina hoy sin DST; igual no hardcodear offsets. Recordatorios se calculan en esa zona.

## 18. i18n y configuración

Textos de UI por catálogo (español rioplatense v1). Nombre del hospital, ventanas de recordatorio, políticas de cancelación, TTS y mensajes: `system_settings` + env, no literales de negocio en React.

## 19. Ambientes

| Ambiente | Datos | Propósito |
| --- | --- | --- |
| development | seed ficticio | Laptops |
| staging | seed ficticio | QA, demo al director |
| production | reales | Hospital |

Tres DBs, tres secretos, tres URLs. Ver [ENVIRONMENT.md](ENVIRONMENT.md).

## 20. Disponibilidad y fallos

| Falla | Comportamiento |
| --- | --- |
| API reinicia | Sesiones en DB sobreviven; WS reconecta |
| Worker cae | Jobs quedan en Redis; se reintentan |
| Redis cae | API sigue sirviendo turnos (degradado: sin cola nueva). Alertar. Estrategia: no perder writes de turnos |
| WhatsApp cae | Turno ya persistido; reintentos; UI avisa “te contactaremos” |
| TV offline | Llamado auditado; badge OFFLINE |
| PostgreSQL cae | Sistema no opera (fuente de verdad). Restaurar según [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) |

RPO objetivo: **15 minutos** (PITR). RTO objetivo: **4 horas** para hospital pequeño/mediano. Validar con el hospital.

## 21. Plan por fases

El orden pedido se respeta. Cada fase cierra con tests del módulo, lint, typecheck y doc actualizada.

0. Arquitectura (este paquete)  
1. Repo base, Docker dev, auth staff, seguridad de borde  
2. Prisma schema + migraciones + seed ficticio  
3. Especialidades, profesionales, consultorios  
4. Horarios y disponibilidad  
5. Motor de turnos (estados, locks, reprogramación)  
6. Portal pacientes  
7. Panel admin  
8. Panel médico  
9. Llamador tiempo real  
10. TV + TTS  
11. WhatsApp  
12. Recordatorios  
13. Lista de espera  
14. Estadísticas  
15. Auditoría avanzada  
16. Testing amplio  
17. Hardening  
18. Staging  
19. Piloto  
20. Producción  

## 22. Criterio para pasar de Fase 0 a Fase 1

- Este documento y [DECISIONS.md](DECISIONS.md) revisados.
- Resueltos al menos: residencia de datos, proveedor WhatsApp (o “WhatsApp en fase 11, mock hasta entonces”), políticas de cancelación, MFA.
- Confirmado que no se implementa HC ni pagos.

WhatsApp puede mockearse hasta Fase 11 sin bloquear Fases 1–10.
