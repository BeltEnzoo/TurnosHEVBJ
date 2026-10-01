"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { isDemoUiEnabled } from "./is-demo-ui";
import "./demo.css";

export function DemoDisabledNotice() {
  return (
    <main>
      <h1>Capa visual DEMO inactiva</h1>
      <p className="muted">
        Esta pantalla es solo de demostración. Ejecutá <code>pnpm demo:ui</code> desde la raíz del
        proyecto.
      </p>
    </main>
  );
}

export function DemoApp({ children }: { children: ReactNode }) {
  if (!isDemoUiEnabled()) {
    return <DemoDisabledNotice />;
  }
  return children;
}

export function DemoNav({ variant }: { variant: "admin" | "portal" }) {
  if (variant === "portal") {
    return (
      <nav className="demo-nav" aria-label="Portal demo">
        <Link href="/">Inicio</Link>
        <Link href="/portal">Sacar turno</Link>
        <Link href="/portal/mis-turnos">Mis turnos</Link>
      </nav>
    );
  }
  return (
    <nav className="demo-nav" aria-label="Administración demo">
      <Link href="/admin">Dashboard</Link>
      <Link href="/admin/especialidades">Especialidades</Link>
      <Link href="/admin/profesionales">Profesionales</Link>
      <Link href="/admin/consultorios">Consultorios</Link>
      <Link href="/admin/horarios">Horarios</Link>
      <Link href="/admin/turnos">Turnos</Link>
      <Link href="/admin/configuracion">Configuración</Link>
      <Link href="/medico">Panel médico</Link>
      <Link href="/llamador">TV llamador</Link>
    </nav>
  );
}
