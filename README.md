# Digital Poker Table

![Demo screenshot](img/demo.png)

A browser-based poker table for Texas Hold'em. Play solo against bots or with friends. Each player
joins via QR code or link to use their own device, while the shared table handles the rest.

---

## 🎯 Key Features

- **No Setup Required**: No app install, no sign-ups, no lobby and no configuration. Just enter
  names and start playing.
- **Private Player Views**: Human players can join on their own devices without exposing private
  information on the shared screen.
- **QR + Link Joining**: Each human seat provides both a QR code and a direct link for easy access.
- **Companion / Remote Table Switching**: Joined players can switch between a compact companion view
  and the full remote table.
- **Remote Player Actions**: In synced multiplayer games, the active player can act directly from
  their own device.
- **Automatic Game Logic**: Handles blinds, bets, pots, side pots, and showdown evaluations.
- **Progressive Blinds**: Blinds increase every 6 hands using a hand-based formula with safe
  nice-step rounding, so the pace stays stable even short-handed or heads-up.
- **Side Pot Support**: Accurately resolves complex all-in scenarios.
- **Dynamic Positioning**: Turn order and bot strategy adapt as players fold.
- **Supports All Table Sizes**: From heads-up to full-ring games.
- **Responsive Design**: Optimized for tablets, phones, and desktops.
- **Smart Bet Slider**: The bet slider highlights invalid amounts in red while dragging and snaps to
  the minimum legal raise when released.
- **Fast & Offline-Ready**: Loads fast and works offline once cached.
- **Built‑in Bots**: Empty player slots are automatically filled with bots.
- **Fast Forward for Bot-Only Hands**: When no human can act in the current hand, a Fast Forward
  button lets you speed through the remaining bot action. If no humans have chips left after that,
  the game keeps fast-forwarding until a winner remains.
- **Smart Bot Play**: Bots use tournament-style heuristics with M-ratio pressure, pot odds,
  position, opponent tendencies, and context-aware postflop aggression instead of fixed charts or
  simulations.
- **Postflop Hand Labels**: When hole cards are visible on the table, the shared screen shows short
  postflop hand categories.
- **Bot Reveals**: After some uncontested postflop wins, bots may occasionally reveal one or both
  hole cards to create small TV-poker moments.
- **Session Stats Overlay**: After each completed hand, open a compact stats view with stack, hands
  won, showdown results, folds, and all-ins for all active players.
- **Winner Reactions**: After a pot win, the shared table may briefly show a face emoji above each
  main-pot winner. Reactions are based only on public information such as pot size, split pots,
  all-ins, visible hand strength, reveals, and stack swings.

---

## 🎮 Main Play Modes

The same table supports different ways to play. The mode depends only on how many humans join.

- **Solo vs Bots (Open Cards)**: One human plays directly on the shared device while bots fill the
  empty seats. This is the fastest way to play and learn.
- **Spectator / TV Poker**: No humans join. All seats are bots, hole cards are visible, and the
  table becomes a self-running poker show.
- **Multiplayer**: Two or more humans join. They can play in the same room or anywhere in the world.
  Players can join on their own devices via QR code or link while the shared table remains the
  central board.
- **Hybrid Tables**: Humans and bots can mix freely. This makes it easy to run short-handed games,
  fill gaps, or teach new players without slowing the table down.

---

## 🚀 Getting Started

