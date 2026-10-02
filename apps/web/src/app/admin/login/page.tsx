"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { staffHome } from "@/admin/role-labels";
import { Brand } from "@/brand/Brand";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";
import { useDemoData } from "@/demo/DemoDataProvider";

function DemoLoginActions() {
  const router = useRouter();
  const data = useDemoData();

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <p className="pill-demo">MODO DEMO</p>
      <p className="muted">
        No usa PostgreSQL ni la API de Fase 1. El formulario de arriba es el login real y fallará
        sin infraestructura.
      </p>
      <button
        type="button"
        onClick={() => {
          data.setSession({ role: "admin", label: "Admin demo" });
          router.push("/admin");
        }}
      >
        Entrar al panel admin (demo)
      </button>
      <p>
        <button
          type="button"
          onClick={() => {
            data.setSession({ role: "medico", label: "Médico demo" });
            router.push("/medico");
          }}
        >
          Entrar al panel médico (demo)
        </button>
      </p>
    </div>
  );
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    setShowDemo(isDemoUiEnabled());
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/auth/staff/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-turnos-client": "web" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as {
        mfaRequired?: boolean;
        mfaEnrollmentRequired?: boolean;
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          data.error?.message ??
            (showDemo
              ? "Login real no disponible sin API. Usá los botones de DEMO."
              : "No se pudo iniciar sesión."),
        );
        return;
      }
      if (data.mfaEnrollmentRequired) {
        router.push("/admin/mfa?mode=enroll");
        return;
      }
      if (data.mfaRequired) {
        router.push("/admin/mfa?mode=verify");
        return;
      }
      const me = await fetch("/api/v1/auth/staff/me", { credentials: "include" });
      const profile = (await me.json()) as { permissions?: string[] };
      router.push(staffHome(profile.permissions));
    } catch {
      setError(
        showDemo
          ? "Login real no disponible sin API. Usá los botones de DEMO."
          : "No se pudo iniciar sesión.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <header className="app-header">
        <Brand compact />
        <Link className="ghost" href="/">
          Inicio
        </Link>
      </header>
      <h1>Ingreso del personal</h1>
      <p className="muted">Usá el correo y la contraseña de tu puesto.</p>
      <form className="card" onSubmit={onSubmit}>
        {error ? <p className="error">{error}</p> : null}
        <label htmlFor="email">Correo</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
      {showDemo ? <DemoLoginActions /> : null}
    </main>
  );
}
