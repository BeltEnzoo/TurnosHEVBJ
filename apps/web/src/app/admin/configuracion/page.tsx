"use client";

import { SettingsAdmin } from "@/admin/SettingsAdmin";
import { DemoSettingsScreen } from "@/demo/admin-catalog-screens";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function Page() {
  if (isDemoUiEnabled()) {
    return <DemoSettingsScreen />;
  }
  return <SettingsAdmin />;
}
