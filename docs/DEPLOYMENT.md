# Deployment e infraestructura

## Topología recomendada (producción)

```text
Usuarios
   → Cloudflare (DNS, TLS, WAF, DDoS, Turnstile)
   → AWS ALB (sa-east-1)  [revisión legal: transferencia a Brasil]
   → Servicio `web` (Next.js) y servicio `api` (Fastify+WS)
   → Servicio `worker` (BullMQ), sin puerto público
   → RDS PostgreSQL (subred privada, cifrado, backups, PITR)
   → ElastiCache Redis (privada)
   → Secrets Manager
   → Copia de backups a S3 (otra cuenta o vault)
```

Misma zona / VPC. Security groups: API solo desde ALB; DB/Redis solo desde API y worker.

Escalado inicial: 1–2 tasks api, 1 worker, RDS small/medium. Horizontal: Socket.IO adapter Redis.

## Por qué no

- **Kubernetes:** no hay equipo de plataforma.
- **Vercel + serverless API:** WebSockets y BullMQ no encajan.
- **DB en un PC del hospital:** sin PITR, sin UPS institucional, backup informal.
- **Un VPS con todo expuesto:** solo aceptable como laboratorio, no prod.

## Docker

Imágenes distroless o node slim, usuario no root, HEALTHCHECK, secrets por env inyectado, no bakeados. `docker-compose` para development (web, api, worker, postgres, redis).

## CI/CD

GitHub (o equivalente) sobre `main` / `develop` / `feature/*`.

```text
PR → lint → typecheck → unit → integration → npm audit → build
     → deploy staging (manual o auto)
     → producción: aprobación humana
```

No CD automático a prod en v1.

## Dominio y HTTPS

Hostname configurable. Certificado en Cloudflare o ACM. Sin HTTP plano en prod.

## Monitoreo

`/health`, `/ready`. Métricas: latencia API, profundidad de cola, fallos WhatsApp, displays offline, errores 5xx. Alertas a un canal del hospital (email/Telegram interno), **sin PII** en el texto de la alerta.

Error tracking opcional con scrubbing. Evaluar DPA antes de activar.

## Administración del host

SSH keys, sin password, sin app como root, parches, reloj NTP. Terraform más adelante; v1 puede ser consola AWS documentada paso a paso para poder reproducir.

## Costos (orden de magnitud, no cotización)

Hospital chico: Cloudflare (a menudo free/pro) + RDS + Redis + 2 servicios 24/7 en sa-east-1 suele ser más caro que un VPS único, y es el piso profesional. Cotizar en el momento del piloto. WhatsApp es costo variable por conversación.

## Checklist pre-producción (resumen)

SECURITY, DATABASE, BACKUPS (restauración probada), AUTH, MFA, RBAC, LOGGING, AUDIT, WHATSAPP, WEBHOOKS, WEBSOCKETS, TV, TTS, MONITORING, TESTS, LOAD (reserva concurrente), DR, PRIVACY, LEGAL REVIEW.

Nada se marca completo si solo “está codeado”.
