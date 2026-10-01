# Fases 18 a 20 — Staging, piloto y producción

Estado: **bloqueadas fuera de este repositorio**. El software de las fases 0 a 17 está en el código. Ponerlo en staging, en un piloto o en producción necesita decisiones y recursos del hospital:

- Tres bases, tres secretos y tres URLs.
- `WHATSAPP_PROVIDER` oficial recién después de comparar costos, API y requisitos legales. El stub sigue sin vendor.
- `COOKIE_SECURE`, Turnstile y `WHATSAPP_WEBHOOK_SECRET` en staging y producción.
- PITR con RPO de 15 minutos. El Postgres local no lo cumple.
- Un responsable del hospital para el piloto.

No se marca producción como cerrada desde esta máquina.
