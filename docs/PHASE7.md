# Fase 7 — Panel administrativo

Estado: **cerrada**. Tests de API en verde (30). El mostrador, la búsqueda de pacientes y el alta manual cargan en `/admin`. Fase 8: [PHASE8.md](PHASE8.md).

Fuera de esta fase: panel médico (Fase 8), llamador, TV y tokens de display, WhatsApp oficial, reenvío de avisos, lista de espera y estadísticas. El aviso de turno sigue pendiente y no se envía.

## Qué hace

- El personal entra por `/admin/login`. La navegación muestra solo lo que el rol puede hacer. La autorización sigue en el API.
- Recepción ve el mostrador del día, busca turnos, da de alta un turno, cancela, marca atendido o ausente, y busca pacientes por DNI o apellido.
- La búsqueda de pacientes es `POST /api/v1/admin/patients/search` para no dejar el DNI en la URL. Queda auditada, sin guardar el DNI en la auditoría.
- Administración y supervisión arman especialidades, profesionales, consultorios, horario semanal, feriados y regeneración de cupos.
- Solo `SUPER_ADMIN` cambia la configuración operativa y asigna el rol `SUPER_ADMIN`.
- Quien tiene `users:manage` crea usuarios, activa o desactiva, revoca sesiones y pide una contraseña temporal que se muestra una sola vez.
- La cola de avisos se lista sin teléfono ni DNI. No hay reenvío.

## API nuevo

- `POST /api/v1/admin/patients/search`
- `GET /api/v1/admin/appointments/:id` con historial de estados
- `GET /api/v1/admin/appointments?publicCode=`
- `GET|PATCH /api/v1/admin/settings`
- `GET|POST /api/v1/admin/users`
- `PATCH /api/v1/admin/users/:id`
- `POST /api/v1/admin/users/:id/reset-password`
- `POST /api/v1/admin/users/:id/revoke-sessions`
- `GET /api/v1/admin/notifications`

La lectura de catálogos admin también está abierta para quien reserva o arma agenda. Escribir catálogos sigue exigiendo `catalogs:write`.

`pnpm demo:ui` sigue siendo ficticia.
