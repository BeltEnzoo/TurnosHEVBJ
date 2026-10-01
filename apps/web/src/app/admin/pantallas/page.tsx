"use client";

import { DisplaysAdmin } from "@/admin/DisplaysAdmin";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function Page() {
  if (isDemoUiEnabled()) {
    return null;
  }
  return <DisplaysAdmin />;
}
