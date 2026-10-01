"use client";

import { PatientsAdmin } from "@/admin/PatientsAdmin";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function Page() {
  if (isDemoUiEnabled()) {
    return null;
  }
  return <PatientsAdmin />;
}
