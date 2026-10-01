"use client";

import { NoticesAdmin } from "@/admin/NoticesAdmin";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function Page() {
  if (isDemoUiEnabled()) {
    return null;
  }
  return <NoticesAdmin />;
}
