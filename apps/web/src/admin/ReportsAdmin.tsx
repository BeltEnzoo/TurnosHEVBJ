"use client";

import { useState } from "react";
import { AdminShell } from "./AdminShell";
import { adminApi } from "./api";

type Summary = {
  total: number;
  byStatus: Record<string, number>;
  bySpecialty: Record<string, number>;
};

export function ReportsAdmin() {
  return (
    <AdminShell title="Estadísticas" permission="reports:read">
      <ReportsBody />
    </AdminShell>
  );
}

function ReportsBody() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void adminApi<Summary>(`/api/v1/admin/reports/summary?from=${from}&to=${to}`)
            .then(setSummary)
            .catch((reason: Error) => setError(reason.message));
        }}
      >
        <label htmlFor="from">Desde</label>
        <input id="from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} required />
        <label htmlFor="to">Hasta</label>
        <input id="to" type="date" value={to} onChange={(event) => setTo(event.target.value)} required />
        <button type="submit">Ver totales</button>
      </form>
      {summary ? (
        <div className="card">
          <p>{summary.total} turnos en el período.</p>
          {Object.entries(summary.byStatus).map(([status, count]) => (
            <p key={status}>
              {status}: {count}
            </p>
          ))}
          {Object.entries(summary.bySpecialty).map(([name, count]) => (
            <p key={name}>
              {name}: {count}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}
