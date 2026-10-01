# Riesgos

| ID | Riesgo | Impacto | Mitigación |
| --- | --- | --- | --- |
| R1 | Transferencia internacional (São Paulo) no aceptada legalmente | Bloquea cloud elegido | Confirmar con legal; plan B datacenter AR |
| R2 | Demora de verificación Meta / plantillas | Piloto sin WhatsApp | Mock hasta Fase 11; recepción como canal |
| R3 | Doble reserva | Caos operativo y legal | Transacción + FOR UPDATE + unique + test de carrera |
| R4 | IDOR entre médicos o pacientes | Fuga de PII | Tests BOLA, UUIDs, 404 |
| R5 | OTP / WhatsApp abusado (bots, spam) | Costo y denegación | Turnstile, rate limit, topes |
| R6 | Teléfono compartido / SIM swap | Suplantación | Topes, cambio de teléfono en recepción, audit |
| R7 | TV en Wi‑Fi inestable | Sala de espera muda | Reconnect, snapshot, llamado persistido |
| R8 | Redis caído | Jobs y rate limit degradados | Turnos en PG; alerta; reencolar |
| R9 | Secretos en Git o laptops | Compromiso | gitignore, secret manager, rotación |
| R10 | Scope creep a historia clínica | Riesgo legal y de producto | Rechazar campos clínicos |
| R11 | Un solo desarrollador + Cursor | Bus factor | Docs, ADRs, módulos claros |
| R12 | Subestimar carga del primer día de campaña | Caída a la mañana | Prueba de carga en piloto, WAF |
| R13 | Personal compartiendo cuentas | Pérdida de audit | Cuentas nominadas, política hospitalaria |
| R14 | Backup nunca restaurado | Falsa seguridad | Ejercicio trimestral |
| R15 | CSP / Turnstile mal configurados | XSS o portal roto | Ajustar en staging, no 'unsafe-inline' masivo |

Ningún riesgo de esta lista se “cierra” en Fase 0: se diseñan controles y se verifican en las fases 16–19.
