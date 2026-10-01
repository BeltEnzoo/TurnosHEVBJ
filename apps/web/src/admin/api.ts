export type StaffMe = {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
};

export async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
  if (response.status === 401 && typeof window !== "undefined") {
    const code = body.error?.code;
    window.location.assign(code === "MFA_REQUIRED" || code === "MFA_ENROLLMENT_REQUIRED" ? "/admin/mfa" : "/admin/login");
    throw new Error(body.error?.message ?? "Necesita iniciar sesión.");
  }
  if (!response.ok) {
    throw new Error(body.error?.message ?? "No se pudo completar la acción.");
  }
  return body as T;
}

export const TZ = "America/Argentina/Buenos_Aires";

export function civilToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function addCivilDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function hourOf(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function dayOf(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(iso));
}
