# Sistema integral de turnos — Hospital Municipal

Sistema web de gestión de turnos para un hospital municipal de Argentina. Permite a los habitantes solicitar, consultar, cancelar y reprogramar turnos sin llamar ni concurrir al hospital, y da al personal herramientas de agenda, llamado en sala de espera, notificaciones por WhatsApp y auditoría.

Arquitectura **aprobada**. Requisitos normativos: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md). Fase en curso: **1** ([docs/PHASE1.md](docs/PHASE1.md)).

## Estado actual

| Fase | Contenido | Estado |
| --- | --- | --- |
| 0 | Arquitectura y documentación | Aprobada |
| 1 | Base del proyecto + autenticación + seguridad | Lista para tests Docker |
| 2–20 | Resto de módulos | No iniciar |

## Cómo leer la documentación

Empezar por estos documentos:

1. [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — requisitos aprobados.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — visión y stack.
3. [docs/PHASE1.md](docs/PHASE1.md) — plan e implementación de la fase actual.
4. [docs/DEMO_UI.md](docs/DEMO_UI.md) — capa visual DEMO (sin infraestructura).

El resto:

| Documento | Tema |
| --- | --- |
| [docs/DATABASE.md](docs/DATABASE.md) | ERD, tablas, constraints, estados |
| [docs/API.md](docs/API.md) | API REST versionada y errores |
| [docs/PATIENT_PORTAL.md](docs/PATIENT_PORTAL.md) | Portal público |
| [docs/ADMIN_PANEL.md](docs/ADMIN_PANEL.md) | Panel administrativo |
| [docs/MEDICAL_PANEL.md](docs/MEDICAL_PANEL.md) | Panel médico |
| [docs/TV_DISPLAY.md](docs/TV_DISPLAY.md) | Llamador, TV, TTS |
| [docs/WHATSAPP.md](docs/WHATSAPP.md) | Proveedor, plantillas, webhooks |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | development / staging / production |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Infraestructura y CI/CD |
| [docs/BACKUP.md](docs/BACKUP.md) | Backups |
| [docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md) | RPO/RTO y restauración |
| [docs/TESTING.md](docs/TESTING.md) | Estrategia de pruebas |
| [docs/INSTALL.md](docs/INSTALL.md) | Instalación y desarrollo local |
| [docs/adrs/](docs/adrs/) | ADRs individuales |

## Principios que no se negocian

- PostgreSQL es la fuente de verdad. WhatsApp, la TV y el frontend no lo son.
- El frontend nunca se considera confiable. Autorización siempre en backend.
- No hay doble reserva: transacción + lock + constraint único.
- No se muestran nombres ni DNI en televisores. Solo código de turno y consultorio.
- No se almacena historia clínica. Esto no es un sistema de HC.
- No se usa WhatsApp Web automatizado.
- No hay secretos en Git. PostgreSQL no se expone a Internet.
- Datos reales de pacientes: solo en producción, nunca en development ni staging.

## Stack aprobado

- **Web:** Next.js + TypeScript
- **API:** Fastify + TypeScript (monolito modular)
- **DB:** PostgreSQL + Prisma
- **Cola:** Redis + BullMQ
- **Tiempo real:** Socket.IO (fase del llamador; no se instala en Fase 1)
- **Auth personal:** sesión en cookie HttpOnly + MFA TOTP para administración
- **Auth paciente:** DNI + OTP por WhatsApp (sin contraseña)
- **Infra producción:** Cloudflare + AWS `sa-east-1` (São Paulo), sujeta a revisión legal de transferencia internacional

## Instalación rápida

Ver [docs/INSTALL.md](docs/INSTALL.md).

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres redis
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm test
pnpm dev
```

Pagos, documentos clínicos, recetas, telemedicina, kiosco, check-in, confirmación interactiva por WhatsApp, llamador por nombre, Kubernetes, microservicios.

La arquitectura deja ganchos para esas extensiones, sin implementarlas.

## Desarrollo con Cursor

Antes de cada cambio importante: identificar archivos, explicar impacto, implementar, tests/lint/typecheck, revisar seguridad, actualizar documentación. No reemplazar archivos enteros sin necesidad. No inventar APIs.

## Aviso legal

Cumplir técnicamente con esta arquitectura **no equivale** a cumplimiento legal automático. Ley 25.326 y normativa relacionada deben ser validadas por el responsable legal/compliance del hospital. Ver [docs/SECURITY.md](docs/SECURITY.md).
