"use client";

import { FormEvent, useEffect, useState } from "react";
import { AdminShell } from "./AdminShell";
import { addCivilDays, adminApi, civilToday, dayOf, hourOf } from "./api";

type Row = {
  id: string;
  publicCode: string;
  status: string;
  startsAt: string;
  specialtyName: string;
  professionalName: string;
  officeCode: string;
  patient: { givenName: string; familyName: string; dni: string };
};

type History = { fromStatus: string | null; toStatus: string; actorType: string; at: string };
type Detail = Row & { history: History[] };
type Specialty = { id: string; name: string };
type Slot = { id: string; startsAt: string; officeCode: string };

export function AppointmentsAdmin() {
  return (
    <AdminShell title="Turnos" permission="appointments:write">
      <AppointmentsBody />
    </AdminShell>
  );
}

function AppointmentsBody() {
  const today = civilToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [publicCode, setPublicCode] = useState("");
  const [items, setItems] = useState<Row[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [specialtyId, setSpecialtyId] = useState("");
  const [slotDay, setSlotDay] = useState(today);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState("");
  const [patient, setPatient] = useState({
    givenName: "",
    familyName: "",
    dni: "",
    birthDate: "",
    phone: "",
  });
  const [error, setError] = useState<string | null>(null);

  function loadList() {
    const params = new URLSearchParams({ limit: "50" });
    if (publicCode.trim()) {
      params.set("publicCode", publicCode.trim().toUpperCase());
    } else {
      params.set("from", from);
      params.set("to", to);
    }
    void adminApi<{ items: Row[] }>(`/api/v1/admin/appointments?${params.toString()}`)
      .then((body) => setItems(body.items))
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    void adminApi<{ items: Specialty[] }>("/api/v1/admin/specialties?limit=100")
      .then((body) => setSpecialties(body.items))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!specialtyId) {
      setSlots([]);
      setSlotId("");
      return;
    }
    setSlotId("");
    const params = new URLSearchParams({ specialtyId, from: slotDay, to: slotDay });
    void adminApi<{ items: Slot[] }>(`/api/v1/availability?${params.toString()}`)
      .then((body) => setSlots(body.items))
      .catch((reason: Error) => setError(reason.message));
  }, [specialtyId, slotDay]);

  function search(event: FormEvent) {
    event.preventDefault();
    setError(null);
    loadList();
  }

  function book(event: FormEvent) {
    event.preventDefault();
    setError(null);
    void adminApi("/api/v1/admin/appointments", {
      method: "POST",
      body: JSON.stringify({ slotId, patient }),
    })
      .then(() => {
        setPatient({ givenName: "", familyName: "", dni: "", birthDate: "", phone: "" });
        loadList();
      })
      .catch((reason: Error) => setError(reason.message));
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <form className="card" onSubmit={search}>
        <label htmlFor="from">Desde</label>
        <input id="from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <label htmlFor="to">Hasta</label>
        <input id="to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <label htmlFor="publicCode">Código</label>
        <input id="publicCode" value={publicCode} onChange={(event) => setPublicCode(event.target.value)} />
        <button type="submit">Buscar turnos</button>
      </form>
      <div className="card">
        {items.map((item) => (
          <p key={item.id}>
            <button
              type="button"
              className="inline"
              onClick={() => {
                void adminApi<Detail>(`/api/v1/admin/appointments/${item.id}`)
                  .then(setDetail)
                  .catch((reason: Error) => setError(reason.message));
              }}
            >
              {item.publicCode}
            </button>{" "}
            {dayOf(item.startsAt)} {hourOf(item.startsAt)} · {item.status} · {item.patient.familyName} · {item.specialtyName}
          </p>
        ))}
        {items.length === 0 ? <p className="muted">Elegí un rango o un código.</p> : null}
      </div>
      {detail ? (
        <article className="card">
          <h2>{detail.publicCode}</h2>
          <p>
            {detail.patient.familyName}, {detail.patient.givenName} · DNI {detail.patient.dni}
          </p>
          <ol>
            {detail.history.map((item) => (
              <li key={`${item.at}-${item.toStatus}`}>
                {item.fromStatus ?? "—"} → {item.toStatus} · {item.actorType}
              </li>
            ))}
          </ol>
        </article>
      ) : null}
      <form className="card" onSubmit={book}>
        <h2>Alta manual</h2>
        <label htmlFor="specialtyId">Especialidad</label>
        <select id="specialtyId" value={specialtyId} onChange={(event) => setSpecialtyId(event.target.value)} required>
          <option value="">Elegir</option>
          {specialties.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <label htmlFor="slotDay">Día</label>
        <input
          id="slotDay"
          type="date"
          min={today}
          max={addCivilDays(today, 44)}
          value={slotDay}
          onChange={(event) => setSlotDay(event.target.value)}
          required
        />
        <label htmlFor="slotId">Horario</label>
        <select id="slotId" value={slotId} onChange={(event) => setSlotId(event.target.value)} required>
          <option value="">Elegir</option>
          {slots.map((item) => (
            <option key={item.id} value={item.id}>
              {hourOf(item.startsAt)} · {item.officeCode}
            </option>
          ))}
        </select>
        {specialtyId && slots.length === 0 ? <p className="muted">No hay horarios libres ese día.</p> : null}
        <label htmlFor="givenName">Nombre</label>
        <input id="givenName" value={patient.givenName} onChange={(event) => setPatient({ ...patient, givenName: event.target.value })} required />
        <label htmlFor="familyName">Apellido</label>
        <input id="familyName" value={patient.familyName} onChange={(event) => setPatient({ ...patient, familyName: event.target.value })} required />
        <label htmlFor="dniBook">DNI</label>
        <input id="dniBook" value={patient.dni} onChange={(event) => setPatient({ ...patient, dni: event.target.value })} required />
        <label htmlFor="birthDate">Fecha de nacimiento</label>
        <input id="birthDate" type="date" value={patient.birthDate} onChange={(event) => setPatient({ ...patient, birthDate: event.target.value })} required />
        <label htmlFor="phone">Teléfono</label>
        <input id="phone" value={patient.phone} onChange={(event) => setPatient({ ...patient, phone: event.target.value })} required />
        <button type="submit">Reservar</button>
      </form>
    </>
  );
}
