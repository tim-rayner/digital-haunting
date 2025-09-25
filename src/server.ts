// src/server.ts (fixed)
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import path from "path";
import { Server } from "socket.io";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true });

// static files
app.register(fastifyStatic, {
  root: path.join(process.cwd(), "public"),
  prefix: "/",
});

// Map nice routes → files (so /display works, not only /display.html)
app.get("/display", async (_, reply) => reply.sendFile("display.html"));
app.get("/control", async (_, reply) => reply.sendFile("control.html"));

const io = new Server(app.server, {
  cors: { origin: "*" },
  transports: ["websocket"],     // prefer pure WS
  pingInterval: 20000,           // 20s
  pingTimeout: 20000             // 20s
});

const ROOM = process.env.ROOM || "HALLOWEEN";
const PARTY_KEY = process.env.PARTY_KEY || "changeme";
// Cooldown removed
const PORT = Number(process.env.PORT || 8080);

const lastThemeByRoom = new Map<string, string>();
const buckets = new Map<string, { tokens: number; last: number }>();
function tooFast(id: string, ratePerSec = 0.8, burst = 2) {
  const now = Date.now();
  const b = buckets.get(id) ?? { tokens: burst, last: now };
  const delta = (now - b.last) / 1000;
  b.tokens = Math.min(burst, b.tokens + delta * ratePerSec);
  b.last = now;
  buckets.set(id, b);
  if (b.tokens < 1) return true;
  b.tokens -= 1;
  return false;
}

let locked = false;

io.on("connection", (socket) => {
  let joined = false;

  socket.on(
    "join",
    (p: { room: string; role: "display" | "control"; key?: string }) => {
      if (p.room !== ROOM) return socket.disconnect(true);
      if (p.role === "control" && p.key !== PARTY_KEY)
        return socket.disconnect(true);

      socket.join(ROOM);
      joined = true;

      const last = lastThemeByRoom.get(ROOM);
      if (last) socket.emit("theme:current", { theme: last, at: Date.now() });

      socket.emit("state", {
        locked,
        cooldownMs: 0,
      });
    }
  );

  socket.on("theme:get", (room: string) => {
    if (room !== ROOM) return;
    const last = lastThemeByRoom.get(ROOM);
    socket.emit("theme:current", { theme: last ?? null, at: Date.now() });
  });

  socket.on("theme:set", (msg: { room: string; theme: string }) => {
    console.log("[server] theme:set", msg);
    if (!joined || msg.room !== ROOM) return;
    if (locked) return;
    if (tooFast(socket.id)) return;

    lastThemeByRoom.set(ROOM, msg.theme);
    // 1) broadcast to everyone
    io.to(ROOM).emit("theme:current", { theme: msg.theme, at: Date.now() });
    // 2) ack sender so controller can confirm
    socket.emit("theme:ack", { theme: msg.theme, at: Date.now() });
    // cooldown/state emit stays as-is
    io.to(ROOM).emit("state", { locked, cooldownMs: 0 });
  });

  socket.on("host:lock", (payload: { key: string; locked: boolean }) => {
    if (payload.key !== PARTY_KEY) return;
    locked = payload.locked;
    io.to(ROOM).emit("state", { locked, cooldownMs: 2000 });
  });
});

// IMPORTANT: listen with Fastify (not a separate httpServer)
app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`🎃 Up on ${address}`);
});
