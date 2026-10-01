"use client";

import { ReportsAdmin } from "@/admin/ReportsAdmin";
import { DemoApp } from "@/demo/DemoApp";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function ReportsPage() {
  if (isDemoUiEnabled()) {
    return (
      <DemoApp>
        <main>
          <p className="pill-demo">DEMO</p>
          <h1>Estadísticas</h1>
          <p>En la demostración visual no hay totales reales.</p>
        </main>
      </DemoApp>
    );
  }
  return <ReportsAdmin />;
}
