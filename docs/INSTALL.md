# Instalación y desarrollo local

Requisitos: Node.js 22, pnpm 9+, **Docker Desktop** (PostgreSQL y Redis de desarrollo).

Si `docker` no está en el PATH, los tests de integración y `pnpm dev` contra la base no van a funcionar. Instalá Docker Desktop, abrí una terminal nueva y repetí `docker compose up -d`.

```bash
cd sist_turnos_HEP
cp .env.example .env
# Completar SESSION_SECRET y FIELD_ENCRYPTION_KEY (32 bytes en base64).
# En development se pueden generar con:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

pnpm install
docker compose up -d postgres redis
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000  
- API directa: http://localhost:3001 (los browsers deben usar el rewrite de Next: `/api/v1`)  
- Health: http://localhost:3001/api/v1/health  

Seed de usuario admin ficticio: **solo** `development`/`test` con `ALLOW_DEV_SEED=true` y base en localhost. Nunca staging ni producción.

```bash
pnpm test
pnpm typecheck
pnpm lint
```

No usar datos reales. No copiar `.env` de producción.
