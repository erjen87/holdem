// DOM rendering: seats, cards, pot, dealer button, action controls, banners.
// Pure rendering layer -- no game rules here, and no event listeners are
// attached (main.js owns those); functions just read Game state and update DOM.
(function (Poker) {
  "use strict";

  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  function buildCardEl(card, faceUp, sizeClass) {
    const el = document.createElement("div");
    el.className = "card" + (sizeClass ? " " + sizeClass : "");
    if (!faceUp) {
      el.classList.add("back");
      return el;
    }
    const color = Poker.Deck.SUIT_COLOR[card.s];
    el.classList.add(color);
    const rank = document.createElement("div");
    rank.className = "rank";
    rank.textContent = Poker.Deck.RANK_LABEL[card.r];
    const suit = document.createElement("div");
    suit.className = "suit";
    suit.textContent = Poker.Deck.SUIT_SYMBOL[card.s];
    el.appendChild(rank);
    el.appendChild(suit);
    el.dataset.cardId = card.id;
    return el;
  }

  function cardKey(card) {
    return card.id;
  }

  // Renders a player's hole cards into a seat, animating only newly-dealt
  // cards and re-rendering (without re-animating) when reveal state flips.
  function renderSeatCards(containerId, player, faceUp, winningCardIds) {
    const container = document.getElementById(containerId);
    const count = player.holeCards.length;
    const prevCount = Number(container.dataset.count || 0);
    const prevRevealed = container.dataset.revealed === "1";
    const revealed = faceUp && count > 0;

    if (count !== prevCount || revealed !== prevRevealed || container.dataset.dirty === "1") {
      container.innerHTML = "";
      player.holeCards.forEach((card, i) => {
        const isWinning = winningCardIds && winningCardIds.has(cardKey(card));
        const el = buildCardEl(card, revealed, "mini-card");
        if (isWinning) el.classList.add("winning");
        if (count !== prevCount) {
          el.classList.add("dealing");
          el.style.animationDelay = i * 90 + "ms";
        }
        container.appendChild(el);
      });
      container.dataset.count = String(count);
      container.dataset.revealed = revealed ? "1" : "0";
      container.dataset.dirty = "0";
    } else if (winningCardIds) {
      // Update winning highlight without rebuilding (avoids re-animating).
      [...container.children].forEach((el, i) => {
        const card = player.holeCards[i];
        el.classList.toggle("winning", !!(card && winningCardIds.has(cardKey(card))));
      });
    }
  }

  function renderCommunity(game) {
    const container = document.getElementById("community-cards");
    const prevCount = Number(container.dataset.count || 0);
    const count = game.community.length;
    if (count < prevCount) {
      container.innerHTML = "";
    }
    for (let i = Number(container.dataset.count || 0); i < count; i++) {
      const el = buildCardEl(game.community[i], true, "");
      el.classList.add("dealing");
      el.style.animationDelay = (i - prevCount) * 110 + "ms";
      container.appendChild(el);
    }
    container.dataset.count = String(count);
  }

  function highlightWinningCommunity(winningCardIds) {
    const container = document.getElementById("community-cards");
    [...container.children].forEach((el) => {
      el.classList.toggle("winning", !!(el.dataset.cardId && winningCardIds.has(el.dataset.cardId)));
    });
  }

  function renderPot(game) {
    document.getElementById("pot-display").textContent = "Pot: " + fmt(game.potSize());
  }

  function renderStageLabel(game) {
    const labels = { idle: "Ready", preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River", showdown: "Showdown" };
    document.getElementById("stage-label").textContent = labels[game.stage] || "";
  }

  function renderDealerChip(game) {
    const chip = document.getElementById("dealer-chip");
    if (game.dealerIndex < 0) {
      chip.style.display = "none";
      return;
    }
    chip.style.display = "flex";
    const seatEl = document.getElementById("seat-" + game.dealerIndex);
    const tableEl = document.getElementById("table-oval");
    const seatRect = seatEl.getBoundingClientRect();
    const tableRect = tableEl.getBoundingClientRect();
    const cx = seatRect.left + seatRect.width / 2 - tableRect.left;
    const cy = seatRect.top - tableRect.top;
    chip.style.left = cx + 18 + "px";
    chip.style.top = cy + "px";
  }

  function renderSeats(game, winningCardIdsBySeat, mySeat) {
    if (mySeat === undefined) mySeat = 0;
    for (let i = 0; i < Poker.NUM_SEATS; i++) {
      const p = game.players[i];
      const seatEl = document.getElementById("seat-" + i);
      if (!p) {
        seatEl.classList.add("eliminated");
        seatEl.classList.remove("folded", "active");
        continue;
      }
      seatEl.classList.toggle("eliminated", !!p.eliminated);
      seatEl.classList.toggle("folded", !!p.folded && !p.eliminated);
      seatEl.classList.toggle("active", game.currentPlayerIndex === i && game.handInProgress);

      document.getElementById("seat-stack-" + i).textContent = fmt(p.stack);

      const statusEl = document.getElementById("seat-status-" + i);
      statusEl.textContent = p.eliminated ? "Out" : (p.lastAction || "");

      const betEl = document.getElementById("seat-bet-" + i);
      if (p.bet > 0) {
        betEl.textContent = fmt(p.bet);
        betEl.classList.remove("hidden");
      } else {
        betEl.classList.add("hidden");
      }

      const winSet = winningCardIdsBySeat ? winningCardIdsBySeat[i] : null;
      if (i === mySeat) {
        renderSeatCards("seat-cards-" + i, { holeCards: [] }, false, null);
      } else {
        const reveal = game.stage === "showdown" && !p.folded;
        renderSeatCards("seat-cards-" + i, p, reveal, winSet);
      }
    }
  }

  function renderMyCards(game, winningCardIds, mySeat) {
    if (mySeat === undefined) mySeat = 0;
    const container = document.getElementById("my-cards");
    const me = game.players[mySeat];
    if (!me) {
      container.innerHTML = "";
      container.dataset.count = "0";
      return;
    }
    const count = me.holeCards.length;
    const prevCount = Number(container.dataset.count || 0);
    if (count !== prevCount || container.dataset.dirty === "1") {
      container.innerHTML = "";
      me.holeCards.forEach((card, i) => {
        const isWinning = winningCardIds && winningCardIds.has(cardKey(card));
        const el = buildCardEl(card, true, "");
        if (isWinning) el.classList.add("winning");
        if (count !== prevCount) {
          el.classList.add("dealing");
          el.style.animationDelay = i * 90 + "ms";
        }
        container.appendChild(el);
      });
      container.dataset.count = String(count);
      container.dataset.dirty = "0";
    } else if (winningCardIds) {
      [...container.children].forEach((el, i) => {
        const card = me.holeCards[i];
        el.classList.toggle("winning", !!(card && winningCardIds.has(cardKey(card))));
      });
    }
  }

  function renderAll(game, mySeat) {
    renderStageLabel(game);
    renderCommunity(game);
    renderPot(game);
    renderDealerChip(game);
    renderSeats(game, null, mySeat);
    renderMyCards(game, null, mySeat);
  }

  function markDirty() {
    // Forces the next renderSeats/renderMyCards to rebuild card DOM (used
    // when starting a fresh hand so old cards are cleared even if the count
    // is coincidentally the same as before).
    document.getElementById("my-cards").dataset.dirty = "1";
    document.getElementById("my-cards").dataset.count = "0";
    document.getElementById("community-cards").dataset.count = "0";
    document.getElementById("community-cards").innerHTML = "";
    for (let i = 0; i < Poker.NUM_SEATS; i++) {
      const el = document.getElementById("seat-cards-" + i);
      el.dataset.dirty = "1";
      el.dataset.count = "0";
      el.innerHTML = "";
    }
  }

  function setControls(state) {
    const foldBtn = document.getElementById("btn-fold");
    const ccBtn = document.getElementById("btn-check-call");
    const brBtn = document.getElementById("btn-bet-raise");
    const allinBtn = document.getElementById("btn-allin");
    const betControls = document.getElementById("bet-controls");

    if (!state.enabled) {
      [foldBtn, ccBtn, brBtn, allinBtn].forEach((b) => (b.disabled = true));
      betControls.classList.add("hidden");
      return;
    }

    foldBtn.disabled = !state.canFold;
    ccBtn.disabled = !state.canCheck && !state.canCall;
    ccBtn.textContent = state.canCheck ? "Check" : "Call " + fmt(state.toCall);
    brBtn.disabled = !state.canBetRaise;
    brBtn.textContent = state.currentBetLevel === 0 ? "Bet" : "Raise";
    allinBtn.disabled = !state.canAllin;

    if (state.canBetRaise) {
      const slider = document.getElementById("bet-slider");
      slider.min = state.minTotal;
      slider.max = state.maxTotal;
      slider.value = Math.min(Math.max(state.minTotal, slider.value || state.minTotal), state.maxTotal);
      document.getElementById("bet-amount-display").textContent = fmt(slider.value);
    }
  }

  function showBetControls(show) {
    document.getElementById("bet-controls").classList.toggle("hidden", !show);
  }

  function showWinnerBanner(html) {
    const el = document.getElementById("winner-banner");
    el.innerHTML = html;
    el.classList.remove("hidden");
  }

  function hideWinnerBanner() {
    document.getElementById("winner-banner").classList.add("hidden");
  }

  Poker.UI = {
    fmt,
    renderAll,
    renderSeats,
    renderCommunity,
    renderPot,
    renderStageLabel,
    renderDealerChip,
    renderMyCards,
    renderSeatCards,
    highlightWinningCommunity,
    markDirty,
    setControls,
    showBetControls,
    showWinnerBanner,
    hideWinnerBanner
  };
})(window.Poker = window.Poker || {});
