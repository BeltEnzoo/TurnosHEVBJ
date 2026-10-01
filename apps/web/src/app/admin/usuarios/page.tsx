"use client";

import { UsersAdmin } from "@/admin/UsersAdmin";
import { isDemoUiEnabled } from "@/demo/is-demo-ui";

export default function Page() {
  if (isDemoUiEnabled()) {
    return null;
  }
  return <UsersAdmin />;
}
