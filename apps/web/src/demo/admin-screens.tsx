"use client";

import { DemoApp, DemoNav } from "@/demo/DemoApp";
import { useDemoData } from "@/demo/DemoDataProvider";

function Dashboard() {
  const data = useDemoData();
  const confirmed = data.appointments.filter((item) => item.status === "CONFIRMED").length;
  const called = data.appointments.filter((item) => item.status === "CALLED").length;
  return (
    <div className="demo-page">
      <DemoNav variant="admin" />
      <p className="pill-demo">ADMIN · DEMO</p>
      <h1>Dashboard</h1>
      <p className="muted">Indicadores ficticios para recorrer la interfaz.</p>
      <div className="demo-actions" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => {
            data.setSession(null);
            window.location.href = "/admin/login";
          }}
        >
          Salir del demo admin
        </button>
      </div>
      <div className="demo-grid">
        <div className="card">
          <p className="muted">Especialidades</p>
          <h2>{data.specialties.length}</h2>
        </div>
        <div className="card">
          <p className="muted">Profesionales</p>
          <h2>{data.professionals.length}</h2>
        </div>
        <div className="card">
          <p className="muted">Turnos demo del día</p>
          <h2>{data.appointments.length}</h2>
        </div>
        <div className="card">
          <p className="muted">Confirmados / llamados</p>
          <h2>
            {confirmed} / {called}
          </h2>
        </div>
      </div>
    </div>
  );
}

export function DemoAdminDashboard() {
  return (
    <DemoApp>
      <Dashboard />
    </DemoApp>
  );
}
