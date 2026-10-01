"use client";

import { FormEvent, useEffect, useState } from "react";
import { AdminShell } from "./AdminShell";
import { adminApi } from "./api";

type Setting = { key: string; value: string | number | null };

const FIELDS: Array<{ key: string; label: string }> = [
  { key: "hospital_name", label: "Nombre del hospital" },
  { key: "cancel_min_hours", label: "Horas mínimas para cancelar" },
  { key: "booking_horizon_days", label: "Días de horizonte de reserva" },
  { key: "max_active_appointments", label: "Turnos activos por paciente" },
];

export function SettingsAdmin() {
  return (
    <AdminShell title="Configuración" permission="settings:write">
      <SettingsBody />
    </AdminShell>
  );
}

function SettingsBody() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void adminApi<{ items: Setting[] }>("/api/v1/admin/settings")
      .then((body) => {
        const next: Record<string, string> = {};
        for (const item of body.items) {
          next[item.key] = item.value === null || item.value === undefined ? "" : String(item.value);
        }
        setValues(next);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const body = {
      hospital_name: values.hospital_name,
      cancel_min_hours: Number(values.cancel_min_hours),
      booking_horizon_days: Number(values.booking_horizon_days),
      max_active_appointments: Number(values.max_active_appointments),
    };
    void adminApi("/api/v1/admin/settings", { method: "PATCH", body: JSON.stringify(body) })
      .then(() => setSaved(true))
      .catch((reason: Error) => setError(reason.message));
  }

  return (
    <form className="card" onSubmit={save}>
      {error ? <p className="error">{error}</p> : null}
      {saved ? <p>Cambios guardados.</p> : null}
      {FIELDS.map((field) => (
        <div key={field.key}>
          <label htmlFor={field.key}>{field.label}</label>
          <input
            id={field.key}
            value={values[field.key] ?? ""}
            onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
            required
          />
        </div>
      ))}
      <button type="submit">Guardar</button>
    </form>
  );
}
