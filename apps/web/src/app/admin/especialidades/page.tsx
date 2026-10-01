"use client";

import { SpecialtiesAdmin } from "@/admin/CatalogsAdmin";
import { DemoSpecialtiesScreen } from "@/demo/admin-catalog-screens";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function Page() {
  if (isDemoUiEnabled()) {
    return <DemoSpecialtiesScreen />;
  }
  return <SpecialtiesAdmin />;
}
