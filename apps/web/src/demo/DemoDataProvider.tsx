"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  buildDemoSlots,
  demoAppointmentsSeed,
  demoOffices,
  demoProfessionals,
  demoSpecialties,
} from "./catalog";
import { DEMO_CALL_CHANNEL, DEMO_SESSION_KEY, DEMO_MY_APPOINTMENTS_KEY, DEMO_APPOINTMENTS_KEY, isDemoUiEnabled } from "./is-demo-ui";
import type {
  DemoAppointment,
  DemoCallEvent,
  DemoSession,
  DemoSlot,
} from "./types";

type DemoData = {
  specialties: typeof demoSpecialties;
  professionals: typeof demoProfessionals;
  offices: typeof demoOffices;
  slots: DemoSlot[];
  appointments: DemoAppointment[];
  myAppointments: DemoAppointment[];
  session: DemoSession | null;
  sessionReady: boolean;
  setSession: (session: DemoSession | null) => void;
  confirmMockBooking: (slot: DemoSlot) => DemoAppointment;
  callAppointment: (id: string, recall?: boolean) => void;
  markCompleted: (id: string) => void;
  markNoShow: (id: string) => void;
};

const DemoDataContext = createContext<DemoData | null>(null);

function officeLabel(officeId: string): string {
  return demoOffices.find((item) => item.id === officeId)?.label ?? officeId;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") {
    return;
  }
  sessionStorage.setItem(key, JSON.stringify(value));
}

export function DemoDataProvider({ children }: { children: ReactNode }) {
  const enabled = isDemoUiEnabled();
  const [appointments, setAppointments] = useState<DemoAppointment[]>(demoAppointmentsSeed);
  const [myAppointments, setMyAppointments] = useState<DemoAppointment[]>([]);
  const [session, setSessionState] = useState<DemoSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const slots = useMemo(() => buildDemoSlots(), []);

  useEffect(() => {
    setSessionState(readJson<DemoSession | null>(DEMO_SESSION_KEY, null));
    setMyAppointments(readJson<DemoAppointment[]>(DEMO_MY_APPOINTMENTS_KEY, []));
    setAppointments(readJson<DemoAppointment[]>(DEMO_APPOINTMENTS_KEY, demoAppointmentsSeed));
    setSessionReady(true);
  }, []);

  const setSession = useCallback((next: DemoSession | null) => {
    setSessionState(next);
    if (next) {
      writeJson(DEMO_SESSION_KEY, next);
    } else if (typeof window !== "undefined") {
      sessionStorage.removeItem(DEMO_SESSION_KEY);
    }
  }, []);

  const confirmMockBooking = useCallback((slot: DemoSlot): DemoAppointment => {
    const created: DemoAppointment = {
      id: `ap-local-${Date.now()}`,
      publicCode: `WX-${String(Date.now()).slice(-3)}`,
      patientLabel: "Tu turno (demo)",
      specialtyId: slot.specialtyId,
      professionalId: slot.professionalId,
      officeId: slot.officeId,
      date: slot.date,
      time: slot.time,
      status: "CONFIRMED",
    };
    setMyAppointments((current) => {
      const next = [created, ...current];
      writeJson(DEMO_MY_APPOINTMENTS_KEY, next);
      return next;
    });
    return created;
  }, []);

  const publishCall = useCallback((appointment: DemoAppointment) => {
    const event: DemoCallEvent = {
      publicCode: appointment.publicCode,
      officeLabel: officeLabel(appointment.officeId),
      spokenText: `Turno ${appointment.publicCode}. Dirigirse al ${officeLabel(appointment.officeId)}.`,
      at: new Date().toISOString(),
    };
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(DEMO_CALL_CHANNEL);
      channel.postMessage(event);
      channel.close();
    }
  }, []);

  const callAppointment = useCallback(
    (id: string, _recall = false) => {
      setAppointments((current) => {
        const next = current.map((item) =>
          item.id === id ? { ...item, status: "CALLED" as const } : item,
        );
        const found = next.find((item) => item.id === id);
        if (found) {
          publishCall(found);
        }
        writeJson(DEMO_APPOINTMENTS_KEY, next);
        return next;
      });
    },
    [publishCall],
  );

  const markCompleted = useCallback((id: string) => {
    setAppointments((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, status: "COMPLETED" as const } : item));
      writeJson(DEMO_APPOINTMENTS_KEY, next);
      return next;
    });
  }, []);

  const markNoShow = useCallback((id: string) => {
    setAppointments((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, status: "NO_SHOW" as const } : item));
      writeJson(DEMO_APPOINTMENTS_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      specialties: demoSpecialties,
      professionals: demoProfessionals,
      offices: demoOffices,
      slots,
      appointments,
      myAppointments,
      session,
      sessionReady,
      setSession,
      confirmMockBooking,
      callAppointment,
      markCompleted,
      markNoShow,
    }),
    [slots, appointments, myAppointments, session, sessionReady, setSession, confirmMockBooking, callAppointment, markCompleted, markNoShow],
  );

  if (!enabled) {
    return <>{children}</>;
  }

  return <DemoDataContext.Provider value={value}>{children}</DemoDataContext.Provider>;
}

export function useDemoData(): DemoData {
  const context = useContext(DemoDataContext);
  if (!context) {
    throw new Error("useDemoData only works inside DemoDataProvider (DEMO UI).");
  }
  return context;
}
