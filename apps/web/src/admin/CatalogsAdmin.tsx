"use client";

import { FormEvent, useEffect, useState } from "react";
import { AdminShell } from "./AdminShell";
import { adminApi } from "./api";

type Specialty = { id: string; name: string; defaultSlotMinutes: number; deactivatedAt: string | null };
type Office = { id: string; name: string; code: string; locationLabel: string | null; deactivatedAt: string | null };
type Professional = {
  id: string;
  givenName: string;
  familyName: string;
  licenseNumber: string | null;
  specialtyIds: string[];
  officeIds: string[];
  userId: string | null;
  deactivatedAt: string | null;
};
type MedicoAccount = { id: string; email: string; professionalId: string | null };

export function SpecialtiesAdmin() {
  return (
    <AdminShell title="Especialidades" permission="catalogs:write">
      <SpecialtyBody />
    </AdminShell>
  );
}

function SpecialtyBody() {
  const [items, setItems] = useState<Specialty[]>([]);
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("20");
  const [error, setError] = useState<string | null>(null);

  function load() {
    void adminApi<{ items: Specialty[] }>("/api/v1/admin/specialties?limit=100")
      .then((body) => setItems(body.items))
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(load, []);

  function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    void adminApi("/api/v1/admin/specialties", {
      method: "POST",
      body: JSON.stringify({ name, defaultSlotMinutes: Number(minutes), sortOrder: items.length + 1 }),
    })
      .then(() => {
        setName("");
        load();
      })
      .catch((reason: Error) => setError(reason.message));
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <form className="card" onSubmit={create}>
        <label htmlFor="name">Nombre</label>
        <input id="name" value={name} onChange={(event) => setName(event.target.value)} required />
        <label htmlFor="minutes">Minutos del turno</label>
        <input id="minutes" value={minutes} onChange={(event) => setMinutes(event.target.value)} required />
        <button type="submit">Agregar</button>
      </form>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.name} · {item.defaultSlotMinutes} min {item.deactivatedAt ? "(inactiva)" : ""}
            {item.deactivatedAt ? null : (
              <button
                type="button"
                className="inline"
                onClick={() => {
                  void adminApi(`/api/v1/admin/specialties/${item.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ deactivated: true }),
                  }).then(load);
                }}
              >
                Desactivar
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export function OfficesAdmin() {
  return (
    <AdminShell title="Consultorios" permission="catalogs:write">
      <OfficeBody />
    </AdminShell>
  );
}

function OfficeBody() {
  const [items, setItems] = useState<Office[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    void adminApi<{ items: Office[] }>("/api/v1/admin/offices?limit=100")
      .then((body) => setItems(body.items))
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(load, []);

  function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    void adminApi("/api/v1/admin/offices", {
      method: "POST",
      body: JSON.stringify({ name, code }),
    })
      .then(() => {
        setName("");
        setCode("");
        load();
      })
      .catch((reason: Error) => setError(reason.message));
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <form className="card" onSubmit={create}>
        <label htmlFor="officeName">Nombre</label>
        <input id="officeName" value={name} onChange={(event) => setName(event.target.value)} required />
        <label htmlFor="officeCode">Código</label>
        <input id="officeCode" value={code} onChange={(event) => setCode(event.target.value)} required />
        <button type="submit">Agregar</button>
      </form>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.name} ({item.code}) {item.deactivatedAt ? "(inactivo)" : ""}
          </li>
        ))}
      </ul>
    </>
  );
}

export function ProfessionalsAdmin() {
  return (
    <AdminShell title="Profesionales" permission="catalogs:write">
      <ProfessionalBody />
    </AdminShell>
  );
}

function ProfessionalBody() {
  const [items, setItems] = useState<Professional[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [specialtyIds, setSpecialtyIds] = useState<string[]>([]);
  const [officeIds, setOfficeIds] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [medicos, setMedicos] = useState<MedicoAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    void Promise.all([
      adminApi<{ items: Professional[] }>("/api/v1/admin/professionals?limit=100"),
      adminApi<{ items: Specialty[] }>("/api/v1/admin/specialties?limit=100"),
      adminApi<{ items: Office[] }>("/api/v1/admin/offices?limit=100"),
      adminApi<{ items: MedicoAccount[] }>("/api/v1/admin/professionals/linkable-users"),
    ])
      .then(([people, specs, rooms, accounts]) => {
        setItems(people.items);
        setSpecialties(specs.items.filter((item) => !item.deactivatedAt));
        setOffices(rooms.items.filter((item) => !item.deactivatedAt));
        setMedicos(accounts.items);
      })
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(load, []);

  function toggle(list: string[], id: string, setList: (value: string[]) => void) {
    setList(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  function clearForm() {
    setEditingId(null);
    setGivenName("");
    setFamilyName("");
    setSpecialtyIds([]);
    setOfficeIds([]);
    setUserId("");
  }

  function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const body = JSON.stringify({ givenName, familyName, specialtyIds, officeIds, userId: userId || null });
    const request = editingId
      ? adminApi(`/api/v1/admin/professionals/${editingId}`, { method: "PATCH", body })
      : adminApi("/api/v1/admin/professionals", { method: "POST", body });
    void request
      .then(() => {
        clearForm();
        load();
      })
      .catch((reason: Error) => setError(reason.message));
  }

  function startEdit(item: Professional) {
    setError(null);
    setEditingId(item.id);
    setGivenName(item.givenName);
    setFamilyName(item.familyName);
    setSpecialtyIds(item.specialtyIds);
    setOfficeIds(item.officeIds);
    setUserId(item.userId ?? "");
  }

  function setActive(item: Professional, active: boolean) {
    setError(null);
    void adminApi(`/api/v1/admin/professionals/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ deactivated: !active }),
    })
      .then(() => {
        if (!active && editingId === item.id) {
          clearForm();
        }
        load();
      })
      .catch((reason: Error) => setError(reason.message));
  }

  function linkedNames(ids: string[], rows: Array<{ id: string; name: string }>): string {
    const names = ids.map((id) => rows.find((row) => row.id === id)?.name).filter((name): name is string => Boolean(name));
    return names.length > 0 ? names.join(", ") : "ninguna";
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <form className="card" onSubmit={save}>
        {editingId ? <h2>Editar profesional</h2> : null}
        <label htmlFor="givenName">Nombre</label>
        <input id="givenName" value={givenName} onChange={(event) => setGivenName(event.target.value)} required />
        <label htmlFor="familyName">Apellido</label>
        <input id="familyName" value={familyName} onChange={(event) => setFamilyName(event.target.value)} required />
        <p>Especialidades</p>
        {specialties.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={specialtyIds.includes(item.id)}
              onChange={() => toggle(specialtyIds, item.id, setSpecialtyIds)}
            />{" "}
            {item.name}
          </label>
        ))}
        <p>Consultorios</p>
        {offices.map((item) => (
          <label key={item.id}>
            <input type="checkbox" checked={officeIds.includes(item.id)} onChange={() => toggle(officeIds, item.id, setOfficeIds)} />{" "}
            {item.name}
          </label>
        ))}
        <label htmlFor="userId">Cuenta de médico</label>
        <select id="userId" value={userId} onChange={(event) => setUserId(event.target.value)}>
          <option value="">Sin cuenta</option>
          {medicos
            .filter((account) => !account.professionalId || account.professionalId === editingId)
            .map((account) => (
              <option key={account.id} value={account.id}>
                {account.email}
              </option>
            ))}
        </select>
        {medicos.length === 0 ? <p className="muted">Sistemas tiene que crear una cuenta con rol Médico.</p> : null}
        <button type="submit">{editingId ? "Guardar cambios" : "Agregar"}</button>
        {editingId ? (
          <button type="button" className="inline" onClick={clearForm}>
            Cancelar
          </button>
        ) : null}
      </form>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.familyName}, {item.givenName}
            {item.deactivatedAt ? " (inactivo)" : ""}
            {" · "}
            {linkedNames(item.specialtyIds, specialties)}
            {" · "}
            {linkedNames(item.officeIds, offices)}
            {" · "}
            {medicos.find((account) => account.id === item.userId)?.email ?? "sin cuenta"}
            <button type="button" className="inline" onClick={() => startEdit(item)}>
              Editar
            </button>
            {item.deactivatedAt ? (
              <button type="button" className="inline" onClick={() => setActive(item, true)}>
                Activar
              </button>
            ) : (
              <button type="button" className="inline" onClick={() => setActive(item, false)}>
                Eliminar
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
