// Authoritative, server-side Texas Hold'em table. Generalized version of
// the single-player js/game.js engine: sparse seats (2-6 players instead of
// a fixed 6), no AI, and a real turn timer instead of setTimeout-based AI
// pacing. The server is the only place that ever touches the deck or an
// opponent's hole cards.
"use strict";

const Deck = require("./deck");
const Evaluator = require("./handEvaluator");

const NUM_SEATS = 6;
const TURN_TIME_MS = 30000;
const RUNOUT_DELAY_MS = 900;
const NEXT_HAND_DELAY_MS = 8000;

function computePots(seats) {
  const contributors = seats.filter((p) => p && p.totalContributed > 0);
  const levels = [...new Set(contributors.map((p) => p.totalContributed))].sort((a, b) => a - b);
  const pots = [];
  let prevLevel = 0;
  for (const level of levels) {
    const layerPlayers = contributors.filter((p) => p.totalContributed >= level);
    const amount = (level - prevLevel) * layerPlayers.length;
    if (amount > 0) {
      const eligible = layerPlayers.filter((p) => !p.folded).map((p) => p.seatIndex);
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

class Table {
  constructor(config, onEvent) {
    this.smallBlind = config.smallBlind;
    this.bigBlind = config.bigBlind;
    this.startingStack = config.startingStack;
    this.onEvent = onEvent || (() => {});

    this.seats = new Array(NUM_SEATS).fill(null);
    this.dealerIndex = -1;
    this.community = [];
    this.deck = [];
    this.stage = "lobby";
    this.currentSeat = -1;
    this.currentBetLevel = 0;
    this.minRaise = this.bigBlind;
    this.toAct = [];
    this.handNumber = 0;
    this.lastResult = null;
    this.handInProgress = false;
    this.turnTimer = null;
    this.turnDeadline = null;
  }

  emit(type, payload) {
    this.onEvent(type, payload || {});
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnDeadline = null;
  }

  seatedPlayers() {
    return this.seats.filter(Boolean);
  }

  findByToken(token) {
    return this.seats.find((p) => p && p.token === token) || null;
  }

  firstEmptySeat() {
    const idx = this.seats.findIndex((p) => p === null);
    return idx === -1 ? null : idx;
  }

  addPlayer(token, name, isHost) {
    const seatIndex = this.firstEmptySeat();
    if (seatIndex === null) return null;
    const player = {
      token,
      name,
      seatIndex,
      stack: this.startingStack,
      holeCards: [],
      folded: this.handInProgress,
      allIn: false,
      bet: 0,
      totalContributed: 0,
      lastAction: null,
      connected: true,
      socketId: null,
      isHost: !!isHost,
      sittingOut: this.handInProgress,
      eliminated: false
    };
    this.seats[seatIndex] = player;
    return player;
  }

  getHost() {
    return this.seats.find((p) => p && p.isHost) || null;
  }

  // If the host disconnects while the room is still in the lobby, hand the
  // host badge to another connected player so the room doesn't get stuck
  // unable to start.
  promoteNextHostIfNeeded() {
    const host = this.getHost();
    if (host && host.connected) return;
    const candidate = this.seatedPlayers().find((p) => p.connected && !p.isHost) || this.seatedPlayers().find((p) => p.connected);
    if (!candidate) return;
    for (const p of this.seatedPlayers()) p.isHost = false;
    candidate.isHost = true;
  }

  canStart() {
    return !this.handInProgress && this.seatedPlayers().filter((p) => !p.eliminated).length >= 2;
  }

  seatsInOrderFrom(startSeat) {
    const order = [];
    for (let i = 0; i < NUM_SEATS; i++) order.push((startSeat + i) % NUM_SEATS);
    return order;
  }

  nextDealer() {
    const participants = this.seats.filter((p) => p && !p.eliminated);
    if (participants.length === 0) return;
    let idx = this.dealerIndex;
    do {
      idx = (idx + 1) % NUM_SEATS;
    } while (!this.seats[idx] || this.seats[idx].eliminated);
    this.dealerIndex = idx;
  }

  startHand() {
    if (!this.canStart()) return false;

    for (const p of this.seatedPlayers()) {
      if (!p.eliminated) p.sittingOut = false;
    }

    this.handNumber++;
    this.community = [];
    this.lastResult = null;
    this.deck = Deck.shuffle(Deck.makeDeck());

    for (const p of this.seatedPlayers()) {
      p.holeCards = [];
      p.folded = p.eliminated || p.sittingOut;
      p.allIn = false;
      p.bet = 0;
      p.totalContributed = 0;
      p.lastAction = null;
    }

    this.nextDealer();

    const order = this.seatsInOrderFrom(this.dealerIndex).filter(
      (i) => this.seats[i] && !this.seats[i].eliminated && !this.seats[i].sittingOut
    );

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

    for (let round = 0; round < 2; round++) {
      for (const seat of order) {
        this.seats[seat].holeCards.push(this.deck.pop());
      }
    }

    this.stage = "preflop";
    this.currentBetLevel = this.bigBlind;
    this.minRaise = this.bigBlind;
    this.handInProgress = true;

    const firstToAct = order.length === 2 ? sbSeat : order[3 % order.length];
    this.toAct = this.seatsInOrderFrom(firstToAct)
      .filter((i) => order.includes(i))
      .filter((i) => !this.seats[i].allIn);

    this.emit("handstart", { dealer: this.dealerIndex, sb: sbSeat, bb: bbSeat });
    this.advanceToNextActor(firstToAct, true);
    return true;
  }

  postBlind(seat, amount) {
    const p = this.seats[seat];
    const actual = Math.min(amount, p.stack);
    p.stack -= actual;
    p.bet += actual;
    p.totalContributed += actual;
    if (p.stack === 0) p.allIn = true;
    this.emit("blind", { seat, amount: actual });
  }

  getLegalActions(seatIndex) {
    const p = this.seats[seatIndex];
    if (!p || p.folded || p.allIn || p.eliminated || p.sittingOut) return [];
    const toCall = this.currentBetLevel - p.bet;
    const actions = ["fold"];
    if (toCall <= 0) actions.push("check");
    else actions.push("call");
    if (p.stack > toCall) actions.push(this.currentBetLevel === 0 ? "bet" : "raise");
    if (p.stack > 0) actions.push("allin");
    return actions;
  }

  minRaiseTotal() {
    return this.currentBetLevel + this.minRaise;
  }

  applyAction(seatIndex, action, amount) {
    if (this.currentSeat !== seatIndex) return { ok: false, error: "Not your turn." };
    const p = this.seats[seatIndex];
    if (!p || p.folded || p.allIn) return { ok: false, error: "You cannot act right now." };
    const legal = this.getLegalActions(seatIndex);
    if (!legal.includes(action)) return { ok: false, error: "Illegal action." };
    this.clearTurnTimer();

    const toCall = this.currentBetLevel - p.bet;

    if (action === "fold") {
      p.folded = true;
      p.lastAction = "Fold";
    } else if (action === "check") {
      p.lastAction = "Check";
    } else if (action === "call") {
      const callAmt = Math.min(toCall, p.stack);
      p.stack -= callAmt;
      p.bet += callAmt;
      p.totalContributed += callAmt;
      if (p.stack === 0) p.allIn = true;
      p.lastAction = p.allIn ? "All-in (call)" : "Call";
    } else if (action === "bet" || action === "raise") {
      let target = Math.max(Number(amount) || 0, this.minRaiseTotal());
      target = Math.min(target, p.bet + p.stack);
      const raiseIncrement = target - this.currentBetLevel;
      const putIn = target - p.bet;
      p.stack -= putIn;
      p.bet = target;
      p.totalContributed += putIn;
      if (p.stack === 0) p.allIn = true;
      if (raiseIncrement >= this.minRaise) this.minRaise = raiseIncrement;
      this.currentBetLevel = target;
      p.lastAction = (action === "bet" ? "Bet " : "Raise to ") + target;
      this.toAct = this.seats
        .filter((q) => q && !q.folded && !q.allIn && !q.eliminated && !q.sittingOut && q.seatIndex !== seatIndex)
        .map((q) => q.seatIndex);
      this.emit("bet", { seat: seatIndex, amount: target });
      this.finishActionCommon(seatIndex);
      return { ok: true };
    } else if (action === "allin") {
      const putIn = p.stack;
      const target = p.bet + putIn;
      p.stack = 0;
      p.bet = target;
      p.totalContributed += putIn;
      p.allIn = true;
      if (target > this.currentBetLevel) {
        const raiseIncrement = target - this.currentBetLevel;
        if (raiseIncrement >= this.minRaise) this.minRaise = raiseIncrement;
        this.currentBetLevel = target;
        this.toAct = this.seats
          .filter((q) => q && !q.folded && !q.allIn && !q.eliminated && !q.sittingOut && q.seatIndex !== seatIndex)
          .map((q) => q.seatIndex);
      }
      p.lastAction = "All-in";
      this.emit("bet", { seat: seatIndex, amount: target });
      this.finishActionCommon(seatIndex);
      return { ok: true };
    } else {
      return { ok: false, error: "Unknown action." };
    }

    this.emit("action", { seat: seatIndex, action });
    this.finishActionCommon(seatIndex);
    return { ok: true };
  }

  finishActionCommon(seatIndex) {
    this.toAct = this.toAct.filter((s) => s !== seatIndex);
    const remaining = this.seatedPlayers().filter((p) => !p.folded && !p.sittingOut);
    if (remaining.length === 1) {
      this.endHandUncontested(remaining[0].seatIndex);
      return;
    }
    if (this.toAct.length === 0) {
      this.moveToNextStage();
      return;
    }
    this.advanceToNextActor(seatIndex, false);
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
    this.currentSeat = next;
    this.turnDeadline = Date.now() + TURN_TIME_MS;
    this.turnTimer = setTimeout(() => this.onTurnTimeout(next), TURN_TIME_MS);
    this.emit("turn", { seat: next });
  }

  onTurnTimeout(seatIndex) {
    if (!this.handInProgress || this.currentSeat !== seatIndex) return;
    const legal = this.getLegalActions(seatIndex);
    const action = legal.includes("check") ? "check" : "fold";
    this.applyAction(seatIndex, action);
  }

  countPlayersWhoCanAct() {
    return this.seatedPlayers().filter((p) => !p.folded && !p.allIn && !p.eliminated && !p.sittingOut).length;
  }

  moveToNextStage() {
    this.clearTurnTimer();
    for (const p of this.seatedPlayers()) p.bet = 0;
    this.currentBetLevel = 0;
    this.minRaise = this.bigBlind;

    if (this.stage === "preflop") {
      this.deck.pop();
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
      this.toAct = [];
      this.emit("runout", {});
      setTimeout(() => this.continueRunout(), RUNOUT_DELAY_MS);
      return;
    }

    const order = this.seatsInOrderFrom(this.dealerIndex + 1).filter(
      (s) => this.seats[s] && !this.seats[s].folded && !this.seats[s].eliminated && !this.seats[s].sittingOut && !this.seats[s].allIn
    );
    this.toAct = order.slice();
    if (order.length === 0) {
      this.moveToNextStage();
      return;
    }
    this.advanceToNextActor(order[0], true);
  }

  continueRunout() {
    if (!this.handInProgress) return;
    if (this.stage === "river" && this.community.length === 5) {
      this.runShowdown();
    } else {
      this.moveToNextStage();
    }
  }

  endHandUncontested(winnerSeat) {
    this.clearTurnTimer();
    this.stage = "showdown";
    this.handInProgress = false;
    const winner = this.seats[winnerSeat];
    const pots = computePots(this.seats);
    const totalWon = pots.reduce((s, pot) => s + pot.amount, 0);
    winner.stack += totalWon;
    this.lastResult = { uncontested: true, winnerSeat, winnerName: winner.name, amount: totalWon, showdownHands: [] };
    this.checkEliminations();
    this.emit("showdown", this.lastResult);
    this.scheduleNextHand();
  }

  runShowdown() {
    this.clearTurnTimer();
    this.stage = "showdown";
    this.handInProgress = false;
    const pots = computePots(this.seats);
    const contenders = this.seatedPlayers().filter((p) => !p.folded && !p.sittingOut);
    const evals = {};
    for (const p of contenders) {
      evals[p.seatIndex] = Evaluator.evaluateBest(p.holeCards.concat(this.community));
    }

    const potResults = [];
    for (const pot of pots) {
      const eligiblePlayers = pot.eligible.map((seat) => this.seats[seat]).filter((p) => p && !p.folded);
      if (eligiblePlayers.length === 0) continue;
      let best = null;
      for (const p of eligiblePlayers) {
        const e = evals[p.seatIndex];
        if (!best || Evaluator.compareEval(e, best) > 0) best = e;
      }
      const winners = eligiblePlayers.filter((p) => Evaluator.compareEval(evals[p.seatIndex], best) === 0);
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      const winnerOrder = this.seatsInOrderFrom(this.dealerIndex + 1).filter((s) => winners.some((w) => w.seatIndex === s));
      for (const seat of winnerOrder) {
        const w = this.seats[seat];
        let award = share;
        if (remainder > 0) {
          award += 1;
          remainder--;
        }
        w.stack += award;
      }
      potResults.push({
        amount: pot.amount,
        winners: winners.map((w) => ({ seat: w.seatIndex, name: w.name, hand: evals[w.seatIndex].name, cards: evals[w.seatIndex].cards }))
      });
    }

    this.lastResult = {
      uncontested: false,
      pots: potResults,
      showdownHands: contenders.map((p) => ({ seat: p.seatIndex, cards: p.holeCards, evaluation: evals[p.seatIndex] }))
    };
    this.checkEliminations();
    this.emit("showdown", this.lastResult);
    this.scheduleNextHand();
  }

  // Multiplayer games flow continuously after the host's initial Start --
  // no per-hand "Next Hand" click needed. Only schedules another hand while
  // enough non-eliminated players remain.
  scheduleNextHand() {
    if (this.nextHandTimer) clearTimeout(this.nextHandTimer);
    if (!this.canStart()) return;
    this.nextHandTimer = setTimeout(() => {
      this.nextHandTimer = null;
      if (this.canStart()) this.startHand();
    }, NEXT_HAND_DELAY_MS);
  }

  // Builds the wire payload for one specific viewer. Never includes another
  // seat's hole cards unless that hand is revealed at showdown.
  serializeForToken(viewerToken) {
    const viewer = this.findByToken(viewerToken);
    const mySeat = viewer ? viewer.seatIndex : -1;

    const players = this.seats.map((p, i) => {
      if (!p) return null;
      const isMe = p.token === viewerToken;
      const revealedAtShowdown = this.stage === "showdown" && !p.folded && !p.sittingOut;
      return {
        seat: i,
        name: p.name,
        stack: p.stack,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        eliminated: p.eliminated,
        sittingOut: p.sittingOut,
        connected: p.connected,
        isHost: p.isHost,
        isMe,
        lastAction: p.lastAction,
        cardCount: p.holeCards.length,
        holeCards: isMe || revealedAtShowdown ? p.holeCards : []
      };
    });

    const legalActions = mySeat === this.currentSeat && this.handInProgress ? this.getLegalActions(mySeat) : [];

    return {
      stage: this.stage,
      community: this.community,
      dealerIndex: this.dealerIndex,
      currentSeat: this.currentSeat,
      currentBetLevel: this.currentBetLevel,
      minRaiseTotal: this.handInProgress ? this.minRaiseTotal() : 0,
      pot: this.seats.reduce((s, p) => s + (p ? p.totalContributed : 0), 0),
      handInProgress: this.handInProgress,
      handNumber: this.handNumber,
      turnDeadline: this.turnDeadline,
      turnTimeMs: TURN_TIME_MS,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      startingStack: this.startingStack,
      canStart: this.canStart(),
      mySeat,
      isHost: viewer ? viewer.isHost : false,
      legalActions,
      lastResult: this.lastResult,
      players
    };
  }

  checkEliminations() {
    for (const p of this.seatedPlayers()) {
      if (!p.eliminated && p.stack <= 0) p.eliminated = true;
    }
    const remaining = this.seatedPlayers().filter((p) => !p.eliminated);
    if (remaining.length <= 1) {
      this.emit("gameover", { winner: remaining[0] ? { seat: remaining[0].seatIndex, name: remaining[0].name } : null });
    }
  }
}

module.exports = { Table, computePots, NUM_SEATS, TURN_TIME_MS };