1. Open this URL on a shared device (e.g., tablet or laptop): 👉
   [https://tehes.github.io/poker](https://tehes.github.io/poker)

2. Add players by typing their names.

3. Start the game.

4. Human players can then join on their own devices via QR code or direct link.

The table handles dealing, blinds, betting, and showdown automatically.

---

## 📶 Offline Use

The table works fully offline after the first complete load.

- **First visit online** – When opened once with an internet connection, all necessary assets (HTML,
  JS, CSS, SVGs, icons) are cached in the browser.
- **Service Worker** – Handles cache-first requests and serves offline content when the network is
  unavailable.
- **Core Assets Pre‑cached** – Core assets are precached during install; any additional resources
  are loaded and cached on demand.
- **Updates** – A new version is fetched and activated in the background; refreshing the page loads
  the updated assets.
- **Graceful QR Fallback** – If sync is unavailable, the QR code can still carry embedded hole-card
  data so the companion view remains usable in read-only mode.

---

## 🛠️ Tech Stack

- **Vanilla HTML, CSS, and JavaScript** – no frameworks
- **Client-side game engine** – handles table state, betting flow, bots, and showdown logic in the
  browser
- **Service Worker caching** – supports offline play after the first load
- **Optional Deno backend sync** – keeps multiplayer companion views and remote actions in sync
- **qr-creator** – QR code generation for device joining
- **pokersolver** – hand evaluation at showdown

---

## 🌐 Optional Backend Sync

Backend sync is used only in multiplayer games that start with at least 2 human players.

- **Solo and spectator games stay local** and keep a clean URL without `tableId`.
- **Human seats expose two entry points**: a QR code for the companion view (`hole-cards.html`) and
  a direct link for the full remote table (`remoteTable.html`).
- **Both views stay connected to the same seat** and can be switched at any time.
- **Player actions from joined devices** are relayed back to the shared table.
- **If the backend is unreachable**, the QR flow degrades gracefully to embedded hole-card data and
  read-only companion access.

---

## 🤖 How It Works

- The shared device runs the main table.
- Human players can join their seats on their own devices.
- Empty seats are filled with bots automatically.
- The table manages:
  - **Dealer rotation** and automatic blind posting
  - **Progressive blinds** that increase every 6 hands with a formula-based, nice-step schedule
    (e.g., 10/20 -> 20/40 -> 30/60 -> 40/80 -> 50/100 -> 60/120)
  - Side pots and all-ins
  - Automatic showdown resolution

---

## Bot Behavior (Tournament Logic)

Bots play tournament-style poker and follow consistent rules without hidden information or "reads".
Their decisions consider:

- **Hand evaluation**: preflop uses a heuristic hand score, while postflop strength comes from real
  solved hand rank plus context such as top pair, overpair, draw equity, and board texture.
- **Tournament zones (M-ratio)**: dead/red/orange/yellow/green zones guide Harrington-style
  short-stack decisions for shoves, calls, and yellow-zone opens.
- **Pot odds and stack pressure**: pot odds, stack ratio, SPR, commitment pressure, and
  elimination-risk penalties all influence whether a hand keeps going or gets released.
- **Position and table size**: aggression thresholds are adjusted by position and remaining
  opponents, so bots naturally loosen up short-handed and tighten up in crowded spots.
- **Opponent tendencies**: average VPIP, aggression, and fold rate influence bluff frequency and
  raise thresholds; fold-heavy tables invite more pressure, while loose or aggressive fields dampen
  it.
- **Postflop board context**: bots recognize top pair, overpairs, flush draws, straight draws, and
  dry vs wet textures when deciding between value, protection, bluffing, calling, or checking.
- **Bet sizing**: value, protection, bluff, overbet, and yellow-zone open sizes scale with pot,
  texture, SPR, position, and opponent count, with small randomness and chip-grid rounding.
- **Line memory**: the preflop aggressor can carry simple c-bet and barrel plans across streets,
  while very wet boards can abort those lines.
- **Tie-breakers and raise safety**: near-threshold spots randomize between close actions, and
  illegal raises are downgraded to the nearest legal raise, call, or check.
- **All-in response**: bots are prevented from auto-folding too often against all-ins when their
  hand clears a risk-adjusted threshold.
- **Checked-to initiative**: when no one has bet, bots can still take the betting lead with
  controlled stabs or bluffs in the right position and texture.

---

## 🧠 Design Philosophy

- **Local-first**: Works without network once loaded.
- **Optional back-end sync**: Core state is client-side, with best-effort syncing when available.
- **Zero footprint**: No accounts, no sign-ups, no persistent cloud state.
- **Focus on flow**: The app enforces rules and turn order so you can focus on the game.
- **Tournament-style**: Progressive blinds keep games from stalling.

---

## 🐞 Debug Logging

Set `DEBUG_FLOW` to `true` in `js/app.js` to print detailed, timestamped messages about the betting
flow. Enable this flag when investigating hangs or unexpected behavior.

### Automated Speedmode Runs

For repeatable bot-vs-bot runs with detailed decision logs and aggregate bot-behavior metrics, use
the repo-local Deno runner:

```sh
deno task speedmode
deno task speedmode:10
```

The runner starts a local static server, opens the table in headless Chrome with
`?speedmode=1&botdebug=detail`, and writes one log plus one JSON summary per run. By default the
output goes to `/tmp/poker-speedmode-batch-YYYYMMDD-HHMMSS/` and includes a combined `summary.json`.

Recommended workflow: after general game-flow changes, run `deno task speedmode` once. After bot
logic or bot-tuning changes, prefer `deno task speedmode:10` so you get a broader summary before
judging the effect.

Useful overrides:

```sh
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno task speedmode -- --runs=3
deno task speedmode -- --out=/tmp/poker-speedmode-latest
```

---

## 📋 Known Limitations

- Live syncing is best-effort; if the backend is unreachable, joined devices fall back to read-only
  companion access, and actions stay on the shared table.
- No persistent chip stacks or session saving (yet).
- Remote table links are lightweight and trust-based; there are no seat tokens or connection checks
  yet.
- The blind progression (formula-based increase every 6 hands) is not customizable.

---

## 🙌 Credits

- [pokersolver](https://github.com/goldfire/pokersolver) for hand ranking logic
- [qr-creator](https://github.com/nimiq/qr-creator) for QR code generation
