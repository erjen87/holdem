// Entry point: Express serves the static frontend (the same index.html /
// css / js used by the single-player game, plus the new play.html for
// multiplayer), and Socket.IO drives the real-time, server-authoritative
// poker rooms. Run with `npm start`.
"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const { RoomManager } = require("./server/roomManager");

const ROOT_DIR = __dirname;
const PORT = process.env.PORT || 3000;

const app = express();

// Keep server internals and dependency source out of the static file tree,
// even though there are no secrets in this repo.
app.use((req, res, next) => {
  if (
    req.path.startsWith("/server") ||
    req.path.startsWith("/node_modules") ||
    req.path === "/package.json" ||
    req.path === "/package-lock.json" ||
    req.path.startsWith("/.git") ||
    req.path === "/.env"
  ) {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(ROOT_DIR));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const roomManager = new RoomManager();

// socket.id -> { code, token }, used to resolve disconnects.
const socketIndex = new Map();

function broadcastRoom(code) {
  const record = roomManager.getRoom(code);
  if (!record) return;
  const table = record.table;
  for (const p of table.seatedPlayers()) {
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit("game_state", table.serializeForToken(p.token));
    }
  }
}

io.on("connection", (socket) => {
  socket.on("create_room", (payload, cb) => {
    cb = typeof cb === "function" ? cb : () => {};
    try {
      const { code, token, seat } = roomManager.createRoom(
        {
          hostName: payload && payload.name,
          startingStack: payload && payload.startingStack,
          smallBlind: payload && payload.smallBlind,
          bigBlind: payload && payload.bigBlind
        },
        (roomCode) => broadcastRoom(roomCode)
      );
      const record = roomManager.getRoom(code);
      const player = record.table.seats[seat];
      player.socketId = socket.id;
      socketIndex.set(socket.id, { code, token });
      cb({ ok: true, code, token, seat });
      broadcastRoom(code);
    } catch (err) {
      cb({ ok: false, error: "Could not create room." });
    }
  });

  socket.on("join_room", (payload, cb) => {
    cb = typeof cb === "function" ? cb : () => {};
    const code = String((payload && payload.code) || "").toUpperCase();
    const result = roomManager.joinRoom(code, payload && payload.name);
    if (result.error) return cb({ ok: false, error: result.error });
    const record = roomManager.getRoom(code);
    const player = record.table.seats[result.seat];
    player.socketId = socket.id;
    socketIndex.set(socket.id, { code, token: result.token });
    cb({ ok: true, code, token: result.token, seat: result.seat });
    broadcastRoom(code);
  });

  socket.on("rejoin", (payload, cb) => {
    cb = typeof cb === "function" ? cb : () => {};
    const code = String((payload && payload.code) || "").toUpperCase();
    const token = payload && payload.token;
    const record = roomManager.getRoom(code);
    if (!record) return cb({ ok: false, error: "Room not found." });
    const player = record.table.findByToken(token);
    if (!player) return cb({ ok: false, error: "Session not recognized." });
    player.connected = true;
    player.socketId = socket.id;
    roomManager.touch(code);
    socketIndex.set(socket.id, { code, token });
    cb({ ok: true, code, seat: player.seatIndex });
    broadcastRoom(code);
  });

  socket.on("start_game", (payload, cb) => {
    cb = typeof cb === "function" ? cb : () => {};
    const entry = socketIndex.get(socket.id);
    if (!entry) return cb({ ok: false, error: "Not in a room." });
    const record = roomManager.getRoom(entry.code);
    if (!record) return cb({ ok: false, error: "Room not found." });
    const table = record.table;
    const player = table.findByToken(entry.token);
    if (!player || !player.isHost) return cb({ ok: false, error: "Only the host can start the game." });
    if (!table.canStart()) return cb({ ok: false, error: "Need at least 2 players to start." });
    table.startHand();
    cb({ ok: true });
    broadcastRoom(entry.code);
  });

  socket.on("player_action", (payload, cb) => {
    cb = typeof cb === "function" ? cb : () => {};
    const entry = socketIndex.get(socket.id);
    if (!entry) return cb({ ok: false, error: "Not in a room." });
    const record = roomManager.getRoom(entry.code);
    if (!record) return cb({ ok: false, error: "Room not found." });
    const table = record.table;
    const player = table.findByToken(entry.token);
    if (!player) return cb({ ok: false, error: "Not seated in this room." });
    const result = table.applyAction(player.seatIndex, payload && payload.action, payload && payload.amount);
    cb(result);
    broadcastRoom(entry.code);
  });

  socket.on("leave_room", () => {
    const entry = socketIndex.get(socket.id);
    if (!entry) return;
    handleDisconnect(socket.id);
  });

  socket.on("disconnect", () => {
    handleDisconnect(socket.id);
  });
});

function handleDisconnect(socketId) {
  const entry = socketIndex.get(socketId);
  if (!entry) return;
  socketIndex.delete(socketId);
  const record = roomManager.getRoom(entry.code);
  if (!record) return;
  const table = record.table;
  const player = table.findByToken(entry.token);
  if (!player || player.socketId !== socketId) return; // already replaced by a newer connection
  player.connected = false;
  player.socketId = null;
  table.promoteNextHostIfNeeded();
  broadcastRoom(entry.code);
}

setInterval(() => roomManager.cleanupAbandoned(), 30 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Hold'em Royale server listening on http://localhost:${PORT}`);
});
