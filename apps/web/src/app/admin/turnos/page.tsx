"use client";

import { AppointmentsAdmin } from "@/admin/AppointmentsAdmin";
import { DemoAppointmentsScreen } from "@/demo/admin-catalog-screens";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function Page() {
  if (isDemoUiEnabled()) {
    return <DemoAppointmentsScreen />;
  }
  return <AppointmentsAdmin />;
}
