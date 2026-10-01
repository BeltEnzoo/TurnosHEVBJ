"use client";

import { DemoApp } from "@/demo/DemoApp";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";
import { useDemoData } from "@/demo/DemoDataProvider";
import { DemoNav } from "@/demo/DemoApp";
import { formatDemoDate } from "@/demo/catalog";
import { MedicalAgenda } from "@/medico/MedicalAgenda";

function statusLabel(status: string): string {
  if (status === "CALLED") return "Llamado";
  if (status === "COMPLETED") return "Atendido";
  if (status === "NO_SHOW") return "Ausente";
  return "Confirmado";
}

function MedicalAgendaDemo() {
  const data = useDemoData();
  const mine = data.appointments.filter((item) => item.professionalId === "pr-perez");

  return (
    <div className="demo-page">
      <DemoNav variant="admin" />
      <p className="pill-demo">PANEL MÉDICO · DEMO</p>
      <h1>Agenda del día — Dra. Pérez (demo)</h1>
      <p className="muted">
        Los cambios de estado son solo visuales en este navegador. Abrí /llamador en otra pestaña para ver el llamado.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.85rem" }}>
        {mine.map((item) => (
          <li key={item.id} className="card">
            <p>
              <strong>
                {item.time} — {item.publicCode}
              </strong>
            </p>
            <p>{item.patientLabel}</p>
            <p className="muted">
              {formatDemoDate(item.date)} · {statusLabel(item.status)}
            </p>
            <div className="demo-actions">
              <button className="primary" type="button" onClick={() => data.callAppointment(item.id)}>
                LLAMAR PACIENTE
              </button>
              <button type="button" onClick={() => data.callAppointment(item.id, true)}>
                VOLVER A LLAMAR
              </button>
              <button type="button" onClick={() => data.markCompleted(item.id)}>
                MARCAR ATENDIDO
              </button>
              <button type="button" onClick={() => data.markNoShow(item.id)}>
                MARCAR AUSENTE
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MedicalPage() {
  if (isDemoUiEnabled()) {
    return (
      <DemoApp>
        <MedicalAgendaDemo />
      </DemoApp>
    );
  }
  return <MedicalAgenda />;
}
