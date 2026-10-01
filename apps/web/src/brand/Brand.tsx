"use client";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand brand-compact" : "brand"}>
      <img className="brand-mark" src="/brand/logo.png" alt="" />
      <span className="brand-text">
        <strong>Hospital Eva Perón</strong>
        {compact ? null : <small>Ente Descentralizado Dr. Saintout · Benito Juárez</small>}
      </span>
    </div>
  );
}
