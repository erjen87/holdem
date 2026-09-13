// Wires the Game engine to the UI: event handling, AI turn pacing, animations.
(function () {
  "use strict";

  const Poker = window.Poker;
  let game = null;
  let awaitingHuman = false;

  const AI_MIN_DELAY = 650;
  const AI_MAX_DELAY = 1500;
  const RUNOUT_DELAY = 900;
  const STAGE_PAUSE = 550;
  const SHOWDOWN_REVEAL_DELAY = 400;

  function randDelay(min, max) {
    return min + Math.random() * (max - min);
  }

  function fmt(n) {
    return Poker.UI.fmt(n);
  }

  function refresh() {
    Poker.UI.renderAll(game);
  }

  function onGameEvent(type, payload) {
    switch (type) {
      case "handstart":
        Poker.UI.hideWinnerBanner();
        Poker.UI.markDirty();
        refresh();
        break;
      case "blind":
      case "action":
      case "bet":
        refresh();
        break;
      case "turn":
        refresh();
        handleTurn(payload.seat);
        break;
      case "stage":
        refresh();
        break;
      case "runout":
        refresh();
        setTimeout(() => game.continueRunout(), RUNOUT_DELAY);
        break;
      case "showdown":
        setTimeout(() => presentShowdown(payload), SHOWDOWN_REVEAL_DELAY);
        break;
      case "gameover":
        setTimeout(() => presentGameOver(payload), 900);
        break;
      default:
        break;
    }
  }

  function handleTurn(seat) {
    const p = game.players[seat];
    if (p.isHuman) {
      awaitingHuman = true;
      enableHumanControls(seat);
    } else {
      awaitingHuman = false;
      Poker.UI.setControls({ enabled: false });
      const delay = randDelay(AI_MIN_DELAY, AI_MAX_DELAY);
      setTimeout(() => {
        if (!game.handInProgress || game.currentPlayerIndex !== seat) return;
        const decision = Poker.AI.decide(game, seat);
        game.applyAction(seat, decision.action, decision.amount);
      }, delay);
    }
  }

  function enableHumanControls(seat) {
    const p = game.players[seat];
    const legal = game.getLegalActions(seat);
    const toCall = game.currentBetLevel - p.bet;
    const canBetRaise = legal.includes("bet") || legal.includes("raise");
    const maxTotal = p.bet + p.stack;
    const minTotal = Math.min(game.minRaiseTotal(seat), maxTotal);

    Poker.UI.setControls({
      enabled: true,
      canFold: legal.includes("fold"),
      canCheck: legal.includes("check"),
      canCall: legal.includes("call"),
      canBetRaise: canBetRaise && p.stack > toCall,
      canAllin: legal.includes("allin") && p.stack > 0,
      toCall,
      currentBetLevel: game.currentBetLevel,
      minTotal,
      maxTotal
    });
    Poker.UI.showBetControls(false);
  }

  function humanAct(action, amount) {
    if (!awaitingHuman) return;
    const seat = 0;
    if (game.currentPlayerIndex !== seat) return;
    const ok = game.applyAction(seat, action, amount);
    if (ok) {
      awaitingHuman = false;
      Poker.UI.showBetControls(false);
      Poker.UI.setControls({ enabled: false });
    }
  }

  function winningCardIdSets(result) {
    const sets = {};
    if (!result || result.uncontested) return sets;
    for (const pot of result.pots) {
      for (const winner of pot.winners) {
        if (!sets[winner.seat]) sets[winner.seat] = new Set();
        for (const c of winner.cards) sets[winner.seat].add(c.id);
      }
    }
    return sets;
  }

  function communityWinningIds(result) {
    const ids = new Set();
    if (!result || result.uncontested) return ids;
    for (const pot of result.pots) {
      for (const winner of pot.winners) {
        for (const c of winner.cards) {
          if (game.community.some((cc) => cc.id === c.id)) ids.add(c.id);
        }
      }
    }
    return ids;
  }

  function presentShowdown(result) {
    refresh();
    const sets = winningCardIdSets(result);
    Poker.UI.renderSeats(game, sets);
    Poker.UI.renderMyCards(game, sets[0]);
    Poker.UI.highlightWinningCommunity(communityWinningIds(result));

    let html = "";
    if (result.uncontested) {
      const winner = game.players[result.winnerSeat];
      html = `<h3>${winner.name} wins</h3><p>Everyone else folded &mdash; wins ${fmt(result.amount)} chips</p>`;
    } else {
      const parts = result.pots.map((pot, idx) => {
        const label = result.pots.length > 1 ? (idx === 0 ? "Main Pot" : "Side Pot " + idx) : "Pot";
        const names = pot.winners.map((w) => `${w.name} (${w.hand})`).join(", ");
        return `<p>${label}: ${fmt(pot.amount)} chips &rarr; ${names}</p>`;
      });
      html = `<h3>Showdown</h3>${parts.join("")}`;
    }
    Poker.UI.showWinnerBanner(html);

    document.getElementById("btn-next-hand").disabled = false;
    Poker.UI.setControls({ enabled: false });
  }

  function presentGameOver(payload) {
    const winner = payload.winner;
    let html;
    if (payload.humanEliminated) {
      html = `<h3>Game Over</h3><p>You&rsquo;re out of chips. Start a new game to play again.</p>`;
    } else if (winner) {
      html = winner.isHuman
        ? `<h3>You win the game!</h3><p>You took every chip at the table.</p>`
        : `<h3>Game Over</h3><p>${winner.name} has all the chips. Better luck next time.</p>`;
    } else {
      html = `<h3>Game Over</h3>`;
    }
    Poker.UI.showWinnerBanner(html);
    document.getElementById("btn-next-hand").disabled = true;
    Poker.UI.setControls({ enabled: false });
  }

  function startNewGame() {
    game = new Poker.Game(onGameEvent);
    window.__pokerGame = game; // convenient for manual inspection / debugging
    document.getElementById("btn-next-hand").disabled = true;
    Poker.UI.hideWinnerBanner();
    Poker.UI.markDirty();
    refresh();
    setTimeout(() => game.startHand(), 300);
  }

  function nextHand() {
    if (!game) return;
    if (game.activePlayers().length < 2) return;
    document.getElementById("btn-next-hand").disabled = true;
    Poker.UI.hideWinnerBanner();
    setTimeout(() => game.startHand(), STAGE_PAUSE);
  }

  function wireControls() {
    document.getElementById("btn-new-game").addEventListener("click", () => {
      startNewGame();
    });
    document.getElementById("btn-next-hand").addEventListener("click", nextHand);
    document.getElementById("btn-how-to-play").addEventListener("click", () => {
      document.getElementById("how-to-play-modal").classList.remove("hidden");
    });
    document.getElementById("btn-close-modal").addEventListener("click", () => {
      document.getElementById("how-to-play-modal").classList.add("hidden");
    });
    document.getElementById("how-to-play-modal").addEventListener("click", (e) => {
      if (e.target.id === "how-to-play-modal") e.target.classList.add("hidden");
    });

    document.getElementById("btn-fold").addEventListener("click", () => humanAct("fold"));
    document.getElementById("btn-check-call").addEventListener("click", () => {
      const p = game.players[0];
      const toCall = game.currentBetLevel - p.bet;
      humanAct(toCall > 0 ? "call" : "check");
    });
    document.getElementById("btn-allin").addEventListener("click", () => humanAct("allin"));

    document.getElementById("btn-bet-raise").addEventListener("click", () => {
      const shown = !document.getElementById("bet-controls").classList.contains("hidden");
      Poker.UI.showBetControls(!shown);
    });
    document.getElementById("btn-confirm-bet").addEventListener("click", () => {
      const slider = document.getElementById("bet-slider");
      const amount = Number(slider.value);
      const action = game.currentBetLevel === 0 ? "bet" : "raise";
      humanAct(action, amount);
    });

    const slider = document.getElementById("bet-slider");
    slider.addEventListener("input", () => {
      document.getElementById("bet-amount-display").textContent = fmt(slider.value);
    });

    document.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = game.players[0];
        const pot = game.potSize();
        const min = Number(slider.min);
        const max = Number(slider.max);
        let val;
        if (btn.dataset.preset === "min") val = min;
        else if (btn.dataset.preset === "half") val = game.currentBetLevel + Math.round(pot * 0.5);
        else if (btn.dataset.preset === "pot") val = game.currentBetLevel + pot;
        else val = max;
        val = Math.max(min, Math.min(max, val));
        slider.value = val;
        document.getElementById("bet-amount-display").textContent = fmt(val);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireControls();
    startNewGame();
  });
})();
