# ADR-006 — MFA para cuentas administrativas

- Estado: en pausa para el ingreso diario
- Fecha: 2026-09-15
- Actualización 2026-09-30: el hospital pidió que Admisión, Sistemas, Administración y Superusuario entren solo con correo y contraseña. El código de 6 dígitos no se pide al iniciar sesión.

## Contexto

Cuentas admin pueden exportar datos, cambiar agendas y revocar sesiones. Password-only es insuficiente. El hospital municipal puede tener PCs compartidas.

## Decisión

TOTP (app de autenticación) obligatorio para `SUPER_ADMIN` y `ADMIN` antes de producción. Códigos de recuperación hasheados, de un solo uso. MFA no se desactiva a sí mismo sin otro SUPER_ADMIN. Recepción/médicos: disponible en v1, política a confirmar.

No SMS-OTP como segundo factor del personal (SIM swap). WhatsApp OTP es solo para pacientes.

## Alternativas

- WebAuthn/llaves: mejor, más fricción de rollout; fase posterior.
- MFA email: débil si el buzón está abierto en la misma PC.

## Consecuencias

- Onboarding de personal con enrolamiento TOTP.
- Lockout y rate limit siguen aplicando al factor contraseña y al TOTP.
