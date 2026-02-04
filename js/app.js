/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/
import { chooseBotAction, enqueueBotAction } from "./bot.js";
import { Hand } from "./pokersolver.js";

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/
const startButton = document.querySelector("#start-button");
const rotateIcons = document.querySelectorAll(".seat .rotate");
const nameBadges = document.querySelectorAll("h3");
const closeButtons = document.querySelectorAll(".close");
const notification = document.querySelector("#notification");
const foldButton = document.querySelector("#fold-button");
const actionButton = document.querySelector("#action-button");
const amountSlider = document.querySelector("#amount-slider");
const sliderOutput = document.querySelector("output");
const Phases = ["preflop", "flop", "turn", "river", "showdown"];
let currentPhaseIndex = 0;
let currentBet = 0;
let pot = 0;
let initialDealerName = null;
let dealerOrbitCount = -1;
let gameStarted = false;
let gameFinished = false;
let openCardsMode = false;
let spectatorMode = false;

const MAX_ITEMS = 8;
const notifArr = [];
const pendingNotif = [];
let isNotifProcessing = false;
let NOTIF_INTERVAL = 750;
let ACTION_LABEL_DURATION = 3000;
const HISTORY_LOG = false; // Set to true to enable history logging in the console
let DEBUG_FLOW = false; // Set to true for verbose game-flow logging

const speedModeParam = new URLSearchParams(globalThis.location.search).get("speedmode");
const SPEED_MODE = speedModeParam !== null && speedModeParam !== "0" && speedModeParam !== "false";
if (SPEED_MODE) {
	NOTIF_INTERVAL = 0;
	ACTION_LABEL_DURATION = 0;
	DEBUG_FLOW = true;
}

let raisesThisRound = 0;
const STATE_SYNC_ENDPOINT = "https://poker.tehes.deno.net/state";
let tableId = null;
const STATE_SYNC_DELAY = 750;
let stateSyncTimer = null;

// --- Analytics --------------------------------------------------------------
let totalHands = 0;

// Clubs, Diamonds, Hearts, Spades
// 2,3,4,5,6,7,8,9,T,J,Q,K,A
// deno-fmt-ignore-start
let cards = [
	"2C", "2D", "2H", "2S",
	"3C", "3D", "3H", "3S",
	"4C", "4D", "4H", "4S",
	"5C", "5D", "5H", "5S",
	"6C", "6D", "6H", "6S",
	"7C", "7D", "7H", "7S",
	"8C", "8D", "8H", "8S",
	"9C", "9D", "9H", "9S",
	"TC", "TD", "TH", "TS",
	"JC", "JD", "JH", "JS",
	"QC", "QD", "QH", "QS",
	"KC", "KD", "KH", "KS",
	"AC", "AD", "AH", "AS",
];
// deno-fmt-ignore-end

let cardGraveyard = [];
let players = [];

let smallBlind = 10;
let bigBlind = 20;
// Tracks the size of the most recent raise. Used to enforce minimum raise rules
let lastRaise = bigBlind;

/* --------------------------------------------------------------------------------------------------
functions
---------------------------------------------------------------------------------------------------*/
Array.prototype.shuffle = function () {
	let i = this.length;
	while (i) {
		const j = Math.floor(Math.random() * i);
		const t = this[--i];
		this[i] = this[j];
		this[j] = t;
	}
	return this;
};

function logHistory(msg) {
	if (HISTORY_LOG) console.log(msg);
}

function logFlow(msg, data) {
	if (DEBUG_FLOW) {
		const ts = new Date().toISOString().slice(11, 23);
		if (data !== undefined) {
			console.log("%c" + ts, "color:#888", msg, data);
		} else {
			console.log("%c" + ts, "color:#888", msg);
		}
	}
}

function getHandsPlayedBucket(handCount) {
	if (handCount < 20) return "<20";
	if (handCount <= 25) return "20-25";
	if (handCount <= 30) return "26-30";
	if (handCount <= 35) return "31-35";
	if (handCount <= 40) return "36-40";
	if (handCount <= 45) return "41-45";
	if (handCount <= 50) return "46-50";
	if (handCount <= 55) return "51-55";
	if (handCount <= 60) return "56-60";
	return ">60";
}

function collectTableState() {
	const communityCards = Array.from(
		document.querySelectorAll("#community-cards .cardslot img"),
		(img) => {
			const match = img.src.match(/\/cards\/([2-9TJQKA][CDHS])\.svg$/);
			return match ? match[1] : null;
		},
	).filter(Boolean);

	const playerStates = players.map((p, index) => ({
		name: p.name,
		chips: p.chips,
		roundBet: p.roundBet,
		totalBet: p.totalBet,
		folded: p.folded,
		allIn: p.allIn,
		isBot: p.isBot,
		dealer: p.dealer,
		smallBlind: p.smallBlind,
		bigBlind: p.bigBlind,
		cards: Array.from(p.cards, (card) => card.dataset.value || null),
		seatIndex: p.seatIndex ?? index,
		stats: {
			hands: p.stats.hands,
			handsWon: p.stats.handsWon,
			showdowns: p.stats.showdowns,
			showdownsWon: p.stats.showdownsWon,
		},
	}));

	return {
		phase: Phases[currentPhaseIndex] ?? null,
		pot,
		currentBet,
		lastRaise,
		smallBlind,
		bigBlind,
		raisesThisRound,
		dealerOrbitCount,
		communityCards,
		players: playerStates,
		timestamp: Date.now(),
	};
}

