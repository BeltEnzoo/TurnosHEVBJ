# Fase 10 — TV y voz

Estado: **cerrada**. La pantalla `/llamador` muestra el código y el consultorio, y el navegador lee el llamado. Los avisos de WhatsApp están en [PHASE11.md](PHASE11.md).

Fuera de esta fase: WhatsApp oficial, lista de espera y estadísticas.

## Qué hace

- `/llamador` pide una vez el token de la pantalla y lo guarda en ese navegador. No hay enlaces al panel.
- Conecta por Socket.IO al namespace `/ws/displays`. Si se corta, queda el último llamado y el aviso «Sin conexión». Al volver, pide el snapshot.
- Muestra el nombre del hospital, el código y el consultorio. La lista de últimos llamados usa el mismo criterio. No muestra nombre, DNI, teléfono ni profesional.
- La voz usa `speechSynthesis`, en español, en cola y sin superponerse. Respeta si la pantalla tiene la voz apagada, el volumen, la velocidad y las repeticiones.
- `pnpm demo:ui` sigue siendo ficticia.

## Comprobación

Un volver a llamar de Laura Benítez hizo aparecer `M9-4K2` y Consultorio 1 en `/llamador`, y el navegador leyó ese texto. La página no contenía el nombre del paciente.
