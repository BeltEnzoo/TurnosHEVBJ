# Fase 3 — Especialidades, profesionales y consultorios

Estado: **cerrada**. Tests de catálogos en verde. Fase 4: [PHASE4.md](PHASE4.md).

Fuera de esta fase: horarios y cupos (Fase 4), motor de turnos (Fase 5), auth HTTP de pacientes, TV, displays, llamador y WhatsApp oficial. El panel admin completo es Fase 7; esta fase expone el API.

## API

Público, solo registros activos, sin matrícula ni usuario vinculado:

- `GET /api/v1/specialties`
- `GET /api/v1/professionals?specialtyId=`

Admin, cookie de personal con MFA si el rol es sensible, permiso `catalogs:write` (`SUPER_ADMIN` y `ADMIN`):

- `POST|GET|PATCH /api/v1/admin/specialties`
- `POST|GET|PATCH /api/v1/admin/professionals`
- `POST|GET|PATCH /api/v1/admin/offices`

No hay borrado físico. Desactivar es `PATCH` con `deactivated: true`. Un profesional puede vincularse a un usuario de personal ya existente; esta fase no crea cuentas ni contraseñas.

Cada alta y cada cambio deja una fila en `audit_logs`.
