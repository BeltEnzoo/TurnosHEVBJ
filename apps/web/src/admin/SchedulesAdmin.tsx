"use client";

import { FormEvent, useEffect, useState } from "react";
import { AdminShell } from "./AdminShell";
import { adminApi, civilToday } from "./api";

type Named = { id: string; name?: string; givenName?: string; familyName?: string; code?: string };
type Schedule = {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  professionalId: string;
  deactivatedAt: string | null;
};

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function SchedulesAdmin() {
  return (
    <AdminShell title="Agenda" permission="schedules:write">
      <SchedulesBody />
    </AdminShell>
  );
}

function SchedulesBody() {
  const [professionals, setProfessionals] = useState<Named[]>([]);
  const [specialties, setSpecialties] = useState<Named[]>([]);
  const [offices, setOffices] = useState<Named[]>([]);
  const [items, setItems] = useState<Schedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    professionalId: "",
    specialtyId: "",
    officeId: "",
    weekday: "1",
    startTime: "08:00",
    endTime: "12:00",
    slotMinutes: "20",
    validFrom: civilToday(),
  });

  function load() {
    void Promise.all([
      adminApi<{ items: Named[] }>("/api/v1/admin/professionals?limit=100"),
      adminApi<{ items: Named[] }>("/api/v1/admin/specialties?limit=100"),
      adminApi<{ items: Named[] }>("/api/v1/admin/offices?limit=100"),
      adminApi<{ items: Schedule[] }>("/api/v1/admin/schedules"),
    ])
      .then(([people, specs, rooms, schedules]) => {
        setProfessionals(people.items);
        setSpecialties(specs.items);
        setOffices(rooms.items);
        setItems(schedules.items);
      })
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(load, []);

  function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    void adminApi("/api/v1/admin/schedules", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        weekday: Number(form.weekday),
        slotMinutes: Number(form.slotMinutes),
      }),
    })
      .then(() => load())
      .catch((reason: Error) => setError(reason.message));
  }

  function labelPerson(item: Named): string {
    return item.familyName ? `${item.familyName}, ${item.givenName ?? ""}` : item.name ?? item.code ?? item.id;
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
      <form className="card" onSubmit={create}>
        <label htmlFor="professionalId">Profesional</label>
        <select id="professionalId" value={form.professionalId} onChange={(event) => setForm({ ...form, professionalId: event.target.value })} required>
          <option value="">Elegir</option>
          {professionals.map((item) => (
            <option key={item.id} value={item.id}>
              {labelPerson(item)}
            </option>
          ))}
        </select>
        <label htmlFor="specialtyId">Especialidad</label>
        <select id="specialtyId" value={form.specialtyId} onChange={(event) => setForm({ ...form, specialtyId: event.target.value })} required>
          <option value="">Elegir</option>
          {specialties.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <label htmlFor="officeId">Consultorio</label>
        <select id="officeId" value={form.officeId} onChange={(event) => setForm({ ...form, officeId: event.target.value })} required>
          <option value="">Elegir</option>
          {offices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.code})
            </option>
          ))}
        </select>
        <label htmlFor="weekday">Día</label>
        <select id="weekday" value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>
          {DAYS.map((day, index) => (
            <option key={day} value={index}>
              {day}
            </option>
          ))}
        </select>
        <label htmlFor="startTime">Desde</label>
        <input id="startTime" type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} required />
        <label htmlFor="endTime">Hasta</label>
        <input id="endTime" type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} required />
        <label htmlFor="validFrom">Vigente desde</label>
        <input id="validFrom" type="date" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} required />
        <button type="submit">Guardar horario</button>
      </form>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {DAYS[item.weekday] ?? item.weekday} {item.startTime}–{item.endTime} {item.deactivatedAt ? "(inactivo)" : ""}
          </li>
        ))}
      </ul>
      <HolidayForm onError={setError} onDone={(message) => setNotice(message)} />
      <button
        type="button"
        className="inline"
        onClick={() => {
          setError(null);
          void adminApi<{ created: number; updated: number; removed: number }>("/api/v1/admin/slots/regenerate", { method: "POST" })
            .then((result) => setNotice(`Cupos: ${result.created} nuevos, ${result.updated} actualizados, ${result.removed} quitados.`))
            .catch((reason: Error) => setError(reason.message));
        }}
      >
        Regenerar cupos
      </button>
    </>
  );
}

function HolidayForm({ onError, onDone }: { onError: (message: string) => void; onDone: (message: string) => void }) {
  const [date, setDate] = useState(civilToday());
  const [name, setName] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    void adminApi("/api/v1/admin/holidays", {
      method: "POST",
      body: JSON.stringify({ date, name, appliesTo: "ALL" }),
    })
      .then(() => {
        setName("");
        onDone(`Feriado ${name} guardado.`);
      })
      .catch((reason: Error) => onError(reason.message));
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Feriado</h2>
      <label htmlFor="holidayDate">Fecha</label>
      <input id="holidayDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
      <label htmlFor="holidayName">Nombre</label>
      <input id="holidayName" value={name} onChange={(event) => setName(event.target.value)} required />
      <button type="submit">Agregar feriado</button>
    </form>
  );
}
