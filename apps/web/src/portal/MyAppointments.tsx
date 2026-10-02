"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/brand/Brand";
import "./portal.css";

type Item = {
  id: string;
  publicCode: string;
  status: string;
  startsAt: string;
  specialtyName: string;
  professionalName: string;
  officeCode: string;
};

const TZ = "America/Argentina/Buenos_Aires";

function hourOf(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function dayOf(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(iso));
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

type WaitItem = {
  id: string;
  status: string;
  specialtyName: string;
  professionalName: string | null;
  offer: { id: string; expiresAt: string; startsAt: string } | null;
};

function WaitlistPanel({ onError }: { onError: (message: string | null) => void }) {
  const [items, setItems] = useState<WaitItem[]>([]);
  const [specialties, setSpecialties] = useState<Array<{ id: string; name: string }>>([]);
  const [specialtyId, setSpecialtyId] = useState("");

  function load() {
    void api<{ items: WaitItem[] }>("/api/v1/me/waitlist")
      .then((body) => setItems(body.items))
      .catch(() => setItems([]));
  }

  useEffect(() => {
    load();
    void api<{ items: Array<{ id: string; name: string }> }>("/api/v1/specialties")
      .then((body) => setSpecialties(body.items))
      .catch(() => undefined);
  }, []);

  return (
    <section className="card">
      <h2>Lista de espera</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onError(null);
          void api("/api/v1/waitlist", { method: "POST", body: JSON.stringify({ specialtyId }) })
            .then(() => load())
            .catch((reason: Error) => onError(reason.message));
        }}
      >
        <label htmlFor="wait-specialty">Especialidad</label>
        <select id="wait-specialty" value={specialtyId} onChange={(event) => setSpecialtyId(event.target.value)} required>
          <option value="">Elegir</option>
          {specialties.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button type="submit">Anotarme</button>
      </form>
      {items.map((item) => (
        <article key={item.id}>
          <p>
            {item.specialtyName}
            {item.professionalName ? ` · ${item.professionalName}` : ""} · {item.status}
          </p>
          {item.offer ? (
            <p>
              Oferta {dayOf(item.offer.startsAt)} · {hourOf(item.offer.startsAt)}
              <button
                type="button"
                onClick={() => {
                  onError(null);
                  void api(`/api/v1/waitlist/offers/${item.offer?.id}/accept`, { method: "POST" })
                    .then(() => {
                      load();
                      window.location.reload();
                    })
                    .catch((reason: Error) => onError(reason.message));
                }}
              >
                Confirmar oferta
              </button>
            </p>
          ) : null}
        </article>
      ))}
    </section>
  );
}

export function MyAppointments() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dni, setDni] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);

  function load() {
    void api<{ items: Item[] }>("/api/v1/me/appointments")
      .then((body) => {
        setItems(body.items);
        setReady(true);
        setError(null);
      })
      .catch(() => {
        setItems(null);
        setReady(true);
      });
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="portal">
      <Brand />
      <nav className="portal-nav" aria-label="Portal">
        <Link href="/">Inicio</Link>
        <Link href="/portal">Sacar turno</Link>
      </nav>
      <h1>Mis turnos</h1>
      {error ? <p className="error">{error}</p> : null}
      {!ready ? <p className="muted">Cargando…</p> : null}
      {ready && items ? <WaitlistPanel onError={setError} /> : null}
      {ready && items ? (
        items.length === 0 ? (
          <p className="muted">No tenés turnos próximos.</p>
        ) : (
          <div className="card">
            {items.map((item) => (
              <article key={item.id}>
                <p>
                  <strong>{item.publicCode}</strong> · {item.status}
                </p>
                <p>
                  {dayOf(item.startsAt)} · {hourOf(item.startsAt)}
                </p>
                <p>
                  {item.specialtyName} · {item.professionalName} · {item.officeCode}
                </p>
                {item.status === "CONFIRMED" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      void api(`/api/v1/appointments/${item.id}/cancel`, { method: "POST" })
                        .then(() => load())
                        .catch((reason: Error) => setError(reason.message));
                    }}
                  >
                    Cancelar
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )
      ) : ready ? (
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            void api<{ devCode?: string }>("/api/v1/auth/patient/otp/request", {
              method: "POST",
              body: JSON.stringify({
                dni,
                phone,
                turnstileToken: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "" : "test-turnstile",
              }),
            })
              .then((body) => {
                setDevCode(body.devCode ?? null);
                setOtpSent(true);
              })
              .catch((reason: Error) => setError(reason.message));
          }}
        >
          <p>Ingresá con DNI y el teléfono registrado.</p>
          <label htmlFor="dni">DNI</label>
          <input id="dni" value={dni} onChange={(event) => setDni(event.target.value)} required />
          <label htmlFor="phone">Teléfono</label>
          <input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} required />
          <button type="submit">Enviar código</button>
          {devCode ? <p className="muted">Código de desarrollo, WhatsApp simulado: {devCode}</p> : null}
          {otpSent ? (
            <>
              <label htmlFor="code">Código</label>
              <input id="code" value={code} onChange={(event) => setCode(event.target.value)} />
              <button
                type="button"
                onClick={() => {
                  void api("/api/v1/auth/patient/otp/verify", {
                    method: "POST",
                    body: JSON.stringify({
                      dni,
                      phone,
                      code,
                      turnstileToken: "test-turnstile",
                    }),
                  })
                    .then(() => load())
                    .catch((reason: Error) => setError(reason.message));
                }}
              >
                Entrar
              </button>
            </>
          ) : null}
        </form>
      ) : null}
    </main>
  );
}
