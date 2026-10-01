# Panel administrativo

Destinado a desktop. Admisión, Sistemas, Administración y Superusuario ven menús distintos. La UI se adapta, el API aplica la verdad. El ingreso es correo y contraseña.

## Módulos

### Catálogos

Especialidades, profesionales (alta de cuenta individual), consultorios, displays (emisión/revocación de token, consultorios asignados, estado ONLINE/OFFLINE).

### Agenda

Horario semanal, excepciones, feriados, bloqueos, regeneración de slots, sobturnos (quién, cuándo, audit).

### Turnos

Búsqueda por código, DNI, fecha, profesional, estado. Alta manual (paciente que llama por teléfono). Cancelar, reprogramar, marcar atendido/ausente según permiso. Historial de estados visible.

### Pacientes

Búsqueda por DNI/nombre con rate limit y audit. Ficha mínima: identidad, contacto, turnos. Sin pestaña “historia clínica”.

### WhatsApp / notificaciones

Cola: pendiente, enviado, entregado, leído, fallido, reintentos. Reenviar manual con permiso. No se muestran plantillas crudas con PII extra.

### Estadísticas

Agregados: totales, atendidos, cancelados, ausentes, reprogramados, por especialidad/profesional/período, demanda por hora. Sin listados nominados en el dashboard. Export CSV/XLSX/PDF: permiso extra + audit + mínimo de columnas.

### Usuarios

Alta, rol, activar/desactivar, reset, revocar sesiones, ver último acceso e intentos fallidos (no ver el password). Solo SUPER_ADMIN asigna SUPER_ADMIN.

### Configuración

Nombre del hospital, ventanas de recordatorio, cancelación, horizonte de reserva, texto TTS, opt-in WhatsApp. Cambios auditados.

## Recepción

Vista de “mostrador”: agenda del día, buscar paciente, crear turno, no entra a settings ni a MFA de otros.
