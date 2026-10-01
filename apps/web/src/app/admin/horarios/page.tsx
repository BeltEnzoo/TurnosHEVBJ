"use client";

import { SchedulesAdmin } from "@/admin/SchedulesAdmin";
import { DemoSchedulesScreen } from "@/demo/admin-catalog-screens";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function Page() {
  if (isDemoUiEnabled()) {
    return <DemoSchedulesScreen />;
  }
  return <SchedulesAdmin />;
}
