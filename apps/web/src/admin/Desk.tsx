"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "./AdminShell";
import { adminApi, civilToday, hourOf } from "./api";

type Row = {
  id: string;
  publicCode: string;
  status: string;
  startsAt: string;
  specialtyName: string;
  professionalName: string;
  officeCode: string;
  patient: { givenName: string; familyName: string };
};

export function Desk() {
  return (
    <AdminShell title="Mostrador" permission="appointments:write">
      <DeskBody />
    </AdminShell>
  );
}

function DeskBody() {
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = civilToday();

  function load() {
    void adminApi<{ items: Row[] }>(`/api/v1/admin/appointments?from=${today}&to=${today}&limit=100`)
      .then((body) => setItems(body.items))
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(load, [today]);

  async function act(id: string, action: "cancel" | "complete" | "no-show") {
    setError(null);
    const path = `/api/v1/admin/appointments/${id}/${action}`;
    const init =
      action === "cancel"
        ? { method: "POST", body: JSON.stringify({ reasonCode: "STAFF_REQUEST" }) }
        : { method: "POST" };
    try {
      await adminApi(path, init);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo completar la acción.");
    }
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <p>
        Agenda de hoy. <Link href="/admin/turnos">Dar un turno</Link> o <Link href="/admin/pacientes">buscar un paciente</Link>.
      </p>
      <div className="card">
        {items.length === 0 ? <p className="muted">No hay turnos para hoy.</p> : null}
        <table className="admin-table">
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.publicCode}</strong>
                  <br />
                  {hourOf(item.startsAt)} · {item.status}
                </td>
                <td>
                  {item.patient.familyName}, {item.patient.givenName}
                  <br />
                  <span className="muted">
                    {item.specialtyName} · {item.professionalName} · {item.officeCode}
                  </span>
                </td>
                <td>
                  {item.status === "CONFIRMED" ? (
                    <div className="admin-actions">
                      <button type="button" className="inline" onClick={() => void act(item.id, "complete")}>
                        Atendido
                      </button>
                      <button type="button" className="inline" onClick={() => void act(item.id, "no-show")}>
                        Ausente
                      </button>
                      <button type="button" className="inline" onClick={() => void act(item.id, "cancel")}>
                        Cancelar
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
