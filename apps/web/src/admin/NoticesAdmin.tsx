"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "./AdminShell";
import { adminApi } from "./api";

type Notice = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  publicCode: string | null;
  scheduledAt: string | null;
};

export function NoticesAdmin() {
  return (
    <AdminShell title="Avisos" permission="appointments:write">
      <NoticesBody />
    </AdminShell>
  );
}

function NoticesBody() {
  const [items, setItems] = useState<Notice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<{ items: Notice[] }>("/api/v1/admin/notifications?limit=50")
      .then((body) => setItems(body.items))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <p className="muted">
        Estos avisos salen por WhatsApp desde el worker. En este equipo el proveedor es de prueba y el panel no reenvía mensajes.
      </p>
      <div className="card">
        {items.length === 0 ? <p className="muted">No hay avisos.</p> : null}
        <table className="admin-table">
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.publicCode ?? "—"}</td>
                <td>{item.type}</td>
                <td>{item.status}</td>
                <td>{item.attempts} intentos</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
