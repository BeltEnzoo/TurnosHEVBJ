"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PatientPortal } from "@/portal/PatientPortal";
import { DemoApp, DemoNav } from "@/demo/DemoApp";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";
import { useDemoData } from "@/demo/DemoDataProvider";
import { formatDemoDate } from "@/demo/catalog";
import type { DemoSlot } from "@/demo/types";

function PortalWizard() {
  const router = useRouter();
  const data = useDemoData();
  const [specialtyId, setSpecialtyId] = useState<string | null>(null);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<DemoSlot | null>(null);
  const [confirmed, setConfirmed] = useState<{ code: string; slot: DemoSlot } | null>(null);

  const professionals = data.professionals.filter((item) => item.specialtyId === specialtyId);
  const dates = useMemo(() => {
    const unique = new Set(
      data.slots
        .filter((item) => item.specialtyId === specialtyId && item.professionalId === professionalId)
        .map((item) => item.date),
    );
    return [...unique];
  }, [data.slots, professionalId, specialtyId]);
  const hours = data.slots.filter(
    (item) =>
      item.specialtyId === specialtyId &&
      item.professionalId === professionalId &&
      item.date === date,
  );

  if (confirmed) {
    const specialty = data.specialties.find((item) => item.id === confirmed.slot.specialtyId);
    const professional = data.professionals.find((item) => item.id === confirmed.slot.professionalId);
    return (
      <div className="demo-page">
        <DemoNav variant="portal" />
        <p className="pill-demo">DEMO</p>
        <h1>Turno registrado (ficticio)</h1>
        <div className="card">
          <p>Este no es un turno real. No se guardó en el hospital.</p>
          <p>
            <strong>Código:</strong> {confirmed.code}
          </p>
          <p>
            {formatDemoDate(confirmed.slot.date)} · {confirmed.slot.time}
          </p>
          <p>
            {specialty?.name} · {professional?.displayName}
          </p>
        </div>
        <p>
          <button type="button" onClick={() => router.push("/portal/mis-turnos")}>
            Ver mis turnos (demo)
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="demo-page">
      <DemoNav variant="portal" />
      <p className="pill-demo">PORTAL PACIENTE · DEMO</p>
      <h1>Sacar un turno</h1>
      <p className="muted">Flujo visual. Los horarios no están reservados de verdad.</p>

      <h2>1. Especialidad</h2>
      <div className="demo-grid">
        {data.specialties.map((item) => (
          <button
            key={item.id}
            type="button"
            className="demo-choice"
            aria-pressed={specialtyId === item.id}
            onClick={() => {
              setSpecialtyId(item.id);
              setProfessionalId(null);
              setDate(null);
              setSlot(null);
            }}
          >
            {item.name}
          </button>
        ))}
      </div>

      {specialtyId ? (
        <>
          <h2>2. Profesional</h2>
          <div className="demo-grid">
            {professionals.map((item) => (
              <button
                key={item.id}
                type="button"
                className="demo-choice"
                aria-pressed={professionalId === item.id}
                onClick={() => {
                  setProfessionalId(item.id);
                  setDate(null);
                  setSlot(null);
                }}
              >
                {item.displayName}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {professionalId ? (
        <>
          <h2>3. Fecha</h2>
          <div className="demo-grid">
            {dates.map((item) => (
              <button
                key={item}
                type="button"
                className="demo-choice"
                aria-pressed={date === item}
                onClick={() => {
                  setDate(item);
                  setSlot(null);
                }}
              >
                {formatDemoDate(item)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {date ? (
        <>
          <h2>4. Horario</h2>
          <div className="demo-grid">
            {hours.map((item) => (
              <button
                key={item.id}
                type="button"
                className="demo-choice"
                aria-pressed={slot?.id === item.id}
                onClick={() => setSlot(item)}
              >
                {item.time}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {slot ? (
        <>
          <h2>5. Confirmación ficticia</h2>
          <div className="card">
            <p>
              {formatDemoDate(slot.date)} a las {slot.time}
            </p>
            <button
              type="button"
              onClick={() => {
                const created = data.confirmMockBooking(slot);
                setConfirmed({ code: created.publicCode, slot });
              }}
            >
              Confirmar (demo)
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function PortalPage() {
  if (!isDemoUiEnabled()) {
    return <PatientPortal />;
  }
  return (
    <DemoApp>
      <PortalWizard />
    </DemoApp>
  );
}
