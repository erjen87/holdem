// Simple heuristic computer opponents. Not optimal poker strategy, just
// legal, varied, reasonably sane decisions with a bit of personality.
(function (Poker) {
  "use strict";

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  function preflopStrength(holeCards) {
    const [a, b] = holeCards;
    const hi = Math.max(a.r, b.r);
    const lo = Math.min(a.r, b.r);
    const suited = a.s === b.s;
    let score;
    if (hi === lo) {
      score = 0.5 + ((hi - 2) / 12) * 0.5;
    } else {
      score = ((hi - 2) / 12) * 0.42 + ((lo - 2) / 12) * 0.2;
      if (suited) score += 0.08;
      const gap = hi - lo;
      if (gap === 1) score += 0.07;
      else if (gap === 2) score += 0.04;
      else if (gap === 3) score += 0.015;
      if (hi === 14) score += 0.1;
    }
    return clamp01(score);
  }

  function postflopStrength(holeCards, community) {
    const evalResult = Poker.Evaluator.evaluateBest(holeCards.concat(community));
    const top = evalResult.tiebreak[0] || 2;
    return clamp01((evalResult.cat + (top - 2) / 12) / 8);
  }

  function sizeBet(game, seat, strength) {
    const p = game.players[seat];
    const pot = Math.max(game.potSize(), game.bigBlind);
    const fraction = 0.45 + strength * 0.55;
    let amount = Math.round(game.currentBetLevel + pot * fraction);
    amount = Math.max(amount, game.minRaiseTotal(seat));
    const maxTotal = p.bet + p.stack;
    amount = Math.min(amount, maxTotal);
    if (maxTotal - amount <= Math.max(1, Math.round(game.bigBlind * 0.25))) {
      return { action: "allin" };
    }
    return { action: game.currentBetLevel === 0 ? "bet" : "raise", amount };
  }

  function decide(game, seat) {
    const p = game.players[seat];
    const legal = game.getLegalActions(seat);
    const toCall = game.currentBetLevel - p.bet;
    const pot = Math.max(game.potSize(), 1);
    const traits = p.aiTraits || { aggression: 0.5, tightness: 0.5 };

    const strength = game.stage === "preflop"
      ? preflopStrength(p.holeCards)
      : postflopStrength(p.holeCards, game.community);

    const noise = (Math.random() - 0.5) * 0.16;
    const effective = clamp01(strength + noise);

    const foldThreshold = 0.16 + traits.tightness * 0.22;
    const raiseThreshold = 0.6 + (1 - traits.aggression) * 0.22;
    const shoveThreshold = 0.9;

    if (toCall <= 0) {
      const canBet = legal.includes("bet") || legal.includes("raise");
      if (canBet && effective >= raiseThreshold) {
        return sizeBet(game, seat, effective);
      }
      return { action: "check" };
    }

    const potOdds = toCall / (pot + toCall);
    const callThreshold = Math.max(foldThreshold, potOdds * 0.95);
    const facingShove = toCall >= p.stack;

    if (facingShove) {
      if (effective >= callThreshold + 0.08) return { action: "call" };
      if (toCall <= pot * 0.12 && effective >= foldThreshold) return { action: "call" };
      return { action: "fold" };
    }

    if (effective < callThreshold) {
      if (toCall <= p.stack * 0.025 && effective >= foldThreshold * 0.6) {
        return { action: "call" };
      }
      return { action: "fold" };
    }

    if (effective >= shoveThreshold && Math.random() < 0.3) {
      return { action: "allin" };
    }

    if (effective >= raiseThreshold && legal.includes("raise") && Math.random() < 0.7) {
      return sizeBet(game, seat, effective);
    }

    return { action: "call" };
  }

  Poker.AI = { decide, preflopStrength, postflopStrength };
})(window.Poker = window.Poker || {});
