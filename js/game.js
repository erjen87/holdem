// Texas Hold'em game engine: state machine for blinds, betting rounds, side pots, showdown.
(function (Poker) {
  "use strict";

  const STARTING_STACK = 10000;
  const NUM_SEATS = 6;
  const NAMES = ["You", "Marcus", "Priya", "Sofia", "Ken", "Diego"];

  function makePlayers() {
    const players = [];
    for (let i = 0; i < NUM_SEATS; i++) {
      players.push({
        id: i,
        name: NAMES[i],
        isHuman: i === 0,
        seatIndex: i,
        stack: STARTING_STACK,
        holeCards: [],
        folded: false,
        allIn: false,
        bet: 0,
        totalContributed: 0,
        hasActed: false,
        eliminated: false,
        lastAction: null,
        aiTraits: i === 0 ? null : {
          aggression: 0.25 + Math.random() * 0.5,
          tightness: 0.25 + Math.random() * 0.5
        }
      });
    }
    return players;
  }

  function computePots(players) {
    const contributors = players.filter((p) => p.totalContributed > 0);
    const levels = [...new Set(contributors.map((p) => p.totalContributed))].sort((a, b) => a - b);
    const pots = [];
    let prevLevel = 0;
    for (const level of levels) {
      const layerPlayers = contributors.filter((p) => p.totalContributed >= level);
      const amount = (level - prevLevel) * layerPlayers.length;
      if (amount > 0) {
        let eligible = layerPlayers.filter((p) => !p.folded).map((p) => p.id);
        if (eligible.length === 0 && pots.length > 0) {
          pots[pots.length - 1].amount += amount;
        } else {
          pots.push({ amount, eligible });
        }
      }
      prevLevel = level;
    }
    return pots;
  }

  class Game {
    constructor(onEvent) {
      this.onEvent = onEvent || function () {};
      this.smallBlind = 50;
      this.bigBlind = 100;
      this.players = makePlayers();
      this.dealerIndex = -1;
      this.community = [];
      this.deck = [];
      this.stage = "idle";
      this.currentPlayerIndex = -1;
      this.currentBetLevel = 0;
      this.minRaise = this.bigBlind;
      this.toAct = [];
      this.pots = [];
      this.handNumber = 0;
      this.lastResult = null;
      this.handInProgress = false;
    }

    emit(type, payload) {
      this.onEvent(type, payload || {});
    }

    activePlayers() {
      return this.players.filter((p) => !p.eliminated);
    }

    resetGame() {
      this.players = makePlayers();
      this.dealerIndex = -1;
      this.handNumber = 0;
      this.lastResult = null;
      this.stage = "idle";
      this.emit("reset", {});
    }

    nextDealer() {
      const active = this.activePlayers();
      if (active.length === 0) return;
      let idx = this.dealerIndex;
      do {
        idx = (idx + 1) % NUM_SEATS;
      } while (this.players[idx].eliminated);
      this.dealerIndex = idx;
    }

    seatsInOrderFrom(startSeat) {
      const order = [];
      for (let i = 0; i < NUM_SEATS; i++) {
        order.push((startSeat + i) % NUM_SEATS);
      }
      return order;
    }

    startHand() {
      const active = this.activePlayers();
      if (active.length < 2) {
        this.emit("gameover", { winner: active[0] || null });
        return;
      }
      this.handNumber++;
      this.community = [];
      this.pots = [];
      this.lastResult = null;
      this.deck = Poker.Deck.shuffle(Poker.Deck.makeDeck());
      for (const p of this.players) {
        p.holeCards = [];
        p.folded = p.eliminated;
        p.allIn = false;
        p.bet = 0;
        p.totalContributed = 0;
        p.hasActed = false;
        p.lastAction = null;
      }
      this.nextDealer();

      const order = this.seatsInOrderFrom(this.dealerIndex).filter((i) => !this.players[i].eliminated);
      // Heads-up special case: dealer posts SB.
      let sbSeat, bbSeat;
      if (order.length === 2) {
        sbSeat = order[0];
        bbSeat = order[1];
      } else {
        sbSeat = order[1];
        bbSeat = order[2];
      }
      this.sbSeat = sbSeat;
      this.bbSeat = bbSeat;

      this.postBlind(sbSeat, this.smallBlind);
      this.postBlind(bbSeat, this.bigBlind);

      // Deal two hole cards to each active player.
      for (let round = 0; round < 2; round++) {
        for (const seat of order) {
          const p = this.players[seat];
          p.holeCards.push(this.deck.pop());
        }
      }

      this.stage = "preflop";
      this.currentBetLevel = this.bigBlind;
      this.minRaise = this.bigBlind;
      this.handInProgress = true;

      const firstToAct = order.length === 2 ? sbSeat : order[3 % order.length];
      this.toAct = this.seatsInOrderFrom(firstToAct)
        .filter((i) => order.includes(i))
        .filter((i) => !this.players[i].allIn);

      this.emit("handstart", { dealer: this.dealerIndex, sb: sbSeat, bb: bbSeat });
      this.advanceToNextActor(firstToAct, true);
    }

    postBlind(seat, amount) {
      const p = this.players[seat];
      const actual = Math.min(amount, p.stack);
      p.stack -= actual;
      p.bet += actual;
      p.totalContributed += actual;
      if (p.stack === 0) p.allIn = true;
      this.emit("blind", { seat, amount: actual });
    }

    getLegalActions(seat) {
      const p = this.players[seat];
      if (!p || p.folded || p.allIn || p.eliminated) return [];
      const toCall = this.currentBetLevel - p.bet;
      const actions = ["fold"];
      if (toCall <= 0) {
        actions.push("check");
      } else {
        actions.push("call");
      }
      if (p.stack > toCall) {
        actions.push(this.currentBetLevel === 0 ? "bet" : "raise");
      }
      if (p.stack > 0) actions.push("allin");
      return actions;
    }

    minRaiseTotal(seat) {
      // Minimum total bet amount a raise must reach.
      return this.currentBetLevel + this.minRaise;
    }

    applyAction(seat, action, amount) {
      const p = this.players[seat];
      if (!p || p.folded || p.allIn) return false;
      const toCall = this.currentBetLevel - p.bet;

      if (action === "fold") {
        p.folded = true;
        p.lastAction = "Fold";
      } else if (action === "check") {
        if (toCall > 0) return false;
        p.lastAction = "Check";
      } else if (action === "call") {
        const callAmt = Math.min(toCall, p.stack);
        p.stack -= callAmt;
        p.bet += callAmt;
        p.totalContributed += callAmt;
        if (p.stack === 0) p.allIn = true;
        p.lastAction = p.allIn ? "All-in (call)" : "Call";
      } else if (action === "bet" || action === "raise") {
        let target = Math.max(amount, this.minRaiseTotal(seat));
        target = Math.min(target, p.bet + p.stack);
        const raiseIncrement = target - this.currentBetLevel;
        const putIn = target - p.bet;
        p.stack -= putIn;
        p.bet = target;
        p.totalContributed += putIn;
        if (p.stack === 0) p.allIn = true;
        const isFullRaise = raiseIncrement >= this.minRaise;
        if (isFullRaise) this.minRaise = raiseIncrement;
        this.currentBetLevel = target;
        p.lastAction = (action === "bet" ? "Bet " : "Raise to ") + target;
        // Reopen action for all other active, non-all-in players.
        this.toAct = this.players
          .filter((q) => !q.folded && !q.allIn && !q.eliminated && q.seatIndex !== seat)
          .map((q) => q.seatIndex);
        this.emit("bet", { seat, amount: target });
        this.finishActionCommon(seat);
        return true;
      } else if (action === "allin") {
        const putIn = p.stack;
        const target = p.bet + putIn;
        p.stack = 0;
        p.bet = target;
        p.totalContributed += putIn;
        p.allIn = true;
        const raiseIncrement = target - this.currentBetLevel;
        if (target > this.currentBetLevel) {
          const isFullRaise = raiseIncrement >= this.minRaise;
          if (isFullRaise) this.minRaise = raiseIncrement;
          this.currentBetLevel = target;
          this.toAct = this.players
            .filter((q) => !q.folded && !q.allIn && !q.eliminated && q.seatIndex !== seat)
            .map((q) => q.seatIndex);
        }
        p.lastAction = "All-in";
        this.emit("bet", { seat, amount: target });
        this.finishActionCommon(seat);
        return true;
      } else {
        return false;
      }

      this.emit("action", { seat, action });
      this.finishActionCommon(seat);
      return true;
    }

    finishActionCommon(seat) {
      this.toAct = this.toAct.filter((s) => s !== seat);
      const remaining = this.players.filter((p) => !p.folded);
      if (remaining.length === 1) {
        this.endHandUncontested(remaining[0].seatIndex);
        return;
      }
      if (this.toAct.length === 0) {
        this.moveToNextStage();
        return;
      }
      this.advanceToNextActor(seat, false);
    }

    advanceToNextActor(fromSeat, isFirst) {
      if (this.toAct.length === 0) {
        this.moveToNextStage();
        return;
      }
      const order = this.seatsInOrderFrom(isFirst ? fromSeat : (fromSeat + 1) % NUM_SEATS);
      const next = order.find((s) => this.toAct.includes(s));
      if (next === undefined) {
        this.moveToNextStage();
        return;
      }
      this.currentPlayerIndex = next;
      this.emit("turn", { seat: next });
    }

    potSize() {
      return this.players.reduce((s, p) => s + p.totalContributed, 0);
    }

    countPlayersWhoCanAct() {
      return this.players.filter((p) => !p.folded && !p.allIn && !p.eliminated).length;
    }

    moveToNextStage() {
      for (const p of this.players) p.bet = 0;
      this.currentBetLevel = 0;
      this.minRaise = this.bigBlind;

      if (this.stage === "preflop") {
        this.deck.pop(); // burn
        this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        this.stage = "flop";
      } else if (this.stage === "flop") {
        this.deck.pop();
        this.community.push(this.deck.pop());
        this.stage = "turn";
      } else if (this.stage === "turn") {
        this.deck.pop();
        this.community.push(this.deck.pop());
        this.stage = "river";
      } else {
        this.runShowdown();
        return;
      }

      this.emit("stage", { stage: this.stage, community: this.community.slice() });

      if (this.countPlayersWhoCanAct() < 2) {
        // Nobody left who can bet further; run out remaining streets automatically.
        this.toAct = [];
        this.emit("runout", {});
        return;
      }

      const order = this.seatsInOrderFrom(this.dealerIndex + 1)
        .filter((s) => !this.players[s].folded && !this.players[s].eliminated && !this.players[s].allIn);
      this.toAct = order.slice();
      if (order.length === 0) {
        this.moveToNextStage();
        return;
      }
      this.advanceToNextActor(order[0], true);
    }

    continueRunout() {
      // Called by UI after an animated pause, to progress through remaining streets when all-in.
      if (this.stage === "river" && this.community.length === 5) {
        this.runShowdown();
      } else {
        this.moveToNextStage();
      }
    }

    endHandUncontested(winnerSeat) {
      this.stage = "showdown";
      this.handInProgress = false;
      const winner = this.players[winnerSeat];
      const pots = computePots(this.players);
      const totalWon = pots.reduce((s, pot) => s + pot.amount, 0);
      winner.stack += totalWon;
      this.lastResult = {
        uncontested: true,
        winnerSeat,
        amount: totalWon,
        showdownHands: []
      };
      this.checkEliminations();
      this.emit("showdown", this.lastResult);
    }

    runShowdown() {
      this.stage = "showdown";
      this.handInProgress = false;
      const pots = computePots(this.players);
      const contenders = this.players.filter((p) => !p.folded);
      const evals = {};
      for (const p of contenders) {
        evals[p.id] = Poker.Evaluator.evaluateBest(p.holeCards.concat(this.community));
      }

      const potResults = [];
      for (const pot of pots) {
        const eligiblePlayers = pot.eligible.map((id) => this.players[id]).filter((p) => !p.folded);
        if (eligiblePlayers.length === 0) continue;
        let best = null;
        for (const p of eligiblePlayers) {
          const e = evals[p.id];
          if (!best || Poker.Evaluator.compareEval(e, best) > 0) best = e;
        }
        const winners = eligiblePlayers.filter((p) => Poker.Evaluator.compareEval(evals[p.id], best) === 0);
        const share = Math.floor(pot.amount / winners.length);
        let remainder = pot.amount - share * winners.length;
        const winnerOrder = this.seatsInOrderFrom(this.dealerIndex + 1).filter((s) => winners.some((w) => w.id === s));
        for (const seat of winnerOrder) {
          const w = this.players[seat];
          let award = share;
          if (remainder > 0) {
            award += 1;
            remainder--;
          }
          w.stack += award;
        }
        potResults.push({
          amount: pot.amount,
          winners: winners.map((w) => ({ seat: w.id, name: w.name, hand: evals[w.id].name, cards: evals[w.id].cards })),
          eligibleCount: eligiblePlayers.length
        });
      }

      this.lastResult = {
        uncontested: false,
        pots: potResults,
        showdownHands: contenders.map((p) => ({ seat: p.id, cards: p.holeCards, evaluation: evals[p.id] }))
      };
      this.checkEliminations();
      this.emit("showdown", this.lastResult);
    }

    checkEliminations() {
      for (const p of this.players) {
        if (!p.eliminated && p.stack <= 0) {
          p.eliminated = true;
          p.folded = true;
        }
      }
      const human = this.players[0];
      if (human.eliminated) {
        this.emit("gameover", { winner: null, humanEliminated: true });
        return;
      }
      const remaining = this.activePlayers();
      if (remaining.length <= 1) {
        this.emit("gameover", { winner: remaining[0] || null });
      }
    }
  }

  Poker.Game = Game;
  Poker.computePots = computePots;
  Poker.STARTING_STACK = STARTING_STACK;
  Poker.NUM_SEATS = NUM_SEATS;
})(window.Poker = window.Poker || {});
