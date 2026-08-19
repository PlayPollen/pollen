// Server entrypoint. The ONLY place infrastructure choices are wired together.
// To scale, you change adapters here — not in any game code.

import { Server } from "colyseus";
import { createServer } from "http";
import express from "express";
import { FarmRoom } from "./rooms/FarmRoom";
import { InMemoryPersistence, PersistencePort } from "./persistence/PersistencePort";

const app = express();
app.use(express.json());

// --- Swap this one line to change your whole storage backend. --------------
const persistence: PersistencePort = new InMemoryPersistence();
// const persistence = new PostgresPersistence(process.env.DATABASE_URL!);  // later

const gameServer = new Server({ server: createServer(app) });

// Register the room type. `.filterBy(['farmId'])` later lets players rejoin
// their specific farm; matchmaking hands them to the right instance.
gameServer.define("farm", FarmRoom, { persistence });

const PORT = Number(process.env.PORT ?? 2567);
gameServer.listen(PORT);
console.log(`🌼 Pollen server (authoritative) on :${PORT}`);
