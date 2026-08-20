// Server entrypoint. The ONLY place infrastructure choices are wired together.
// To scale, you change adapters here — not in any game code.

// We depend on @colyseus/core + an explicit transport rather than the `colyseus`
// meta-package. That meta-package is just core with a default transport, but it
// eagerly imports @colyseus/redis-presence and @colyseus/redis-driver, which we
// don't use yet. Choosing the transport here keeps the dependency tree honest —
// and this is the line you'd change to add Redis when scaling past one node.
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import express from "express";
import { FarmRoom } from "./rooms/FarmRoom.js";
import { InMemoryPersistence, PersistencePort } from "./persistence/PersistencePort.js";
import { issueGuestToken } from "./auth/guestToken.js";

const app = express();
app.use(express.json());

// The client is served from a different origin than the game server (Vite on
// :5173 in dev, Cloudflare Pages in production), so the token endpoint needs
// CORS. `*` is safe here specifically because nothing uses cookies — the token
// is returned in the response body and stored by the client, so there are no
// ambient credentials for another origin to ride on. Set POLLEN_ALLOWED_ORIGIN
// to lock it down anyway once the production domain is known.
const ALLOWED_ORIGIN = process.env.POLLEN_ALLOWED_ORIGIN ?? "*";
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Every host (Fly/Railway/VPS behind a proxy) wants a cheap liveness endpoint.
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Mint an anonymous identity. No signup: the browser calls this once, keeps the
// token, and presents it on every join. The server stores nothing — the
// signature is what makes the id unforgeable.
app.post("/auth/guest", (_req, res) => res.json(issueGuestToken()));

// --- Swap this one line to change your whole storage backend. --------------
const persistence: PersistencePort = new InMemoryPersistence();
// const persistence = new PostgresPersistence(process.env.DATABASE_URL!);  // later

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer(app) }),
});

// `.filterBy(['farmId'])` is what makes single-player single: matchmaking only
// reuses a room whose farmId matches, so "solo:<userId>" is a farm nobody else
// can be matched into. Without it every player on the server lands in the same
// room, which is what happened before the menu existed.
gameServer.define("farm", FarmRoom, { persistence }).filterBy(["farmId"]);

const PORT = Number(process.env.PORT ?? 2567);
gameServer.listen(PORT);
console.log(`🌼 Pollen server (authoritative) on :${PORT}`);
