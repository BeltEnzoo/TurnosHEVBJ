# Portal de pacientes

Superficie pública, mobile-first, WCAG 2.2 AA razonable (contraste, labels, teclado, errores en texto no solo color). Español rioplatense. Botones grandes, pocos pasos.

## Flujo de reserva

1. Elegir especialidad  
2. Elegir profesional (opción “cualquiera / primer horario”)  
3. Elegir fecha (solo días con AVAILABLE)  
4. Elegir horario  
5. Datos: nombre, apellido, DNI, fecha de nacimiento, teléfono, email opcional  
6. Turnstile  
7. OTP por WhatsApp  
8. Resumen y confirmar  
9. Comprobante en pantalla: código, fecha, hora, especialidad, profesional, consultorio si ya está asignado  

No se pide motivo de consulta ni datos clínicos.

## Otros flujos

- Consultar próximos turnos: DNI + OTP  
- Cancelar / reprogramar dentro de la ventana configurable  
- Lista de espera si no hay cupos  

## UX de confianza

- Mostrar claramente que el hospital confirmará por WhatsApp  
- Si WhatsApp falla después del commit: “Tu turno está reservado. Si no llega el mensaje, conservá el código y comunicate.”  
- Nunca mostrar turnos de otro paciente  

## Accesibilidad y dispositivos

Responsive 320px–desktop. No depender de hover. Área táctil ≥ 44px. El comprobante debe poder copiarse o screenshot-friendly.

QR en el comprobante: no en v1 (gancho futuro).
