"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "./AdminShell";
import { adminApi } from "./api";

type DisplayRow = {
  id: string;
  name: string;
  location: string | null;
  status: string;
  lastSeenAt: string | null;
  offices: Array<{ code: string; name: string }>;
};

const STATUS: Record<string, string> = {
  ONLINE: "En línea",
  OFFLINE: "Sin conexión",
  MAINTENANCE: "Mantenimiento",
};

export function DisplaysAdmin() {
  return (
    <AdminShell title="Pantallas" permission="displays:manage">
      <DisplaysBody />
    </AdminShell>
  );
}

function DisplaysBody() {
  const [items, setItems] = useState<DisplayRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<{ items: DisplayRow[] }>("/api/v1/admin/displays")
      .then((body) => setItems(body.items))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <p className="muted">El estado cambia cuando la pantalla se conecta al llamador. No se muestra el token.</p>
      <div className="card">
        {items.length === 0 ? <p className="muted">No hay pantallas.</p> : null}
        <table className="admin-table">
          <thead>
            <tr>
              <th>Pantalla</th>
              <th>Lugar</th>
              <th>Consultorios</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.location ?? "—"}</td>
                <td>{item.offices.map((office) => office.code).join(", ") || "—"}</td>
                <td>{STATUS[item.status] ?? item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
