// Main table runtime.
// Put code here when it coordinates engine state, bots, sync, timers, analytics, or DOM side effects.
// Do not add pure poker rules, reusable action math, sync schema helpers, or generic render-only helpers here.


/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

import { chooseBotAction, enqueueBotAction, setBotPlaybackFast } from "./bot.js";
import {
	buildSplitPayouts,
	combinationCount,
	getCurrentPhase,
	INITIAL_BIG_BLIND,
	INITIAL_DECK,
	INITIAL_SMALL_BLIND,
	shuffleArray,
	takeDeckCard,
	trackUsedCard,
} from "./gameEngine.js";
import { Hand } from "./pokersolver.js";
import QrCreator from "./qr-creator.js";
import {
	getActionButtonLabel,
	getActionRequestForAmount,
	getPlayerActionState,
	isInvalidRaiseAmount,
	normalizeActionAmount,
} from "./shared/actionModel.js";
import {
	clearSeatActionLabel,
	clearWinnerReaction,
	renderChipStacks,
	renderCommunityCards as renderTableCommunityCards,
	renderNotificationBar,
	renderSeatActionLabel,
	renderSeatCards,
	renderSeatPill,
	renderSeatWinnerState,
	showWinnerReaction,
} from "./shared/tableRenderer.js";
import { initServiceWorker } from "./serviceWorkerRegistration.js";

/* --------------------------------------------------------------------------------------------------
Configuration And DOM References
---------------------------------------------------------------------------------------------------*/

const startButton = document.querySelector("#start-button");
const instructionsButton = document.querySelector("#instructions-button");
const rotateIcons = document.querySelectorAll(".seat .rotate");
const nameBadges = document.querySelectorAll(".seat h3");
const closeButtons = document.querySelectorAll(".close");
const notification = document.querySelector("#notification");
const foldButton = document.querySelector("#fold-button");
const actionButton = document.querySelector("#action-button");
const statsButton = document.querySelector("#stats-button");
const logButton = document.querySelector("#log-button");
const fastForwardButton = document.querySelector("#fast-forward-button");
const potEl = document.getElementById("pot");
const communityCardSlots = document.querySelectorAll("#community-cards .cardslot");
const overlayBackdrop = document.querySelector("#overlay-backdrop");
const statsOverlay = document.querySelector("#stats-overlay");
const statsCloseButton = document.querySelector("#stats-close-button");
const statsTableBody = document.querySelector("#stats-table-body");
const logOverlay = document.querySelector("#log-overlay");
const logCloseButton = document.querySelector("#log-close-button");
const instructionsOverlay = document.querySelector("#instructions-overlay");
const instructionsCloseButton = document.querySelector("#instructions-close-button");
const logList = document.querySelector("#log-list");
const amountSlider = document.querySelector("#amount-slider");
const sliderOutput = document.querySelector("output");
const overlays = {
	stats: {
		el: statsOverlay,
		beforeOpen: () => renderStatsOverlay(),
	},
	log: {
		el: logOverlay,
		canOpen: () => !!logList && logList.childElementCount > 0,
	},
	instructions: {
		el: instructionsOverlay,
	},
};

/* --------------------------------------------------------------------------------------------------
Runtime Flags And Mutable UI State
---------------------------------------------------------------------------------------------------*/

const MAX_ITEMS = 8;
const notifArr = [];
const pendingNotif = [];
let isNotifProcessing = false;
let notifTimer = null;
const DEFAULT_NOTIF_INTERVAL = 750;
let NOTIF_INTERVAL = DEFAULT_NOTIF_INTERVAL;
const FAST_FORWARD_NOTIF_INTERVAL = 0;
const DEFAULT_ACTION_LABEL_DURATION = 3000;
let ACTION_LABEL_DURATION = DEFAULT_ACTION_LABEL_DURATION;
const FAST_FORWARD_ACTION_LABEL_DURATION = 180;
const DEFAULT_RUNOUT_PHASE_DELAY = 3000;
let RUNOUT_PHASE_DELAY = DEFAULT_RUNOUT_PHASE_DELAY;
const FAST_FORWARD_RUNOUT_PHASE_DELAY = 320;
const FAST_FORWARD_CHIP_TRANSFER_DURATION = 160;
const FAST_FORWARD_CHIP_TRANSFER_STEPS = 8;
const WINNER_REACTION_DURATION = 2000;

const HISTORY_LOG = false; // Set to true to enable history logging in the console
let DEBUG_FLOW = false; // Set to true for verbose game-flow logging
const CHIP_UNIT = 10;

const speedModeParam = new URLSearchParams(globalThis.location.search).get("speedmode");
const SPEED_MODE = speedModeParam !== null && speedModeParam !== "0" && speedModeParam !== "false";
if (SPEED_MODE) {
	NOTIF_INTERVAL = 0;
	ACTION_LABEL_DURATION = 0;
	RUNOUT_PHASE_DELAY = 0;
	DEBUG_FLOW = true;
}

const STATE_SYNC_ENDPOINT = "https://poker.tehes.deno.net/state";
const ACTION_SYNC_ENDPOINT = "https://poker.tehes.deno.net/action";
let tableId = null;
const STATE_SYNC_DELAY = 750;
const ACTION_POLL_INTERVAL = 1000;
let stateSyncTimer = null;
let stateSyncTimerDelay = null;
let runoutPhaseTimer = null;
let summaryButtonsVisible = false;
let handFastForwardActive = false;
let autoplayToGameEnd = false;

// --- Analytics --------------------------------------------------------------
let totalHands = 0;
let hadHumansAtStart = false;
let exitEventSent = false;

/* --------------------------------------------------------------------------------------------------
Game Constants And Game State
---------------------------------------------------------------------------------------------------*/

const BOT_REVEAL_CHANCE = 0.3; // Chance that a bot will choose to reveal part of its hand post-flop.
const BOT_DOUBLE_REVEAL_HANDS = new Set(["Straight Flush", "Four of a Kind", "Full House"]);
const WINNER_REACTION_EMOJIS = {
	reveal: ["😉", "😜", "🤭"],
	uncontested: ["😎", "😏", "😌"],
	split: ["🤝"],
	comeback: ["💪", "😅"],
	monsterHand: ["🤩", "🥳"],
	strongHand: ["😁", "😄", "😬"],
	bigPot: ["🤑"],
	fallback: ["🙂", "😊"],
};
const WINNER_REACTION_MONSTER_HANDS = new Set(["Full House", "Four of a Kind", "Straight Flush"]);
const WINNER_REACTION_STRONG_HANDS = new Set(["Straight", "Flush"]);
const CARD_RANK_ORDER = "23456789TJQKA";
const CARD_SUIT_SYMBOLS = {
	C: "♣",
	D: "♦",
	H: "♥",
	S: "♠",
};

const gameState = {
	currentPhaseIndex: 0,
	currentBet: 0,
	pot: 0,
	activeSeatIndex: null,
	initialDealerName: null,
	dealerOrbitCount: -1,
	gameStarted: false,
	gameFinished: false,
	openCardsMode: false,
	spectatorMode: false,
	raisesThisRound: 0,
	handInProgress: false,
	deck: INITIAL_DECK.slice(),
	cardGraveyard: [],
	communityCards: [],
	players: [],
	allPlayers: [],
	pendingAction: null,
	smallBlind: INITIAL_SMALL_BLIND,
	bigBlind: INITIAL_BIG_BLIND,
	lastRaise: INITIAL_BIG_BLIND,
};

gameState.toJSON = function () {
	return {
		currentPhaseIndex: this.currentPhaseIndex,
		currentBet: this.currentBet,
		pot: this.pot,
		lastRaise: this.lastRaise,
		smallBlind: this.smallBlind,
		bigBlind: this.bigBlind,
		raisesThisRound: this.raisesThisRound,
		dealerOrbitCount: this.dealerOrbitCount,
		communityCards: this.communityCards.slice(),
		pendingAction: this.pendingAction ? { ...this.pendingAction } : null,
		players: this.players,
		timestamp: Date.now(),
	};
};

/* --------------------------------------------------------------------------------------------------
Low-Level Utilities And Formatting Helpers
---------------------------------------------------------------------------------------------------*/

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

function createPageUrl(pageName) {
	const base = globalThis.location.origin + globalThis.location.pathname.replace(/[^/]*$/, "");
	return new URL(`${base}${pageName}`);
}

function formatPercent(numerator, denominator) {
	if (denominator === 0) {
		return "-";
	}
	return `${Math.round((numerator / denominator) * 100)}%`;
}

function getRandomItem(items) {
	return items[Math.floor(Math.random() * items.length)];
}

/* --------------------------------------------------------------------------------------------------
Render And Overlay Helpers
---------------------------------------------------------------------------------------------------*/

function renderPot() {
	potEl.textContent = gameState.pot;
}

function setPot(amount) {
	gameState.pot = amount;
	renderPot();
}

function addToPot(amount) {
	gameState.pot += amount;
	renderPot();
}

function setCommunityCards(cardCodes) {
	gameState.communityCards = cardCodes.slice();
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);
}

function appendCommunityCards(cardCodes) {
	gameState.communityCards = gameState.communityCards.concat(cardCodes);
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);
}

function setPlayerHoleCards(player, holeCards) {
	player.holeCards = holeCards.slice();
	renderPlayerHoleCards(player);
}

function setPlayerVisibleHoleCards(player, visibleHoleCards) {
	player.visibleHoleCards = visibleHoleCards.slice();
	renderPlayerHoleCards(player);
}

function renderPlayerHoleCards(player) {
	const visibleCards = player.holeCards.map((cardCode, index) =>
		player.visibleHoleCards[index] ? cardCode : null
	);
	renderSeatCards(player.cardEls, visibleCards);
}

function getStatsPlayers() {
	return gameState.allPlayers.slice().sort((a, b) => {
		if (b.chips !== a.chips) {
			return b.chips - a.chips;
		}
		return a.seatIndex - b.seatIndex;
	});
}

