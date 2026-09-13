// Room lifecycle: creating rooms with unguessable codes, joining, and
// garbage-collecting abandoned rooms. Poker rules live entirely in Table;
// this module only knows about rooms as containers.
"use strict";

const { Table } = require("./table");
const { generateRoomCode, generatePlayerToken } = require("./codes");

const MAX_NAME_LENGTH = 20;
const ROOM_IDLE_CLEANUP_MS = 6 * 60 * 60 * 1000; // 6 hours with nobody connected

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> { table, createdAt, lastActivity }
  }

  sanitizeName(name) {
    const trimmed = String(name || "").trim().slice(0, MAX_NAME_LENGTH);
    return trimmed || "Player";
  }

  createRoom({ hostName, startingStack, smallBlind, bigBlind }, onEvent) {
    let code;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));

    const stack = clampInt(startingStack, 100, 1000000, 10000);
    const bb = clampInt(bigBlind, 2, 100000, 100);
    const sb = clampInt(smallBlind, 1, bb, Math.max(1, Math.floor(bb / 2)));

    const table = new Table({ startingStack: stack, smallBlind: sb, bigBlind: bb }, (type, payload) =>
      onEvent(code, type, payload)
    );

    const record = { table, createdAt: Date.now(), lastActivity: Date.now() };
    this.rooms.set(code, record);

    const token = generatePlayerToken();
    const player = table.addPlayer(token, this.sanitizeName(hostName), true);
    return { code, token, seat: player.seatIndex };
  }

  getRoom(code) {
    return this.rooms.get(String(code || "").toUpperCase()) || null;
  }

  joinRoom(code, name) {
    const record = this.getRoom(code);
    if (!record) return { error: "Room not found." };
    record.lastActivity = Date.now();
    const table = record.table;
    if (table.seatedPlayers().length >= 6) return { error: "Room is full." };
    const token = generatePlayerToken();
    const isHost = table.seatedPlayers().length === 0;
    const player = table.addPlayer(token, this.sanitizeName(name), isHost);
    if (!player) return { error: "Room is full." };
    return { token, seat: player.seatIndex };
  }

  touch(code) {
    const record = this.rooms.get(code);
    if (record) record.lastActivity = Date.now();
  }

  cleanupAbandoned() {
    const now = Date.now();
    for (const [code, record] of this.rooms) {
      const anyoneConnected = record.table.seatedPlayers().some((p) => p.connected);
      if (!anyoneConnected && now - record.lastActivity > ROOM_IDLE_CLEANUP_MS) {
        this.rooms.delete(code);
      }
    }
  }
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

module.exports = { RoomManager };
