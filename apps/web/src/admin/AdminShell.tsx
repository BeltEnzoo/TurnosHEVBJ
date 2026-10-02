"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brand } from "@/brand/Brand";
import { adminApi, type StaffMe } from "./api";
import { roleLabel, staffHome } from "./role-labels";
import "./admin.css";

const LINKS: Array<{ href: string; label: string; permission: string }> = [
  { href: "/admin", label: "Mostrador", permission: "appointments:write" },
  { href: "/admin/turnos", label: "Turnos", permission: "appointments:write" },
  { href: "/admin/pacientes", label: "Pacientes", permission: "appointments:write" },
  { href: "/admin/avisos", label: "Avisos", permission: "appointments:write" },
  { href: "/admin/estadisticas", label: "Estadísticas", permission: "reports:read" },
  { href: "/admin/auditoria", label: "Auditoría", permission: "audit:read" },
  { href: "/admin/especialidades", label: "Especialidades", permission: "catalogs:write" },
  { href: "/admin/profesionales", label: "Profesionales", permission: "catalogs:write" },
  { href: "/admin/consultorios", label: "Consultorios", permission: "catalogs:write" },
  { href: "/admin/horarios", label: "Agenda", permission: "schedules:write" },
  { href: "/admin/pantallas", label: "Pantallas", permission: "displays:manage" },
  { href: "/admin/usuarios", label: "Usuarios", permission: "users:manage" },
  { href: "/admin/configuracion", label: "Configuración", permission: "settings:write" },
];

export function AdminShell({
  title,
  permission,
  children,
}: {
  title: string;
  permission?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<StaffMe>("/api/v1/auth/staff/me")
      .then(setMe)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function logout() {
    await fetch("/api/v1/auth/staff/logout", { method: "POST", credentials: "include" });
    router.replace("/admin/login");
  }

  if (error) {
    return (
      <main className="admin-app">
        <p className="error">{error}</p>
      </main>
    );
  }
  if (!me) {
    return (
      <main className="admin-app">
        <p className="muted">Cargando…</p>
      </main>
    );
  }
  if (permission && !me.permissions.includes(permission)) {
    return (
      <main className="admin-app">
        <p className="error">No tiene permiso para esta sección.</p>
        <Link href={staffHome(me.permissions)}>Volver</Link>
      </main>
    );
  }

  const links = LINKS.filter((item) => me.permissions.includes(item.permission));

  return (
    <main className="admin-app">
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
      <nav className="admin-nav" aria-label="Panel">
        {links.map((item) => {
          const current = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <h1>{title}</h1>
      <p className="muted">
        {me.email} · {me.roles.map(roleLabel).join(", ")}
      </p>
      {children}
    </main>
  );
}
