"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Desk } from "@/admin/Desk";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";
import { DemoAdminDashboard } from "@/demo/admin-screens";
import { useDemoData } from "@/demo/DemoDataProvider";

function DemoAdminGate() {
  const data = useDemoData();
  const router = useRouter();
  useEffect(() => {
    if (!data.sessionReady) {
      return;
    }
    if (!data.session) {
      router.replace("/admin/login");
    }
  }, [data.session, data.sessionReady, router]);
  if (!data.sessionReady || !data.session) {
    return (
      <main>
        <p className="muted">Redirigiendo al ingreso demo…</p>
      </main>
    );
  }
  return <DemoAdminDashboard />;
}

export default function AdminHomePage() {
  if (isDemoUiEnabled()) {
    return <DemoAdminGate />;
  }
  return <Desk />;
}
