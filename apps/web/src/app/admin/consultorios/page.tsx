"use client";

import { OfficesAdmin } from "@/admin/CatalogsAdmin";
import { DemoOfficesScreen } from "@/demo/admin-catalog-screens";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function Page() {
  if (isDemoUiEnabled()) {
    return <DemoOfficesScreen />;
  }
  return <OfficesAdmin />;
}
