// Unguessable room codes and player session tokens, both CSPRNG-backed.
"use strict";

const crypto = require("crypto");

// Uppercase alphanumeric, excluding visually ambiguous characters (0/O, 1/I/L).
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 8; // 32^8 ~= 2^40 combinations.

function generateRoomCode() {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

// Player tokens are session secrets (never shown in the URL) used to
// reclaim a seat after a refresh or reconnect. 24 random bytes, base64url.
function generatePlayerToken() {
  return crypto.randomBytes(24).toString("base64url");
}

module.exports = { generateRoomCode, generatePlayerToken };
