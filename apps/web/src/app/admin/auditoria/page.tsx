"use client";

import { AuditAdmin } from "@/admin/AuditAdmin";
import { DemoApp } from "@/demo/DemoApp";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function AuditPage() {
  if (isDemoUiEnabled()) {
    return (
      <DemoApp>
        <main>
          <p className="pill-demo">DEMO</p>
          <h1>Auditoría</h1>
          <p>En la demostración visual no hay registros reales.</p>
        </main>
      </DemoApp>
    );
  }
  return <AuditAdmin />;
}
