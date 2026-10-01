export type DemoSpecialty = {
  id: string;
  name: string;
  sortOrder: number;
};

export type DemoProfessional = {
  id: string;
  displayName: string;
  specialtyId: string;
  officeId: string;
};

export type DemoOffice = {
  id: string;
  label: string;
};

export type DemoSlot = {
  id: string;
  specialtyId: string;
  professionalId: string;
  officeId: string;
  date: string;
  time: string;
};

export type DemoAppointmentStatus =
  | "CONFIRMED"
  | "CALLED"
  | "COMPLETED"
  | "NO_SHOW";

export type DemoAppointment = {
  id: string;
  publicCode: string;
  patientLabel: string;
  specialtyId: string;
  professionalId: string;
  officeId: string;
  date: string;
  time: string;
  status: DemoAppointmentStatus;
};

export type DemoCallEvent = {
  publicCode: string;
  officeLabel: string;
  spokenText: string;
  at: string;
};

export type DemoSession = {
  role: "admin" | "medico";
  label: string;
};
