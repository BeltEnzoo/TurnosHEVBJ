"use client";

import { MyAppointments } from "@/portal/MyAppointments";
import { DemoApp, DemoNav } from "@/demo/DemoApp";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";
import { useDemoData } from "@/demo/DemoDataProvider";
import { formatDemoDate } from "@/demo/catalog";

function MyAppointmentsDemo() {
  const data = useDemoData();
  return (
    <div className="demo-page">
      <DemoNav variant="portal" />
      <p className="pill-demo">DEMO</p>
      <h1>Mis turnos</h1>
      {data.myAppointments.length === 0 ? (
        <p className="muted">No hay turnos de demostración todavía. Sacá uno en el portal.</p>
      ) : (
        <div className="demo-table-wrap">
          <table className="demo-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.myAppointments.map((item) => (
                <tr key={item.id}>
                  <td>{item.publicCode}</td>
                  <td>{formatDemoDate(item.date)}</td>
                  <td>{item.time}</td>
                  <td>{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MyAppointmentsPage() {
  if (!isDemoUiEnabled()) {
    return <MyAppointments />;
  }
  return (
    <DemoApp>
      <MyAppointmentsDemo />
    </DemoApp>
  );
}
