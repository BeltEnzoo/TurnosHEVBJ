"use client";

import { ProfessionalsAdmin } from "@/admin/CatalogsAdmin";
import { DemoProfessionalsScreen } from "@/demo/admin-catalog-screens";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function Page() {
  if (isDemoUiEnabled()) {
    return <DemoProfessionalsScreen />;
  }
  return <ProfessionalsAdmin />;
}
