"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { asScreenCall, pushRecent, speechLines, type ScreenCall } from "./board";
import { browserSpeech, type SpeechRequest } from "./speech";
import "./display.css";

const STORAGE_KEY = "hep.display.token";

type VoiceSettings = {
  enabled: boolean;
  locale: string;
  rate: number;
  volume: number;
  repeatCount: number;
};

const DEFAULT_VOICE: VoiceSettings = {
  enabled: true,
  locale: "es-AR",
  rate: 1,
  volume: 80,
  repeatCount: 1,
};

function apiOrigin(): string {
  return (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
}

function asVoice(value: unknown): VoiceSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_VOICE;
  }
  const row = value as Record<string, unknown>;
  return {
    enabled: row.enabled !== false,
    locale: typeof row.locale === "string" ? row.locale : DEFAULT_VOICE.locale,
    rate: typeof row.rate === "number" ? row.rate : DEFAULT_VOICE.rate,
    volume: typeof row.volume === "number" ? row.volume : DEFAULT_VOICE.volume,
    repeatCount: typeof row.repeatCount === "number" ? row.repeatCount : DEFAULT_VOICE.repeatCount,
  };
}

export function LiveDisplay() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [hospitalName, setHospitalName] = useState("Hospital");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<ScreenCall | null>(null);
  const [recent, setRecent] = useState<ScreenCall[]>([]);

  useEffect(() => {
    setToken(window.localStorage.getItem(STORAGE_KEY));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    const seen = new Set<string>();
    const voice = { ...DEFAULT_VOICE };
    const lines: SpeechRequest[] = [];
    let pumping = false;
    let online = false;
    const currentRef = { current: null as ScreenCall | null };
    const speech = browserSpeech();

    function show(call: ScreenCall, speak: boolean) {
      if (seen.has(call.callId)) {
        return;
      }
      seen.add(call.callId);
      const previous = currentRef.current;
      currentRef.current = call;
      setCurrent(call);
      setRecent((items) => pushRecent(items, previous));
      if (!speak) {
        return;
      }
      lines.push(
        ...speechLines(call.spokenText, voice.enabled, voice.repeatCount).map((text) => ({
          text,
          locale: voice.locale,
          rate: voice.rate,
          volume: voice.volume,
        })),
      );
      void pump();
    }

    async function pump() {
      if (pumping || !online) {
        return;
      }
      const next = lines.shift();
      if (!next) {
        return;
      }
      pumping = true;
      await speech.speak(next);
      pumping = false;
      if (!cancelled) {
        void pump();
      }
    }

    async function loadBoard() {
      const headers = { authorization: `Bearer ${token}` };
      const [meResponse, snapshotResponse] = await Promise.all([
        fetch("/api/v1/displays/me", { headers }),
        fetch("/api/v1/displays/me/snapshot", { headers }),
      ]);
      if (!meResponse.ok || !snapshotResponse.ok) {
        throw new Error("rejected");
      }
      const me = (await meResponse.json()) as { hospitalName?: string; voice?: unknown };
      const snapshot = (await snapshotResponse.json()) as { items?: unknown[] };
      if (cancelled) {
        return;
      }
      if (typeof me.hospitalName === "string" && me.hospitalName) {
        setHospitalName(me.hospitalName);
      }
      Object.assign(voice, asVoice(me.voice));
      const items = (snapshot.items ?? []).map(asScreenCall).filter((item): item is ScreenCall => item !== null);
      for (const item of items) {
        seen.add(item.callId);
      }
      const newest = items.at(-1) ?? null;
      if (newest && !currentRef.current) {
        currentRef.current = newest;
        setCurrent(newest);
        setRecent(items.slice(0, -1).reverse().slice(0, 4));
      }
    }

    const socket: Socket = io(`${apiOrigin()}/ws/displays`, {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    socket.on("connect", () => {
      online = true;
      setConnected(true);
      setError(null);
      void loadBoard().catch(() => {
        if (!cancelled) {
          setError("No se pudo conectar esta pantalla.");
        }
      });
      void pump();
    });
    socket.on("disconnect", () => {
      online = false;
      setConnected(false);
    });
    socket.on("connect_error", () => {
      online = false;
      setConnected(false);
      setError("No se pudo conectar esta pantalla.");
    });
    socket.on("display.config", (payload: { hospitalName?: string; voice?: unknown }) => {
      if (typeof payload?.hospitalName === "string" && payload.hospitalName) {
        setHospitalName(payload.hospitalName);
      }
      Object.assign(voice, asVoice(payload?.voice));
    });
    socket.on("patient.called", (payload: unknown) => {
      const call = asScreenCall(payload);
      if (call) {
        show(call, true);
      }
    });
    socket.on("ping", () => {
      socket.emit("pong");
    });

    const beat = window.setInterval(() => {
      if (!online) {
        return;
      }
      void fetch("/api/v1/displays/me/heartbeat", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
    }, 20_000);

    return () => {
      cancelled = true;
      online = false;
      window.clearInterval(beat);
      speech.cancel();
      socket.close();
    };
  }, [token]);

  function saveToken(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (next.length < 16) {
      setError("El token de la pantalla no es válido.");
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, next);
    setError(null);
    setToken(next);
    setDraft("");
  }

  function forget() {
    window.localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setCurrent(null);
    setRecent([]);
    setConnected(false);
    setError(null);
  }

  if (!ready) {
    return (
      <main className="tv-live">
        <p className="tv-waiting">Sala de espera</p>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="tv-live">
        <p className="tv-kicker">{hospitalName}</p>
        <form className="tv-setup" onSubmit={saveToken}>
          <h1>Pantalla de llamados</h1>
          <label htmlFor="display-token">Token de esta pantalla</label>
          <input
            id="display-token"
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          {error ? <p className="tv-error">{error}</p> : null}
          <button type="submit">Conectar</button>
        </form>
      </main>
    );
  }

  return (
    <main className="tv-live">
      <p className="tv-status" data-state={connected ? "online" : "offline"}>
        {connected ? "En línea" : "Sin conexión"}
      </p>
      <header className="tv-brand">
        <img src="/brand/logo.png" alt="" />
        <p>{hospitalName}</p>
      </header>
      {current ? (
        <>
          <p className="tv-kicker">TURNO</p>
          <p className="tv-code">{current.publicCode}</p>
          <p className="tv-direction">DIRIGIRSE AL</p>
          <p className="tv-office">{current.officeLabel}</p>
        </>
      ) : (
        <p className="tv-waiting">Sala de espera · próximo llamado</p>
      )}
      {error ? <p className="tv-error">{error}</p> : null}
      {recent.length > 0 ? (
        <section className="tv-recent" aria-label="Últimos llamados">
          <h2>ÚLTIMOS</h2>
          <ul>
            {recent.map((item) => (
              <li key={item.callId}>
                <span>{item.publicCode}</span>
                <span>{item.officeLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <button type="button" className="tv-forget" onClick={forget}>
        Usar otra pantalla
      </button>
    </main>
  );
}
