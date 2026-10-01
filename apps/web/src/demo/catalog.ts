import type {
  DemoAppointment,
  DemoOffice,
  DemoProfessional,
  DemoSlot,
  DemoSpecialty,
} from "./types";

export const DEMO_HOSPITAL_NAME = "Hospital Municipal";

export const demoSpecialties: DemoSpecialty[] = [
  { id: "sp-clinica", name: "Clínica Médica", sortOrder: 1 },
  { id: "sp-pedia", name: "Pediatría", sortOrder: 2 },
  { id: "sp-gine", name: "Ginecología", sortOrder: 3 },
  { id: "sp-trauma", name: "Traumatología", sortOrder: 4 },
];

export const demoOffices: DemoOffice[] = [
  { id: "of-1", label: "Consultorio 1" },
  { id: "of-2", label: "Consultorio 2" },
  { id: "of-3", label: "Consultorio 3" },
  { id: "of-4", label: "Consultorio 4" },
];

export const demoProfessionals: DemoProfessional[] = [
  { id: "pr-perez", displayName: "Dra. Pérez (demo)", specialtyId: "sp-clinica", officeId: "of-3" },
  { id: "pr-gomez", displayName: "Dr. Gómez (demo)", specialtyId: "sp-clinica", officeId: "of-1" },
  { id: "pr-ruiz", displayName: "Dra. Ruiz (demo)", specialtyId: "sp-pedia", officeId: "of-2" },
  { id: "pr-sosa", displayName: "Dra. Sosa (demo)", specialtyId: "sp-gine", officeId: "of-4" },
  { id: "pr-lopes", displayName: "Dr. Lopes (demo)", specialtyId: "sp-trauma", officeId: "of-1" },
];

function isoDate(offsetDays: number): string {
  const now = new Date();
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays);
  return new Date(utc).toISOString().slice(0, 10);
}

const times = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00"];

export function buildDemoSlots(): DemoSlot[] {
  const slots: DemoSlot[] = [];
  for (const professional of demoProfessionals) {
    for (let day = 1; day <= 5; day += 1) {
      for (const time of times) {
        slots.push({
          id: `slot-${professional.id}-${day}-${time}`,
          specialtyId: professional.specialtyId,
          professionalId: professional.id,
          officeId: professional.officeId,
          date: isoDate(day),
          time,
        });
      }
    }
  }
  return slots;
}

export const demoAppointmentsSeed: DemoAppointment[] = [
  {
    id: "ap-1",
    publicCode: "KT-7M4",
    patientLabel: "Paciente demo A",
    specialtyId: "sp-clinica",
    professionalId: "pr-perez",
    officeId: "of-3",
    date: isoDate(0),
    time: "09:00",
    status: "CONFIRMED",
  },
  {
    id: "ap-2",
    publicCode: "HN-3P2",
    patientLabel: "Paciente demo B",
    specialtyId: "sp-clinica",
    professionalId: "pr-perez",
    officeId: "of-3",
    date: isoDate(0),
    time: "09:30",
    status: "CONFIRMED",
  },
  {
    id: "ap-3",
    publicCode: "QR-8W6",
    patientLabel: "Paciente demo C",
    specialtyId: "sp-clinica",
    professionalId: "pr-perez",
    officeId: "of-3",
    date: isoDate(0),
    time: "10:00",
    status: "CONFIRMED",
  },
  {
    id: "ap-4",
    publicCode: "LM-2N9",
    patientLabel: "Paciente demo D",
    specialtyId: "sp-pedia",
    professionalId: "pr-ruiz",
    officeId: "of-2",
    date: isoDate(0),
    time: "08:30",
    status: "CONFIRMED",
  },
];

export function formatDemoDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}
