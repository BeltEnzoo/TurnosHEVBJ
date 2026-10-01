"use client";

import { useEffect, useRef, useState } from "react";
import { DEMO_CALL_CHANNEL, isDemoUiEnabled } from "@/demo/is-demo-ui";
import type { DemoCallEvent } from "@/demo/types";
import "@/demo/demo.css";
import { LiveDisplay } from "@/llamador/LiveDisplay";
import "@/llamador/display.css";

function DemoDisplay() {
  const [current, setCurrent] = useState<DemoCallEvent | null>(null);
  const [pulse, setPulse] = useState(false);
  const queue = useRef<DemoCallEvent[]>([]);
  const speaking = useRef(false);

  useEffect(() => {
    const channel = new BroadcastChannel(DEMO_CALL_CHANNEL);
    channel.onmessage = (message: MessageEvent<DemoCallEvent>) => {
      queue.current.push(message.data);
    };
    const timer = window.setInterval(() => {
      if (speaking.current || queue.current.length === 0) {
        return;
      }
      const next = queue.current.shift();
      if (!next) {
        return;
      }
      speaking.current = true;
      setCurrent(next);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 4800);
      window.setTimeout(() => {
        speaking.current = false;
      }, 5000);
    }, 400);
    return () => {
      channel.close();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="tv-root">
      <span className="tv-offline">DEMO · sin WebSocket</span>
      <p className="tv-kicker">HOSPITAL MUNICIPAL</p>
      {current ? (
        <div className={pulse ? "tv-pulse" : undefined}>
          <p className="tv-kicker">TURNO</p>
          <p className="tv-code">{current.publicCode}</p>
          <p className="tv-office">Dirigirse al {current.officeLabel}</p>
        </div>
      ) : (
        <p className="tv-waiting">Sala de espera · próximo llamado</p>
      )}
    </main>
  );
}

export default function DisplayPage() {
  const [demo, setDemo] = useState(false);
  const [known, setKnown] = useState(false);

  useEffect(() => {
    setDemo(isDemoUiEnabled());
    setKnown(true);
  }, []);

  if (!known) {
    return <main className="tv-live" />;
  }
  if (demo) {
    return <DemoDisplay />;
  }
  return <LiveDisplay />;
}
