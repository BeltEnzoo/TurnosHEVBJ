# Llamador, televisores y voz

Ruta de UI: `/llamador`. Kiosk: pantalla completa, sin chrome de navegación del hospital (no links a admin).

## Qué muestra

```text
HOSPITAL MUNICIPAL          [estado conexión discreto]
TURNO
KT-7M4
DIRIGIRSE AL
CONSULTORIO 3
```

Lista corta de “últimos llamados” opcional, mismo criterio (código + consultorio).  
Nunca: nombre, DNI, nacimiento, teléfono, profesional (el profesional puede inferir consultorio; se acepta mostrar consultorio, no el paciente).

## Tiempo real

- Conexión Socket.IO autenticada con token de dispositivo  
- Heartbeat → `last_seen_at`  
- Reconexión automática con backoff  
- Al reconectar: snapshot  
- Si no hay red: banner “Sin conexión”, última información en pantalla, cola TTS local pausada o se drena lo ya recibido  

El backend no “deshace” un llamado si la TV estaba caída.

## Múltiples TVs

Cada display filtra por consultorios asignados. Un llamado al consultorio 3 llega a TVs que lo incluyen, no a laboratorio.

Admin ve ONLINE/OFFLINE/MAINTENANCE.

## TTS

v1: `speechSynthesis` del navegador, `lang=es-AR` (fallback `es-ES`). Cola FIFO: no superponer. Config: on/off, rate, volume, repeticiones, template `Turno {code}. Dirigirse al {office}.`

Arquitectura: `SpeechAdapter` en el cliente. Más adelante un provider de audio pre-renderizado (archivo o API) sin cambiar el evento `patient.called`.

## Seguridad física

Cualquiera frente a la TV es un observador. Token en almacenamiento del dispositivo kiosk, no en una cuenta humana. Robo → revocar. No modo debug en producción.

## Texto de diseño

Alta legibilidad: tipografía sans, peso bold, contraste WCAG, tamaños pensados a 3–5 m. Paleta sobria hospitalaria, no animaciones llamativas.
