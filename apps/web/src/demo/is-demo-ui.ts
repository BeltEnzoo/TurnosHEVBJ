/**
 * Visual DEMO UI only. Never true in production builds.
 * Does not replace PostgreSQL, Redis, or Phase 1 auth.
 */
export function isDemoUiEnabled(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return process.env.NEXT_PUBLIC_DEMO_UI === "true";
}

export const DEMO_CALL_CHANNEL = "hep.demo.caller";
export const DEMO_SESSION_KEY = "hep.demo.session";
export const DEMO_MY_APPOINTMENTS_KEY = "hep.demo.myAppointments";
export const DEMO_APPOINTMENTS_KEY = "hep.demo.appointments";
