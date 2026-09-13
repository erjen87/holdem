# Hold'em Royale

A single-player Texas Hold'em poker game: you against five computer
opponents, playing with chips only (no real money, accounts, or online
multiplayer). Built as static HTML/CSS/JavaScript with no build step, so it
runs directly in a browser and hosts cleanly on GitHub Pages.

## Features

- Full Texas Hold'em rules: blinds, preflop/flop/turn/river, fold / check /
  call / bet / raise / all-in, side pots for uneven all-ins, ties and split
  pots, hand-ranking evaluation (high card through royal flush).
- Six-seat table (you + five AI opponents) with a premium dark/felt/gold look,
  dealer button, per-seat bets and stacks, pot display, and a bet slider with
  pot-fraction presets.
- Simple AI opponents with per-player personality (aggression/tightness)
  driving legal, reasonably varied decisions.
- Winner banner that reveals hands at showdown and highlights the specific
  cards that made the winning hand.
- Responsive layout: same table design scales down to a one-handed mobile
  layout with larger touch targets, no horizontal scrolling.
- New Game / Next Hand controls and an in-app "How to Play" panel.

## Project structure

```
index.html         Game page (all screens/panels live here)
css/styles.css      All styling, including the mobile media queries
js/deck.js          Card + deck creation/shuffling
js/evaluator.js      7-card hand evaluator (best 5-of-7, category + tiebreak)
js/game.js          Game engine: blinds, betting rounds, side pots, showdown
js/ai.js            Heuristic computer-opponent decision logic
js/ui.js            DOM rendering (cards, seats, pot, banners) - no game rules
js/main.js          Wires the engine to the UI, handles input + AI pacing
tests.html          In-browser test suite for the evaluator and pot math
```

There is no bundler, framework, or package.json: every file is loaded with a
plain `<script>` tag in `index.html`, in dependency order (deck → evaluator →
ai → game → ui → main). All modules attach to a single `window.Poker`
namespace to avoid polluting globals.

## Running locally

Because the scripts are loaded as regular (non-module) `<script>` tags, you
can open `index.html` directly from disk in most browsers. If your browser
blocks anything when opened via `file://`, serve the folder over HTTP
instead — any static file server works, for example:

```bash
npx serve .
```

or

```bash
python -m http.server 8000
```

then visit `http://localhost:8000/` (or whatever port/tool you used).

## Running the tests

Open `tests.html` the same way (double-click it, or visit it through a local
server) and read the pass/fail list rendered on the page. It covers hand
category detection, hand-vs-hand comparisons (including the wheel straight
and straight-flush edge cases), 7-card best-hand selection, and side-pot math
for multi-way all-ins.

## "Building"

There is no build step — the files in this repository are exactly what gets
served. "Building" just means making sure `index.html`, `css/`, and `js/`
are all present and reachable from the same relative paths.

## Publishing to GitHub Pages

1. Push this repository to GitHub (already done if you're reading this from
   the repo).
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch".
4. Choose the `main` branch and the `/ (root)` folder, then save.
5. GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/`
   (usually within a minute or two).

No environment variables, secrets, or server-side code are involved.

## Known simplifications

This is a casual single-player implementation, not a tournament-grade engine:

- The rule that a short (less-than-a-full-raise) all-in does not "reopen"
  raising for players who already matched the previous bet is not enforced —
  any raise reopens the action for simplicity.
- The AI opponents use a hand-strength heuristic (preflop hand tiers, and
  hand category + top rank post-flop) rather than full equity/range
  calculations. They make legal, varied decisions, not optimal ones.
- There is no persistence: refreshing the page starts a brand new game.
