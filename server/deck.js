// Server-side deck: card creation + cryptographically secure shuffle.
// The client never receives the deck or a shuffle seed -- only the cards
// dealt to it.
"use strict";

const crypto = require("crypto");

const SUITS = ["s", "h", "d", "c"];
const RANK_LABEL = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
  11: "J", 12: "Q", 13: "K", 14: "A"
};

function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) {
      deck.push({ r, s, id: RANK_LABEL[r] + s });
    }
  }
  return deck;
}

// Fisher-Yates using a CSPRNG. crypto.randomInt(0, n) is uniform and
// unbiased, unlike `Math.random() * n | 0`.
function shuffle(deck) {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { SUITS, RANK_LABEL, makeDeck, shuffle };
