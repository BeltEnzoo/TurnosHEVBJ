"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminApi, civilToday, hourOf } from "@/admin/api";
import { Brand } from "@/brand/Brand";
import "./medical.css";

type Item = {
  id: string;
  publicCode: string;
  status: string;
  startsAt: string;
  officeCode: string;
  specialtyName: string;
  patient: { givenName: string; familyName: string };
};

const LABELS: Record<string, string> = {
  CONFIRMED: "Confirmado",
  CALLED: "Llamado",
  IN_PROGRESS: "En atención",
  COMPLETED: "Atendido",
  NO_SHOW: "Ausente",
};

export function MedicalAgenda() {
  const router = useRouter();
  const [date, setDate] = useState(civilToday());
  const [name, setName] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load(next = date) {
    void adminApi<{ professionalName: string; items: Item[] }>(`/api/v1/medico/agenda?date=${next}`)
      .then((body) => {
        setName(body.professionalName);
        setItems(body.items);
      })
      .catch((reason: Error) => {
        if (reason.message.includes("permiso")) {
          router.replace("/admin");
        }
        setError(reason.message);
      });
  }

  useEffect(() => {
    load(date);
  }, [date]);

  async function logout() {
    await fetch("/api/v1/auth/staff/logout", { method: "POST", credentials: "include" });
    router.replace("/");
  }

  async function act(id: string, action: "call" | "recall" | "in-progress" | "complete" | "no-show") {
    if (action === "no-show" && !window.confirm("¿Marcar ausente?")) {
      return;
    }
    setError(null);
    try {
      await adminApi(`/api/v1/appointments/${id}/${action}`, { method: "POST" });
      load(date);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo completar la acción.");
    }
  }

  return (
    <main className="medical">
      <header className="app-header">
        <Brand compact />
        <div className="app-header-actions">
          <Link className="ghost" href="/">
            Inicio
          </Link>
          <button type="button" className="ghost" onClick={() => void logout()}>
            Salir
          </button>
        </div>
      </header>
      <h1>Agenda del día</h1>
      {name ? <p>{name}</p> : null}
      <label htmlFor="date">Fecha</label>
      <input id="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      {error ? <p className="error">{error}</p> : null}
      {items.length === 0 ? <p className="muted">No hay turnos en esta fecha.</p> : null}
      <ul className="medical-list">
        {items.map((item) => (
          <li key={item.id} className="card">
            <p>
              <strong>
                {hourOf(item.startsAt)} — {item.publicCode}
              </strong>
            </p>
            <p>
              {item.patient.familyName}, {item.patient.givenName}
            </p>
            <p className="muted">
              {LABELS[item.status] ?? item.status} · {item.specialtyName} · {item.officeCode}
            </p>
            {item.status === "CONFIRMED" ? (
              <button type="button" className="medical-primary" onClick={() => void act(item.id, "call")}>
                Llamar paciente
              </button>
            ) : null}
            {item.status === "CALLED" || item.status === "IN_PROGRESS" ? (
              <div className="medical-actions">
                {item.status === "CALLED" ? (
                  <>
                    <button type="button" onClick={() => void act(item.id, "recall")}>
                      Volver a llamar
                    </button>
                    <button type="button" onClick={() => void act(item.id, "in-progress")}>
                      Iniciar atención
                    </button>
                  </>
                ) : null}
                <button type="button" onClick={() => void act(item.id, "complete")}>
                  Atendido
                </button>
                <button type="button" onClick={() => void act(item.id, "no-show")}>
                  Ausente
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
