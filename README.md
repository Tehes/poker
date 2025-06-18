# Digital Poker Table

![Demo screenshot](img/demo.jpeg)

A browser-based, zero-setup poker table to play Texas Hold'em with friends using only your devices.
Scan a QR code to see your hole cards privately on your phone, while the shared table (e.g., on a
tablet or laptop) handles community cards, blinds, pot, and betting rounds.

---

## 🎯 Key Features

- **No Setup Required**: Just open the table in your browser and start playing. No app install, no
  sign-ups.
- **Device Pairing via QR**: Each player scans a code to privately view their cards on their phone.
- **Automatic Game Logic**: Handles blinds, bets, pots, side pots, and showdown evaluations.
- **Progressive Blinds**: Blinds automatically double every 2 complete dealer orbits to keep the
  action going.
- **Side Pot Support**: Accurately resolves complex all-in scenarios.
- **Dynamic Positioning**: Turn order and bot strategy adapt as players fold.
- **Supports All Table Sizes**: From heads-up to full-ring games.
- **Responsive Design**: Optimized for tablets, phones, and desktops.
- **Fast & Offline-Ready**: Loads fast, works without internet once cached.
- **Built‑in Bots**: Empty player slots are automatically filled with bots.
- **Bot Intelligence**: Bots evaluate hand strength, pot odds, stack size, and position to make
  informed decisions.
- **Adaptive Behavior**: Bots track how often opponents fold, detect frequent all-ins, and adjust
  their bluffing frequency accordingly.
- **Context Awareness**: Bots recognize top pair, overpairs, and draw potential to decide between
  check, call, raise, or fold.

---

## 🚀 Getting Started

1. Open this URL on a shared device (e.g., tablet or laptop): 👉
   [https://tehes.github.io/poker](https://tehes.github.io/poker)

2. Add players by typing their names.

3. Start the game — each player scans their QR code to get their cards.

4. The table handles dealing, blinds, betting, and showdown.

---

## 📶 Offline Use

The table works fully offline after the first complete load.

- **First visit online** – When opened once with an internet connection, all necessary assets (HTML,
  JS, CSS, SVGs, icons) are cached in the browser.
- **Service Worker** – Handles cache-first requests and serves offline content when the network is
  unavailable.
- **No asset list needed** – All resources are cached dynamically as they are used.
- **Updates** – A new version is fetched in the background if online; just refresh the page to
  switch.

---

## 🛠️ Tech Stack

- **HTML/CSS/JavaScript** only – no frameworks
- **Vanilla JS Game Engine**
 - **kjua** – lightweight QR code generation for offline play
- **pokersolver** (ES module) – for hand evaluation at showdown

---

## 🤖 How It Works

- The shared device runs the table (e.g., tablet).
- When a round starts, each player sees a QR code.
- They scan it and view their private hole cards on their own phone.
- Players take turns acting via the main table.
- Game flow logic ensures proper handling of:

  - **Dealer rotation** and automatic blind posting
  - **Progressive blinds** that double every 2 complete orbits (e.g., 10/20 → 20/40 → 40/80)
  - Side pots and all-ins
  - Automatic showdown resolution
  - **Bot Support**: Empty seats without a player name are assigned bots that play automatically
    using simple hand-strength logic.

---

## 🧠 Design Philosophy

- **Local-first**: Works without network once loaded.
- **No back-end**: All state is client-side only.
- **Zero footprint**: No accounts, no tracking, no cloud sync.
- **Focus on flow**: The app enforces rules and turn order so you can focus on the game.
- **Tournament-style**: Progressive blinds keep games from stalling.

---

## 📋 Known Limitations

- No live syncing between devices — players act only via the shared table.
- No persistent chip stacks or session saving (yet).
- Not designed for remote multiplayer.
- Fixed blind structure (doubles every 2 orbits) — not customizable.

---

## 📄 License

MIT License. Do whatever you want, just don't sue me.

---

## 🙌 Credits

 - [pokersolver](https://github.com/goldfire/pokersolver) for hand ranking logic
 - [kjua](https://github.com/lrsjng/kjua) for QR code generation
