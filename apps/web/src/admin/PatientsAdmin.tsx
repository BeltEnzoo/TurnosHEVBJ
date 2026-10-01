"use client";

import { FormEvent, useState } from "react";
import { AdminShell } from "./AdminShell";
import { adminApi, dayOf, hourOf } from "./api";

type Appointment = {
  id: string;
  publicCode: string;
  status: string;
  startsAt: string;
  specialtyName: string;
  professionalName: string;
  officeCode: string;
};

type Patient = {
  id: string;
  givenName: string;
  familyName: string;
  dni: string;
  birthDate: string;
  phoneE164: string;
  email: string | null;
  appointments: Appointment[];
};

export function PatientsAdmin() {
  return (
    <AdminShell title="Pacientes" permission="appointments:write">
      <PatientsBody />
    </AdminShell>
  );
}

function PatientsBody() {
  const [dni, setDni] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [items, setItems] = useState<Patient[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const body: { dni?: string; familyName?: string } = {};
    if (dni.trim()) {
      body.dni = dni.trim();
    }
    if (familyName.trim()) {
      body.familyName = familyName.trim();
    }
    void adminApi<{ items: Patient[] }>("/api/v1/admin/patients/search", {
      method: "POST",
      body: JSON.stringify(body),
    })
      .then((result) => setItems(result.items))
      .catch((reason: Error) => setError(reason.message));
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <form className="card" onSubmit={onSubmit}>
        <p className="muted">La búsqueda queda auditada. No hay historia clínica.</p>
        <label htmlFor="dni">DNI</label>
        <input id="dni" value={dni} onChange={(event) => setDni(event.target.value)} />
        <label htmlFor="familyName">Apellido</label>
        <input id="familyName" value={familyName} onChange={(event) => setFamilyName(event.target.value)} />
        <button type="submit">Buscar</button>
      </form>
      {items?.length === 0 ? <p className="muted">Sin resultados.</p> : null}
      {items?.map((patient) => (
        <article className="card" key={patient.id}>
          <h2>
            {patient.familyName}, {patient.givenName}
          </h2>
          <p>
            DNI {patient.dni} · {patient.birthDate}
            <br />
            {patient.phoneE164}
            {patient.email ? ` · ${patient.email}` : ""}
          </p>
          {patient.appointments.length === 0 ? <p className="muted">Sin turnos.</p> : null}
          <ul>
            {patient.appointments.map((item) => (
              <li key={item.id}>
                {item.publicCode} · {item.status} · {dayOf(item.startsAt)} {hourOf(item.startsAt)} · {item.specialtyName} ·{" "}
                {item.professionalName} · {item.officeCode}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </>
  );
}