function createStatsCell(tagName, value) {
	const cell = document.createElement(tagName);
	cell.textContent = `${value}`;
	return cell;
}

function renderStatsOverlay() {
	if (!statsTableBody) {
		return;
	}

	statsTableBody.replaceChildren();
	getStatsPlayers().forEach((player) => {
		const row = document.createElement("tr");
		row.appendChild(createStatsCell("th", player.name));
		row.appendChild(createStatsCell("td", player.chips));
		row.appendChild(createStatsCell("td", player.stats.hands));
		row.appendChild(createStatsCell("td", player.stats.handsWon));
		row.appendChild(
			createStatsCell("td", formatPercent(player.stats.handsWon, player.stats.hands)),
		);
		row.appendChild(createStatsCell("td", player.stats.showdowns));
		row.appendChild(createStatsCell("td", player.stats.showdownsWon));
		row.appendChild(
			createStatsCell("td", formatPercent(player.stats.showdownsWon, player.stats.showdowns)),
		);
		row.appendChild(createStatsCell("td", player.stats.folds));
		row.appendChild(createStatsCell("td", player.stats.foldsPreflop));
		row.appendChild(createStatsCell("td", player.stats.foldsPostflop));
		row.appendChild(createStatsCell("td", player.stats.allins));
		statsTableBody.appendChild(row);
	});
}

function syncOverlayBackdrop() {
	const isOverlayOpen = Object.values(overlays).some(({ el }) =>
		!el.classList.contains("hidden")
	);
	overlayBackdrop.classList.toggle("hidden", !isOverlayOpen);
}

function openOverlay(name) {
	const overlay = overlays[name];
	if (!overlay) {
		return;
	}
	if (overlay.canOpen && !overlay.canOpen()) {
		return;
	}
	Object.entries(overlays).forEach(([key, entry]) => {
		entry.el.classList.toggle("hidden", key !== name);
	});
	overlay.beforeOpen?.();
	syncOverlayBackdrop();
}

function closeOverlay(name) {
	const overlay = overlays[name];
	if (!overlay) {
		return;
	}
	overlay.el.classList.add("hidden");
	syncOverlayBackdrop();
}

function closeAllOverlays() {
	Object.values(overlays).forEach(({ el }) => {
		el.classList.add("hidden");
	});
	syncOverlayBackdrop();
}

function syncLogUi() {
	const hasLogHistory = !!logList && logList.childElementCount > 0;
	const showSummaryButtons = !SPEED_MODE && summaryButtonsVisible;

	statsButton.classList.toggle("hidden", !showSummaryButtons);
	logButton.classList.toggle("hidden", !showSummaryButtons || !hasLogHistory);
}

function setSummaryButtonsVisible(isVisible) {
	summaryButtonsVisible = isVisible;
	syncLogUi();
}

/* --------------------------------------------------------------------------------------------------
Notification And Playback Helpers
---------------------------------------------------------------------------------------------------*/

function isFastPlaybackActive() {
	return SPEED_MODE || handFastForwardActive || autoplayToGameEnd;
}

function isTurboPlaybackActive() {
	return handFastForwardActive || autoplayToGameEnd;
}

function getNotifInterval() {
	if (SPEED_MODE) {
		return 0;
	}
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_NOTIF_INTERVAL;
	}
	return NOTIF_INTERVAL;
}

function getActionLabelDuration() {
	if (SPEED_MODE) {
		return 0;
	}
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_ACTION_LABEL_DURATION;
	}
	return ACTION_LABEL_DURATION;
}

function buildPublicPlayerActionState(player) {
	if (!player?.lastActionName || !Number.isFinite(player.actionLabelUntil)) {
		return null;
	}
	if (player.actionLabelUntil <= Date.now()) {
		return null;
	}
	return {
		name: player.lastActionName,
		labelUntil: player.actionLabelUntil,
	};
}

function buildPublicPlayerWinnerReactionState(player) {
	if (!player?.winnerReactionEmoji || !Number.isFinite(player.winnerReactionUntil)) {
		return null;
	}
	if (player.winnerReactionUntil <= Date.now()) {
		return null;
	}
	return {
		emoji: player.winnerReactionEmoji,
		visibleUntil: player.winnerReactionUntil,
	};
}

function getRunoutPhaseDelay() {
	if (SPEED_MODE) {
		return 0;
	}
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_RUNOUT_PHASE_DELAY;
	}
	return RUNOUT_PHASE_DELAY;
}

function scheduleNextNotif() {
	if (notifTimer) {
		clearTimeout(notifTimer);
	}
	notifTimer = setTimeout(() => {
		notifTimer = null;
		showNextNotif();
	}, getNotifInterval());
}

function deliverNotification(msg) {
	// newest message first for tracking
	if (logList) {
		const logEntry = document.createElement("div");
		logEntry.textContent = msg;
		logList.prepend(logEntry);
	}
	notifArr.unshift(msg);
	if (notifArr.length > MAX_ITEMS) notifArr.pop();
	syncLogUi();
	queueStateSync();
	renderNotificationBar(notification, notifArr);
	logHistory(msg);
}

function flushPendingNotifications() {
	if (notifTimer) {
		clearTimeout(notifTimer);
		notifTimer = null;
	}
	if (pendingNotif.length === 0) {
		isNotifProcessing = false;
		return;
	}
	isNotifProcessing = true;
	while (pendingNotif.length > 0) {
		deliverNotification(pendingNotif.shift());
	}
	isNotifProcessing = false;
}

function refreshNotificationPlayback() {
	if (!isNotifProcessing || pendingNotif.length === 0) {
		return;
	}
	scheduleNextNotif();
}

function syncRuntimePlayback() {
	setBotPlaybackFast(handFastForwardActive || autoplayToGameEnd);
	if (isFastPlaybackActive()) {
		flushPendingNotifications();
		return;
	}
	refreshNotificationPlayback();
}

function enqueueNotification(msg) {
	pendingNotif.push(msg);
	if (isFastPlaybackActive()) {
		flushPendingNotifications();
		return;
	}
	if (!isNotifProcessing) {
		showNextNotif();
	}
}

function showNextNotif() {
	if (pendingNotif.length === 0) {
		isNotifProcessing = false;
		notifTimer = null;
		return;
	}
	isNotifProcessing = true;
	deliverNotification(pendingNotif.shift());
	scheduleNextNotif();
}

function clearActionLabels() {
	gameState.players.forEach((player) => {
		clearSeatActionLabel(player, player.name);
	});
}

function getHumanPlayers() {
	return gameState.players.filter((p) => !p.isBot);
}

function getHumansWithChipsCount() {
	return gameState.players.filter((p) => !p.isBot && p.chips > 0).length;
}

function updateFastForwardButton() {
	if (!fastForwardButton) {
		return;
	}
	const humanPlayers = getHumanPlayers();
	const noHumanCanAct = humanPlayers.length === 0 ||
		humanPlayers.every((player) => player.folded);
	const shouldShow = !SPEED_MODE &&
		hadHumansAtStart &&
		gameState.handInProgress &&
		!gameState.gameFinished &&
		!handFastForwardActive &&
		!autoplayToGameEnd &&
		noHumanCanAct;
	fastForwardButton.classList.toggle("hidden", !shouldShow);
}

function resetRuntimeFastForward() {
	handFastForwardActive = false;
	autoplayToGameEnd = false;
	syncRuntimePlayback();
	updateFastForwardButton();
}

function activateFastForward() {
	if (!gameState.handInProgress || handFastForwardActive || autoplayToGameEnd || SPEED_MODE) {
		return;
	}
	handFastForwardActive = true;
	clearActionLabels();
	syncRuntimePlayback();
	updateFastForwardButton();
	if (runoutPhaseTimer) {
		clearTimeout(runoutPhaseTimer);
		runoutPhaseTimer = null;
		setPhase();
	}
}

function hideActionControls() {
	foldButton.classList.add("hidden");
	actionButton.classList.add("hidden");
	amountSlider.classList.add("hidden");
	sliderOutput.classList.add("hidden");
	updateFastForwardButton();
}

/* --------------------------------------------------------------------------------------------------
Analytics And Remote State-Sync Helpers
---------------------------------------------------------------------------------------------------*/

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

function getExitCounts() {
	const humansWithChipsAtExit = gameState.players.filter((p) => !p.isBot && p.chips > 0).length;
	const botsWithChipsAtExit = gameState.players.filter((p) => p.isBot && p.chips > 0).length;
	return { humansWithChipsAtExit, botsWithChipsAtExit };
}

function trackUnfinishedExit() {
	if (
		SPEED_MODE ||
		!globalThis.umami ||
		!gameState.gameStarted ||
		gameState.gameFinished ||
		exitEventSent ||
		!hadHumansAtStart
	) {
		return;
	}
	const { humansWithChipsAtExit, botsWithChipsAtExit } = getExitCounts();
	const exitCategory = humansWithChipsAtExit === 0 ? "last_human_bust" : "humans_left_with_chips";
	exitEventSent = true;
	globalThis.umami?.track("Poker", {
		finished: false,
		humansWithChipsAtExit,
		botsWithChipsAtExit,
		exitCategory,
	});
}

function registerBotReveal(player) {
	if (player?.stats) {
		player.stats.reveals++;
	}
	if (SPEED_MODE) {
		return;
	}
	globalThis.umami?.track("Poker", {
		botReveal: true,
	});
}

function hasStateSyncEnabled() {
	return tableId !== null;
}

function getHumanPlayerCount(players = gameState.players) {
	return players.filter((player) => !player.isBot).length;
}

function shouldEnableStateSyncForGame() {
	return getHumanPlayerCount() >= 2;
}

function syncTableUrlWithState() {
	const tableUrl = new URL(globalThis.location.href);
	if (tableId === null) {
		tableUrl.searchParams.delete("tableId");
	} else {
		tableUrl.searchParams.set("tableId", tableId);
	}
	globalThis.history.replaceState(null, "", tableUrl.toString());
}

