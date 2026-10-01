"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "./AdminShell";
import { adminApi } from "./api";

type Row = {
  id: string;
  at: string;
  actorType: string;
  action: string;
  entityType: string | null;
};

export function AuditAdmin() {
  return (
    <AdminShell title="Auditoría" permission="audit:read">
      <AuditBody />
    </AdminShell>
  );
}

function AuditBody() {
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<{ items: Row[] }>("/api/v1/admin/audit?limit=50")
      .then((body) => setItems(body.items))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <p className="muted">Acciones recientes. No se muestra el contenido ni datos de pacientes.</p>
      <div className="card">
        {items.length === 0 ? <p className="muted">No hay registros.</p> : null}
        <table className="admin-table">
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.at).toLocaleString("es-AR")}</td>
                <td>{item.action}</td>
                <td>{item.actorType}</td>
                <td>{item.entityType ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
