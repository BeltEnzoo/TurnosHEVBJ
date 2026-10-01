"use client";

import Link from "next/link";
import { Brand } from "@/brand/Brand";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function HomePage() {
  if (!isDemoUiEnabled()) {
    return (
      <main className="home">
        <Brand />
        <h1>Turnos</h1>
        <p className="home-lead">Reservá un turno o entrá si trabajás en el hospital.</p>
        <div className="home-actions">
          <Link className="home-card" href="/portal">
            <span>Pacientes</span>
            <strong>Sacar o ver un turno</strong>
          </Link>
          <Link className="home-card" href="/admin/login">
            <span>Personal</span>
            <strong>Ingreso al sistema</strong>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="demo-page" style={{ maxWidth: "36rem" }}>
      <p className="pill-demo">DEMO VISUAL</p>
      <h1>Hospital Eva Perón</h1>
      <p className="muted">
        Recorrido de interfaz con datos ficticios. No hay reservas reales ni base de datos.
      </p>
      <div className="hub-links">
        <Link href="/portal">Portal del paciente</Link>
        <Link href="/admin/login">Ingreso del personal</Link>
        <Link href="/medico">Panel médico</Link>
        <Link href="/llamador">Pantalla de TV / llamador</Link>
      </div>
    </main>
  );
}