function initStateSyncForGame() {
	if (!shouldEnableStateSyncForGame()) {
		tableId = null;
		syncTableUrlWithState();
		return;
	}

	const tableUrl = new URL(globalThis.location.href);
	tableId = tableUrl.searchParams.get("tableId") || Math.random().toString(36).slice(2, 8);
	syncTableUrlWithState();
}

function createTurnToken() {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function setPendingAction(player) {
	if (!hasStateSyncEnabled() || !player || player.isBot || player.folded || player.allIn) {
		if (gameState.pendingAction !== null) {
			gameState.pendingAction = null;
			queueStateSync(0);
		}
		return null;
	}

	const actionState = getPlayerActionState(gameState, player);
	const pendingAction = {
		seatIndex: player.seatIndex,
		turnToken: createTurnToken(),
		needToCall: actionState.needToCall,
		minAmount: actionState.minAmount,
		maxAmount: actionState.maxAmount,
		minRaise: actionState.minRaise,
		canCheck: actionState.canCheck,
		buttonLabel: getActionButtonLabel(actionState.minAmount, actionState),
	};
	gameState.pendingAction = pendingAction;
	queueStateSync(0);
	return pendingAction;
}

function clearPendingAction() {
	if (gameState.pendingAction === null) {
		return;
	}
	gameState.pendingAction = null;
	queueStateSync(0);
}

function buildPublicPlayerView(player, communityCards) {
	return {
		seatIndex: player.seatIndex,
		seatSlot: player.seatSlot,
		name: player.name,
		chips: player.chips,
		roundBet: player.roundBet,
		folded: player.folded,
		allIn: player.allIn,
		dealer: player.dealer,
		smallBlind: player.smallBlind,
		bigBlind: player.bigBlind,
		publicHoleCards: player.holeCards.map((cardCode, index) =>
			player.visibleHoleCards[index] ? cardCode : null
		),
		handStrengthLabel: shouldShowTableHandStrength(player, communityCards)
			? getPlayerHandStrengthLabel(player, communityCards)
			: "",
		winProbability: player.winProbability,
		showWinProbability: shouldShowTableWinProbability(player),
		winner: player.isWinner === true,
		actionState: buildPublicPlayerActionState(player),
		winnerReaction: buildPublicPlayerWinnerReactionState(player),
	};
}

// The table stays the canonical source for private display values.
// Seat views receive already-decided visibility and computed display fields instead of recomputing
// them on the phone, which keeps the single view thin and prevents rule drift.
function shouldShowSeatHandStrength(player, communityCards) {
	return gameState.currentPhaseIndex > 0 &&
		communityCards.length >= 3 &&
		!player.folded &&
		player.holeCards.every(Boolean);
}

function shouldShowSeatWinProbability(player) {
	return (gameState.spectatorMode || isAllInRunout()) &&
		gameState.currentPhaseIndex > 0 &&
		!player.folded &&
		player.holeCards.every(Boolean) &&
		typeof player.winProbability === "number";
}

function buildSeatView(player, communityCards) {
	return {
		seatIndex: player.seatIndex,
		seatSlot: player.seatSlot,
		name: player.name,
		chips: player.chips,
		roundBet: player.roundBet,
		folded: player.folded,
		allIn: player.allIn,
		holeCards: player.holeCards.slice(),
		handStrengthLabel: shouldShowSeatHandStrength(player, communityCards)
			? getPlayerHandStrengthLabel(player, communityCards)
			: "",
		winProbability: player.winProbability,
		showWinProbability: shouldShowSeatWinProbability(player),
	};
}

function buildSyncView() {
	const communityCards = getCommunityCardCodes();

	return {
		table: {
			// table contains public/shared state only.
			phase: getCurrentPhase(gameState.currentPhaseIndex),
			pot: gameState.pot,
			activeSeatIndex: gameState.activeSeatIndex,
			communityCards,
			notifications: notifArr.slice(0, MAX_ITEMS),
			playersPublic: gameState.players.map((player) =>
				buildPublicPlayerView(player, communityCards)
			),
			pendingAction: gameState.pendingAction ? { ...gameState.pendingAction } : null,
		},
		// seatViews carries one private projection per seat; the backend narrows this to one seat.
		seatViews: gameState.players.map((player) => buildSeatView(player, communityCards)),
	};
}

async function fetchPendingRemoteAction(turnToken) {
	if (!hasStateSyncEnabled() || !turnToken) {
		return null;
	}

	try {
		const url = `${ACTION_SYNC_ENDPOINT}?tableId=${encodeURIComponent(tableId)}&turnToken=${
			encodeURIComponent(turnToken)
		}`;
		const res = await fetch(url, {
			cache: "no-store",
		});
		if (res.status === 204) {
			return null;
		}
		if (!res.ok) {
			logFlow("remote action poll failed", { status: res.status });
			return null;
		}
		return await res.json();
	} catch (error) {
		logFlow("remote action poll failed", error);
		return null;
	}
}

async function sendTableState() {
	const payload = {
		tableId: tableId,
		view: buildSyncView(),
	};

	try {
		const res = await fetch(STATE_SYNC_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			throw new Error(`state sync failed with status ${res.status}`);
		}
	} catch (error) {
		logFlow("state sync failed", error);
		queueStateSync();
	}
}

function queueStateSync(delay = STATE_SYNC_DELAY) {
	if (!hasStateSyncEnabled()) {
		return;
	}

	const nextDelay = Math.max(0, delay);
	if (stateSyncTimer !== null) {
		if (stateSyncTimerDelay !== null && stateSyncTimerDelay <= nextDelay) {
			return;
		}
		clearTimeout(stateSyncTimer);
	}

	stateSyncTimerDelay = nextDelay;
	stateSyncTimer = setTimeout(() => {
		stateSyncTimer = null;
		stateSyncTimerDelay = null;
		sendTableState();
	}, nextDelay);
}

/* --------------------------------------------------------------------------------------------------
Card Visibility, Hand-Strength, Reveal, And Winner-Reaction Logic
---------------------------------------------------------------------------------------------------*/

function revealPlayerHoleCards(player) {
	setPlayerVisibleHoleCards(player, [true, true]);
}

function hidePlayerHoleCards(player) {
	setPlayerVisibleHoleCards(player, [false, false]);
}

function getCommunityCardCodes() {
	return gameState.communityCards.slice();
}

function isAllInRunout() {
	const activePlayers = gameState.players.filter((p) => !p.folded);
	const actionablePlayers = activePlayers.filter((p) => !p.allIn);
	if (activePlayers.length <= 1 || actionablePlayers.length > 1) {
		return false;
	}
	if (actionablePlayers.length === 0) {
		return true;
	}
	// Do not start the runout until the last player with chips has matched the bet.
	return actionablePlayers[0].roundBet === gameState.currentBet;
}

function revealActiveHoleCards() {
	gameState.players.filter((p) => !p.folded).forEach((p) => {
		revealPlayerHoleCards(p);
		p.qr.hide();
	});
	updateHandStrengthDisplays();
}

function areHoleCardsFaceUp(player) {
	return player.visibleHoleCards.every(Boolean);
}

function getShortHandStrengthLabel(solvedHand) {
	if (!solvedHand) {
		return "";
	}
	if (solvedHand.descr === "Royal Flush") {
		return "Royal flush";
	}
	switch (solvedHand.name) {
		case "Straight Flush":
			return "Straight flush";
		case "Four of a Kind":
			return "4 of a kind";
		case "Full House":
			return "Full house";
		case "Flush":
			return "Flush";
		case "Straight":
			return "Straight";
		case "Three of a Kind":
			return "3 of a kind";
		case "Two Pair":
			return "2 Pair";
		case "Pair":
			return "Pair";
		case "High Card":
		default:
			return "High card";
	}
}

function formatCardLabel(cardCode) {
	if (!cardCode || cardCode.length < 2) {
		return "";
	}
	const rank = cardCode[0] === "T" ? "10" : cardCode[0];
	const suit = CARD_SUIT_SYMBOLS[cardCode[1]] || cardCode[1];
	return `${rank}${suit}`;
}

function getSolvedHandCardCodes(solvedHand) {
	if (!solvedHand) {
		return [];
	}
	return solvedHand.cards.map((card) => `${card.value}${card.suit.toUpperCase()}`);
}

function getHighestBoardRank(boardCards) {
	return boardCards.reduce((highestRank, cardCode) => {
		if (
			!highestRank ||
			CARD_RANK_ORDER.indexOf(cardCode[0]) > CARD_RANK_ORDER.indexOf(highestRank)
		) {
			return cardCode[0];
		}
		return highestRank;
	}, "");
}

function getBotRevealDecision(player, communityCards) {
	if (!player.isBot || communityCards.length === 0) {
		return null;
	}
	if (Math.random() >= BOT_REVEAL_CHANCE) {
		return null;
	}

	const holeCards = player.holeCards.slice();
	const solvedHand = Hand.solve([...holeCards, ...communityCards]);
	if (!solvedHand) {
		return null;
	}

	const bestHandCardCodes = new Set(getSolvedHandCardCodes(solvedHand));
	const revealedHoleCards = holeCards.filter((cardCode) => bestHandCardCodes.has(cardCode));

	if (BOT_DOUBLE_REVEAL_HANDS.has(solvedHand.name) && revealedHoleCards.length === 2) {
		return { type: "double", handName: solvedHand.name, codes: holeCards.slice() };
	}

	if (solvedHand.name !== "Pair" && solvedHand.name !== "Three of a Kind") {
		return null;
	}

	const repeatedCount = solvedHand.name === "Pair" ? 2 : 3;
	const rankCounts = new Map();
	getSolvedHandCardCodes(solvedHand).forEach((cardCode) => {
		const rank = cardCode[0];
		rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
	});
	const madeRankEntry = Array.from(rankCounts.entries()).find(([, count]) =>
		count === repeatedCount
	);
	if (!madeRankEntry) {
		return null;
	}
	if (solvedHand.name === "Pair" && madeRankEntry[0] !== getHighestBoardRank(communityCards)) {
		return null;
	}

	const matchingHoleCards = holeCards.filter((cardCode) => cardCode[0] === madeRankEntry[0]);
	if (matchingHoleCards.length !== 1) {
		return null;
	}

	return { type: "single", handName: solvedHand.name, codes: matchingHoleCards };
}

function applyBotReveal(player, revealDecision) {
	if (!revealDecision) {
		return;
	}
	if (gameState.spectatorMode) {
		updateHandStrengthDisplays();
		return;
	}
	const revealedCards = new Set(revealDecision.codes);
	setPlayerVisibleHoleCards(
		player,
		player.holeCards.map((cardCode) => revealedCards.has(cardCode)),
	);
	player.qr.hide();
	updateHandStrengthDisplays();
}

function getVisibleSolvedHand(player, communityCards) {
	if (!areHoleCardsFaceUp(player) || communityCards.length !== 5) {
		return null;
	}
	return Hand.solve([...player.holeCards, ...communityCards]);
}

function getWinnerReactionEmoji(player, context) {
	if (context.revealedPlayers.has(player)) {
		return getRandomItem(WINNER_REACTION_EMOJIS.reveal);
	}

	if (context.activePlayerCount === 1) {
		return getRandomItem(WINNER_REACTION_EMOJIS.uncontested);
	}

	if (context.mainPotWinnerCount > 1) {
		return getRandomItem(WINNER_REACTION_EMOJIS.split);
	}

	const totalPayout = context.totalPayout;
	const stackBeforePayout = context.stackBeforePayout;
	const stackAfterPayout = stackBeforePayout + totalPayout;
	if (
		stackBeforePayout <= 6 * context.bigBlind &&
		stackAfterPayout >= 12 * context.bigBlind &&
		stackAfterPayout >= stackBeforePayout * 3
	) {
		return getRandomItem(WINNER_REACTION_EMOJIS.comeback);
	}

	if (context.hadShowdown) {
		const solvedHand = getVisibleSolvedHand(player, context.communityCards);
		if (solvedHand) {
			if (
				solvedHand.descr === "Royal Flush" ||
				WINNER_REACTION_MONSTER_HANDS.has(solvedHand.name)
			) {
				return getRandomItem(WINNER_REACTION_EMOJIS.monsterHand);
			}
			if (WINNER_REACTION_STRONG_HANDS.has(solvedHand.name)) {
				return getRandomItem(WINNER_REACTION_EMOJIS.strongHand);
			}
		}
	}

	if (totalPayout >= Math.max(12 * context.bigBlind, stackBeforePayout)) {
		return getRandomItem(WINNER_REACTION_EMOJIS.bigPot);
	}

	return getRandomItem(WINNER_REACTION_EMOJIS.fallback);
}

function triggerMainPotWinnerReactions(context) {
	if (isFastPlaybackActive() || context.mainPotWinners.length === 0) {
		return;
	}

	context.mainPotWinners.forEach((player) => {
		const totalPayout = context.totalPayoutByPlayer.get(player) || 0;
		if (totalPayout <= 0) {
			return;
		}
		const emoji = getWinnerReactionEmoji(player, {
			...context,
			totalPayout,
			stackBeforePayout: player.chips,
		});
		const visibleUntil = Date.now() + WINNER_REACTION_DURATION;
		player.winnerReactionEmoji = emoji;
		player.winnerReactionUntil = visibleUntil;
		showWinnerReaction(player, emoji, visibleUntil);
		queueStateSync(0);
	});
}

function getPlayerSolvedHand(player, communityCards) {
	if (!player.holeCards.every(Boolean) || communityCards.length < 3) {
		return null;
	}
	return Hand.solve([...player.holeCards, ...communityCards]);
}

function getPlayerHandStrengthLabel(player, communityCards) {
	const solvedHand = getPlayerSolvedHand(player, communityCards);
	if (!solvedHand) {
		return "";
	}
	return getShortHandStrengthLabel(solvedHand);
}

function shouldShowTableHandStrength(player, communityCards) {
	return gameState.currentPhaseIndex > 0 &&
		communityCards.length >= 3 &&
		areHoleCardsFaceUp(player);
}

function shouldShowTableWinProbability(player) {
	return (gameState.spectatorMode || isAllInRunout()) &&
		gameState.currentPhaseIndex > 0 &&
		areHoleCardsFaceUp(player) &&
		typeof player.winProbability === "number";
}

function updateHandStrengthDisplays() {
	const communityCards = getCommunityCardCodes();

	gameState.players.forEach((p) => {
		const handEl = p.handStrengthEl || p.seat.querySelector(".hand-strength");
		if (!handEl) {
			return;
		}

		const shouldShow = shouldShowTableHandStrength(p, communityCards);
		const label = shouldShow ? getPlayerHandStrengthLabel(p, communityCards) : "";
		renderSeatPill(handEl, label, shouldShow);
	});
}

function updateWinProbabilityDisplays() {
	gameState.players.forEach((p) => {
		const winEl = p.winProbabilityEl || p.seat.querySelector(".win-probability");
		if (!winEl) {
			return;
		}
		const shouldShow = shouldShowTableWinProbability(p);
		const label = shouldShow ? `${Math.round(p.winProbability)}%` : "";
		renderSeatPill(winEl, label, shouldShow);
	});
}

function computeSpectatorWinProbabilities(reason = "") {
	if (!gameState.spectatorMode && !isAllInRunout()) {
		return;
	}
	if (gameState.currentPhaseIndex === 0) {
		logFlow("winProbability: preflop skipped", { reason });
		updateWinProbabilityDisplays();
		return;
	}

	const communityCards = getCommunityCardCodes();
	const missingCount = 5 - communityCards.length;
	if (missingCount < 0) {
		logFlow("winProbability: invalid board state", {
			communityCards,
			missingCount,
		});
		return;
	}

	const activePlayers = gameState.players.filter((p) => !p.folded);
	if (activePlayers.length === 0) {
		updateWinProbabilityDisplays();
		return;
	}

	gameState.players.forEach((p) => {
		p.winProbability = p.folded ? 0 : null;
	});

	if (activePlayers.length === 1) {
		activePlayers[0].winProbability = 100;
		updateWinProbabilityDisplays();
		logFlow("winProbability", {
			phase: getCurrentPhase(gameState.currentPhaseIndex),
			reason,
			boards: 1,
			players: [{ name: activePlayers[0].name, winProbability: 100 }],
		});
		return;
	}

	const totalBoards = combinationCount(gameState.deck.length, missingCount);
	const MAX_ENUM_BOARDS = 50000;
	if (totalBoards > MAX_ENUM_BOARDS) {
		logFlow("winProbability: skipped heavy enumeration", {
			phase: getCurrentPhase(gameState.currentPhaseIndex),
			reason,
			missingCount,
			totalBoards,
			deckSize: gameState.deck.length,
		});
		updateWinProbabilityDisplays();
		return;
	}

	const deck = gameState.deck.slice();
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
		hole: p.holeCards.slice(),
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
		phase: getCurrentPhase(gameState.currentPhaseIndex),
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

/* --------------------------------------------------------------------------------------------------
Game Setup And Hand Lifecycle
---------------------------------------------------------------------------------------------------*/

function startGame(event) {
	if (!gameState.gameStarted) {
		resetRuntimeFastForward();
		gameState.handInProgress = false;
		createPlayers();
		hadHumansAtStart = gameState.players.some((p) => !p.isBot);
		exitEventSent = false;

		if (gameState.players.length > 1) {
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
			instructionsButton.classList.add("hidden");
			closeAllOverlays();
			gameState.gameStarted = true;
			initStateSyncForGame();

			preFlop();
		} else {
			hadHumansAtStart = false;
			for (const name of nameBadges) {
				if (name.textContent === "") {
					name.parentElement.classList.remove("hidden");
				}
			}
			gameState.players = [];
			gameState.allPlayers = [];
			enqueueNotification("Not enough players");
		}
	} else {
		// New Round
		preFlop();
	}
}

function createPlayers() {
	gameState.players = [];
	gameState.allPlayers = [];
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

	const allSeats = Array.from(document.querySelectorAll(".seat"));
	const activePlayers = document.querySelectorAll(".seat:not(.hidden)");
	for (const player of activePlayers) {
		const seatIndex = gameState.players.length;
		// Transitional shape: this object still mixes player state with seat DOM references.
		// A later refactor should split it into playerState and seatRef without changing behavior.
		const playerObject = {
			name: player.querySelector("h3").textContent,
			isBot: player.classList.contains("bot"),
			seat: player,
			seatSlot: allSeats.indexOf(player),
			totalEl: player.querySelector(".chips .total"),
			betEl: player.querySelector(".chips .bet"),
			stackChipEls: player.querySelectorAll(".stack-visual img"),
			winnerReactionEl: player.querySelector(".winner-reaction"),
			winnerReactionTimer: null,
			winnerReactionEmoji: "",
			winnerReactionUntil: 0,
			isWinner: false,
			winProbabilityEl: player.querySelector(".win-probability"),
			handStrengthEl: player.querySelector(".hand-strength"),
			actionLabelTimer: null,
			lastActionName: "",
			actionLabelUntil: 0,
			winProbability: null,
			seatIndex,
			holeCards: [null, null],
			visibleHoleCards: [false, false],
			qr: {
				show: function (card1, card2) {
					const qrContainer = player.querySelector(".qr");
					const qrLink = qrContainer.querySelector(".qr-link");
					const remoteLink = qrContainer.querySelector(".remote-table-link");
					qrContainer.classList.remove("hidden");
					const holeCardsUrl = createPageUrl("hole-cards.html");
					holeCardsUrl.searchParams.set("card1", card1);
					holeCardsUrl.searchParams.set("card2", card2);
					holeCardsUrl.searchParams.set("name", playerObject.name);
					holeCardsUrl.searchParams.set("chips", `${playerObject.chips}`);
					holeCardsUrl.searchParams.set("seatIndex", `${playerObject.seatIndex}`);
					if (tableId !== null) {
						holeCardsUrl.searchParams.set("tableId", tableId);
					}
					holeCardsUrl.searchParams.set("t", `${Date.now()}`);
					const url = holeCardsUrl.toString();
					qrLink.replaceChildren();
					qrLink.href = url;
					QrCreator.render({
						text: url,
						size: 200,
						fill: "#333",
						background: "#fff",
						radius: 0,
					}, qrLink);

					if (tableId !== null) {
						const remoteTableUrl = createPageUrl("remoteTable.html");
						remoteTableUrl.searchParams.set("tableId", tableId);
						remoteTableUrl.searchParams.set("seatIndex", `${playerObject.seatIndex}`);
						remoteLink.href = remoteTableUrl.toString();
						remoteLink.classList.remove("hidden");
					} else {
						remoteLink.removeAttribute("href");
						remoteLink.classList.add("hidden");
					}

					qrContainer.dataset.url = url;
				},
				hide: function () {
					const qrContainer = player.querySelector(".qr");
					const qrLink = qrContainer.querySelector(".qr-link");
					const remoteLink = qrContainer.querySelector(".remote-table-link");
					qrContainer.classList.add("hidden");
					qrLink.replaceChildren();
					qrLink.removeAttribute("href");
					remoteLink.removeAttribute("href");
					remoteLink.classList.add("hidden");
					delete qrContainer.dataset.url;
				},
			},
			cardEls: player.querySelectorAll(".card"),
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
				reveals: 0,
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
				playerObject.totalEl.textContent = playerObject.chips;
			},
			placeBet: function (x) {
				// Clamp bet to available chips → prevents negative stacks
				const bet = Math.min(x, playerObject.chips);
				playerObject.roundBet += bet;
				playerObject.totalBet += bet;
				playerObject.betEl.textContent = playerObject.roundBet;
				playerObject.chips -= bet;
				if (playerObject.chips === 0) {
					playerObject.allIn = true;
				}
				playerObject.showTotal();
				return bet; // return the real amount pushed to the pot
			},
			resetRoundBet: function () {
				playerObject.roundBet = 0;
				playerObject.betEl.textContent = 0;
			},
			clearActionLabelState: function () {
				playerObject.lastActionName = "";
				playerObject.actionLabelUntil = 0;
			},
			clearWinnerReactionState: function () {
				playerObject.winnerReactionEmoji = "";
				playerObject.winnerReactionUntil = 0;
			},
			toJSON: function () {
				return {
					name: playerObject.name,
					chips: playerObject.chips,
					roundBet: playerObject.roundBet,
					totalBet: playerObject.totalBet,
					folded: playerObject.folded,
					allIn: playerObject.allIn,
					isBot: playerObject.isBot,
					dealer: playerObject.dealer,
					smallBlind: playerObject.smallBlind,
					bigBlind: playerObject.bigBlind,
					holeCards: playerObject.holeCards.slice(),
					visibleHoleCards: playerObject.visibleHoleCards.slice(),
					seatIndex: playerObject.seatIndex,
					stats: {
						hands: playerObject.stats.hands,
						handsWon: playerObject.stats.handsWon,
						reveals: playerObject.stats.reveals,
						showdowns: playerObject.stats.showdowns,
						showdownsWon: playerObject.stats.showdownsWon,
					},
				};
			},
		};
		gameState.players.push(playerObject);
	}
	renderChipStacks(gameState.players);
	gameState.players.forEach((player) => {
		player.showTotal();
		player.resetRoundBet();
		renderPlayerHoleCards(player);
	});
	gameState.allPlayers = gameState.players.slice();
}

function setDealer() {
	const isNotDealer = (currentValue) => currentValue.dealer === false;
	if (gameState.players.every(isNotDealer)) {
		const randomPlayerIndex = Math.floor(Math.random() * gameState.players.length);
		gameState.players[randomPlayerIndex].dealer = true;
		gameState.players[randomPlayerIndex].assignRole("dealer");
		gameState.initialDealerName = gameState.players[randomPlayerIndex].name;
	} else {
		const dealerIndex = gameState.players.findIndex((p) => p.dealer);
		// clear current dealer flag
		gameState.players[dealerIndex].dealer = false;
		gameState.players[dealerIndex].clearRole("dealer");

		// assign new dealer – wrap with modulo to avoid “undefined”
		const nextIndex = (dealerIndex + 1) % gameState.players.length;
		gameState.players[nextIndex].dealer = true;
		gameState.players[nextIndex].assignRole("dealer");
	}

	while (gameState.players[0].dealer === false) {
		gameState.players.unshift(gameState.players.pop());
	}

	enqueueNotification(`${gameState.players[0].name} is Dealer.`);
}

function setBlinds() {
	// When the dealer is back at initialDealer → increment orbit
	if (gameState.players[0].name === gameState.initialDealerName) {
		gameState.dealerOrbitCount++;
		if (gameState.dealerOrbitCount > 0 && gameState.dealerOrbitCount % 2 === 0) {
			// Increase blind level
			gameState.smallBlind *= 2;
			gameState.bigBlind *= 2;
			enqueueNotification(`Blinds are now ${gameState.smallBlind}/${gameState.bigBlind}.`);
		}
	}

	// Clear previous roles and icons
	gameState.players.forEach((p) => {
		p.clearRole("small-blind");
		p.clearRole("big-blind");
	});
	// Post blinds for Pre-Flop and set currentBet
	const sbIdx = (gameState.players.length > 2) ? 1 : 0;
	const bbIdx = (gameState.players.length > 2) ? 2 : 1;

	const sbBet = gameState.players[sbIdx].placeBet(gameState.smallBlind);
	const bbBet = gameState.players[bbIdx].placeBet(gameState.bigBlind);

	enqueueNotification(`${gameState.players[sbIdx].name} posted small blind of ${sbBet}.`);
	enqueueNotification(`${gameState.players[bbIdx].name} posted big blind of ${bbBet}.`);

	// Add blinds to the pot
	addToPot(sbBet + bbBet);
	// Assign new blinds
	gameState.players[sbIdx].assignRole("small-blind");
	gameState.players[bbIdx].assignRole("big-blind");
	gameState.currentBet = gameState.bigBlind;
	gameState.lastRaise = gameState.bigBlind; // minimum raise equals the big blind at hand start
}

function dealCards() {
	gameState.deck = gameState.deck.concat(gameState.cardGraveyard);
	gameState.cardGraveyard = [];
	shuffleArray(gameState.deck);

	for (const player of gameState.players) {
		const card1 = trackUsedCard(gameState.cardGraveyard, takeDeckCard(gameState.deck));
		const card2 = trackUsedCard(gameState.cardGraveyard, takeDeckCard(gameState.deck));
		setPlayerHoleCards(player, [card1, card2]);

		const showCards = gameState.spectatorMode || (!player.isBot && gameState.openCardsMode);
		setPlayerVisibleHoleCards(player, [showCards, showCards]);

		if (!player.isBot) {
			if (gameState.openCardsMode) {
				player.qr.hide();
			} else {
				player.qr.show(card1, card2);
			}
		} else {
			player.qr.hide();
		}
	}
}

/**
 * Execute the standard pre-flop steps: rotate dealer, post blinds, deal cards, start betting.
 */
function preFlop() {
	// --- Hand Start And Reset ---------------------------------------------------
	// Analytics: count hands and mark start time
	totalHands++;
	// Reset phase to preflop
	gameState.currentPhaseIndex = 0;
	gameState.gameFinished = false;
	gameState.handInProgress = false;
	if (runoutPhaseTimer) {
		clearTimeout(runoutPhaseTimer);
		runoutPhaseTimer = null;
	}

	startButton.classList.add("hidden");
	closeAllOverlays();
	setSummaryButtonsVisible(false);
	clearActionLabels();
	clearActiveTurnPlayer(false);

	// Clear folded state and remove CSS-Klasse
	gameState.players.forEach((p) => {
		p.folded = false;
		p.allIn = false;
		p.totalBet = 0;
		p.winProbability = null;
		p.isWinner = false;
		clearWinnerReaction(p);
		renderSeatWinnerState(p, false);
		p.seat.classList.remove("folded", "called", "raised", "checked", "allin");
		setPlayerHoleCards(p, [null, null]);
		hidePlayerHoleCards(p);
		p.qr.hide();
	});

	// Clear community cards from last hand
	setCommunityCards([]);

	// --- Busted Player Cleanup ---------------------------------------------------
	// Remove players with zero chips from the table
	const remainingPlayers = [];
	gameState.players.forEach((p) => {
		if (p.chips <= 0) {
			p.chips = 0;
			p.seat.classList.add("hidden");
			enqueueNotification(`${p.name} is out of the game!`);
			logFlow("player_bust", { name: p.name });
		} else {
			remainingPlayers.push(p);
		}
	});
	gameState.players = remainingPlayers;
	// --- Visibility Mode Recalculation -------------------------------------------
	const humanCount = getHumanPlayerCount();
	gameState.openCardsMode = humanCount === 1;
	gameState.spectatorMode = humanCount === 0;
	updateWinProbabilityDisplays();
	updateHandStrengthDisplays();

	// --- Per-Hand Stats Reset ----------------------------------------------------
	// Start statistics for a new hand
	gameState.players.forEach((p) => {
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
	if (
		!gameState.players.some((p) => p.name === gameState.initialDealerName) &&
		gameState.players.length > 0
	) {
		gameState.initialDealerName = gameState.players[0].name;
		gameState.dealerOrbitCount = -1;
	}

	// --- Game Over Check ---------------------------------------------------------
	// GAME OVER: only one player left at the table
	if (gameState.players.length === 1) {
		const champion = gameState.players[0];
		clearActiveTurnPlayer(false);
		enqueueNotification(`${champion.name} wins the game! 🏆`);
		// Reveal champion's stack
		champion.showTotal();
		champion.isWinner = true;
		renderSeatWinnerState(champion, true);
		logFlow("tournament_end", { champion: champion.name });
		gameState.gameFinished = true;
		clearPendingAction();
		hideActionControls();
		resetRuntimeFastForward();
		if (!SPEED_MODE) {
			globalThis.umami?.track("Poker", {
				champion: champion.name,
				botWon: champion.isBot,
				handsPlayed: getHandsPlayedBucket(totalHands),
				finished: true,
			});
			renderStatsOverlay();
			setSummaryButtonsVisible(true);
		}
		queueStateSync(0);
		return; // skip the rest of preFlop()
	}
	// ----------------------------------------------------------

	// --- Dealer, Blinds, Deal, And First Round ----------------------------------
	gameState.handInProgress = true;
	updateFastForwardButton();

	// Assign dealer
	setDealer();

	// post blinds
	setBlinds();

	// Shuffle and deal new hole cards
	dealCards();
	if (totalHands === 1 && !SPEED_MODE) {
		globalThis.umami?.track("Poker", {
			players: gameState.players.length,
			bots: gameState.players.filter((p) => p.isBot).length,
			humans: gameState.players.filter((p) => !p.isBot).length,
		});
	}

	// Start first betting round (preflop)
	queueStateSync();
	startBettingRound();
}

function dealCommunityCards(amount) {
	if (communityCardSlots.length - gameState.communityCards.length < amount) {
		console.warn("Not enough empty slots for", amount);
		logFlow("dealCommunityCards: not enough slots");
		return;
	}
	trackUsedCard(gameState.cardGraveyard, takeDeckCard(gameState.deck)); // burn
	const dealtCards = [];
	for (let i = 0; i < amount; i++) {
		const card = trackUsedCard(gameState.cardGraveyard, takeDeckCard(gameState.deck));
		if (card) {
			dealtCards.push(card);
		}
	}
	appendCommunityCards(dealtCards);
	updateHandStrengthDisplays();
	if (gameState.spectatorMode || isAllInRunout()) {
		computeSpectatorWinProbabilities("dealCommunityCards");
	}
}

function setPhase() {
	logFlow("setPhase", { phase: getCurrentPhase(gameState.currentPhaseIndex) });
	// EARLY EXIT: If only one player remains, skip straight to showdown
	const activePlayers = gameState.players.filter((p) => !p.folded);
	if (activePlayers.length <= 1) {
		return doShowdown();
	}

	gameState.currentPhaseIndex++;
	switch (getCurrentPhase(gameState.currentPhaseIndex)) {
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

function queueRunoutPhaseAdvance(reason = "") {
	hideActionControls();
	const runoutPhaseDelay = getRunoutPhaseDelay();
	if (!isAllInRunout() || runoutPhaseDelay === 0) {
		return setPhase();
	}
	if (runoutPhaseTimer) {
		return;
	}
	logFlow("delay runout phase", {
		reason,
		phase: getCurrentPhase(gameState.currentPhaseIndex),
		delay: runoutPhaseDelay,
	});
	runoutPhaseTimer = setTimeout(() => {
		runoutPhaseTimer = null;
		setPhase();
	}, runoutPhaseDelay);
}

/* --------------------------------------------------------------------------------------------------
Turn Handling And Betting Round Flow
---------------------------------------------------------------------------------------------------*/

function notifyPlayerAction(player, action = "", amount = 0) {
	// Remove any previous action indicator before adding a new one
	player.seat.classList.remove("checked", "called", "raised", "allin");
	// Update statistics based on action and phase
	if (gameState.currentPhaseIndex === 0) {
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

	if (gameState.currentPhaseIndex === 0 && (action === "raise" || action === "allin")) {
		gameState.players.forEach((p) => {
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
		if (gameState.currentPhaseIndex === 0) {
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
		const actionLabelDuration = getActionLabelDuration();
		player.lastActionName = action;
		player.actionLabelUntil = Date.now() + actionLabelDuration;
		renderSeatActionLabel(player, {
			playerName: player.name,
			actionName: action,
			labelUntil: player.actionLabelUntil,
		});
	}

	if (action === "fold") {
		player.winProbability = 0;
		updateHandStrengthDisplays();
	}

	if (action !== "check" && isAllInRunout()) {
		revealActiveHoleCards();
		if (gameState.currentPhaseIndex > 0) {
			computeSpectatorWinProbabilities("allin-runout");
		} else {
			logFlow("winProbability: preflop all-in runout pending", {
				action,
				name: player.name,
			});
		}
	} else if (gameState.spectatorMode && action === "fold") {
		if (gameState.currentPhaseIndex > 0) {
			computeSpectatorWinProbabilities("fold");
		} else {
			logFlow("winProbability: preflop fold skipped", { name: player.name });
		}
	}
	queueStateSync(0);
	updateFastForwardButton();
	enqueueNotification(msg);
}

function setActiveTurnPlayer(player) {
	document.querySelectorAll(".seat").forEach((seat) => seat.classList.remove("active"));
	player.seat.classList.add("active");
	if (gameState.activeSeatIndex !== player.seatIndex) {
		gameState.activeSeatIndex = player.seatIndex;
		queueStateSync(0);
	}
}

function clearActiveTurnPlayer(sync = true) {
	document.querySelectorAll(".seat").forEach((seat) => seat.classList.remove("active"));
	if (gameState.activeSeatIndex === null) {
		return;
	}
	gameState.activeSeatIndex = null;
	if (sync) {
		queueStateSync(0);
	}
}

function continueAfterResolvedTurn({
	player,
	cycles,
	anyUncalled,
	nextPlayer,
	logPrefix,
	advanceReason,
}) {
	if (cycles < gameState.players.length) {
		logFlow(`${logPrefix} next`, { name: player.name });
		nextPlayer();
	} else if (anyUncalled()) {
		logFlow(`${logPrefix} wait`, { name: player.name });
		nextPlayer();
	} else {
		clearActiveTurnPlayer(false);
		logFlow(`${logPrefix} advance`, { name: player.name });
		queueRunoutPhaseAdvance(advanceReason);
	}
}

function applyTurnAction(player, actionRequest) {
	if (!player || !actionRequest) {
		return null;
	}

	const currentActionState = getPlayerActionState(gameState, player);

	switch (actionRequest.action) {
		case "fold":
			player.folded = true;
			notifyPlayerAction(player, "fold", 0);
			player.qr.hide();
			return { action: "fold", amount: 0 };
		case "check":
			notifyPlayerAction(player, "check", 0);
			return { action: "check", amount: 0 };
		case "call": {
			const callAmount = Math.min(player.chips, currentActionState.needToCall);
			if (
				callAmount === player.chips &&
				player.chips > 0 &&
				currentActionState.needToCall > 0
			) {
				return applyTurnAction(player, { action: "allin", amount: player.chips });
			}
			const actual = player.placeBet(callAmount);
			addToPot(actual);
			notifyPlayerAction(player, "call", actual);
			return { action: "call", amount: actual };
		}
		case "allin": {
			const actual = player.placeBet(player.chips);
			addToPot(actual);
			if (actual >= currentActionState.minRaise) {
				gameState.currentBet = player.roundBet;
				gameState.lastRaise = actual - currentActionState.needToCall;
				gameState.raisesThisRound++;
			} else if (actual >= currentActionState.needToCall) {
				gameState.currentBet = Math.max(gameState.currentBet, player.roundBet);
			}
			notifyPlayerAction(player, "allin", actual);
			return { action: "allin", amount: actual };
		}
		case "raise": {
			let bet = Number.parseInt(actionRequest.amount, 10);
			if (Number.isNaN(bet)) {
				return null;
			}
			if (bet < currentActionState.minRaise && bet < player.chips) {
				bet = Math.min(player.chips, currentActionState.minRaise);
			}
			if (bet >= player.chips && player.chips > 0) {
				return applyTurnAction(player, { action: "allin", amount: player.chips });
			}
			const actual = player.placeBet(bet);
			if (actual > currentActionState.needToCall) {
				gameState.currentBet = player.roundBet;
				gameState.lastRaise = actual - currentActionState.needToCall;
				gameState.raisesThisRound++;
			}
			addToPot(actual);
			notifyPlayerAction(player, "raise", actual);
			return { action: "raise", amount: actual };
		}
		default:
			return null;
	}
}

function normalizeBotActionRequest(player, decision) {
	if (!player || !decision) {
		return null;
	}

	const actionState = getPlayerActionState(gameState, player);

	switch (decision.action) {
		case "fold":
		case "check":
			return { action: decision.action };
		case "call":
			return { action: "call", amount: Math.min(player.chips, actionState.needToCall) };
		case "raise": {
			let amount = Number.parseInt(decision.amount, 10);
			if (Number.isNaN(amount)) {
				return null;
			}
			if (amount < actionState.minRaise && amount < player.chips) {
				amount = Math.min(player.chips, actionState.minRaise);
			}
			return { action: "raise", amount };
		}
		default:
			return null;
	}
}

function getHumanAdvanceReason(action) {
	if (action === "fold") {
		return "fold";
	}
	if (action === "allin") {
		return "human-allin";
	}
	return "human";
}

function getHumanLogPrefix(action) {
	return action === "fold" ? "fold" : "human";
}

function runBotTurn({ player, cycles, anyUncalled, nextPlayer }) {
	setActiveTurnPlayer(player);
	hideActionControls();
	const nameEl = player.seat.querySelector("h3");
	clearSeatActionLabel(player, player.name);
	player.seat.classList.remove("checked", "called", "raised", "allin");
	nameEl.textContent = "thinking …";

	enqueueBotAction(() => {
		const decision = chooseBotAction(player, gameState);
		const actionRequest = normalizeBotActionRequest(player, decision);
		let resolvedAction = applyTurnAction(player, actionRequest);
		if (!resolvedAction) {
			logFlow("bot action fallback", {
				name: player.name,
				decision: decision?.action ?? null,
			});
			const fallbackActionState = getPlayerActionState(gameState, player);
			resolvedAction = applyTurnAction(
				player,
				fallbackActionState.canCheck ? { action: "check" } : { action: "fold" },
			);
		}
		continueAfterResolvedTurn({
			player,
			cycles,
			anyUncalled,
			nextPlayer,
			logPrefix: "bot",
			advanceReason: "bot",
		});
	});
}

function runHumanTurn({ player, cycles, anyUncalled, nextPlayer }) {
	setActiveTurnPlayer(player);
	actionButton.classList.remove("hidden");
	foldButton.classList.remove("hidden");
	amountSlider.classList.remove("hidden");
	sliderOutput.classList.remove("hidden");

	const actionState = getPlayerActionState(gameState, player);
	const pendingAction = setPendingAction(player);
	let remoteActionTimer = null;
	let remoteActionInFlight = false;
	let turnResolved = false;

	amountSlider.min = actionState.minAmount;
	amountSlider.max = actionState.maxAmount;
	amountSlider.step = CHIP_UNIT;
	amountSlider.value = actionState.minAmount;
	sliderOutput.value = actionState.minAmount;

	function onSliderInput() {
		const val = Number.parseInt(amountSlider.value, 10);
		sliderOutput.classList.toggle("invalid", isInvalidRaiseAmount(val, actionState));
		actionButton.textContent = getActionButtonLabel(val, actionState);
	}

	function onSliderChange() {
		const val = Number.parseInt(amountSlider.value, 10);
		const normalizedAmount = normalizeActionAmount(val, actionState);
		amountSlider.value = normalizedAmount;
		sliderOutput.value = normalizedAmount;
		sliderOutput.classList.remove("invalid");
		onSliderInput();
	}

	function cleanupHumanTurn() {
		player.seat.classList.remove("active");
		amountSlider.removeEventListener("input", onSliderInput);
		amountSlider.removeEventListener("change", onSliderChange);
		foldButton.removeEventListener("click", onFold);
		actionButton.removeEventListener("click", onAction);
		hideActionControls();
		if (remoteActionTimer !== null) {
			clearTimeout(remoteActionTimer);
			remoteActionTimer = null;
		}
	}

	function normalizeRemoteActionRequest(remoteAction) {
		if (
			!remoteAction ||
			remoteAction.seatIndex !== player.seatIndex ||
			remoteAction.turnToken !== pendingAction?.turnToken
		) {
			return null;
		}

		switch (remoteAction.action) {
			case "fold":
				return { action: "fold" };
			case "check":
				return actionState.canCheck ? getActionRequestForAmount(0, actionState) : null;
			case "call":
				return actionState.needToCall > 0
					? getActionRequestForAmount(
						Math.min(actionState.needToCall, player.chips),
						actionState,
					)
					: null;
			case "allin":
				return player.chips > 0 ? { action: "allin", amount: player.chips } : null;
			case "raise": {
				const amount = Number.parseInt(remoteAction.amount, 10);
				if (Number.isNaN(amount) || amount <= actionState.needToCall) {
					return null;
				}
				return getActionRequestForAmount(Math.min(amount, player.chips), actionState);
			}
			default:
				return null;
		}
	}

	function submitHumanTurn(actionRequest) {
		if (turnResolved || !actionRequest) {
			return false;
		}

		const resolvedAction = applyTurnAction(player, actionRequest);
		if (!resolvedAction) {
			return false;
		}

		turnResolved = true;
		clearPendingAction();
		cleanupHumanTurn();
		continueAfterResolvedTurn({
			player,
			cycles,
			anyUncalled,
			nextPlayer,
			logPrefix: getHumanLogPrefix(resolvedAction.action),
			advanceReason: getHumanAdvanceReason(resolvedAction.action),
		});
		return true;
	}

	function scheduleRemoteActionPoll() {
		if (!pendingAction?.turnToken || turnResolved) {
			return;
		}
		remoteActionTimer = setTimeout(pollRemoteAction, ACTION_POLL_INTERVAL);
	}

	async function pollRemoteAction() {
		remoteActionTimer = null;
		if (turnResolved || remoteActionInFlight || !pendingAction?.turnToken) {
			return;
		}

		remoteActionInFlight = true;
		try {
			const remoteAction = await fetchPendingRemoteAction(pendingAction.turnToken);
			if (turnResolved) {
				return;
			}
			const normalizedRequest = normalizeRemoteActionRequest(remoteAction);
			if (normalizedRequest) {
				submitHumanTurn(normalizedRequest);
				return;
			}
		} finally {
			remoteActionInFlight = false;
		}

		if (!turnResolved) {
			scheduleRemoteActionPoll();
		}
	}

	function onAction() {
		const amount = Number.parseInt(amountSlider.value, 10);
		if (Number.isNaN(amount)) {
			return;
		}
		const actionRequest = getActionRequestForAmount(amount, actionState);
		submitHumanTurn(actionRequest);
	}

	function onFold() {
		submitHumanTurn({ action: "fold" });
	}

	amountSlider.addEventListener("input", onSliderInput);
	amountSlider.addEventListener("change", onSliderChange);
	foldButton.addEventListener("click", onFold);
	actionButton.addEventListener("click", onAction);
	onSliderInput();
	if (pendingAction?.turnToken) {
		scheduleRemoteActionPoll();
	}
}

function startBettingRound() {
	// --- Round Reset -------------------------------------------------------------
	if (gameState.currentPhaseIndex > 0) {
		// Reset state for post-flop rounds before any checks/logging
		gameState.currentBet = 0;
		gameState.lastRaise = gameState.bigBlind;
		gameState.players.forEach((p) => p.resetRoundBet());
	}
	logFlow("startBettingRound", {
		phase: getCurrentPhase(gameState.currentPhaseIndex),
		currentBet: gameState.currentBet,
		lastRaise: gameState.lastRaise,
		order: gameState.players.map((p) => p.name),
	});
	// Clear action indicators from the previous betting round
	clearActiveTurnPlayer(false);
	gameState.players.forEach((p) => p.seat.classList.remove("checked", "called", "raised"));
	clearPendingAction();

	// --- Early Exit Checks -------------------------------------------------------
	// EARLY EXIT: Skip betting if only one player remains or all are all-in
	const activePlayers = gameState.players.filter((p) => !p.folded);
	const actionable = activePlayers.filter((p) => !p.allIn);
	if (activePlayers.length <= 1 || actionable.length <= 1) {
		logFlow("skip betting round", {
			active: activePlayers.length,
			actionable: actionable.length,
		});
		clearActiveTurnPlayer(false);
		clearPendingAction();
		return queueRunoutPhaseAdvance("startBettingRound");
	}

	// --- Start Index -------------------------------------------------------------
	// 2) Determine start index
	let startIdx;
	if (gameState.currentPhaseIndex === 0) {
		// UTG: first player left of big blind
		const bbIdx = gameState.players.findIndex((p) => p.bigBlind);
		startIdx = (bbIdx + 1) % gameState.players.length;
	} else {
		// first player left of dealer
		const dealerIdx = gameState.players.findIndex((p) => p.dealer);
		startIdx = (dealerIdx + 1) % gameState.players.length;
	}

	logFlow("betting start index", { index: startIdx, player: gameState.players[startIdx].name });

	gameState.raisesThisRound = 0;
	let idx = startIdx;
	let cycles = 0;

	function anyUncalled() {
		if (gameState.currentBet === 0) {
			// Post-flop: Prüfe ob alle Spieler schon dran waren
			return cycles < gameState.players.filter((p) => !p.folded && !p.allIn).length;
		}
		return gameState.players.some((p) =>
			!p.folded && !p.allIn && p.roundBet < gameState.currentBet
		);
	}

	// --- Turn Loop ----------------------------------------------------------------
	function nextPlayer() {
		// --- GLOBAL GUARD -------------------------------------------------
		// If no player can act anymore (all folded or all all-in),
		// the betting round is over and we advance the phase.
		const activePlayers = gameState.players.filter((p) => !p.folded);
		const actionablePlayers = activePlayers.filter((p) => !p.allIn);
		if (activePlayers.length <= 1 || actionablePlayers.length === 0) {
			logFlow("no actionable players, advance phase (nextPlayer)", {
				active: activePlayers.map((p) => ({
					name: p.name,
					allIn: p.allIn,
					roundBet: p.roundBet,
				})),
			});
			clearActiveTurnPlayer(false);
			clearPendingAction();
			return queueRunoutPhaseAdvance("nextPlayer");
		}

		// -------------------------------------------------------------------
		// Find next player who still owes action
		const player = gameState.players[idx % gameState.players.length];
		logFlow(
			"nextPlayer",
			{
				index: idx % gameState.players.length,
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
		if (player.roundBet >= gameState.currentBet) {
			logFlow("already matched bet", { name: player.name, cycles });
			// Allow one pass-through for Big Blind pre-flop or Check post-flop
			if (
				(gameState.currentPhaseIndex === 0 && cycles <= gameState.players.length) ||
				(gameState.currentPhaseIndex > 0 &&
					gameState.currentBet === 0 &&
					cycles <= gameState.players.length)
			) {
				// within first cycle: let them act
			} else {
				if (anyUncalled()) {
					logFlow("wait uncalled", { name: player.name });
					return setTimeout(nextPlayer, 0); // schedule asynchronously to break call chain
				}
				logFlow("advance phase", { name: player.name });
				clearActiveTurnPlayer(false);
				clearPendingAction();
				return queueRunoutPhaseAdvance("matched");
			}
		}

		// --- Bot Branch --------------------------------------------------------------
		// If this is a bot, choose an action based on hand strength
		if (player.isBot) {
			return runBotTurn({ player, cycles, anyUncalled, nextPlayer });
		}

		// --- Human Branch ------------------------------------------------------------
		return runHumanTurn({ player, cycles, anyUncalled, nextPlayer });
	}

	nextPlayer();
}

/* --------------------------------------------------------------------------------------------------
Showdown And Payout Flow
---------------------------------------------------------------------------------------------------*/

/**
 * Animate chip transfer from the pot display to a player's total chips.
 * amount   – integer to transfer
 * playerObj – player object to receive chips
 * onDone   – callback after animation completes
 */
function animateChipTransfer(amount, playerObj, onDone) {
	if (SPEED_MODE) {
		gameState.pot -= amount;
		renderPot();
		playerObj.chips += amount;
		playerObj.showTotal();

		if (onDone) onDone();
		return;
	}

	const steps = isTurboPlaybackActive() ? FAST_FORWARD_CHIP_TRANSFER_STEPS : 30;
	const totalDuration = isTurboPlaybackActive()
		? FAST_FORWARD_CHIP_TRANSFER_DURATION
		: Math.min(Math.max(amount * 20, 300), 3000);
	const delay = totalDuration / steps;
	const increment = Math.floor(amount / steps);
	const remainder = amount - increment * steps;
	let currentStep = 0;

	function step() {
		if (currentStep < steps) {
			gameState.pot -= increment;
			renderPot();
			playerObj.chips += increment;
			playerObj.showTotal();

			currentStep++;
			setTimeout(step, delay);
		} else {
			gameState.pot -= remainder;
			renderPot();
			playerObj.chips += remainder;
			playerObj.showTotal();

			if (onDone) onDone();
		}
	}
	step();
}

function finishHandAfterShowdown() {
	renderChipStacks(gameState.players);
	setPot(0);

	clearActiveTurnPlayer(false);

	gameState.handInProgress = false;
	clearPendingAction();
	hideActionControls();
	if (SPEED_MODE) {
		queueStateSync();
		preFlop();
		return;
	}
	if (autoplayToGameEnd) {
		queueStateSync();
		preFlop();
		return;
	}
	if (handFastForwardActive && getHumansWithChipsCount() === 0) {
		handFastForwardActive = false;
		autoplayToGameEnd = true;
		syncRuntimePlayback();
		updateFastForwardButton();
		queueStateSync();
		preFlop();
		return;
	}
	handFastForwardActive = false;
	syncRuntimePlayback();
	updateFastForwardButton();
	renderStatsOverlay();
	setSummaryButtonsVisible(true);
	startButton.textContent = "New Round";
	startButton.classList.remove("hidden");
	queueStateSync();
}

function doShowdown() {
	// --- Active Players And Showdown State ---------------------------------------
	// Reset round bets now that they are in the pot
	gameState.players.forEach((p) => p.resetRoundBet());

	// Filter active players
	const activePlayers = gameState.players.filter((p) => !p.folded);
	const contributors = gameState.players.filter((p) => p.totalBet > 0);

	const hadShowdown = activePlayers.length > 1;
	if (hadShowdown) {
		activePlayers.forEach((p) => p.stats.showdowns++);
	}

	// Reveal hole cards of all active players
	if (activePlayers.length > 1) {
		revealActiveHoleCards();
	}

	// --- Single Winner Path ------------------------------------------------------
	// Single-player case: immediate win (no hand needed)
	if (activePlayers.length === 1) {
		const winner = activePlayers[0];
		const communityCards = getCommunityCardCodes();
		const totalPayoutByPlayer = new Map([[winner, gameState.pot]]);
		const revealedPlayers = new Set();
		const revealDecision = getBotRevealDecision(winner, communityCards);
		winner.stats.handsWon++;
		winner.isWinner = true;
		renderSeatWinnerState(winner, true);
		winner.seat.classList.remove("active");
		if (revealDecision) {
			revealedPlayers.add(winner);
			applyBotReveal(winner, revealDecision);
			registerBotReveal(winner);
			enqueueNotification(
				`${winner.name} reveals ${revealDecision.codes.map(formatCardLabel).join(" ")}`,
			);
		} else {
			winner.qr.hide();
		}
		triggerMainPotWinnerReactions({
			activePlayerCount: activePlayers.length,
			bigBlind: gameState.bigBlind,
			communityCards,
			contributors,
			hadShowdown,
			mainPotWinnerCount: 1,
			mainPotWinners: [winner],
			revealedPlayers,
			totalPayoutByPlayer,
		});
		queueStateSync(0);
		enqueueNotification(`${winner.name} wins ${gameState.pot}!`);
		animateChipTransfer(gameState.pot, winner, () => {
			finishHandAfterShowdown();
		});
		return;
	}

	const communityCards = getCommunityCardCodes();

	// --- Side Pot Construction ---------------------------------------------------
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
	let mainPotWinners = [];

	// --- Pot Evaluation ----------------------------------------------------------
	// ---- Evaluate each side pot ----
	// Collect results for notification consolidation
	const potResults = [];
	sidePots.forEach((sp, potIdx) => {
		const spHands = sp.eligible
			.filter((p) => !p.folded) // only players still in the hand can win
			.map((p) => {
				const seven = [...p.holeCards, ...communityCards];
				return { player: p, handObj: Hand.solve(seven) };
			});

		// --- If only one player is eligible for this pot, refund/award it immediately ---
		if (sp.eligible.filter((p) => !p.folded).length === 1) {
			const solePlayer = sp.eligible.find((p) => !p.folded);
			if (potIdx === 0) {
				mainPotWinners = [solePlayer];
			}
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
		const potWinners = winners.map((winnerHand) => {
			const winnerEntry = spHands.find((h) => h.handObj === winnerHand);
			return winnerEntry.player;
		});
		// Use odd-chip payouts here so split pots stay on 10-chip stacks.
		const splitPayouts = buildSplitPayouts(
			sp.amount,
			potWinners,
			gameState.players,
			CHIP_UNIT,
		);
		if (potIdx === 0) {
			mainPotWinners = potWinners.slice();
		}

		winners.forEach((w) => {
			const entry = spHands.find((h) => h.handObj === w);
			const payout = splitPayouts.get(entry.player) || 0;
			transferQueue.push({ player: entry.player, amount: payout });
			if (!winnersSet.has(entry.player)) {
				entry.player.stats.handsWon++;
				if (hadShowdown) entry.player.stats.showdownsWon++;
				winnersSet.add(entry.player);
			}
			// Highlight winners only for the main pot
			if (potIdx === 0) {
				entry.player.isWinner = true;
				renderSeatWinnerState(entry.player, true);
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

	// --- Notification Consolidation ----------------------------------------------
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

	const totalPayoutByPlayer = transferQueue.reduce((payouts, transfer) => {
		const currentTotal = payouts.get(transfer.player) || 0;
		payouts.set(transfer.player, currentTotal + transfer.amount);
		return payouts;
	}, new Map());
	triggerMainPotWinnerReactions({
		activePlayerCount: activePlayers.length,
		bigBlind: gameState.bigBlind,
		communityCards,
		contributors,
		hadShowdown,
		mainPotWinnerCount: mainPotWinners.length,
		mainPotWinners,
		revealedPlayers: new Set(),
		totalPayoutByPlayer,
	});
	queueStateSync(0);

	// --- Payout Animation --------------------------------------------------------
	// run all chip transfers in parallel
	Promise.all(
		transferQueue.map((t) =>
			new Promise((resolve) => {
				animateChipTransfer(t.amount, t.player, resolve);
			})
		),
	).then(() => {
		finishHandAfterShowdown();
	});
	return; // exit doShowdown early because UI flow continues in animation
}

/* --------------------------------------------------------------------------------------------------
Seat-Editing Helpers
---------------------------------------------------------------------------------------------------*/

function rotateSeat(ev) {
	const seat = ev.target.parentElement.parentElement;
	seat.dataset.rotation = parseInt(seat.dataset.rotation) + 90;
	seat.style.transform = "rotate(" + seat.dataset.rotation + "deg)";
}

function deletePlayer(ev) {
	const seat = ev.target.parentElement.parentElement;
	seat.classList.add("hidden");
}

/* --------------------------------------------------------------------------------------------------
App Bootstrap And Public API
---------------------------------------------------------------------------------------------------*/

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
	document.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape") {
			closeAllOverlays();
		}
	}, false);
	startButton.addEventListener("click", startGame, false);
	instructionsButton.addEventListener("click", () => openOverlay("instructions"), false);
	notification.addEventListener("click", () => openOverlay("log"), false);
	statsButton.addEventListener("click", () => openOverlay("stats"), false);
	logButton.addEventListener("click", () => openOverlay("log"), false);
	fastForwardButton.addEventListener("click", activateFastForward, false);
	statsCloseButton.addEventListener("click", () => closeOverlay("stats"), false);
	logCloseButton.addEventListener("click", () => closeOverlay("log"), false);
	instructionsCloseButton.addEventListener("click", () => closeOverlay("instructions"), false);
	overlayBackdrop.addEventListener("click", closeAllOverlays, false);
	globalThis.addEventListener("pagehide", () => trackUnfinishedExit(), false);
	globalThis.addEventListener("beforeunload", () => trackUnfinishedExit(), false);
	renderPot();
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);

	for (const rotateIcon of rotateIcons) {
		rotateIcon.addEventListener("click", rotateSeat, false);
	}
	for (const closeButton of closeButtons) {
		closeButton.addEventListener("click", deletePlayer, false);
	}
}

globalThis.poker = {
	init,
	get players() {
		return gameState.allPlayers;
	},
	get reveals() {
		return gameState.allPlayers.map((player) => ({
			name: player.name,
			reveals: player.stats.reveals,
		}));
	},
};

poker.init();

/* --------------------------------------------------------------------------------------------------
 * Service Worker configuration
 * - USE_SERVICE_WORKER: enable or disable SW for this project
 * - SERVICE_WORKER_VERSION: bump to force new SW and new cache
 * - AUTO_RELOAD_ON_SW_UPDATE: reload page once after an update
 -------------------------------------------------------------------------------------------------- */
const USE_SERVICE_WORKER = true;
const SERVICE_WORKER_VERSION = "2026-03-27-v3";
const AUTO_RELOAD_ON_SW_UPDATE = true;

initServiceWorker({
	useServiceWorker: USE_SERVICE_WORKER,
	serviceWorkerVersion: SERVICE_WORKER_VERSION,
	autoReloadOnUpdate: AUTO_RELOAD_ON_SW_UPDATE,
});
