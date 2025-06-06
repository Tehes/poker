# Digital Poker Table

A browser-based, zero-setup poker table to play Texas Hold'em with friends using only your devices. Scan a QR code to see your hole cards privately on your phone, while the shared table (e.g., on a tablet or laptop) handles community cards, blinds, pot, and betting rounds.

---

## 🎯 Key Features

* **No Setup Required**: Just open the table in your browser and start playing. No app install, no sign-ups.
* **Device Pairing via QR**: Each player scans a code to privately view their cards on their phone.
* **Automatic Game Logic**: Handles blinds, bets, pots, side pots, and showdown evaluations.
* **Progressive Blinds**: Blinds automatically double every 2 complete dealer orbits to keep the action going.
* **Side Pot Support**: Accurately resolves complex all-in scenarios.
* **Supports All Table Sizes**: From heads-up to full-ring games.
* **Responsive Design**: Optimized for tablets, phones, and desktops.
* **Fast & Offline-Ready**: Loads fast, works without internet once cached.

---

## 🚀 Getting Started

1. Open this URL on a shared device (e.g., tablet or laptop):
   👉 [https://tehes.github.io/poker](https://tehes.github.io/poker)

2. Add players by typing their names.

3. Start the game — each player scans their QR code to get their cards.

4. The table handles dealing, blinds, betting, and showdown.

---

## 🛠️ Tech Stack

* **HTML/CSS/JavaScript** only – no frameworks
* **Vanilla JS Game Engine**
* **QR Code API** – generates links to reveal hole cards on phone
* **pokersolver.js** – for hand evaluation at showdown

---


## 🤖 How It Works

* The shared device runs the table (e.g., tablet).
* When a round starts, each player sees a QR code.
* They scan it and view their private hole cards on their own phone.
* Players take turns acting via the main table.
* Game flow logic ensures proper handling of:

  * **Dealer rotation** and automatic blind posting
  * **Progressive blinds** that double every 2 complete orbits (e.g., 10/20 → 20/40 → 40/80)
  * Side pots and all-ins
  * Automatic showdown resolution

---

## 🧠 Design Philosophy

* **Local-first**: Works without network once loaded.
* **No back-end**: All state is client-side only.
* **Zero footprint**: No accounts, no tracking, no cloud sync.
* **Focus on flow**: The app enforces rules and turn order so you can focus on the game.
* **Tournament-style**: Progressive blinds keep games from stalling.

---

## 📋 Known Limitations

* No live syncing between devices — players act only via the shared table.
* No persistent chip stacks or session saving (yet).
* Not designed for remote multiplayer.
* Fixed blind structure (doubles every 2 orbits) — not customizable.

---


## 📄 License

MIT License. Do whatever you want, just don't sue me.

---

## 🙌 Credits

* [pokersolver](https://github.com/goldfire/pokersolver) for hand ranking logic
* QR codes by [https://goqr.me/api/](https://goqr.me/api/)
