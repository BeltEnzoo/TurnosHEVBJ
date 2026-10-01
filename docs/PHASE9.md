# Fase 9 — Llamador en tiempo real

Estado: **cerrada**. Tests de API en verde (32). Un llamado del médico llega a la pantalla conectada del consultorio, con código y consultorio, sin nombre ni DNI. Fase 10: [PHASE10.md](PHASE10.md).

Fuera de esta fase: la pantalla de TV y la voz (Fase 10), WhatsApp oficial, lista de espera y estadísticas.

## Qué hace

- El proceso API abre Socket.IO en el namespace `/ws/displays`. El token de la pantalla va en el handshake, no en la URL.
- Un llamado o un volver a llamar se emite como `patient.called` solo a las pantallas del consultorio. El mensaje lleva código, consultorio y texto para leer. No lleva nombre ni DNI.
- Si ninguna pantalla de ese consultorio está conectada, el llamado igual queda guardado con resultado `DISPLAY_OFFLINE`. Si al menos una recibió el evento, el resultado es `EMITTED`.
- Al reconectar, `GET /displays/me/snapshot` devuelve los llamados de los últimos 30 minutos de sus consultorios.
- El admin con `displays:manage` ve en `/admin/pantallas` si cada pantalla está en línea, sin el token.

## API

- Socket.IO `/ws/displays`, evento `patient.called`
- `GET /api/v1/displays/me`
- `GET /api/v1/displays/me/snapshot`
- `POST /api/v1/displays/me/heartbeat`
- `GET /api/v1/admin/displays`

`pnpm demo:ui` sigue siendo ficticia. La pantalla `/llamador` está en la Fase 10.
