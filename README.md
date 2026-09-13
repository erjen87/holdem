# Hold'em Royale

Texas Hold'em with play chips only (never real money) in two modes:

- **Single-player** -- you against five computer opponents, 100% client-side
  static HTML/CSS/JS. No server needed; hosts directly on GitHub Pages.
- **Multiplayer** -- create a private room, share an invite link, and play
  live with 2-6 friends on their own devices. This needs the small Node.js
  server in this repo (GitHub Pages alone cannot run it -- see
  [Deploying multiplayer](#deploying-multiplayer)).

## Features

**Both modes**
- Full Texas Hold'em rules: blinds, preflop/flop/turn/river, fold / check /
  call / bet / raise / all-in, side pots for uneven all-ins, ties and split
  pots, hand-ranking evaluation (high card through royal flush).
- Premium dark/felt/gold table, dealer button, per-seat bets and stacks, pot
  display, a bet slider with pot-fraction presets, and a winner banner that
  highlights the exact cards that made the winning hand.
- Responsive layout: the same table design scales down to a one-handed
  mobile layout with large touch targets and no horizontal scrolling.

**Single-player only**
- Simple AI opponents with per-player personality (aggression/tightness)
  driving legal, reasonably varied decisions.
- New Game / Next Hand controls.

**Multiplayer only**
- Create a room (your name, starting chips, blinds), get a shareable invite
  link and a room code, and a lobby showing who's joined.
- Real-time play over Socket.IO: the server shuffles, deals, enforces turns
  and legal actions, and settles pots -- it is the only thing that ever
  touches the deck or an opponent's hole cards.
- Refresh or briefly lose your connection and reclaim your seat automatically
  (per-browser session token, no accounts).
- Join mid-hand and you're seated but sit out until the next hand.
- A visible per-turn countdown; if you don't act in time, the game checks for
  you when that's legal, otherwise it folds your hand.
- Hands play continuously once the host starts the game -- no "Next Hand"
  click needed between hands.

## Project structure

```
index.html            Single-player game page
play.html              Multiplayer lobby + table page
css/styles.css         Shared table/card/action-bar styling (both modes)
css/online.css         Extra styling for the lobby/entry screens
js/deck.js             Card + deck helpers (rendering only; no shuffling here)
js/evaluator.js         7-card hand evaluator (best 5-of-7, category + tiebreak)
js/ui.js               DOM rendering (cards, seats, pot, banners) -- shared by both modes
js/game.js             Single-player game engine (blinds, betting, side pots, AI turns)
js/ai.js               Single-player computer-opponent decision logic
js/main.js             Single-player: wires the engine to the UI
js/online/onlineMain.js Multiplayer client: Socket.IO wiring, reuses js/ui.js for rendering
tests.html             In-browser test suite for the client evaluator/pot math

server.js              Node entry point: Express (static files) + Socket.IO
server/deck.js          Server-side deck (CSPRNG shuffle)
server/handEvaluator.js Server-side hand evaluator (same algorithm as js/evaluator.js)
server/table.js         Authoritative multiplayer poker engine (the real "server logic")
server/roomManager.js   Room codes, creation/joining, idle-room cleanup
server/codes.js         CSPRNG room codes and player session tokens
server/tests/run.js     Server engine test suite (`npm run test:server`)
```

Single-player has no build step or dependency: every script is a plain
`<script>` tag, and all client modules attach to one `window.Poker`
namespace. Multiplayer adds a small Node/Express/Socket.IO server that
*also* serves the same static files, so both modes are one app.

## Why Node + Express + Socket.IO

The brief asked for "a straightforward stack" -- this is about as simple as
real-time multiplayer gets:

- **Express** just serves the existing static files (`index.html`, `css/`,
  `js/`, `play.html`) and needs no templating, routing framework, or ORM.
- **Socket.IO** gives bidirectional, per-connection messaging with automatic
  reconnection handling built in, which maps directly onto "a player's
  browser talks to their seat at the table." It also degrades gracefully if
  WebSockets are blocked by a network.
- Game state lives **in memory**, in one JS object per room
  (`server/table.js`). There's no database: a casual game with friends does
  not need one, and it keeps the whole thing deployable on a single small
  server process with nothing else to provision or pay for. The tradeoff is
  explicit in [Known limitations](#known-limitations) below.

## Running locally

### Single-player

Because its scripts are plain (non-module) `<script>` tags, you can open
`index.html` directly from disk, or serve it with any static file server
(`npx serve .`, `python -m http.server 8000`, etc.).

### Multiplayer (and single-player through the same server)

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Then open `http://localhost:3000/` (single-player) or
`http://localhost:3000/play.html` (multiplayer) in a browser. The server
serves both pages from the same origin, which is also why Socket.IO needs no
CORS configuration for local use.

To play with someone else on your own machine for testing, open a second
browser (or a private/incognito window) to the same
`http://localhost:3000/play.html` and join with the room code -- a second
tab in the *same* browser will share that browser's saved session for the
room, since browser storage is per-origin, not per-tab.

## Running the tests

```bash
node server/tests/run.js       # or: npm run test:server
```

covers the authoritative server engine: side-pot math, a full hand played to
showdown, fold-around (uncontested win), illegal/out-of-turn actions being
rejected, hole cards never being sent to the wrong player, a real side-pot
all-in, and a ~300-hand randomized stress run checking chips are conserved
and the engine never throws.

Open `tests.html` in a browser for the client-side hand-evaluator test suite
(hand categories, comparisons, 7-card best-hand selection, side-pot math --
the same checks the single-player client relies on).

## Deploying multiplayer

GitHub Pages only serves static files, so it can host `index.html` (single
player) but **not** `play.html`'s live backend. To let friends outside your
Wi-Fi join, deploy the Node app to any host that runs a long-lived Node
process, for example [Render](https://render.com), [Fly.io](https://fly.io),
or [Railway](https://railway.app):

1. Push this repo to GitHub.
2. Create a new "Web Service" (Render) / app (Fly/Railway) pointing at the
   repo, with build command `npm install` and start command `npm start`
   (`node server.js`).
3. Set the `PORT` environment variable if your host requires it (most set it
   for you automatically -- `server.js` reads `process.env.PORT`).
4. No other configuration, secrets, or paid services are required. There is
   no database and no third-party API key anywhere in this app. If your
   chosen host requires payment for always-on hosting, that's a decision for
   you to make and provide -- the app itself doesn't need it (a free tier
   that sleeps when idle is enough for casual play with friends).
5. Once deployed, share `https://<your-app>.onrender.com/play.html` (or
   whatever your host's URL is) the same way you'd share a local invite link.

You can still publish `index.html` (single-player) separately to GitHub
Pages if you want a zero-server link for that mode; the two modes don't
depend on each other.

## Security notes

- Room codes and player session tokens are generated with Node's `crypto`
  CSPRNG, not `Math.random()`. Room codes are 8 characters from a 32-symbol
  alphabet (about 2^40 combinations) and double as the invite-link slug;
  session tokens are 24 random bytes and are never shown in any URL.
- The server never sends a hole card to any client except its owner (and to
  everyone at showdown, only for hands that weren't folded). This is
  enforced by what the server *serializes*, not by client-side hiding --
  opponent cards are simply never present in the payload.
- Every action (`fold`/`check`/`call`/`bet`/`raise`/`all-in`) is re-validated
  server-side against whose turn it is and what's currently legal; the
  client's disabled buttons are a UX convenience, not the security boundary.

## Known limitations

- **In-memory state only.** Rooms live in the Node process's memory. If the
  server restarts, all rooms and games are lost (players seeing "session not
  recognized" would need to create/join a new room). Fine for casual play;
  would need a shared store (e.g. Redis) to survive restarts or run more
  than one server instance.
- **No seat recycling.** A player who busts out (0 chips) is shown as "out"
  but keeps their seat slot; a room is "full" once 6 people have ever taken
  seats, even if some are now eliminated.
- **Short all-in raise reopening.** Like the single-player engine, a
  less-than-a-full raise from an all-in does not restrict other players to
  call-or-fold-only the way strict casino rules do; any raise reopens the
  betting round. Noted, not implemented, for simplicity.
- **One continuous game per room.** Once started, a room plays hands back to
  back automatically until one player has all the chips; there's no lobby
  "rematch" -- start a new room for a fresh game.
- **Browser storage caveat.** Reconnection relies on a token saved in
  `localStorage` for that browser. Two tabs of the *same* browser opening the
  same invite link will share that stored token (the second tab reclaims
  whatever session is currently stored) -- this only matters if one person
  tries to occupy two seats from one browser, which isn't a real multiplayer
  scenario, but is worth knowing if you're testing.
