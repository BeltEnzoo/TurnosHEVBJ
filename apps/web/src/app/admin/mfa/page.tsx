"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function MfaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const enroll = params.get("mode") === "enroll";
  const [code, setCode] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startEnroll() {
    setError(null);
    const response = await fetch("/api/v1/auth/staff/mfa/enroll/start", {
      method: "POST",
      credentials: "include",
      headers: { "x-turnos-client": "web" },
    });
    const data = (await response.json()) as { otpauthUrl?: string; error?: { message: string } };
    if (!response.ok) {
      setError(data.error?.message ?? "No se pudo iniciar MFA.");
      return;
    }
    setOtpauthUrl(data.otpauthUrl ?? null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const url = enroll ? "/api/v1/auth/staff/mfa/enroll/confirm" : "/api/v1/auth/staff/mfa/verify";
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-turnos-client": "web" },
      body: JSON.stringify({ code }),
    });
    const data = (await response.json()) as {
      recoveryCodes?: string[];
      error?: { message: string };
    };
    if (!response.ok) {
      setError(data.error?.message ?? "Código inválido.");
      return;
    }
    if (data.recoveryCodes) {
      setRecovery(data.recoveryCodes);
      return;
    }
    router.push("/admin");
  }

  return (
    <main>
      <h1>{enroll ? "Activar MFA" : "Verificación MFA"}</h1>
      <form className="card" onSubmit={onSubmit}>
        {error ? <p className="error">{error}</p> : null}
        {enroll && !otpauthUrl ? (
          <button type="button" onClick={() => void startEnroll()}>
            Generar código de aplicación
          </button>
        ) : null}
        {otpauthUrl ? (
          <p className="muted">
            Cargá esta clave en tu aplicación TOTP (no la compartas): {otpauthUrl}
          </p>
        ) : null}
        {recovery ? (
          <div>
            <p>Guardá estos códigos de recuperación. Se muestran una sola vez.</p>
            <ul>
              {recovery.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button type="button" onClick={() => router.push("/admin")}>
              Continuar
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="code">Código de 6 dígitos</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <button type="submit">Confirmar</button>
          </>
        )}
      </form>
    </main>
  );
}

export default function MfaPage() {
  return (
    <Suspense fallback={<main>Cargando…</main>}>
      <MfaForm />
    </Suspense>
  );
}
