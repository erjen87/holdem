// Server-side port of js/evaluator.js (CommonJS instead of the browser's
// window.Poker namespace). Same algorithm, kept in sync deliberately --
// see tests/handEvaluator.test.js for the shared assertions.
"use strict";

const CATEGORY_NAMES = {
  8: "Straight Flush",
  7: "Four of a Kind",
  6: "Full House",
  5: "Flush",
  4: "Straight",
  3: "Three of a Kind",
  2: "Two Pair",
  1: "One Pair",
  0: "High Card"
};

function evaluate5(cards) {
  const ranksDesc = cards.map((c) => c.r).sort((a, b) => b - a);
  const suits = cards.map((c) => c.s);
  const isFlush = suits.every((s) => s === suits[0]);

  const countMap = {};
  for (const r of ranksDesc) countMap[r] = (countMap[r] || 0) + 1;
  const groups = Object.entries(countMap)
    .map(([r, c]) => ({ r: Number(r), c }))
    .sort((a, b) => b.c - a.c || b.r - a.r);

  const uniqueRanksDesc = [...new Set(ranksDesc)];
  let straightHigh = null;
  if (uniqueRanksDesc.length === 5) {
    if (uniqueRanksDesc[0] - uniqueRanksDesc[4] === 4) {
      straightHigh = uniqueRanksDesc[0];
    } else if (uniqueRanksDesc.join(",") === "14,5,4,3,2") {
      straightHigh = 5;
    }
  }
  const isStraight = straightHigh !== null;

  if (isStraight && isFlush) {
    return { cat: 8, tiebreak: [straightHigh], name: straightHigh === 14 ? "Royal Flush" : "Straight Flush" };
  }
  if (groups[0].c === 4) {
    const kicker = groups.find((g) => g.c === 1).r;
    return { cat: 7, tiebreak: [groups[0].r, kicker], name: CATEGORY_NAMES[7] };
  }
  if (groups[0].c === 3 && groups[1] && groups[1].c >= 2) {
    return { cat: 6, tiebreak: [groups[0].r, groups[1].r], name: CATEGORY_NAMES[6] };
  }
  if (isFlush) {
    return { cat: 5, tiebreak: ranksDesc.slice(), name: CATEGORY_NAMES[5] };
  }
  if (isStraight) {
    return { cat: 4, tiebreak: [straightHigh], name: CATEGORY_NAMES[4] };
  }
  if (groups[0].c === 3) {
    const kickers = groups.filter((g) => g.c === 1).map((g) => g.r).sort((a, b) => b - a);
    return { cat: 3, tiebreak: [groups[0].r, ...kickers], name: CATEGORY_NAMES[3] };
  }
  if (groups[0].c === 2 && groups[1] && groups[1].c === 2) {
    const pairRanks = [groups[0].r, groups[1].r].sort((a, b) => b - a);
    const kicker = groups.find((g) => g.c === 1).r;
    return { cat: 2, tiebreak: [...pairRanks, kicker], name: CATEGORY_NAMES[2] };
  }
  if (groups[0].c === 2) {
    const kickers = groups.filter((g) => g.c === 1).map((g) => g.r).sort((a, b) => b - a);
    return { cat: 1, tiebreak: [groups[0].r, ...kickers], name: CATEGORY_NAMES[1] };
  }
  return { cat: 0, tiebreak: ranksDesc.slice(), name: CATEGORY_NAMES[0] };
}

function compareEval(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] || 0;
    const bv = b.tiebreak[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function combinations5(cards) {
  const n = cards.length;
  const result = [];
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++)
            result.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return result;
}

function evaluateBest(cards) {
  if (cards.length === 5) {
    return { ...evaluate5(cards), cards: cards.slice() };
  }
  let best = null;
  let bestCards = null;
  for (const combo of combinations5(cards)) {
    const result = evaluate5(combo);
    if (!best || compareEval(result, best) > 0) {
      best = result;
      bestCards = combo;
    }
  }
  return { ...best, cards: bestCards };
}

module.exports = { CATEGORY_NAMES, evaluate5, evaluateBest, compareEval };
