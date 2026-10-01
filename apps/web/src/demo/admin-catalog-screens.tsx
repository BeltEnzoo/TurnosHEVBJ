"use client";

import type { ReactNode } from "react";
import { DemoApp, DemoNav } from "@/demo/DemoApp";
import { useDemoData } from "@/demo/DemoDataProvider";
import { formatDemoDate } from "@/demo/catalog";

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="demo-page">
      <DemoNav variant="admin" />
      <p className="pill-demo">ADMIN · DEMO</p>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

export function DemoSpecialtiesScreen() {
  return (
    <DemoApp>
      <SpecialtiesTable />
    </DemoApp>
  );
}

function SpecialtiesTable() {
  const data = useDemoData();
  return (
    <Screen title="Especialidades">
      <div className="demo-table-wrap">
        <table className="demo-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Orden</th>
            </tr>
          </thead>
          <tbody>
            {data.specialties.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.sortOrder}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Screen>
  );
}

export function DemoProfessionalsScreen() {
  return (
    <DemoApp>
      <ProfessionalsTable />
    </DemoApp>
  );
}

function ProfessionalsTable() {
  const data = useDemoData();
  return (
    <Screen title="Profesionales">
      <div className="demo-table-wrap">
        <table className="demo-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Especialidad</th>
              <th>Consultorio</th>
            </tr>
          </thead>
          <tbody>
            {data.professionals.map((item) => (
              <tr key={item.id}>
                <td>{item.displayName}</td>
                <td>{data.specialties.find((row) => row.id === item.specialtyId)?.name}</td>
                <td>{data.offices.find((row) => row.id === item.officeId)?.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Screen>
  );
}

export function DemoOfficesScreen() {
  return (
    <DemoApp>
      <OfficesTable />
    </DemoApp>
  );
}

function OfficesTable() {
  const data = useDemoData();
  return (
    <Screen title="Consultorios">
      <div className="demo-table-wrap">
        <table className="demo-table">
          <thead>
            <tr>
              <th>Identificación</th>
            </tr>
          </thead>
          <tbody>
            {data.offices.map((item) => (
              <tr key={item.id}>
                <td>{item.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Screen>
  );
}

export function DemoSchedulesScreen() {
  return (
    <DemoApp>
      <SchedulesTable />
    </DemoApp>
  );
}

function SchedulesTable() {
  const data = useDemoData();
  const preview = data.slots.slice(0, 12);
  return (
    <Screen title="Horarios">
      <p className="muted">Muestra de cupos ficticios. No hay motor de disponibilidad real.</p>
      <div className="demo-table-wrap">
        <table className="demo-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Profesional</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((item) => (
              <tr key={item.id}>
                <td>{formatDemoDate(item.date)}</td>
                <td>{item.time}</td>
                <td>
                  {data.professionals.find((row) => row.id === item.professionalId)?.displayName}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Screen>
  );
}

export function DemoAppointmentsScreen() {
  return (
    <DemoApp>
      <AppointmentsTable />
    </DemoApp>
  );
}

function AppointmentsTable() {
  const data = useDemoData();
  return (
    <Screen title="Turnos">
      <p className="muted">Listado ficticio. Sin persistencia.</p>
      <div className="demo-table-wrap">
        <table className="demo-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Hora</th>
              <th>Paciente (etiqueta demo)</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {data.appointments.map((item) => (
              <tr key={item.id}>
                <td>{item.publicCode}</td>
                <td>{item.time}</td>
                <td>{item.patientLabel}</td>
                <td>{item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Screen>
  );
}

export function DemoSettingsScreen() {
  return (
    <DemoApp>
      <Screen title="Configuración">
        <div className="card">
          <p>Hospital Municipal (demo)</p>
          <p className="muted">Cancelación: 2 horas antes (valor de muestra, no aplica reglas reales).</p>
          <p className="muted">Recordatorios: 48 h y 3 h (solo texto).</p>
          <p className="muted">WhatsApp, TTS y WebSocket no están activos en esta capa.</p>
        </div>
      </Screen>
    </DemoApp>
  );
}
