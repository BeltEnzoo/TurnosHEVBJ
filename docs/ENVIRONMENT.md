# Ambientes

| | development | test | staging | production |
| --- | --- | --- | --- | --- |
| Datos | seed ficticio | seed/efímero ficticio | seed ficticio | reales |
| Secretos | `.env` local | CI secrets / env de job | secretos del proveedor | secret manager |
| DB / Redis | docker-compose | compose o services de CI | instancias propias | instancias propias, privadas |
| WhatsApp | mock | mock | sandbox o número de prueba | WABA del hospital (vendor a elegir) |
| URL | localhost | n/a | staging.<dominio> | turnos.<dominio> |
| Ingreso personal | correo y contraseña | cubierto por tests | correo y contraseña | correo y contraseña |
| Logs | consola | silencio o archivo de test | retenidos cortos | retenidos según política |
| Cloudflare | off | off | on | on + WAF |

Nunca restaurar un backup de producción sobre development o test.  
Nunca conectar el `.env` de prod en la laptop.  
Nunca usar datos reales de pacientes fuera de production.

Variables: ver `.env.example` en la raíz. Cada ambiente tiene valores distintos, mismos nombres.

Staging es el entorno de **demo al director** (flujo completo con mock o WhatsApp de prueba y una TV de ensayo).
