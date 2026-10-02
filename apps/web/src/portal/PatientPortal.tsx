"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Brand } from "@/brand/Brand";
import "./portal.css";

type Specialty = { id: string; name: string };
type Professional = { id: string; givenName: string; familyName: string };
type Slot = {
  id: string;
  startsAt: string;
  professionalId: string;
  officeCode: string;
  officeName: string;
};
type Receipt = {
  publicCode: string;
  startsAt: string;
  specialtyName: string;
  professionalName: string;
  officeName: string;
  officeCode: string;
};

const TZ = "America/Argentina/Buenos_Aires";

function civilToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function civilOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
}

function hourOf(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${iso}T15:00:00.000Z`),
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message ?? "No se pudo completar la acción.");
  }
  return body as T;
}

function turnstileToken(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "" : "test-turnstile";
}

export function PatientPortal() {
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [specialtyId, setSpecialtyId] = useState<string | null>(null);
  const [professionalId, setProfessionalId] = useState<string | "any" | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState(45);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [form, setForm] = useState({
    givenName: "",
    familyName: "",
    dni: "",
    birthDate: "",
    phone: "",
    email: "",
  });

  useEffect(() => {
    void api<{ items: Specialty[] }>("/api/v1/specialties?limit=100")
      .then((body) => setSpecialties(body.items))
      .catch((reason: Error) => setError(reason.message));
    void api<{ days: number }>("/api/v1/booking-horizon")
      .then((body) => setHorizon(body.days))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!specialtyId) {
      return;
    }
    void api<{ items: Professional[] }>(`/api/v1/professionals?specialtyId=${specialtyId}&limit=100`)
      .then((body) => setProfessionals(body.items))
      .catch((reason: Error) => setError(reason.message));
  }, [specialtyId]);

  useEffect(() => {
    if (!specialtyId || !professionalId) {
      return;
    }
    const from = civilToday();
    const to = addDays(from, Math.max(horizon - 1, 0));
    const professional = professionalId === "any" ? "" : `&professionalId=${professionalId}`;
    void api<{ items: Slot[] }>(`/api/v1/availability?specialtyId=${specialtyId}&from=${from}&to=${to}${professional}`)
      .then((body) => setSlots(body.items))
      .catch((reason: Error) => setError(reason.message));
  }, [horizon, professionalId, specialtyId]);

  const dates = useMemo(() => [...new Set(slots.map((item) => civilOf(item.startsAt)))], [slots]);
  const [date, setDate] = useState<string | null>(null);
  const hours = slots.filter((item) => civilOf(item.startsAt) === date);

  if (receipt) {
    return (
      <main className="portal">
        <Brand />
        <h1>Turno reservado</h1>
        <div className="card">
          <p>Tu turno está reservado. Si no llega el mensaje, conservá el código y comunicate con el hospital.</p>
          <p>
            <strong>Código:</strong> {receipt.publicCode}
          </p>
          <p>
            {dayLabel(civilOf(receipt.startsAt))} · {hourOf(receipt.startsAt)}
          </p>
          <p>
            {receipt.specialtyName} · {receipt.professionalName}
          </p>
          <p>
            {receipt.officeName} ({receipt.officeCode})
          </p>
        </div>
        <nav className="portal-nav" aria-label="Portal">
          <Link href="/">Inicio</Link>
          <Link href="/portal/mis-turnos">Ver mis turnos</Link>
        </nav>
      </main>
    );
  }

  return (
    <main className="portal">
      <Brand />
      <nav className="portal-nav" aria-label="Portal">
        <Link href="/">Inicio</Link>
        <Link href="/portal/mis-turnos">Mis turnos</Link>
      </nav>
      <h1>Sacar un turno</h1>
      <p className="muted">El hospital confirma por WhatsApp. No hace falta contraseña.</p>
      {error ? <p className="error">{error}</p> : null}

      <h2>1. Especialidad</h2>
      <div className="portal-choices">
        {specialties.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={specialtyId === item.id}
            onClick={() => {
              setSpecialtyId(item.id);
              setProfessionalId(null);
              setDate(null);
              setSlot(null);
              setError(null);
            }}
          >
            {item.name}
          </button>
        ))}
      </div>

      {specialtyId ? (
        <>
          <h2>2. Profesional</h2>
          <div className="portal-choices">
            <button type="button" aria-pressed={professionalId === "any"} onClick={() => setProfessionalId("any")}>
              Primer horario
            </button>
            {professionals.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={professionalId === item.id}
                onClick={() => setProfessionalId(item.id)}
              >
                {item.givenName} {item.familyName}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {professionalId ? (
        <>
          <h2>3. Fecha</h2>
          {dates.length === 0 ? <p className="muted">No hay horarios en los próximos {horizon} días.</p> : null}
          <div className="portal-choices">
            {dates.map((item) => (
              <button key={item} type="button" aria-pressed={date === item} onClick={() => setDate(item)}>
                {dayLabel(item)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {date ? (
        <>
          <h2>4. Horario</h2>
          <div className="portal-choices">
            {hours.map((item) => (
              <button key={item.id} type="button" aria-pressed={slot?.id === item.id} onClick={() => setSlot(item)}>
                {hourOf(item.startsAt)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {slot && !verified ? (
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            void api<{ devCode?: string }>("/api/v1/auth/patient/otp/request", {
              method: "POST",
              body: JSON.stringify({
                dni: form.dni,
                phone: form.phone,
                turnstileToken: turnstileToken(),
              }),
            })
              .then((body) => {
                setDevCode(body.devCode ?? null);
                setOtpSent(true);
              })
              .catch((reason: Error) => setError(reason.message));
          }}
        >
          <h2>5. Tus datos</h2>
          <label htmlFor="givenName">Nombre</label>
          <input id="givenName" value={form.givenName} onChange={(event) => setForm({ ...form, givenName: event.target.value })} required />
          <label htmlFor="familyName">Apellido</label>
          <input id="familyName" value={form.familyName} onChange={(event) => setForm({ ...form, familyName: event.target.value })} required />
          <label htmlFor="dni">DNI</label>
          <input id="dni" inputMode="numeric" value={form.dni} onChange={(event) => setForm({ ...form, dni: event.target.value })} required />
          <label htmlFor="birthDate">Fecha de nacimiento</label>
          <input id="birthDate" type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} required />
          <label htmlFor="phone">Teléfono</label>
          <input id="phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required />
          <label htmlFor="email">Email (opcional)</label>
          <input id="email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          <button type="submit">Enviar código</button>
          {devCode ? <p className="muted">Código de desarrollo, WhatsApp simulado: {devCode}</p> : null}
          {otpSent ? (
            <>
              <label htmlFor="code">Código</label>
              <input id="code" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} />
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  void api("/api/v1/auth/patient/otp/verify", {
                    method: "POST",
                    body: JSON.stringify({
                      dni: form.dni,
                      phone: form.phone,
                      code,
                      turnstileToken: turnstileToken(),
                    }),
                  })
                    .then(() => setVerified(true))
                    .catch((reason: Error) => setError(reason.message));
                }}
              >
                Verificar código
              </button>
            </>
          ) : null}
        </form>
      ) : null}

      {slot && verified ? (
        <div className="card">
          <h2>6. Confirmar</h2>
          <p>
            {dayLabel(civilOf(slot.startsAt))} a las {hourOf(slot.startsAt)}
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void api<Receipt>("/api/v1/appointments", {
                method: "POST",
                body: JSON.stringify({
                  slotId: slot.id,
                  turnstileToken: turnstileToken(),
                  patient: {
                    ...form,
                    email: form.email || null,
                  },
                }),
              })
                .then(setReceipt)
                .catch((reason: Error) => setError(reason.message));
            }}
          >
            Confirmar turno
          </button>
        </div>
      ) : null}
    </main>
  );
}
