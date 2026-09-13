// Multiplayer client: talks to the authoritative server over Socket.IO and
// renders whatever state it broadcasts. This file holds no game rules --
// the server decides everything; the client only displays it and forwards
// button clicks as action requests. Reuses Poker.UI (js/ui.js) for all
// table/card rendering, the same code the single-player game uses.
(function () {
  "use strict";

  const Poker = window.Poker;
  const socket = io();

  let latestState = null;
  let lastNonLobbyStage = null;

  window.__onlineDebug = {
    getSocket: () => socket,
    getSession: () => session,
    getState: () => latestState
  };

  function storageKey(code) {
    return "holdem_token_" + code;
  }

  function saveSession(code, token) {
    try {
      localStorage.setItem(storageKey(code), token);
    } catch (e) {
      /* localStorage unavailable (private mode, etc.) -- session just won't survive a refresh */
    }
  }

  function loadToken(code) {
    try {
      return localStorage.getItem(storageKey(code));
    } catch (e) {
      return null;
    }
  }

  function clearSession(code) {
    try {
      localStorage.removeItem(storageKey(code));
    } catch (e) {}
  }

  // ---------- Panels ----------
  const panels = {
    entry: document.getElementById("panel-entry"),
    lobby: document.getElementById("panel-lobby"),
    table: document.getElementById("panel-table")
  };
  const actionBar = document.getElementById("online-action-bar");

  function showPanel(name) {
    panels.entry.classList.toggle("hidden", name !== "entry");
    panels.lobby.classList.toggle("hidden", name !== "lobby");
    panels.table.classList.toggle("hidden", name !== "table");
    actionBar.classList.toggle("hidden", name !== "table");
  }

  function setEntryError(msg) {
    document.getElementById("entry-error").textContent = msg || "";
  }

  // ---------- Connection badge ----------
  const connBadge = document.getElementById("conn-badge");
  function setConnState(state, label) {
    connBadge.dataset.state = state;
    connBadge.textContent = label;
  }
  socket.on("connect", () => {
    setConnState("connected", "Connected");
    const active = getActiveSession();
    if (active) attemptRejoin(active.code, active.token, true);
  });
  socket.on("disconnect", () => setConnState("disconnected", "Disconnected"));
  socket.io.on("reconnect_attempt", () => setConnState("connecting", "Reconnecting…"));

  // ---------- Session tracking ----------
  let session = null; // { code, token, seat }

  function getActiveSession() {
    return session;
  }

  function urlRoomCode() {
    const params = new URLSearchParams(location.search);
    const code = params.get("room");
    return code ? code.toUpperCase() : null;
  }

  function setUrlRoom(code) {
    const url = new URL(location.href);
    url.searchParams.set("room", code);
    history.replaceState(null, "", url.toString());
  }

  function inviteLinkFor(code) {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("room", code);
    return url.toString();
  }

  // ---------- Entry: create / join ----------
  document.getElementById("btn-create-room").addEventListener("click", () => {
    const name = document.getElementById("create-name").value.trim();
    const startingStack = Number(document.getElementById("create-stack").value);
    const smallBlind = Number(document.getElementById("create-sb").value);
    const bigBlind = Number(document.getElementById("create-bb").value);
    if (!name) return setEntryError("Enter your display name.");
    setEntryError("");
    socket.emit("create_room", { name, startingStack, smallBlind, bigBlind }, (res) => {
      if (!res || !res.ok) return setEntryError((res && res.error) || "Could not create room.");
      session = { code: res.code, token: res.token, seat: res.seat };
      saveSession(res.code, res.token);
      setUrlRoom(res.code);
    });
  });

  document.getElementById("btn-join-room").addEventListener("click", () => {
    const name = document.getElementById("join-name").value.trim();
    const code = document.getElementById("join-code").value.trim().toUpperCase();
    if (!name) return setEntryError("Enter your display name.");
    if (!code) return setEntryError("Enter a room code.");
    setEntryError("");
    socket.emit("join_room", { name, code }, (res) => {
      if (!res || !res.ok) return setEntryError((res && res.error) || "Could not join room.");
      session = { code: res.code, token: res.token, seat: res.seat };
      saveSession(res.code, res.token);
      setUrlRoom(res.code);
    });
  });

  function attemptRejoin(code, token, silent) {
    socket.emit("rejoin", { code, token }, (res) => {
      if (!res || !res.ok) {
        clearSession(code);
        if (!silent) setEntryError("Could not rejoin that room -- it may have ended.");
        return;
      }
      session = { code, token, seat: res.seat };
      setUrlRoom(code);
    });
  }

  // On load: prefill join code from the invite link, and silently try to
  // reclaim a seat if this browser already has a session for that room.
  (function initFromUrl() {
    const code = urlRoomCode();
    if (!code) return;
    document.getElementById("join-code").value = code;
    const token = loadToken(code);
    if (token) {
      setEntryError("Rejoining your seat…");
      attemptRejoin(code, token, false);
    }
  })();

  // ---------- Lobby ----------
  document.getElementById("btn-copy-link").addEventListener("click", async () => {
    const input = document.getElementById("invite-link");
    input.select();
    try {
      await navigator.clipboard.writeText(input.value);
      const btn = document.getElementById("btn-copy-link");
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = original), 1500);
    } catch (e) {
      /* clipboard API blocked -- the text is already selected for manual copy */
    }
  });

  document.getElementById("btn-start-game").addEventListener("click", () => {
    if (!session) return;
    socket.emit("start_game", { code: session.code, token: session.token }, (res) => {
      if (!res || !res.ok) setEntryError((res && res.error) || "Could not start game.");
    });
  });

  document.getElementById("btn-leave-lobby").addEventListener("click", () => {
    if (session) {
      socket.emit("leave_room", { code: session.code, token: session.token });
      clearSession(session.code);
    }
    session = null;
    latestState = null;
    location.href = "play.html";
  });

  function renderLobby(state) {
    document.getElementById("lobby-code").textContent = session.code;
    document.getElementById("invite-link").value = inviteLinkFor(session.code);
    document.getElementById("lobby-config").textContent =
      `Starting chips: ${Poker.UI.fmt(state.startingStack)} · Blinds: ${Poker.UI.fmt(state.smallBlind)}/${Poker.UI.fmt(state.bigBlind)}`;

    const list = document.getElementById("lobby-players");
    list.innerHTML = "";
    state.players.filter(Boolean).forEach((p) => {
      const li = document.createElement("li");
      const nameSpan = document.createElement("span");
      nameSpan.className = "player-name";
      nameSpan.textContent = p.name;
      const badges = document.createElement("span");
      badges.className = "player-badges";
      if (p.isHost) badges.appendChild(makeBadge("Host", "host"));
      if (p.isMe) badges.appendChild(makeBadge("You", "you"));
      if (!p.connected) badges.appendChild(makeBadge("Offline", "offline"));
      li.appendChild(nameSpan);
      li.appendChild(badges);
      list.appendChild(li);
    });

    const startBtn = document.getElementById("btn-start-game");
    const waitMsg = document.getElementById("lobby-wait-msg");
    if (state.isHost) {
      startBtn.classList.remove("hidden");
      startBtn.disabled = !state.canStart;
      waitMsg.textContent = state.canStart ? "" : "Need at least 2 players to start.";
      waitMsg.style.display = state.canStart ? "none" : "block";
    } else {
      startBtn.classList.add("hidden");
      waitMsg.style.display = "block";
      waitMsg.textContent = "Waiting for the host to start the game…";
    }
  }

  function makeBadge(text, cls) {
    const span = document.createElement("span");
    span.className = "badge " + cls;
    span.textContent = text;
    return span;
  }

  // ---------- Table rendering (reuses Poker.UI) ----------
  function buildViewModel(state) {
    const players = state.players.map((p) => {
      if (!p) return null;
      let holeCards;
      if (p.holeCards && p.holeCards.length > 0) {
        holeCards = p.holeCards;
      } else if (p.cardCount > 0) {
        holeCards = new Array(p.cardCount).fill(0).map((_, i) => ({ id: "hidden-" + p.seat + "-" + i }));
      } else {
        holeCards = [];
      }
      return {
        stack: p.stack,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        eliminated: !!p.eliminated,
        lastAction: !p.connected ? "Disconnected" : p.lastAction || "",
        holeCards
      };
    });
    return {
      stage: state.stage,
      community: state.community,
      dealerIndex: state.dealerIndex,
      currentPlayerIndex: state.currentSeat,
      handInProgress: state.handInProgress,
      players,
      potSize() {
        return state.pot;
      }
    };
  }

  function renderSeatMeta(state) {
    for (let i = 0; i < Poker.NUM_SEATS; i++) {
      const p = state.players[i];
      const nameEl = document.getElementById("seat-name-" + i);
      if (!p) {
        nameEl.textContent = "";
        continue;
      }
      let label = p.name;
      if (p.isHost) label += " ★";
      if (!p.connected) label += " (offline)";
      nameEl.textContent = label;
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

  function communityWinningIds(result, community) {
    const ids = new Set();
    if (!result || result.uncontested) return ids;
    for (const pot of result.pots) {
      for (const winner of pot.winners) {
        for (const c of winner.cards) {
          if (community.some((cc) => cc.id === c.id)) ids.add(c.id);
        }
      }
    }
    return ids;
  }

  function renderWinnerBanner(state) {
    if (state.stage !== "showdown" || !state.lastResult) {
      Poker.UI.hideWinnerBanner();
      return;
    }
    const result = state.lastResult;
    let html;
    if (result.uncontested) {
      html = `<h3>${escapeHtml(result.winnerName)} wins</h3><p>Everyone else folded &mdash; wins ${Poker.UI.fmt(result.amount)} chips</p>`;
    } else {
      const parts = result.pots.map((pot, idx) => {
        const label = result.pots.length > 1 ? (idx === 0 ? "Main Pot" : "Side Pot " + idx) : "Pot";
        const names = pot.winners.map((w) => `${escapeHtml(w.name)} (${w.hand})`).join(", ");
        return `<p>${label}: ${Poker.UI.fmt(pot.amount)} chips &rarr; ${names}</p>`;
      });
      html = `<h3>Showdown</h3>${parts.join("")}`;
    }
    Poker.UI.showWinnerBanner(html);
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = String(s);
    return div.innerHTML;
  }

  // ---------- Turn timer ----------
  const turnTimerEl = document.getElementById("turn-timer");
  setInterval(() => {
    if (!latestState || !latestState.handInProgress || !latestState.turnDeadline) {
      turnTimerEl.classList.add("hidden");
      return;
    }
    const remaining = Math.max(0, Math.ceil((latestState.turnDeadline - Date.now()) / 1000));
    turnTimerEl.classList.remove("hidden");
    turnTimerEl.classList.toggle("urgent", remaining <= 10);
    const actorName = (latestState.players[latestState.currentSeat] || {}).name || "";
    turnTimerEl.textContent = `${actorName ? actorName + " -- " : ""}${remaining}s`;
  }, 250);

  // ---------- Action controls ----------
  function updateControls(state) {
    const mySeat = state.mySeat;
    const isMyTurn = state.handInProgress && mySeat >= 0 && state.currentSeat === mySeat;
    const legal = isMyTurn ? state.legalActions : [];
    const me = mySeat >= 0 ? state.players[mySeat] : null;
    const toCall = me ? state.currentBetLevel - me.bet : 0;
    const maxTotal = me ? me.bet + me.stack : 0;

    Poker.UI.setControls({
      enabled: isMyTurn,
      canFold: legal.includes("fold"),
      canCheck: legal.includes("check"),
      canCall: legal.includes("call"),
      canBetRaise: (legal.includes("bet") || legal.includes("raise")) && me && me.stack > toCall,
      canAllin: legal.includes("allin"),
      toCall,
      currentBetLevel: state.currentBetLevel,
      minTotal: Math.min(state.minRaiseTotal, maxTotal),
      maxTotal
    });
    if (!isMyTurn) Poker.UI.showBetControls(false);
  }

  function sendAction(action, amount) {
    if (!session) return;
    socket.emit("player_action", { code: session.code, token: session.token, action, amount }, (res) => {
      if (!res || !res.ok) {
        // Most likely a stale click after the state already moved on; the
        // next broadcast will resync the UI. Nothing else to do here.
        console.warn("Action rejected:", res && res.error);
      }
    });
  }

  document.getElementById("btn-fold").addEventListener("click", () => sendAction("fold"));
  document.getElementById("btn-check-call").addEventListener("click", () => {
    if (!latestState) return;
    const me = latestState.players[latestState.mySeat];
    const toCall = me ? latestState.currentBetLevel - me.bet : 0;
    sendAction(toCall > 0 ? "call" : "check");
  });
  document.getElementById("btn-allin").addEventListener("click", () => sendAction("allin"));
  document.getElementById("btn-bet-raise").addEventListener("click", () => {
    const shown = !document.getElementById("bet-controls").classList.contains("hidden");
    Poker.UI.showBetControls(!shown);
  });
  document.getElementById("btn-confirm-bet").addEventListener("click", () => {
    const slider = document.getElementById("bet-slider");
    const amount = Number(slider.value);
    const action = latestState && latestState.currentBetLevel === 0 ? "bet" : "raise";
    sendAction(action, amount);
  });
  document.getElementById("bet-slider").addEventListener("input", (e) => {
    document.getElementById("bet-amount-display").textContent = Poker.UI.fmt(e.target.value);
  });
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slider = document.getElementById("bet-slider");
      const min = Number(slider.min);
      const max = Number(slider.max);
      const pot = latestState ? latestState.pot : 0;
      const currentBetLevel = latestState ? latestState.currentBetLevel : 0;
      let val;
      if (btn.dataset.preset === "min") val = min;
      else if (btn.dataset.preset === "half") val = currentBetLevel + Math.round(pot * 0.5);
      else if (btn.dataset.preset === "pot") val = currentBetLevel + pot;
      else val = max;
      val = Math.max(min, Math.min(max, val));
      slider.value = val;
      document.getElementById("bet-amount-display").textContent = Poker.UI.fmt(val);
    });
  });

  // ---------- How to Play modal ----------
  document.getElementById("btn-how-to-play").addEventListener("click", () => {
    document.getElementById("how-to-play-modal").classList.remove("hidden");
  });
  document.getElementById("btn-close-modal").addEventListener("click", () => {
    document.getElementById("how-to-play-modal").classList.add("hidden");
  });
  document.getElementById("how-to-play-modal").addEventListener("click", (e) => {
    if (e.target.id === "how-to-play-modal") e.target.classList.add("hidden");
  });

  // ---------- Main state handler ----------
  socket.on("game_state", (state) => {
    setEntryError("");
    latestState = state;

    if (state.stage === "lobby") {
      showPanel("lobby");
      renderLobby(state);
      return;
    }

    showPanel("table");
    const mySeat = state.mySeat;
    const vm = buildViewModel(state);
    Poker.UI.renderAll(vm, mySeat);
    renderSeatMeta(state);
    updateControls(state);

    if (state.stage === "showdown" && state.lastResult) {
      const sets = winningCardIdSets(state.lastResult);
      Poker.UI.renderSeats(vm, sets, mySeat);
      Poker.UI.renderMyCards(vm, sets[mySeat], mySeat);
      Poker.UI.highlightWinningCommunity(communityWinningIds(state.lastResult, state.community));
      renderWinnerBanner(state);
    } else {
      Poker.UI.hideWinnerBanner();
    }

    lastNonLobbyStage = state.stage;
  });
})();
