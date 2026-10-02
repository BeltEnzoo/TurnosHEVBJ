"use client";

import { FormEvent, useEffect, useState } from "react";
import { AdminShell } from "./AdminShell";
import { adminApi, type StaffMe } from "./api";
import { roleLabel } from "./role-labels";

type UserRow = {
  id: string;
  email: string;
  isActive: boolean;
  roles: string[];
  lastLoginAt: string | null;
  failedLoginCount: number;
  professional: { givenName: string; familyName: string } | null;
};

type ProfessionalOption = {
  id: string;
  givenName: string;
  familyName: string;
  specialties: string[];
  offices: string[];
  linked: boolean;
};

const ROLES = ["RECEPCION", "SISTEMAS", "ADMINISTRACION", "MEDICO", "SUPER_ADMIN"];

export function UsersAdmin() {
  return (
    <AdminShell title="Usuarios" permission="users:manage">
      <UsersBody />
    </AdminShell>
  );
}

function UsersBody() {
  const [items, setItems] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("RECEPCION");
  const [professionalId, setProfessionalId] = useState("");
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([]);
  const [roles, setRoles] = useState(ROLES.filter((item) => item !== "SUPER_ADMIN"));
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  function load() {
    void adminApi<{ items: UserRow[] }>("/api/v1/admin/users")
      .then((body) => setItems(body.items))
      .catch((reason: Error) => setError(reason.message));
    void adminApi<{ items: ProfessionalOption[] }>("/api/v1/admin/users/professionals")
      .then((body) => setProfessionals(body.items))
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(load, []);

  useEffect(() => {
    void adminApi<StaffMe>("/api/v1/auth/staff/me").then((me) => {
      setMeId(me.id);
      if (me.roles.includes("SUPER_ADMIN")) {
        setRoles(ROLES);
      }
    });
  }, []);

  function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setTemporaryPassword(null);
    void adminApi("/api/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        role,
        ...(role === "MEDICO" ? { professionalId } : {}),
      }),
    })
      .then(() => {
        setEmail("");
        setPassword("");
        setProfessionalId("");
        load();
      })
      .catch((reason: Error) => setError(reason.message));
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      {temporaryPassword ? (
        <p className="card">
          Contraseña temporal, se muestra una sola vez: <strong>{temporaryPassword}</strong>
        </p>
      ) : null}
      <form className="card" onSubmit={create}>
        <label htmlFor="email">Correo</label>
        <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} />
        <label htmlFor="role">Rol</label>
        <select
          id="role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setProfessionalId("");
          }}
        >
          {roles.map((item) => (
            <option key={item} value={item}>
              {roleLabel(item)}
            </option>
          ))}
        </select>
        {role === "MEDICO" ? (
          <>
            <label htmlFor="professionalId">Profesional</label>
            <select
              id="professionalId"
              value={professionalId}
              onChange={(event) => setProfessionalId(event.target.value)}
              required
            >
              <option value="">Elegir profesional</option>
              {professionals
                .filter((item) => !item.linked)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.familyName}, {item.givenName}
                    {item.specialties.length > 0 ? ` · ${item.specialties.join(", ")}` : ""}
                    {item.offices.length > 0 ? ` · ${item.offices.join(", ")}` : ""}
                  </option>
                ))}
            </select>
            <p className="muted">La cuenta entra directo a la agenda de ese profesional.</p>
          </>
        ) : null}
        <button type="submit">Crear usuario</button>
      </form>
      <table className="admin-table">
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.email}
                <br />
                <span className="muted">
                  {item.roles.map(roleLabel).join(", ")}
                  {item.professional ? ` · ${item.professional.familyName}, ${item.professional.givenName}` : ""} ·{" "}
                  {item.isActive ? "activo" : "inactivo"} · fallos {item.failedLoginCount}
                </span>
              </td>
              <td>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="inline"
                    onClick={() => {
                      void adminApi(`/api/v1/admin/users/${item.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ isActive: !item.isActive }),
                      })
                        .then(load)
                        .catch((reason: Error) => setError(reason.message));
                    }}
                  >
                    {item.isActive ? "Desactivar" : "Activar"}
                  </button>
                  <button
                    type="button"
                    className="inline"
                    onClick={() => {
                      void adminApi<{ temporaryPassword: string }>(`/api/v1/admin/users/${item.id}/reset-password`, { method: "POST" })
                        .then((body) => setTemporaryPassword(body.temporaryPassword))
                        .catch((reason: Error) => setError(reason.message));
                    }}
                  >
                    Nueva clave
                  </button>
                  <button
                    type="button"
                    className="inline"
                    onClick={() => {
                      void adminApi(`/api/v1/admin/users/${item.id}/revoke-sessions`, { method: "POST" }).catch((reason: Error) =>
                        setError(reason.message),
                      );
                    }}
                  >
                    Cerrar sesiones
                  </button>
                  {item.id === meId ? null : (
                    <button
                      type="button"
                      className="inline"
                      onClick={() => {
                        if (!window.confirm(`¿Eliminar la cuenta ${item.email}? No se puede deshacer.`)) {
                          return;
                        }
                        setError(null);
                        void adminApi(`/api/v1/admin/users/${item.id}`, { method: "DELETE" })
                          .then(load)
                          .catch((reason: Error) => setError(reason.message));
                      }}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