async function sendTableState() {
	const payload = {
		tableId: tableId,
		state: collectTableState(),
		notifications: notifArr.slice(0, MAX_ITEMS),
	};

	try {
		await fetch(STATE_SYNC_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
	} catch (error) {
		logFlow("state sync failed", error);
	}
}

function queueStateSync() {
	if (stateSyncTimer || openCardsMode) return;
	stateSyncTimer = setTimeout(() => {
		stateSyncTimer = null;
		sendTableState();
	}, STATE_SYNC_DELAY);
}

function combinationCount(n, k) {
	if (k < 0 || k > n) {
		return 0;
	}
	const kk = Math.min(k, n - k);
	let result = 1;
	for (let i = 1; i <= kk; i++) {
		result = (result * (n - kk + i)) / i;
	}
	return Math.round(result);
}

function getCommunityCardsForEquity() {
	return Array.from(
		document.querySelectorAll("#community-cards .cardslot img"),
	).map((img) => {
		const match = img.src.match(/\/cards\/([2-9TJQKA][CDHS])\.svg$/);
		return match ? match[1] : null;
	}).filter(Boolean);
}

function updateWinProbabilityDisplays() {
	players.forEach((p) => {
		const winEl = p.winProbabilityEl || p.seat.querySelector(".win-probality");
		if (!winEl) {
			return;
		}
		const shouldShow = spectatorMode &&
			currentPhaseIndex > 0 &&
			!p.folded &&
			typeof p.winProbability === "number";
		if (shouldShow) {
			winEl.textContent = `${Math.round(p.winProbability)}%`;
			winEl.classList.remove("hidden");
		} else {
			winEl.textContent = "";
			winEl.classList.add("hidden");
		}
	});
}

function computeSpectatorWinProbabilities(reason = "") {
	if (!spectatorMode) {
		return;
	}
	if (currentPhaseIndex === 0) {
		logFlow("winProbability: preflop skipped", { reason });
		updateWinProbabilityDisplays();
		return;
	}

	const communityCards = getCommunityCardsForEquity();
	const missingCount = 5 - communityCards.length;
	if (missingCount < 0) {
		logFlow("winProbability: invalid board state", {
			communityCards,
			missingCount,
		});
		return;
	}

	const activePlayers = players.filter((p) => !p.folded);
	if (activePlayers.length === 0) {
		updateWinProbabilityDisplays();
		return;
	}

	players.forEach((p) => {
		p.winProbability = p.folded ? 0 : null;
	});

	if (activePlayers.length === 1) {
		activePlayers[0].winProbability = 100;
		updateWinProbabilityDisplays();
		logFlow("winProbability", {
			phase: Phases[currentPhaseIndex],
			reason,
			boards: 1,
			players: [{ name: activePlayers[0].name, winProbability: 100 }],
		});
		return;
	}

	const totalBoards = combinationCount(cards.length, missingCount);
	const MAX_ENUM_BOARDS = 50000;
	if (totalBoards > MAX_ENUM_BOARDS) {
		logFlow("winProbability: skipped heavy enumeration", {
			phase: Phases[currentPhaseIndex],
			reason,
			missingCount,
			totalBoards,
			deckSize: cards.length,
		});
		updateWinProbabilityDisplays();
		return;
	}

	const deck = cards.slice();
	if (totalBoards === 0) {
		logFlow("winProbability: no boards to evaluate", {
			deckSize: deck.length,
			missingCount,
		});
		updateWinProbabilityDisplays();
		return;
	}

	const scores = new Map();
	const playerHoles = activePlayers.map((p) => ({
		player: p,
		hole: [p.cards[0].dataset.value, p.cards[1].dataset.value],
	}));
	playerHoles.forEach((entry) => {
		scores.set(entry.player, 0);
	});

	let boardsSeen = 0;

	const scoreBoard = (boardCards) => {
		const entries = playerHoles.map((entry) => {
			const seven = [entry.hole[0], entry.hole[1], ...boardCards];
			return { player: entry.player, handObj: Hand.solve(seven) };
		});
		const winners = Hand.winners(entries.map((e) => e.handObj));
		const share = 1 / winners.length;
		winners.forEach((winnerHand) => {
			const winnerEntry = entries.find((e) => e.handObj === winnerHand);
			const prev = scores.get(winnerEntry.player);
			scores.set(winnerEntry.player, prev + share);
		});
		boardsSeen++;
	};

	if (missingCount === 0) {
		scoreBoard(communityCards);
	} else {
		const buffer = new Array(missingCount);
		const recurse = (depth, startIndex) => {
			if (depth === missingCount) {
				scoreBoard(communityCards.concat(buffer));
				return;
			}
			const maxIndex = deck.length - (missingCount - depth);
			for (let i = startIndex; i <= maxIndex; i++) {
				buffer[depth] = deck[i];
				recurse(depth + 1, i + 1);
			}
		};
		recurse(0, 0);
	}

	if (boardsSeen === 0) {
		return;
	}

	activePlayers.forEach((p) => {
		const pct = (scores.get(p) / boardsSeen) * 100;
		p.winProbability = pct;
	});

	updateWinProbabilityDisplays();

	logFlow("winProbability", {
		phase: Phases[currentPhaseIndex],
		reason,
		missingCount,
		totalBoards,
		boards: boardsSeen,
		players: activePlayers.map((p) => ({
			name: p.name,
			winProbability: Number(p.winProbability.toFixed(2)),
		})),
	});
}

function startGame(event) {
	if (!gameStarted) {
		createPlayers();

		if (players.length > 1) {
			for (const rotateIcon of rotateIcons) {
				rotateIcon.classList.add("hidden");
			}
			for (const closeButton of closeButtons) {
				closeButton.classList.add("hidden");
			}
			for (const name of nameBadges) {
				name.contentEditable = "false";
			}
			event.target.classList.add("hidden");
			gameStarted = true;

			const tableUrl = new URL(globalThis.location.href);
			tableId = tableUrl.searchParams.get("tableId");
			if (!tableId) {
				tableId = Math.random().toString(36).slice(2, 8);
			}
			tableUrl.searchParams.set("tableId", tableId);
			globalThis.history.replaceState(null, "", tableUrl.toString());

			preFlop();
		} else {
			for (const name of nameBadges) {
				if (name.textContent === "") {
					name.parentElement.classList.remove("hidden");
				}
				players = [];
			}
			enqueueNotification("Not enough players");
		}
	} else {
		// New Round
		preFlop();
	}
}

function createPlayers() {
	// Auto-fill empty seats with Bots
	let botIndex = 1;
	for (const seat of document.querySelectorAll(".seat")) {
		const nameEl = seat.querySelector("h3");
		if (seat.classList.contains("hidden")) continue;
		if (nameEl.textContent.trim() === "") {
			nameEl.textContent = `Bot ${botIndex++}`;
			seat.classList.add("bot");
		}
	}

	const activePlayers = document.querySelectorAll(".seat:not(.hidden)");
	for (const player of activePlayers) {
		const seatIndex = players.length;
		const playerObject = {
			name: player.querySelector("h3").textContent,
			isBot: player.classList.contains("bot"),
			seat: player,
			winProbabilityEl: player.querySelector(".win-probality"),
			actionLabelTimer: null,
			winProbability: null,
			seatIndex,
			qr: {
				show: function (card1, card2) {
					const qrContainer = player.querySelector(".qr");
					qrContainer.classList.remove("hidden");
					const base = globalThis.location.origin +
						globalThis.location.pathname.replace(/[^/]*$/, "");
					const url =
						`${base}hole-cards.html?params=${card1}-${card2}-${playerObject.name}-${playerObject.chips}-${playerObject.seatIndex}&tableId=${tableId}&t=${Date.now()}`;
					qrContainer.innerHTML = "";
					const qrEl = globalThis.kjua({
						text: url,
						render: "svg",
						fill: "#333",
						crisp: true,
					});
					qrContainer.appendChild(qrEl);
					qrContainer.dataset.url = url;
				},
				hide: function () {
					const qrContainer = player.querySelector(".qr");
					qrContainer.classList.add("hidden");
					qrContainer.innerHTML = "";
				},
			},
			cards: player.querySelectorAll(".card"),
			dealer: false,
			smallBlind: false,
			bigBlind: false,
			assignRole: function (role) {
				// Convert kebab-case role to camelCase flag name
				const flag = role.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
				this[flag] = true;
				this.seat.querySelector(`.${role}`).classList.remove("hidden");
			},
			clearRole: function (role) {
				const flag = role.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
				this[flag] = false;
				this.seat.querySelector(`.${role}`).classList.add("hidden");
			},
			folded: false,
			chips: 2000,
			allIn: false,
			totalBet: 0,
			roundBet: 0,
			stats: {
				hands: 0,
				handsWon: 0,
				vpip: 0,
				pfr: 0,
				calls: 0,
				aggressiveActs: 0,
				showdowns: 0,
				showdownsWon: 0,
				folds: 0,
				foldsPreflop: 0,
				foldsPostflop: 0,
				allins: 0,
			},
			botLine: {
				preflopAggressor: false,
				cbetIntent: null,
				barrelIntent: null,
				cbetMade: false,
				barrelMade: false,
				nonValueAggressionMade: false,
			},
			showTotal: function () {
				player.querySelector(".chips .total").textContent = playerObject.chips;
			},
			placeBet: function (x) {
				// Clamp bet to available chips → prevents negative stacks
				const bet = Math.min(x, playerObject.chips);
				playerObject.roundBet += bet;
				playerObject.totalBet += bet;
				player.querySelector(".chips .bet").textContent = playerObject.roundBet;
				playerObject.chips -= bet;
				if (playerObject.chips === 0) {
					playerObject.allIn = true;
				}
				playerObject.showTotal();
				return bet; // return the real amount pushed to the pot
			},
			resetRoundBet: function () {
				playerObject.roundBet = 0;
				player.querySelector(".chips .bet").textContent = 0;
			},
		};
		players.push(playerObject);
	}
}

function setDealer() {
	const isNotDealer = (currentValue) => currentValue.dealer === false;
	if (players.every(isNotDealer)) {
		const randomPlayerIndex = Math.floor(Math.random() * players.length);
		players[randomPlayerIndex].dealer = true;
		players[randomPlayerIndex].assignRole("dealer");
		initialDealerName = players[randomPlayerIndex].name;
	} else {
		const dealerIndex = players.findIndex((p) => p.dealer);
		// clear current dealer flag
		players[dealerIndex].dealer = false;
		players[dealerIndex].clearRole("dealer");

		// assign new dealer – wrap with modulo to avoid “undefined”
		const nextIndex = (dealerIndex + 1) % players.length;
		players[nextIndex].dealer = true;
		players[nextIndex].assignRole("dealer");
	}

	while (players[0].dealer === false) {
		players.unshift(players.pop());
	}

	enqueueNotification(`${players[0].name} is Dealer.`);
}

function setBlinds() {
	// When the dealer is back at initialDealer → increment orbit
	if (players[0].name === initialDealerName) {
		dealerOrbitCount++;
		if (dealerOrbitCount > 0 && dealerOrbitCount % 2 === 0) {
			// Increase blind level
			smallBlind *= 2;
			bigBlind *= 2;
			enqueueNotification(`Blinds are now ${smallBlind}/${bigBlind}.`);
		}
	}

	// Clear previous roles and icons
	players.forEach((p) => {
		p.clearRole("small-blind");
		p.clearRole("big-blind");
	});
	// Post blinds for Pre-Flop and set currentBet
	const sbIdx = (players.length > 2) ? 1 : 0;
	const bbIdx = (players.length > 2) ? 2 : 1;

	const sbBet = players[sbIdx].placeBet(smallBlind);
	const bbBet = players[bbIdx].placeBet(bigBlind);

	enqueueNotification(`${players[sbIdx].name} posted small blind of ${sbBet}.`);
	enqueueNotification(`${players[bbIdx].name} posted big blind of ${bbBet}.`);

	// Add blinds to the pot
	pot += sbBet + bbBet;
	document.getElementById("pot").textContent = pot;
	// Assign new blinds
	players[sbIdx].assignRole("small-blind");
	players[bbIdx].assignRole("big-blind");
	currentBet = bigBlind;
	lastRaise = bigBlind; // minimum raise equals the big blind at hand start
}

function dealCards() {
	cards = cards.concat(cardGraveyard);
	cardGraveyard = [];
	cards.shuffle();

	for (const player of players) {
		player.cards[0].dataset.value = cards[0];
		player.cards[1].dataset.value = cards[1];

		if (!player.isBot) {
			if (openCardsMode) {
				player.cards[0].src = `cards/${cards[0]}.svg`;
				player.cards[1].src = `cards/${cards[1]}.svg`;
			} else {
				player.qr.show(cards[0], cards[1]);
			}
		}
		if (spectatorMode) {
			player.cards[0].src = `cards/${cards[0]}.svg`;
			player.cards[1].src = `cards/${cards[1]}.svg`;
		}
		cardGraveyard.push(cards.shift());
		cardGraveyard.push(cards.shift());
	}
}

/**
 * Execute the standard pre-flop steps: rotate dealer, post blinds, deal cards, start betting.
 */
function preFlop() {
	// Analytics: count hands and mark start time
	totalHands++;
	// Reset phase to preflop
	currentPhaseIndex = 0;

	startButton.classList.add("hidden");

	// Clear folded state and remove CSS-Klasse
	players.forEach((p) => {
		p.folded = false;
		p.allIn = false;
		p.totalBet = 0;
		p.winProbability = null;
		p.seat.classList.remove("folded", "called", "raised", "checked", "allin");
	});

	// Remove any previous winner highlighting
	players.forEach((p) => p.seat.classList.remove("winner"));

	// Cover all hole cards with card back
	players.forEach((p) => {
		p.cards[0].src = "cards/1B.svg";
		p.cards[1].src = "cards/1B.svg";
	});

	// Clear community cards from last hand
	document.querySelectorAll("#community-cards .cardslot").forEach((slot) => {
		slot.innerHTML = "";
	});

	// Remove players with zero chips from the table
	const remainingPlayers = [];
	players.forEach((p) => {
		if (p.chips <= 0) {
			p.chips = 0;
			p.seat.classList.add("hidden");
			enqueueNotification(`${p.name} is out of the game!`);
			logFlow("player_bust", { name: p.name });
		} else {
			remainingPlayers.push(p);
		}
	});
	players = remainingPlayers;
	const humanCount = players.filter((p) => !p.isBot).length;
	openCardsMode = humanCount === 1;
	spectatorMode = humanCount === 0;
	updateWinProbabilityDisplays();

	// Start statistics for a new hand
	players.forEach((p) => {
		p.stats.hands++;
		p.botLine = {
			preflopAggressor: false,
			cbetIntent: null,
			barrelIntent: null,
			cbetMade: false,
			barrelMade: false,
			nonValueAggressionMade: false,
		};
	});

	// If the original dealer is eliminated, update initialDealerName and reset dealerOrbitCount
	if (!players.some((p) => p.name === initialDealerName) && players.length > 0) {
		initialDealerName = players[0].name;
		dealerOrbitCount = -1;
	}

	// ----------------------------------------------------------
	// GAME OVER: only one player left at the table
	if (players.length === 1) {
		const champion = players[0];
		enqueueNotification(`${champion.name} wins the game! 🏆`);
		// Reveal champion's stack
		champion.showTotal();
		champion.seat.classList.add("winner");
		logFlow("tournament_end", { champion: champion.name });
		gameFinished = true;
		if (typeof umami !== "undefined" && !SPEED_MODE) {
			umami.track("Poker", {
				champion: champion.name,
				botWon: champion.isBot,
				handsPlayed: getHandsPlayedBucket(totalHands),
				finished: true,
			});
		}
		return; // skip the rest of preFlop()
	}
	// ----------------------------------------------------------

	// Assign dealer
	setDealer();

	// post blinds
	setBlinds();

	// Shuffle and deal new hole cards
	dealCards();
	if (totalHands === 1 && typeof umami !== "undefined" && !SPEED_MODE) {
		umami.track("Poker", {
			players: players.length,
			bots: players.filter((p) => p.isBot).length,
			humans: players.filter((p) => !p.isBot).length,
		});
	}

	// Start first betting round (preflop)
	queueStateSync();
	startBettingRound();
}

function setPhase() {
	logFlow("setPhase", { phase: Phases[currentPhaseIndex] });
	// EARLY EXIT: If only one player remains, skip straight to showdown
	const activePlayers = players.filter((p) => !p.folded);
	if (activePlayers.length <= 1) {
		return doShowdown();
	}

	currentPhaseIndex++;
	switch (Phases[currentPhaseIndex]) {
		case "flop":
			dealCommunityCards(3);
			enqueueNotification("Flop (3 cards) dealt.");
			startBettingRound();
			break;
		case "turn":
			dealCommunityCards(1);
			enqueueNotification("Turn (4th card) dealt.");
			startBettingRound();
			break;
		case "river":
			dealCommunityCards(1);
			enqueueNotification("River (5th card) dealt.");
			startBettingRound();
			break;
		case "showdown":
			doShowdown();
			break;
	}
	queueStateSync();
}

function dealCommunityCards(amount) {
	const emptySlots = document.querySelectorAll("#community-cards .cardslot:empty");
	if (emptySlots.length < amount) {
		console.warn("Not enough empty slots for", amount);
		logFlow("dealCommunityCards: not enough slots");
		return;
	}
	cardGraveyard.push(cards.shift()); // burn
	for (let i = 0; i < amount; i++) {
		const card = cards.shift();
		emptySlots[i].innerHTML = `<img src="cards/${card}.svg">`;
		cardGraveyard.push(card); // back into Deck
	}
	if (spectatorMode) {
		computeSpectatorWinProbabilities("dealCommunityCards");
	}
}

function startBettingRound() {
	if (currentPhaseIndex > 0) {
		// Reset state for post-flop rounds before any checks/logging
		currentBet = 0;
		lastRaise = bigBlind;
		players.forEach((p) => p.resetRoundBet());
	}
	logFlow("startBettingRound", {
		phase: Phases[currentPhaseIndex],
		currentBet,
		lastRaise,
		order: players.map((p) => p.name),
	});
	// Clear action indicators from the previous betting round
	players.forEach((p) => p.seat.classList.remove("checked", "called", "raised"));

	// EARLY EXIT: Skip betting if only one player remains or all are all-in
	const activePlayers = players.filter((p) => !p.folded);
	const actionable = activePlayers.filter((p) => !p.allIn);
	if (activePlayers.length <= 1 || actionable.length <= 1) {
		logFlow("skip betting round", {
			active: activePlayers.length,
			actionable: actionable.length,
		});
		return setPhase();
	}

	// 2) Determine start index
	let startIdx;
	if (currentPhaseIndex === 0) {
		// UTG: first player left of big blind
		const bbIdx = players.findIndex((p) => p.bigBlind);
		startIdx = (bbIdx + 1) % players.length;
	} else {
		// first player left of dealer
		const dealerIdx = players.findIndex((p) => p.dealer);
		startIdx = (dealerIdx + 1) % players.length;
	}

	logFlow("betting start index", { index: startIdx, player: players[startIdx].name });

	raisesThisRound = 0;
	let idx = startIdx;
	let cycles = 0;

	function anyUncalled() {
		if (currentBet === 0) {
			// Post-flop: Prüfe ob alle Spieler schon dran waren
			return cycles < players.filter((p) => !p.folded && !p.allIn).length;
		}
		return players.some((p) => !p.folded && !p.allIn && p.roundBet < currentBet);
	}

	function nextPlayer() {
		// --- GLOBAL GUARD -------------------------------------------------
		// If no player can act anymore (all folded or all all-in),
		// the betting round is over and we advance the phase.
		const activePlayers = players.filter((p) => !p.folded);
		const actionablePlayers = activePlayers.filter((p) => !p.allIn);
		if (activePlayers.length <= 1 || actionablePlayers.length === 0) {
			logFlow("no actionable players, advance phase (nextPlayer)", {
				active: activePlayers.map((p) => ({
					name: p.name,
					allIn: p.allIn,
					roundBet: p.roundBet,
				})),
			});
			return setPhase();
		}

		// -------------------------------------------------------------------
		// Find next player who still owes action
		const player = players[idx % players.length];
		logFlow(
			"nextPlayer",
			{
				index: idx % players.length,
				cycles,
				name: player.name,
				folded: player.folded,
				allIn: player.allIn,
				roundBet: player.roundBet,
			},
		);
		idx++;
		cycles++;

		// Skip folded or all-in players immediately
		if (player.folded || player.allIn) {
			logFlow("skip folded/allin", { name: player.name });
			return setTimeout(nextPlayer, 0); // avoid recursive stack growth
		}

		// Skip if player already matched the current bet
		if (player.roundBet >= currentBet) {
			logFlow("already matched bet", { name: player.name, cycles });
			// Allow one pass-through for Big Blind pre-flop or Check post-flop
			if (
				(currentPhaseIndex === 0 && cycles <= players.length) ||
				(currentPhaseIndex > 0 && currentBet === 0 && cycles <= players.length)
			) {
				// within first cycle: let them act
			} else {
				if (anyUncalled()) {
					logFlow("wait uncalled", { name: player.name });
					return setTimeout(nextPlayer, 0); // schedule asynchronously to break call chain
				}
				logFlow("advance phase", { name: player.name });
				return setPhase();
			}
		}

		// If this is a bot, choose an action based on hand strength
		if (player.isBot) {
			document.querySelectorAll(".seat").forEach((s) => s.classList.remove("active"));
			player.seat.classList.add("active");
			actionButton.classList.add("hidden");
			foldButton.classList.add("hidden");
			amountSlider.classList.add("hidden");
			sliderOutput.classList.add("hidden");
			const nameEl = player.seat.querySelector("h3");
			if (player.actionLabelTimer) {
				clearTimeout(player.actionLabelTimer);
				player.actionLabelTimer = null;
				player.seat.classList.remove("action-label");
			}
			player.seat.classList.remove("checked", "called", "raised", "allin");
			nameEl.textContent = "thinking …";

			enqueueBotAction(() => {
				const decision = chooseBotAction(player, {
					currentBet,
					pot,
					smallBlind,
					bigBlind,
					raisesThisRound,
					currentPhaseIndex,
					players,
					lastRaise,
				});
				const needToCall = currentBet - player.roundBet;

				if (decision.action === "fold") {
					player.folded = true;
					notifyPlayerAction(player, "fold", 0);
					player.qr.hide();
				} else if (decision.action === "check") {
					notifyPlayerAction(player, "check", 0);
				} else if (decision.action === "call") {
					const actual = player.placeBet(decision.amount);
					pot += actual;
					document.querySelector("#pot").textContent = pot;
					notifyPlayerAction(player, "call", actual);
				} else if (decision.action === "raise") {
					let bet = decision.amount;
					const minRaise = needToCall + lastRaise;
					const autoMin = bet < minRaise && bet < player.chips;
					if (autoMin) {
						bet = Math.min(player.chips, minRaise);
					}
					const amt = player.placeBet(bet);
					if (amt > needToCall) {
						currentBet = player.roundBet;
						lastRaise = amt - needToCall;
						raisesThisRound++;
					}
					pot += amt;
					document.getElementById("pot").textContent = pot;
					notifyPlayerAction(player, "raise", amt);
				}

				if (cycles < players.length) {
					logFlow("bot next", { name: player.name });
					nextPlayer();
				} else if (anyUncalled()) {
					logFlow("bot wait", { name: player.name });
					nextPlayer();
				} else {
					logFlow("bot advance", { name: player.name });
					setPhase();
				}
			});
			return;
		}

		// Highlight active player
		// remove previous highlight
		document.querySelectorAll(".seat").forEach((s) => s.classList.remove("active"));
		player.seat.classList.add("active");
		actionButton.classList.remove("hidden");
		foldButton.classList.remove("hidden");
		amountSlider.classList.remove("hidden");
		sliderOutput.classList.remove("hidden");

		const needToCall = currentBet - player.roundBet;

		// UI: prepare slider and buttons
		if (currentPhaseIndex > 0 && currentBet === 0) {
			// First bet post-flop: allow Check (0) or at least big blind
			amountSlider.min = 0;
			amountSlider.max = player.chips;
			amountSlider.step = 10;
			amountSlider.value = 0;
			sliderOutput.value = 0;
		} else {
			// Determine minimum bet as the lesser of needToCall and player chips
			const minBet = Math.min(needToCall, player.chips);
			amountSlider.min = minBet;
			amountSlider.max = player.chips;
			amountSlider.step = 10;
			amountSlider.value = minBet;
			sliderOutput.value = minBet;
		}

		// Update button label on slider input
		function onSliderInput() {
			const val = parseInt(amountSlider.value, 10);
			const minRaise = needToCall + lastRaise;
			// Only flag *raises* that fall below the minimum‑raise threshold
			const isInvalidRaise = val > needToCall && val < minRaise && val < player.chips;
			if (isInvalidRaise) {
				sliderOutput.classList.add("invalid");
			} else {
				sliderOutput.classList.remove("invalid");
			}
			if (val === 0) {
				actionButton.textContent = "Check";
			} else if (val === player.chips) {
				actionButton.textContent = "All-In";
			} else if (val === needToCall) {
				actionButton.textContent = "Call";
			} else {
				actionButton.textContent = "Raise";
			}
		}
		// Snap slider to min-raise on change if needed
		function onSliderChange() {
			const val = parseInt(amountSlider.value, 10);
			const minRaise = needToCall + lastRaise;
			// If value is between Call and Min‑Raise, snap to minRaise
			if (val > needToCall && val < minRaise) {
				amountSlider.value = minRaise;
				sliderOutput.value = minRaise;
				sliderOutput.classList.remove("invalid");
				onSliderInput(); // refresh button label & invalid state
			}
		}
		amountSlider.addEventListener("input", onSliderInput);
		amountSlider.addEventListener("change", onSliderChange);
		onSliderInput();

		// Event handlers
		function onAction() {
			let bet = parseInt(amountSlider.value, 10);
			const needToCall = currentBet - player.roundBet;
			const minRaise = needToCall + lastRaise;

			// Remove active highlight and slider listener
			player.seat.classList.remove("active");
			amountSlider.removeEventListener("input", onSliderInput);
			amountSlider.removeEventListener("change", onSliderChange);

			// Handle action types
			if (bet === 0) {
				// Check
				notifyPlayerAction(player, "check", 0);
			} else if (bet === player.chips) {
				// All-In
				player.placeBet(bet);
				pot += bet;
				document.getElementById("pot").textContent = pot;
				// If this all-in meets or exceeds the call amount, treat it as a raise
				if (bet >= minRaise) {
					currentBet = player.roundBet;
					lastRaise = bet - needToCall;
					raisesThisRound++;
				} else if (bet >= needToCall) {
					currentBet = Math.max(currentBet, player.roundBet);
				}
				notifyPlayerAction(player, "allin", bet);
				foldButton.removeEventListener("click", onFold);
				actionButton.removeEventListener("click", onAction);
				// Decide whether to continue the betting loop or advance the phase
				if (cycles < players.length) {
					logFlow("human next", { name: player.name });
					nextPlayer();
				} else if (anyUncalled()) {
					logFlow("human wait", { name: player.name });
					nextPlayer();
				} else {
					logFlow("human advance", { name: player.name });
					setPhase();
				}
				return;
			} else if (bet === needToCall) {
				// Call
				player.placeBet(bet);
				pot += bet;
				document.getElementById("pot").textContent = pot;
				notifyPlayerAction(player, "call", bet);
			} else {
				// Raise
				const autoMin = bet < minRaise && bet < player.chips;
				if (autoMin) {
					bet = Math.min(player.chips, minRaise);
				}
				player.placeBet(bet);
				currentBet = player.roundBet;
				pot += bet;
				document.getElementById("pot").textContent = pot;
				notifyPlayerAction(player, "raise", bet);
				lastRaise = bet - needToCall;
				raisesThisRound++;
			}

			foldButton.removeEventListener("click", onFold);
			actionButton.removeEventListener("click", onAction);

			// Decide whether to continue the betting loop or advance the phase
			if (cycles < players.length) {
				logFlow("human next", { name: player.name });
				nextPlayer();
			} else if (anyUncalled()) {
				logFlow("human wait", { name: player.name });
				nextPlayer();
			} else {
				logFlow("human advance", { name: player.name });
				setPhase();
			}
		}
		function onFold() {
			player.folded = true;
			notifyPlayerAction(player, "fold", 0);
			player.qr.hide();
			player.seat.classList.remove("active");
			amountSlider.removeEventListener("input", onSliderInput);
			amountSlider.removeEventListener("change", onSliderChange);
			foldButton.removeEventListener("click", onFold);
			actionButton.removeEventListener("click", onAction);
			// Decide whether to continue the betting loop or advance the phase
			if (cycles < players.length) {
				logFlow("fold next", { name: player.name });
				nextPlayer();
			} else if (anyUncalled()) {
				logFlow("fold wait", { name: player.name });
				nextPlayer();
			} else {
				logFlow("fold advance", { name: player.name });
				setPhase();
			}
		}

		foldButton.addEventListener("click", onFold);
		actionButton.addEventListener("click", onAction);
	}

	nextPlayer();
}

/**
 * Animate chip transfer from the pot display to a player's total chips.
 * amount   – integer to transfer
 * playerObj – player object to receive chips
 * onDone   – callback after animation completes
 */
function animateChipTransfer(amount, playerObj, onDone) {
	if (SPEED_MODE) {
		const potElem = document.getElementById("pot");
		let potVal = parseInt(potElem.textContent, 10);
		potVal -= amount;
		potElem.textContent = potVal;

		playerObj.chips += amount;
		playerObj.showTotal();

		if (onDone) onDone();
		return;
	}

	const steps = 30;
	const totalDuration = Math.min(Math.max(amount * 20, 300), 3000);
	const delay = totalDuration / steps;
	const increment = Math.floor(amount / steps);
	const remainder = amount - increment * steps;
	let currentStep = 0;

	function step() {
		if (currentStep < steps) {
			// decrement pot
			const potElem = document.getElementById("pot");
			let potVal = parseInt(potElem.textContent, 10);
			potVal -= increment;
			potElem.textContent = potVal;

			// increment player chips
			playerObj.chips += increment;
			playerObj.showTotal();

			currentStep++;
			setTimeout(step, delay);
		} else {
			// add any remainder
			const potElem = document.getElementById("pot");
			let potVal = parseInt(potElem.textContent, 10);
			potVal -= remainder;
			potElem.textContent = potVal;

			playerObj.chips += remainder;
			playerObj.showTotal();

			if (onDone) onDone();
		}
	}
	step();
}

function doShowdown() {
	// Reset round bets now that they are in the pot
	players.forEach((p) => p.resetRoundBet());

	// Filter active players
	const activePlayers = players.filter((p) => !p.folded);
	const contributors = players.filter((p) => p.totalBet > 0);

	const hadShowdown = activePlayers.length > 1;
	if (hadShowdown) {
		activePlayers.forEach((p) => p.stats.showdowns++);
	}

	// Reveal hole cards of all active players
	if (activePlayers.length > 1) {
		activePlayers.forEach((p) => {
			const card1 = p.cards[0].dataset.value;
			const card2 = p.cards[1].dataset.value;
			p.cards[0].src = `cards/${card1}.svg`;
			p.cards[1].src = `cards/${card2}.svg`;
			p.qr.hide();
		});
	}

	// Single-player case: immediate win (no hand needed)
	if (activePlayers.length === 1) {
		const winner = activePlayers[0];
		winner.stats.handsWon++;
		// Animate the chip transfer for the single winner
		winner.seat.classList.add("winner");
		winner.seat.classList.remove("active");
		winner.qr.hide(); // keep hole cards concealed
		enqueueNotification(`${winner.name} wins ${pot}!`);
		animateChipTransfer(pot, winner, () => {
			pot = 0;
			document.getElementById("pot").textContent = pot;
			foldButton.classList.add("hidden");
			actionButton.classList.add("hidden");
			amountSlider.classList.add("hidden");
			sliderOutput.classList.add("hidden");
			if (SPEED_MODE) {
				queueStateSync();
				preFlop();
				return;
			}
			startButton.textContent = "New Round";
			startButton.classList.remove("hidden");
			queueStateSync();
		});
		return;
	}

	// 2) Gather community cards from the DOM
	const communityCards = Array.from(
		document.querySelectorAll("#community-cards .cardslot img"),
	).map((img) => {
		// Extract card code from src, e.g., ".../cards/Ah.svg" → "Ah"
		const match = img.src.match(/\/cards\/([2-9TJQKA][CDHS])\.svg$/);
		return match ? match[1] : null;
	}).filter(Boolean);

	// ---- Build side pots based on each player's totalBet ----
	const contenders = contributors.slice();
	const sidePots = [];
	const sorted = contenders.slice().sort((a, b) => a.totalBet - b.totalBet);
	let prev = 0;
	for (let i = 0; i < sorted.length; i++) {
		const lvl = sorted[i].totalBet;
		const diff = lvl - prev;
		if (diff > 0) {
			const eligible = sorted.slice(i);
			sidePots.push({
				amount: diff * eligible.length,
				eligible,
			});
			prev = lvl;
		}
	}

	// ------------------------------------------------------------------
	// COSMETIC MERGE: combine consecutive side pots whose eligible
	// player sets are identical.  This removes tiny "blind-only" pots
	// when all remaining contenders have contributed to the next level.
	for (let i = 0; i < sidePots.length - 1;) {
		const eligA = sidePots[i].eligible.filter((p) => !p.folded);
		const eligB = sidePots[i + 1].eligible.filter((p) => !p.folded);

		const sameEligible = eligA.length === eligB.length &&
			eligA.every((p) => eligB.includes(p));

		if (sameEligible) {
			// Merge amounts and discard the next pot
			sidePots[i].amount += sidePots[i + 1].amount;
			sidePots.splice(i + 1, 1);
			// Do not increment i – check the newly merged pot against the next
		} else {
			i++; // move to next pair
		}
	}
	// ------------------------------------------------------------------

	// ---- Collect animated chip transfers ----
	const transferQueue = [];
	const winnersSet = new Set();

	// ---- Evaluate each side pot ----
	// Collect results for notification consolidation
	const potResults = [];
	sidePots.forEach((sp, potIdx) => {
		const spHands = sp.eligible
			.filter((p) => !p.folded) // only players still in the hand can win
			.map((p) => {
				const seven = [
					p.cards[0].dataset.value,
					p.cards[1].dataset.value,
					...communityCards,
				];
				return { player: p, handObj: Hand.solve(seven) };
			});

		// --- If only one player is eligible for this pot, refund/award it immediately ---
		if (sp.eligible.filter((p) => !p.folded).length === 1) {
			const solePlayer = sp.eligible.find((p) => !p.folded);
			transferQueue.push({ player: solePlayer, amount: sp.amount });
			if (!winnersSet.has(solePlayer)) {
				solePlayer.stats.handsWon++;
				if (hadShowdown) solePlayer.stats.showdownsWon++;
				winnersSet.add(solePlayer);
			}
			// Collect for notification consolidation
			potResults.push({ players: [solePlayer.name], amount: sp.amount, hand: null });
			return;
		}

		const winners = Hand.winners(spHands.map((h) => h.handObj));
		const share = Math.floor(sp.amount / winners.length);
		let remainder = sp.amount - share * winners.length;

		winners.forEach((w) => {
			const entry = spHands.find((h) => h.handObj === w);
			const payout = share + (remainder > 0 ? 1 : 0);
			if (remainder > 0) remainder--;
			transferQueue.push({ player: entry.player, amount: payout });
			if (!winnersSet.has(entry.player)) {
				entry.player.stats.handsWon++;
				if (hadShowdown) entry.player.stats.showdownsWon++;
				winnersSet.add(entry.player);
			}
			// Highlight winners only for the main pot
			if (potIdx === 0) {
				entry.player.seat.classList.add("winner");
				entry.player.seat.classList.remove("active");
			}
		});

		// ---- Build detailed payout message for this pot ----
		if (winners.length === 1 && sidePots.length === 1) {
			// Only one pot in the hand and a single winner → concise wording
			const entry = spHands.find((h) => h.handObj === winners[0]);
			potResults.push({
				players: [entry.player.name],
				amount: sp.amount,
				hand: winners[0].name,
			});
		} else if (winners.length === 1) {
			// Single winner but multiple pots in the hand
			const entry = spHands.find((h) => h.handObj === winners[0]);
			potResults.push({
				players: [entry.player.name],
				amount: sp.amount,
				hand: winners[0].name,
			});
		} else {
			potResults.push({
				players: winners.map((w) => {
					const e = spHands.find((h) => h.handObj === w);
					return `${e.player.name}`;
				}),
				amount: sp.amount,
				hand: null,
			});
		}
	});

	// Filter out side-pots where the winner only gets their own bet back (no profit)
	const filteredResults = potResults.filter((r) => !(r.players.length === 1 && r.hand === null));

	// Consolidate notifications: if same player wins all pots, combine amounts
	if (filteredResults.length > 0) {
		const allSame = filteredResults.every((r) =>
			r.players.length === 1 && r.players[0] === filteredResults[0].players[0]
		);
		if (allSame) {
			const total = filteredResults.reduce((sum, r) => sum + r.amount, 0);
			let msg = `${filteredResults[0].players[0]} wins ${total}`;
			if (filteredResults[0].hand) msg += ` with ${filteredResults[0].hand}`;
			enqueueNotification(msg);
		} else {
			filteredResults.forEach((r) => {
				if (r.players.length === 1) {
					let msg = `${r.players[0]} wins ${r.amount}`;
					if (r.hand) msg += ` with ${r.hand}`;
					enqueueNotification(msg);
				} else {
					enqueueNotification(`${r.players.join(" & ")} split ${r.amount}`);
				}
			});
		}
	}

	// run all chip transfers in parallel
	Promise.all(
		transferQueue.map((t) =>
			new Promise((resolve) => {
				animateChipTransfer(t.amount, t.player, resolve);
			})
		),
	).then(() => {
		// All animations done – reset pot, show New Round button
		pot = 0;
		document.getElementById("pot").textContent = pot;

		players.forEach((p) => {
			p.seat.classList.remove("active");
		});

		foldButton.classList.add("hidden");
		actionButton.classList.add("hidden");
		amountSlider.classList.add("hidden");
		sliderOutput.classList.add("hidden");
		if (SPEED_MODE) {
			queueStateSync();
			preFlop();
			return;
		}
		startButton.textContent = "New Round";
		startButton.classList.remove("hidden");
		queueStateSync();
	});
	return; // exit doShowdown early because UI flow continues in animation
}

function rotateSeat(ev) {
	const seat = ev.target.parentElement.parentElement;
	seat.dataset.rotation = parseInt(seat.dataset.rotation) + 90;
	seat.style.transform = "rotate(" + seat.dataset.rotation + "deg)";
}

function deletePlayer(ev) {
	const seat = ev.target.parentElement.parentElement;
	seat.classList.add("hidden");
}

function notifyPlayerAction(player, action = "", amount = 0) {
	// Remove any previous action indicator before adding a new one
	player.seat.classList.remove("checked", "called", "raised", "allin");
	// Update statistics based on action and phase
	if (currentPhaseIndex === 0) {
		if (action === "call" || action === "raise" || action === "allin") {
			player.stats.vpip++;
		}
		if (action === "raise" || action === "allin") {
			player.stats.pfr++;
		}
	} else {
		if (action === "raise" || action === "allin") {
			player.stats.aggressiveActs++;
		}
		if (action === "call") {
			player.stats.calls++;
		}
	}

	if (currentPhaseIndex === 0 && (action === "raise" || action === "allin")) {
		players.forEach((p) => {
			if (p.botLine) {
				p.botLine.preflopAggressor = false;
			}
		});
		if (player.botLine) {
			player.botLine.preflopAggressor = true;
		}
	}

	if (action === "allin") {
		player.stats.allins++;
	}

	if (action === "fold") {
		player.stats.folds++;
		if (currentPhaseIndex === 0) {
			player.stats.foldsPreflop++;
		} else {
			player.stats.foldsPostflop++;
		}
	}

	let msg = "";
	let actionLabel = "";
	switch (action) {
		case "fold":
			player.seat.classList.add("folded");
			actionLabel = "Fold";
			msg = `${player.name} folded.`;
			break;
		case "check":
			player.seat.classList.add("checked");
			actionLabel = "Check";
			msg = `${player.name} checked.`;
			break;
		case "call":
			player.seat.classList.add("called");
			actionLabel = `Call ${amount}`;
			msg = `${player.name} called ${amount}.`;
			break;
		case "raise":
			player.seat.classList.add("raised");
			actionLabel = `Raise ${amount}`;
			msg = `${player.name} raised to ${amount}.`;
			break;
		case "allin":
			player.seat.classList.add("allin");
			actionLabel = `All-In ${amount}`;
			msg = `${player.name} is all-in.`;
			break;
		default:
			msg = `${player.name} did something…`;
	}
	if (actionLabel) {
		const nameEl = player.seat.querySelector("h3");
		if (player.actionLabelTimer) {
			clearTimeout(player.actionLabelTimer);
		}
		player.seat.classList.add("action-label");
		nameEl.textContent = actionLabel.split(" ")[0];
		player.actionLabelTimer = setTimeout(() => {
			nameEl.textContent = player.name;
			player.seat.classList.remove("action-label");
			player.actionLabelTimer = null;
		}, ACTION_LABEL_DURATION);
	}
	if (spectatorMode && action === "fold") {
		player.winProbability = 0;
		if (currentPhaseIndex > 0) {
			computeSpectatorWinProbabilities("fold");
		} else {
			logFlow("winProbability: preflop fold skipped", { name: player.name });
		}
	}
	enqueueNotification(msg);
}

function enqueueNotification(msg) {
	pendingNotif.push(msg);
	if (!isNotifProcessing) {
		showNextNotif();
	}
}

function showNextNotif() {
	if (pendingNotif.length === 0) {
		isNotifProcessing = false;
		return;
	}
	isNotifProcessing = true;
	const msg = pendingNotif.shift();
	// newest message first for tracking
	notifArr.unshift(msg);
	if (notifArr.length > MAX_ITEMS) notifArr.pop();
	queueStateSync();
	// create a new span for this message
	const span = document.createElement("span");
	span.textContent = msg;
	// prepend to container
	notification.prepend(span);
	// remove excess spans from end if over limit
	while (notification.childElementCount > MAX_ITEMS) {
		notification.removeChild(notification.lastChild);
	}
	logHistory(msg);
	setTimeout(showNextNotif, NOTIF_INTERVAL);
}

function init() {
	// Prevent framing
	if (globalThis.top !== globalThis.self) {
		try {
			globalThis.top.location.href = globalThis.location.href;
		} catch {
			alert("No framing allowed. Please visit: https://tehes.github.io/poker/");
			throw new Error(
				"No framing allowed. Open the original: https://tehes.github.io/poker/",
			);
		}
	}

	document.addEventListener("touchstart", function () {}, false);
	startButton.addEventListener("click", startGame, false);
	globalThis.addEventListener("pagehide", () => {
		if (SPEED_MODE || typeof umami === "undefined" || !gameStarted || gameFinished) {
			return;
		}
		umami.track("Poker", { finished: false });
	}, false);

	for (const rotateIcon of rotateIcons) {
		rotateIcon.addEventListener("click", rotateSeat, false);
	}
	for (const closeButton of closeButtons) {
		closeButton.addEventListener("click", deletePlayer, false);
	}
}

/* --------------------------------------------------------------------------------------------------
public members, exposed with return statement
---------------------------------------------------------------------------------------------------*/
globalThis.poker = {
	init,
	players,
};

poker.init();

/* --------------------------------------------------------------------------------------------------
 * Service Worker configuration
 * - USE_SERVICE_WORKER: enable or disable SW for this project
 * - SERVICE_WORKER_VERSION: bump to force new SW and new cache
 * - AUTO_RELOAD_ON_SW_UPDATE: reload page once after an update
 -------------------------------------------------------------------------------------------------- */
const USE_SERVICE_WORKER = true;
const SERVICE_WORKER_VERSION = "2026-02-04-v1";
const AUTO_RELOAD_ON_SW_UPDATE = true;

/* --------------------------------------------------------------------------------------------------
 * Project detection
 * - GitHub Pages: user.github.io/projektname/... -> slug = "projektname", scope = /projektname/
 * - Everything else (localhost, custom domain): whole origin is one project
 -------------------------------------------------------------------------------------------------- */
function getProjectInfo() {
	const url = new URL(globalThis.location.href);
	const pathParts = url.pathname.split("/").filter(Boolean);
	const hostname = url.hostname;

	const isGitHubPages = hostname.endsWith("github.io");

	let projectScope;
	let projectSlug;

	if (isGitHubPages && pathParts.length > 0) {
		// Example: https://user.github.io/project/
		const first = pathParts[0].toLowerCase();
		projectScope = `${url.origin}/${first}/`;
		projectSlug = first;
	} else {
		// Example: http://127.0.0.1:5500/ or https://nba-spielplan.de/
		projectScope = `${url.origin}/`;
		projectSlug = hostname.replace(/[^\w-]/g, "_").toLowerCase();
	}

	const isGitHubUserRoot = isGitHubPages && pathParts.length === 0;

	return { projectScope, projectSlug, isGitHubUserRoot };
}

const {
	projectScope: PROJECT_SCOPE,
	projectSlug: PROJECT_SLUG,
	isGitHubUserRoot,
} = getProjectInfo();

const SW_CACHE_PREFIX = `${PROJECT_SLUG}-cache-`; // SW caches: "<slug>-cache-<version>"

async function shouldSkipServiceWorker(swUrl) {
	try {
		const response = await fetch(swUrl, {
			method: "HEAD",
			cache: "no-store",
		});

		if (response.redirected) {
			console.log(
				`Service Worker skipped: ${swUrl} redirects to ${response.url}. Use the canonical host for PWA features.`,
			);
			return true;
		}

		if (!response.ok) {
			console.log(
				`Service Worker skipped: ${swUrl} returned status ${response.status}.`,
			);
			return true;
		}
	} catch (error) {
		console.log("Service Worker preflight check failed, trying to register anyway:", error);
	}

	return false;
}

/* Service Worker registration and cleanup */
async function registerServiceWorker() {
	try {
		const swUrl = `./service-worker.js?v=${SERVICE_WORKER_VERSION}`;

		if (await shouldSkipServiceWorker(swUrl)) {
			return;
		}

		const registration = await navigator.serviceWorker.register(
			swUrl,
			{ scope: "./", updateViaCache: "none" },
		);

		// check for updates immediately
		registration.update();

		console.log(
			`Service Worker registered for project "${PROJECT_SLUG}" with scope:`,
			registration.scope,
		);
	} catch (error) {
		console.log("Service Worker registration failed:", error);
	}
}

async function unregisterServiceWorkers() {
	const registrations = await navigator.serviceWorker.getRegistrations();
	let changedSomething = false;

	if (registrations.length) {
		// Only unregister SWs whose scope belongs to this project
		const projectRegistrations = registrations.filter(
			(r) => r.scope === PROJECT_SCOPE || r.scope.startsWith(PROJECT_SCOPE),
		);

		if (projectRegistrations.length) {
			await Promise.all(projectRegistrations.map((r) => r.unregister()));
			changedSomething = true;
		}
	}

	if ("caches" in globalThis) {
		const keys = await caches.keys();

		// Remove only Service Worker caches for this project:
		// - SW caches start with "<slug>-cache-"
		// - Data / app caches can use "<slug>-data-cache" and are not touched here
		const swCaches = keys.filter(
			(k) => k.startsWith(SW_CACHE_PREFIX) && !k.includes("-data-cache"),
		);

		if (swCaches.length) {
			await Promise.all(swCaches.map((k) => caches.delete(k)));
			changedSomething = true;
		}
	}

	if (changedSomething) {
		console.log(
			`Service workers and SW caches for project "${PROJECT_SLUG}" cleared. Reloading page...`,
		);
		globalThis.location.reload();
	} else {
		console.log(
			`No service worker or SW caches found for project "${PROJECT_SLUG}". Not reloading again.`,
		);
	}
}

/* Auto reload on SW controller change and init */
if ("serviceWorker" in navigator) {
	const hadControllerAtStart = !!navigator.serviceWorker.controller;
	let hasHandledControllerChange = false;

	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (!hadControllerAtStart) return;
		if (hasHandledControllerChange) return;
		hasHandledControllerChange = true;

		if (AUTO_RELOAD_ON_SW_UPDATE) {
			globalThis.location.reload();
		} else {
			console.log("Service Worker updated; auto reload disabled.");
		}
	});

	globalThis.addEventListener("DOMContentLoaded", async () => {
		// hard safety: never use a service worker on GitHub user root pages
		if (isGitHubUserRoot) {
			console.log(
				"Service Worker disabled on GitHub user root page to avoid affecting project sites.",
			);
			return;
		}

		if (USE_SERVICE_WORKER) {
			await registerServiceWorker();
		} else {
			await unregisterServiceWorkers();
		}
	});
}
