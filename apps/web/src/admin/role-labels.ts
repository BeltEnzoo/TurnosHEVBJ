const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Superusuario",
  ADMINISTRACION: "Administración",
  SISTEMAS: "Sistemas",
  RECEPCION: "Admisión",
  MEDICO: "Médico",
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  DISPLAY: "Pantalla",
};

export function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code;
}

export function staffHome(permissions: string[] | undefined): string {
  const has = (code: string) => Boolean(permissions?.includes(code));
  const desk = has("appointments:write");
  const catalogs = has("catalogs:write");
  const users = has("users:manage");
  const schedules = has("schedules:write");
  if (has("appointments:call:own") && !desk && !catalogs && !users && !schedules) {
    return "/medico";
  }
  if (desk) return "/admin";
  if (catalogs) return "/admin/especialidades";
  if (schedules) return "/admin/horarios";
  if (users) return "/admin/usuarios";
  if (has("displays:manage")) return "/admin/pantallas";
  if (has("settings:write")) return "/admin/configuracion";
  if (has("reports:read")) return "/admin/estadisticas";
  if (has("audit:read")) return "/admin/auditoria";
  return "/admin/login";
}
