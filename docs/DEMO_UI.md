# Capa visual DEMO (no es Fase 2)

Capa de interfaz para recorrer el sistema **sin Docker, PostgreSQL ni Redis**.  
No implementa turnos reales, reservas, WhatsApp, ni el modelo `patients`.  
**Imposible de activar en `NODE_ENV=production`.**

La capa DEMO no es el modelo de Fase 2. Los datos de esta interfaz siguen siendo mock.

## Cómo ejecutar

Desde la raíz del repo:

```bash
pnpm demo:ui
```

Abrir [http://localhost:3000](http://localhost:3000)

No hace falta `docker compose` ni `pnpm db:*`.

## Recorrido sugerido

1. Inicio → Portal del paciente (especialidad → profesional → fecha → horario → confirmación ficticia).
2. Mis turnos (lista mock en memoria del navegador).
3. Ingreso del personal → **Entrar al panel admin (demo)** (no uses el formulario real sin API).
4. Dashboard, especialidades, profesionales, consultorios, horarios, turnos, configuración.
5. Panel médico → Llamar paciente.
6. Abrí `/llamador` en otra pestaña para ver el código y el consultorio.

## Qué es mock

Todo lo de `/portal`, `/admin/*` (en este modo), `/medico` y `/llamador`: catálogo, horarios, turnos, estados y llamados. El llamado usa `BroadcastChannel` local, no Socket.IO.

El formulario de `/admin/login` sigue siendo el login **real** de Fase 1; sin API va a fallar. Los botones DEMO están separados debajo.

## Apagado

`pnpm dev` / `pnpm build` / producción no activan esta capa salvo `NEXT_PUBLIC_DEMO_UI=true` en development, y el script `demo` se niega a correr si `NODE_ENV=production`.
