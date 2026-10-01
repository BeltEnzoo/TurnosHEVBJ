import type { Server as HttpServer } from "node:http";
import { Server, type Namespace } from "socket.io";
import type { PrismaClient } from "@hep/db";
import { sha256 } from "../../lib/crypto.js";
import { presentDisplay, withHospitalName } from "./service.js";

export type PatientCalledEvent = {
  callId: string;
  publicCode: string;
  officeLabel: string;
  spokenText: string;
  ts: string;
};

export type DisplayHub = {
  hasListeners(displayId: string): boolean;
  emitCalled(displayId: string, payload: PatientCalledEvent): void;
  close(): Promise<void>;
};

const ROOM = (displayId: string) => `display:${displayId}`;

export function attachDisplayHub(httpServer: HttpServer, prisma: PrismaClient, origins: string[]): DisplayHub {
  const io = new Server(httpServer, {
    path: "/socket.io",
    transports: ["websocket"],
    cors: { origin: origins },
  });
  const nsp: Namespace = io.of("/ws/displays");

  nsp.use(async (socket, next) => {
    const raw = socket.handshake.auth?.token;
    const token = typeof raw === "string" ? raw.trim() : "";
    if (token.length < 16 || token.length > 200) {
      next(new Error("unauthorized"));
      return;
    }
    const display = await prisma.display.findFirst({
      where: { tokenHash: sha256(token), deactivatedAt: null },
      select: { id: true, status: true },
    });
    if (!display || display.status === "MAINTENANCE") {
      next(new Error("unauthorized"));
      return;
    }
    socket.data.displayId = display.id;
    next();
  });

  nsp.on("connection", (socket) => {
    const displayId = socket.data.displayId as string;
    void (async () => {
      await socket.join(ROOM(displayId));
      const row = await prisma.display.update({
        where: { id: displayId },
        data: { status: "ONLINE", lastSeenAt: new Date() },
        include: {
          offices: { include: { office: { select: { code: true, name: true } } } },
        },
      });
      socket.emit("display.config", await withHospitalName(prisma, presentDisplay(row)));
    })();
    const timer = setInterval(() => {
      socket.emit("ping");
    }, 25_000);
    socket.on("pong", () => {
      void prisma.display.update({
        where: { id: displayId },
        data: { lastSeenAt: new Date(), status: "ONLINE" },
      });
    });
    socket.on("disconnect", () => {
      clearInterval(timer);
      const stillThere = [...nsp.sockets.values()].some((item) => item.data.displayId === displayId);
      if (stillThere) {
        return;
      }
      void prisma.display
        .updateMany({
          where: { id: displayId, status: { not: "MAINTENANCE" } },
          data: { status: "OFFLINE" },
        })
        .catch(() => undefined);
    });
  });

  return {
    hasListeners(displayId) {
      const room = nsp.adapter.rooms.get(ROOM(displayId));
      return Boolean(room && room.size > 0);
    },
    emitCalled(displayId, payload) {
      nsp.to(ROOM(displayId)).emit("patient.called", payload);
    },
    async close() {
      await io.disconnectSockets(true);
      await io.close();
    },
  };
}
