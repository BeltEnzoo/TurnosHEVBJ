"use client";

import { useEffect, useState } from "react";
import { isDemoUiEnabled } from "./is-demo-ui";
import "./demo.css";

export function DemoBanner() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(isDemoUiEnabled());
  }, []);
  if (!on) {
    return null;
  }
  return (
    <div className="demo-banner" role="status">
      MODO DEMO — datos ficticios, sin persistencia ni infraestructura real. No usar en producción.
    </div>
  );
}
