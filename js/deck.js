// Card, deck creation, shuffling. Exposed on window.Poker namespace.
(function (Poker) {
  "use strict";

  const SUITS = ["s", "h", "d", "c"];
  const SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const SUIT_COLOR = { s: "black", c: "black", h: "red", d: "red" };
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

  // Fisher-Yates using crypto randomness where available.
  function shuffle(deck) {
    const arr = deck.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      let j;
      if (window.crypto && window.crypto.getRandomValues) {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        j = buf[0] % (i + 1);
      } else {
        j = Math.floor(Math.random() * (i + 1));
      }
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  Poker.Deck = {
    SUITS,
    SUIT_SYMBOL,
    SUIT_COLOR,
    RANK_LABEL,
    makeDeck,
    shuffle
  };

  // Shared table size constant (also defined on Poker.Game for the
  // single-player engine); kept here too so pages that only need rendering
  // helpers (e.g. the online multiplayer client) don't have to load game.js.
  Poker.NUM_SEATS = Poker.NUM_SEATS || 6;
})(window.Poker = window.Poker || {});
