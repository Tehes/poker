/* ==================================================================================================
MODULE BOUNDARY: Main Table Runtime
================================================================================================== */

// CURRENT STATE: Coordinates browser-facing game flow, bots, sync, timers, analytics, and DOM
// effects. Showdown resolution is now extracted, but some setup and betting-round orchestration
// still remains here as legacy transition code.
// TARGET STATE: app.js should stay as the browser-facing orchestrator only. Pure poker rules and
// state transforms should live in gameEngine.js, while reusable UI, sync, and control primitives
// should live in shared/*.
// PUT HERE: Engine orchestration, notifications, timers, sync, analytics, bot playback, and DOM
// side effects.
// DO NOT PUT HERE: Pure poker rules, reusable action math, sync schema helpers, or generic
// render-only helpers.
// PREFERENCE: Extend the existing modules before introducing new ones.

/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

import {
	chooseBotAction,
	enqueueBotAction,
	setBotPlaybackFast,
} from "./bot.js";
import {
	calculateWinProbabilities,
	createHandContextState,
	createPlayerSpotState,
	getBettingRoundStartIndex,
	getBigBlindForLevel,
	getBlindLevelForHand,
	getBlindSeatIndexes,
	getBotRevealDecision,
	getCurrentPhase,
	getNextDealerIndex,
	getPlayerActionFollowUpEffects,
	getVisibleSolvedHand,
	INITIAL_BIG_BLIND,
	INITIAL_DECK,
	INITIAL_SMALL_BLIND,
	isAllInRunout,
	recordPlayerActionStats,
	resolveShowdown,
	shuffleArray,
	takeDeckCard,
	trackUsedCard,
} from "./gameEngine.js";
import QrCreator from "./qr-creator.js";
import {
	getActionButtonLabel,
	getPlayerActionState,
} from "./shared/actionModel.js";
import { createHumanTurnController } from "./shared/humanTurnController.js";
import {
	buildPublicPlayerView,
	buildSyncView,
} from "./shared/syncViewModel.js";
import {
	clearChipTransferAnimation,
	renderChipStacks,
	renderChipTransferAnimation,
	renderCommunityCards as renderTableCommunityCards,
	renderHostSeat,
	renderNotificationBar,
	renderSeatResolvedAction,
} from "./shared/tableViewRenderer.js";
import { initServiceWorker } from "./serviceWorkerRegistration.js";
import { APP_VERSION, VERSION_LOG } from "./version.js";

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
const amountControls = document.querySelector("#amount-controls");
const amountDecrementButton = document.querySelector(
	"#amount-decrement-button",
);
const statsButton = document.querySelector("#stats-button");
const logButton = document.querySelector("#log-button");
const fastForwardButton = document.querySelector("#fast-forward-button");
const potEl = document.getElementById("pot");
const communityCardSlots = document.querySelectorAll(
	"#community-cards .cardslot",
);
const tableRenderTarget = {
	potEl,
	chipTransferTimer: null,
	activeChipTransferId: null,
	activeChipTransferState: null,
};
const overlayBackdrop = document.querySelector("#overlay-backdrop");
const statsOverlay = document.querySelector("#stats-overlay");
const statsCloseButton = document.querySelector("#stats-close-button");
const statsTableBody = document.querySelector("#stats-table-body");
const logOverlay = document.querySelector("#log-overlay");
const logCloseButton = document.querySelector("#log-close-button");
const versionButton = document.querySelector("#version-button");
const versionOverlay = document.querySelector("#version-overlay");
const versionCloseButton = document.querySelector("#version-close-button");
const versionList = document.querySelector("#version-list");
const instructionsOverlay = document.querySelector("#instructions-overlay");
const instructionsCloseButton = document.querySelector(
	"#instructions-close-button",
);
const logList = document.querySelector("#log-list");
const amountSlider = document.querySelector("#amount-slider");
const amountIncrementButton = document.querySelector(
	"#amount-increment-button",
);
const sliderOutput = document.querySelector("output");
const seatRefs = Array.from(document.querySelectorAll(".seat")).map((
	seatEl,
	seatSlot,
) => ({
	seatSlot,
	seatEl,
	nameEl: seatEl.querySelector("h3"),
	totalEl: seatEl.querySelector(".chips .total"),
	betEl: seatEl.querySelector(".chips .bet"),
	stackChipEls: seatEl.querySelectorAll(".stack-visual img"),
	dealerEl: seatEl.querySelector(".dealer"),
	smallBlindEl: seatEl.querySelector(".small-blind"),
	bigBlindEl: seatEl.querySelector(".big-blind"),
	winProbabilityEl: seatEl.querySelector(".win-probability"),
	handStrengthEl: seatEl.querySelector(".hand-strength"),
	cardEls: seatEl.querySelectorAll(".card"),
	qrContainer: seatEl.querySelector(".qr"),
	qrLink: seatEl.querySelector(".qr-link"),
	remoteLink: seatEl.querySelector(".remote-table-link"),
	winnerReactionEl: seatEl.querySelector(".winner-reaction"),
	winnerReactionTimer: null,
	actionLabelTimer: null,
	clearActionLabelState: null,
	clearWinnerReactionState: null,
}));
const overlays = {
	stats: {
		el: statsOverlay,
		beforeOpen: () => renderStatsOverlay(),
	},
	log: {
		el: logOverlay,
		canOpen: () => !!logList && logList.childElementCount > 0,
	},
	version: {
		el: versionOverlay,
		beforeOpen: () => renderVersionOverlay(),
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
const DEFAULT_CHIP_TRANSFER_STEPS = 30;
const WINNER_REACTION_DURATION = 2000;

const HISTORY_LOG = false; // Set to true to enable history logging in the console
let DEBUG_FLOW = false; // Set to true for verbose game-flow logging
const CHIP_UNIT = 10;

const speedModeParam = new URLSearchParams(globalThis.location.search).get(
	"speedmode",
);
const SPEED_MODE = speedModeParam !== null && speedModeParam !== "0" &&
	speedModeParam !== "false";
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
let chipTransferFinishTimer = null;
let summaryButtonsVisible = false;
let handFastForwardActive = false;
let autoplayToGameEnd = false;
let nextChipTransferId = 1;

// --- Analytics --------------------------------------------------------------
let totalHands = 0;
let hadHumansAtStart = false;
let exitEventSent = false;

/* --------------------------------------------------------------------------------------------------
Game Constants And Game State
---------------------------------------------------------------------------------------------------*/

const WINNER_REACTION_EMOJIS = {
	reveal: ["😉", "😜", "🤭"],
	uncontested: ["😎", "😏", "😌"],
	split: ["🤝"],
	lucky: ["🥹", "😆", "😮‍💨"],
	comeback: ["💪", "😅"],
	monsterHand: ["🤩", "🥳"],
	strongHand: ["😁", "😄", "😬"],
	bigPot: ["🤑"],
	fallback: ["🙂", "😊"],
};
const WINNER_REACTION_MONSTER_HANDS = new Set([
	"Full House",
	"Four of a Kind",
	"Straight Flush",
]);
const WINNER_REACTION_STRONG_HANDS = new Set(["Straight", "Flush"]);
const WINNER_REACTION_LUCKY_MIN_GAP = 15;
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
	handId: 0,
	nextDecisionId: 1,
	blindLevel: 0,
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
	chipTransfer: null,
	pendingAction: null,
	smallBlind: INITIAL_SMALL_BLIND,
	bigBlind: INITIAL_BIG_BLIND,
	lastRaise: INITIAL_BIG_BLIND,
	handContext: createHandContextState(),
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
		blindLevel: this.blindLevel,
		handContext: this.handContext ? { ...this.handContext } : null,
		communityCards: this.communityCards.slice(),
		pendingAction: this.pendingAction ? { ...this.pendingAction } : null,
		players: this.players,
		timestamp: Date.now(),
	};
};

function resetPlayerSpotStateForHand(player) {
	player.spotState = createPlayerSpotState();
}

function resetPlayerSpotStateForStreet(player) {
	if (!player.spotState) {
		resetPlayerSpotStateForHand(player);
		return;
	}
	player.spotState.actedThisStreet = false;
	player.spotState.voluntaryThisStreet = false;
	player.spotState.aggressiveThisStreet = false;
}

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

function logSpeedmodeEvent(type, payload) {
	if (!SPEED_MODE) {
		return;
	}
	console.log("speedmode_event", { type, ...payload });
}

function buildSpeedmodeHandStartPlayers(players) {
	return players.map((player) => ({
		name: player.name,
		seatIndex: player.seatIndex,
		chipsStart: player.chips,
	}));
}

function buildSpeedmodeTotalBetByPlayer(contributors) {
	return contributors.reduce((totals, player) => {
		totals[player.name] = player.totalBet;
		return totals;
	}, {});
}

function buildSpeedmodeTotalBetBySeatIndex(contributors) {
	return contributors.reduce((totals, player) => {
		totals[player.seatIndex] = player.totalBet;
		return totals;
	}, {});
}

function buildSpeedmodePayoutByPlayer(totalPayoutByPlayer) {
	const payouts = {};
	for (const [player, amount] of totalPayoutByPlayer.entries()) {
		payouts[player.name] = amount;
	}
	return payouts;
}

function buildSpeedmodePayoutBySeatIndex(totalPayoutByPlayer) {
	const payouts = {};
	for (const [player, amount] of totalPayoutByPlayer.entries()) {
		payouts[player.seatIndex] = amount;
	}
	return payouts;
}

function createPageUrl(pageName) {
	const base = globalThis.location.origin +
		globalThis.location.pathname.replace(/[^/]*$/, "");
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
Seat And Player Binding Helpers
---------------------------------------------------------------------------------------------------*/

function getSeatRef(target) {
	if (typeof target === "number") {
		return seatRefs[target] ?? null;
	}
	if (!target) {
		return null;
	}
	if (target.seatEl) {
		return target;
	}
	if (typeof target.seatSlot === "number") {
		return seatRefs[target.seatSlot] ?? null;
	}
	return null;
}

function getPlayerSeatEl(player) {
	return getSeatRef(player)?.seatEl ?? null;
}

function getPlayerNameEl(player) {
	return getSeatRef(player)?.nameEl ?? null;
}

function setPlayerActionState(player, actionName, labelUntil) {
	if (!player || !actionName || !Number.isFinite(labelUntil)) {
		clearPlayerActionState(player);
		return;
	}
	player.actionState = {
		name: actionName,
		labelUntil,
	};
}

function clearPlayerActionState(player) {
	if (!player) {
		return;
	}
	player.actionState = null;
}

function clearPlayerWinnerReactionState(player) {
	player.winnerReactionEmoji = "";
	player.winnerReactionUntil = 0;
}

function bindSeatRefPlayer(player) {
	const seatRef = getSeatRef(player);
	if (!seatRef) {
		return;
	}
	seatRef.clearActionLabelState = () => clearPlayerActionState(player);
	seatRef.clearWinnerReactionState = () =>
		clearPlayerWinnerReactionState(player);
}

function buildPlayerSeatState(
	player,
	communityCards = getCommunityCardCodes(),
) {
	const publicPlayerView = buildPublicPlayerView(
		player,
		communityCards,
		gameState,
	);
	const winProbabilityLabel = publicPlayerView.showWinProbability &&
			typeof publicPlayerView.winProbability === "number"
		? `${Math.round(publicPlayerView.winProbability)}%`
		: "";

	return {
		name: publicPlayerView.name,
		chips: publicPlayerView.chips,
		roundBet: publicPlayerView.roundBet,
		visibleCardCodes: publicPlayerView.publicHoleCards,
		dealer: publicPlayerView.dealer,
		smallBlind: publicPlayerView.smallBlind,
		bigBlind: publicPlayerView.bigBlind,
		folded: publicPlayerView.folded,
		allIn: publicPlayerView.allIn,
		winner: publicPlayerView.winner,
		handStrengthLabel: publicPlayerView.handStrengthLabel,
		winProbabilityLabel,
		actionState: publicPlayerView.actionState,
		winnerReaction: publicPlayerView.winnerReaction,
	};
}

function renderPlayerSeat(player, communityCards = getCommunityCardCodes()) {
	const seatRef = getSeatRef(player);
	if (!seatRef) {
		return;
	}
	renderHostSeat(seatRef, buildPlayerSeatState(player, communityCards));
}

function renderPlayerResolvedAction(player) {
	const seatRef = getSeatRef(player);
	if (!seatRef) {
		return;
	}
	renderSeatResolvedAction(seatRef, {
		playerName: player.name,
		actionName: player.actionState?.name,
		labelUntil: player.actionState?.labelUntil,
		isFolded: player.folded,
	});
}

function getPlayerSeatRenderData(playerList = gameState.players) {
	return playerList
		.map((player) => {
			const seatRef = getSeatRef(player);
			if (!seatRef) {
				return null;
			}
			return {
				seatIndex: player.seatIndex,
				chips: player.chips,
				totalEl: seatRef.totalEl,
				stackChipEls: seatRef.stackChipEls,
			};
		})
		.filter((playerView) => playerView !== null);
}

function renderPlayerChipStacks(playerList = gameState.players) {
	renderChipStacks(getPlayerSeatRenderData(playerList));
}

function renderPlayerTotal(player) {
	renderPlayerSeat(player);
}

function getRoleFlagName(role) {
	return role.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function setPlayerRoleVisibility(player, role, isVisible) {
	const seatRef = getSeatRef(player);
	const flagName = getRoleFlagName(role);
	player[flagName] = isVisible;
	seatRef?.[`${flagName}El`]?.classList.toggle("hidden", !isVisible);
}

function assignPlayerRole(player, role) {
	setPlayerRoleVisibility(player, role, true);
}

function clearPlayerRole(player, role) {
	setPlayerRoleVisibility(player, role, false);
}

function addPlayerSeatClasses(player, ...classNames) {
	const seatEl = getPlayerSeatEl(player);
	if (!seatEl) {
		return;
	}
	seatEl.classList.add(...classNames);
}

function removePlayerSeatClasses(player, ...classNames) {
	const seatEl = getPlayerSeatEl(player);
	if (!seatEl) {
		return;
	}
	seatEl.classList.remove(...classNames);
}

function setPlayerSeatName(player, text) {
	const nameEl = getPlayerNameEl(player);
	if (!nameEl) {
		return;
	}
	nameEl.textContent = text;
}

function showPlayerQr(player, card1, card2) {
	const seatRef = getSeatRef(player);
	if (!seatRef?.qrContainer || !seatRef.qrLink || !seatRef.remoteLink) {
		return;
	}

	seatRef.qrContainer.classList.remove("hidden");
	const holeCardsUrl = createPageUrl("hole-cards.html");
	holeCardsUrl.searchParams.set("card1", card1);
	holeCardsUrl.searchParams.set("card2", card2);
	holeCardsUrl.searchParams.set("name", player.name);
	holeCardsUrl.searchParams.set("chips", `${player.chips}`);
	holeCardsUrl.searchParams.set("seatIndex", `${player.seatIndex}`);
	if (tableId !== null) {
		holeCardsUrl.searchParams.set("tableId", tableId);
	}
	holeCardsUrl.searchParams.set("t", `${Date.now()}`);
	const url = holeCardsUrl.toString();
	seatRef.qrLink.replaceChildren();
	seatRef.qrLink.href = url;
	QrCreator.render({
		text: url,
		size: 200,
		fill: "#333",
		background: "#fff",
		radius: 0,
	}, seatRef.qrLink);

	if (tableId !== null) {
		const remoteTableUrl = createPageUrl("remoteTable.html");
		remoteTableUrl.searchParams.set("tableId", tableId);
		remoteTableUrl.searchParams.set("seatIndex", `${player.seatIndex}`);
		seatRef.remoteLink.href = remoteTableUrl.toString();
		seatRef.remoteLink.classList.remove("hidden");
	} else {
		seatRef.remoteLink.removeAttribute("href");
		seatRef.remoteLink.classList.add("hidden");
	}

	seatRef.qrContainer.dataset.url = url;
}

function hidePlayerQr(player) {
	const seatRef = getSeatRef(player);
	if (!seatRef?.qrContainer || !seatRef.qrLink || !seatRef.remoteLink) {
		return;
	}

	seatRef.qrContainer.classList.add("hidden");
	seatRef.qrLink.replaceChildren();
	seatRef.qrLink.removeAttribute("href");
	seatRef.remoteLink.removeAttribute("href");
	seatRef.remoteLink.classList.add("hidden");
	delete seatRef.qrContainer.dataset.url;
}

function placePlayerBet(player, amount) {
	const bet = Math.min(amount, player.chips);
	player.roundBet += bet;
	player.totalBet += bet;
	player.chips -= bet;
	if (player.chips === 0) {
		player.allIn = true;
	}
	renderPlayerSeat(player);
	return bet;
}

function resetPlayerRoundBet(player) {
	player.roundBet = 0;
	renderPlayerSeat(player);
}

function clearPlayerActionLabel(player) {
	clearPlayerActionState(player);
	renderPlayerResolvedAction(player);
}

function clearPlayerWinnerReaction(player) {
	clearPlayerWinnerReactionState(player);
	renderPlayerSeat(player);
}

function showPlayerWinnerReaction(player, emoji, visibleUntil) {
	player.winnerReactionEmoji = emoji;
	player.winnerReactionUntil = visibleUntil;
	renderPlayerSeat(player);
}

function renderPlayerWinnerState(player, isWinner = false) {
	player.isWinner = isWinner === true;
	renderPlayerSeat(player);
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
	renderPlayerSeat(player);
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
			createStatsCell(
				"td",
				formatPercent(player.stats.handsWon, player.stats.hands),
			),
		);
		row.appendChild(createStatsCell("td", player.stats.showdowns));
		row.appendChild(createStatsCell("td", player.stats.showdownsWon));
		row.appendChild(
			createStatsCell(
				"td",
				formatPercent(
					player.stats.showdownsWon,
					player.stats.showdowns,
				),
			),
		);
		row.appendChild(createStatsCell("td", player.stats.folds));
		row.appendChild(createStatsCell("td", player.stats.foldsPreflop));
		row.appendChild(createStatsCell("td", player.stats.foldsPostflop));
		row.appendChild(createStatsCell("td", player.stats.allins));
		statsTableBody.appendChild(row);
	});
}

function renderVersionOverlay() {
	if (!versionList) {
		return;
	}

	versionList.replaceChildren();
	VERSION_LOG.forEach((entry) => {
		const versionEntry = document.createElement("article");
		versionEntry.className = "version-entry";

		const heading = document.createElement("div");
		heading.className = "version-entry-heading";

		const versionLabel = document.createElement("h3");
		versionLabel.className = "version-entry-version";
		versionLabel.textContent = `v${entry.version}`;
		heading.appendChild(versionLabel);

		const title = document.createElement("p");
		title.className = "version-entry-title";
		title.textContent = entry.title;
		heading.appendChild(title);

		const meta = document.createElement("span");
		meta.className = "version-entry-meta";
		meta.textContent = entry.date;

		const notes = document.createElement("ul");
		notes.className = "version-entry-notes";
		entry.notes.forEach((note) => {
			const noteItem = document.createElement("li");
			noteItem.textContent = note;
			notes.appendChild(noteItem);
		});

		heading.appendChild(meta);
		versionEntry.appendChild(heading);
		versionEntry.appendChild(notes);
		versionList.appendChild(versionEntry);
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

function getPlayerActionNotificationText(playerName, actionName, amount = 0) {
	switch (actionName) {
		case "fold":
			return `${playerName} folded.`;
		case "check":
			return `${playerName} checked.`;
		case "call":
			return `${playerName} called ${amount}.`;
		case "raise":
			return `${playerName} raised to ${amount}.`;
		case "allin":
			return `${playerName} is all-in.`;
		default:
			return `${playerName} did something…`;
	}
}

function logSkippedPlayerActionProbability(
	player,
	action,
	skipProbabilityLogReason,
) {
	switch (skipProbabilityLogReason) {
		case "allin-runout-preflop":
			logFlow("winProbability: preflop all-in runout pending", {
				action,
				name: player.name,
			});
			break;
		case "fold-preflop":
			logFlow("winProbability: preflop fold skipped", {
				name: player.name,
			});
			break;
	}
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

function clearChipTransferFinishTimer() {
	if (chipTransferFinishTimer === null) {
		return;
	}
	clearTimeout(chipTransferFinishTimer);
	chipTransferFinishTimer = null;
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
		clearPlayerActionLabel(player);
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
	if (
		!gameState.handInProgress || handFastForwardActive ||
		autoplayToGameEnd || SPEED_MODE
	) {
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

/* --------------------------------------------------------------------------------------------------
Analytics And Remote State-Sync Helpers
---------------------------------------------------------------------------------------------------*/

function getHandsPlayedBucket(handCount) {
	if (handCount < 35) return "<35";
	if (handCount <= 40) return "36-40";
	if (handCount <= 45) return "41-45";
	if (handCount <= 50) return "46-50";
	if (handCount <= 55) return "51-55";
	if (handCount <= 60) return "56-60";
	if (handCount <= 70) return "61-70";
	if (handCount <= 80) return "71-80";
	if (handCount <= 90) return "81-90";
	if (handCount <= 100) return "91-100";
	if (handCount <= 120) return "101-120";
	return ">120";
}

function getExitCounts() {
	const humansWithChipsAtExit =
		gameState.players.filter((p) => !p.isBot && p.chips > 0).length;
	const botsWithChipsAtExit =
		gameState.players.filter((p) => p.isBot && p.chips > 0).length;
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
	const exitCategory = humansWithChipsAtExit === 0
		? "last_human_bust"
		: "humans_left_with_chips";
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
	tableId = tableUrl.searchParams.get("tableId") ||
		Math.random().toString(36).slice(2, 8);
	syncTableUrlWithState();
}

function createTurnToken() {
	return `${Date.now().toString(36)}${
		Math.random().toString(36).slice(2, 8)
	}`;
}

function setPendingAction(player) {
	if (
		!hasStateSyncEnabled() || !player || player.isBot || player.folded ||
		player.allIn
	) {
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

async function fetchPendingRemoteAction(turnToken) {
	if (!hasStateSyncEnabled() || !turnToken) {
		return null;
	}

	try {
		const url = `${ACTION_SYNC_ENDPOINT}?tableId=${
			encodeURIComponent(tableId)
		}&turnToken=${encodeURIComponent(turnToken)}`;
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
		view: buildSyncView(gameState, notifArr.slice(0, MAX_ITEMS)),
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

const humanTurnController = createHumanTurnController({
	foldButton,
	actionButton,
	amountControls,
	amountSlider,
	sliderOutput,
	decrementButton: amountDecrementButton,
	incrementButton: amountIncrementButton,
	actionPollInterval: ACTION_POLL_INTERVAL,
	actionStep: CHIP_UNIT,
	onControlsHidden: updateFastForwardButton,
	setActiveTurnPlayer,
	setPendingAction,
	clearPendingAction,
	fetchPendingRemoteAction,
	applyTurnAction,
	continueAfterResolvedTurn,
	getPlayerActionState: (player) => getPlayerActionState(gameState, player),
	getResolvedTurnMeta,
});

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

function revealActiveHoleCards() {
	gameState.players.filter((p) => !p.folded).forEach((p) => {
		revealPlayerHoleCards(p);
		hidePlayerQr(p);
	});
	updateHandStrengthDisplays();
}

function formatCardLabel(cardCode) {
	if (!cardCode || cardCode.length < 2) {
		return "";
	}
	const rank = cardCode[0] === "T" ? "10" : cardCode[0];
	const suit = CARD_SUIT_SYMBOLS[cardCode[1]] || cardCode[1];
	return `${rank}${suit}`;
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
	hidePlayerQr(player);
	updateHandStrengthDisplays();
}

function getLuckyWinnerReactionGap(player, showdownPlayers = []) {
	const playerSnapshot = player?.lastNonFinalWinProbability;
	if (typeof playerSnapshot !== "number" || !Array.isArray(showdownPlayers)) {
		return null;
	}

	let hasOtherSnapshot = false;
	let highestSnapshot = playerSnapshot;
	showdownPlayers.forEach((showdownPlayer) => {
		if (showdownPlayer === player) {
			return;
		}
		const showdownSnapshot = showdownPlayer?.lastNonFinalWinProbability;
		if (typeof showdownSnapshot !== "number") {
			return;
		}
		hasOtherSnapshot = true;
		if (showdownSnapshot > highestSnapshot) {
			highestSnapshot = showdownSnapshot;
		}
	});

	if (!hasOtherSnapshot || playerSnapshot === highestSnapshot) {
		return null;
	}

	return highestSnapshot - playerSnapshot;
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

	if (context.hadShowdown) {
		const luckyGap = getLuckyWinnerReactionGap(
			player,
			context.showdownPlayers,
		);
		if (
			luckyGap !== null &&
			luckyGap >= WINNER_REACTION_LUCKY_MIN_GAP
		) {
			return getRandomItem(WINNER_REACTION_EMOJIS.lucky);
		}
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
		showPlayerWinnerReaction(player, emoji, visibleUntil);
		queueStateSync(0);
	});
}

function updateHandStrengthDisplays() {
	const communityCards = getCommunityCardCodes();
	gameState.players.forEach((player) =>
		renderPlayerSeat(player, communityCards)
	);
}

function updateWinProbabilityDisplays() {
	const communityCards = getCommunityCardCodes();
	gameState.players.forEach((player) =>
		renderPlayerSeat(player, communityCards)
	);
}

function computeSpectatorWinProbabilities(reason = "") {
	if (
		!gameState.spectatorMode &&
		!isAllInRunout(gameState.players, gameState.currentBet)
	) {
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
	const result = calculateWinProbabilities(
		gameState.players,
		communityCards,
		gameState.deck,
	);

	if (result.status === "invalid_board") {
		logFlow("winProbability: invalid board state", {
			communityCards,
			missingCount,
		});
		return;
	}

	if (result.status === "no_players") {
		updateWinProbabilityDisplays();
		return;
	}

	if (result.status === "too_many_boards") {
		logFlow("winProbability: skipped heavy enumeration", {
			phase: getCurrentPhase(gameState.currentPhaseIndex),
			reason,
			missingCount,
			totalBoards: result.totalBoards,
			deckSize: gameState.deck.length,
		});
		updateWinProbabilityDisplays();
		return;
	}

	if (result.status === "no_boards") {
		logFlow("winProbability: no boards to evaluate", {
			deckSize: gameState.deck.length,
			missingCount,
		});
		updateWinProbabilityDisplays();
		return;
	}

	result.activePlayers.forEach((player) => {
		player.winProbability = result.probabilities.get(player) ?? null;
		if (missingCount > 0 && typeof player.winProbability === "number") {
			player.lastNonFinalWinProbability = player.winProbability;
		}
	});

	updateWinProbabilityDisplays();

	logFlow("winProbability", {
		phase: getCurrentPhase(gameState.currentPhaseIndex),
		reason,
		missingCount,
		totalBoards: result.totalBoards,
		boards: result.boardsSeen,
		players: result.activePlayers.map((player) => ({
			name: player.name,
			winProbability: Number(player.winProbability.toFixed(2)),
		})),
	});
}

/* --------------------------------------------------------------------------------------------------
Game Setup And Hand Lifecycle
---------------------------------------------------------------------------------------------------*/

function startGame(event) {
	if (!gameState.gameStarted) {
		resetRuntimeFastForward();
		totalHands = 0;
		gameState.handId = 0;
		gameState.nextDecisionId = 1;
		gameState.blindLevel = 0;
		gameState.smallBlind = INITIAL_SMALL_BLIND;
		gameState.bigBlind = INITIAL_BIG_BLIND;
		gameState.lastRaise = INITIAL_BIG_BLIND;
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
	let botIndex = 1;
	for (const seatRef of seatRefs) {
		seatRef.clearActionLabelState = null;
		seatRef.clearWinnerReactionState = null;
		if (seatRef.seatEl.classList.contains("hidden")) {
			continue;
		}
		if (seatRef.nameEl.textContent.trim() === "") {
			seatRef.nameEl.textContent = `Bot ${botIndex++}`;
			seatRef.seatEl.classList.add("bot");
		}
	}

	const activeSeatRefs = seatRefs.filter((seatRef) =>
		!seatRef.seatEl.classList.contains("hidden")
	);
	for (const seatRef of activeSeatRefs) {
		const seatIndex = gameState.players.length;
		const playerState = {
			name: seatRef.nameEl.textContent,
			isBot: seatRef.seatEl.classList.contains("bot"),
			seatSlot: seatRef.seatSlot,
			winnerReactionEmoji: "",
			winnerReactionUntil: 0,
			isWinner: false,
			actionState: null,
			winProbability: null,
			lastNonFinalWinProbability: null,
			seatIndex,
			holeCards: [null, null],
			visibleHoleCards: [false, false],
			dealer: false,
			smallBlind: false,
			bigBlind: false,
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
			spotState: createPlayerSpotState(),
		};
		bindSeatRefPlayer(playerState);
		gameState.players.push(playerState);
	}
	renderPlayerChipStacks();
	gameState.players.forEach((player) => {
		renderPlayerTotal(player);
		resetPlayerRoundBet(player);
		renderPlayerHoleCards(player);
	});
	gameState.allPlayers = gameState.players.slice();
}

function setDealer() {
	const nextDealerIndex = getNextDealerIndex(gameState.players);
	if (nextDealerIndex === -1) {
		return;
	}
	const dealerIndex = gameState.players.findIndex((player) => player.dealer);
	if (dealerIndex !== -1) {
		gameState.players[dealerIndex].dealer = false;
		clearPlayerRole(gameState.players[dealerIndex], "dealer");
	}
	gameState.players[nextDealerIndex].dealer = true;
	assignPlayerRole(gameState.players[nextDealerIndex], "dealer");

	while (gameState.players[0].dealer === false) {
		gameState.players.unshift(gameState.players.pop());
	}

	enqueueNotification(`${gameState.players[0].name} is Dealer.`);
}

function updateBlindLevelForCurrentHand() {
	const nextBlindLevel = getBlindLevelForHand(totalHands);
	if (nextBlindLevel <= gameState.blindLevel) {
		return;
	}

	let nextBigBlind = gameState.bigBlind;
	for (
		let level = gameState.blindLevel + 1;
		level <= nextBlindLevel;
		level++
	) {
		nextBigBlind = getBigBlindForLevel(level, nextBigBlind);
	}

	const nextSmallBlind = nextBigBlind / 2;
	const blindsChanged = nextBigBlind !== gameState.bigBlind ||
		nextSmallBlind !== gameState.smallBlind;

	gameState.blindLevel = nextBlindLevel;
	gameState.bigBlind = nextBigBlind;
	gameState.smallBlind = nextSmallBlind;

	if (blindsChanged) {
		enqueueNotification(
			`Blinds are now ${gameState.smallBlind}/${gameState.bigBlind}.`,
		);
	}
}

function setBlinds() {
	updateBlindLevelForCurrentHand();

	// Clear previous roles and icons
	gameState.players.forEach((p) => {
		clearPlayerRole(p, "small-blind");
		clearPlayerRole(p, "big-blind");
	});
	// Post blinds for Pre-Flop and set currentBet
	const { smallBlindIndex: sbIdx, bigBlindIndex: bbIdx } =
		getBlindSeatIndexes(
			gameState.players.length,
		);

	const sbBet = placePlayerBet(
		gameState.players[sbIdx],
		gameState.smallBlind,
	);
	const bbBet = placePlayerBet(gameState.players[bbIdx], gameState.bigBlind);

	enqueueNotification(
		`${gameState.players[sbIdx].name} posted small blind of ${sbBet}.`,
	);
	enqueueNotification(
		`${gameState.players[bbIdx].name} posted big blind of ${bbBet}.`,
	);

	// Add blinds to the pot
	addToPot(sbBet + bbBet);
	// Assign new blinds
	assignPlayerRole(gameState.players[sbIdx], "small-blind");
	assignPlayerRole(gameState.players[bbIdx], "big-blind");
	gameState.currentBet = gameState.bigBlind;
	gameState.lastRaise = gameState.bigBlind; // minimum raise equals the big blind at hand start
}

function dealCards() {
	gameState.deck = gameState.deck.concat(gameState.cardGraveyard);
	gameState.cardGraveyard = [];
	shuffleArray(gameState.deck);

	for (const player of gameState.players) {
		const card1 = trackUsedCard(
			gameState.cardGraveyard,
			takeDeckCard(gameState.deck),
		);
		const card2 = trackUsedCard(
			gameState.cardGraveyard,
			takeDeckCard(gameState.deck),
		);
		setPlayerHoleCards(player, [card1, card2]);

		const showCards = gameState.spectatorMode ||
			(!player.isBot && gameState.openCardsMode);
		setPlayerVisibleHoleCards(player, [showCards, showCards]);

		if (!player.isBot) {
			if (gameState.openCardsMode) {
				hidePlayerQr(player);
			} else {
				showPlayerQr(player, card1, card2);
			}
		} else {
			hidePlayerQr(player);
		}
	}
}

// Execute the standard pre-flop steps: rotate dealer, post blinds, deal cards, start betting.
function preFlop() {
	// --- Hand Start And Reset ---------------------------------------------------
	// Analytics: count hands and mark start time
	totalHands++;
	// Reset phase to preflop
	gameState.currentPhaseIndex = 0;
	gameState.gameFinished = false;
	gameState.handInProgress = false;
	gameState.chipTransfer = null;
	if (runoutPhaseTimer) {
		clearTimeout(runoutPhaseTimer);
		runoutPhaseTimer = null;
	}
	clearChipTransferFinishTimer();
	clearChipTransferAnimation(tableRenderTarget);

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
		p.lastNonFinalWinProbability = null;
		p.isWinner = false;
		clearPlayerWinnerReaction(p);
		renderPlayerWinnerState(p, false);
		removePlayerSeatClasses(
			p,
			"folded",
			"called",
			"raised",
			"checked",
			"allin",
		);
		setPlayerHoleCards(p, [null, null]);
		hidePlayerHoleCards(p);
		hidePlayerQr(p);
	});

	// Clear community cards from last hand
	setCommunityCards([]);

	// --- Busted Player Cleanup ---------------------------------------------------
	// Remove players with zero chips from the table
	const remainingPlayers = [];
	gameState.players.forEach((p) => {
		if (p.chips <= 0) {
			p.chips = 0;
			getPlayerSeatEl(p)?.classList.add("hidden");
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
	gameState.handContext = createHandContextState();
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
		resetPlayerSpotStateForHand(p);
	});

	// --- Game Over Check ---------------------------------------------------------
	// GAME OVER: only one player left at the table
	if (gameState.players.length === 1) {
		const champion = gameState.players[0];
		clearActiveTurnPlayer(false);
		enqueueNotification(`${champion.name} wins the game! 🏆`);
		// Reveal champion's stack
		renderPlayerTotal(champion);
		champion.isWinner = true;
		renderPlayerWinnerState(champion, true);
		logFlow("tournament_end", { champion: champion.name });
		gameState.gameFinished = true;
		clearPendingAction();
		humanTurnController.hide();
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
	gameState.handId = totalHands;
	gameState.nextDecisionId = 1;
	updateFastForwardButton();

	// Assign dealer
	setDealer();

	// post blinds
	setBlinds();
	const handStartPlayers = buildSpeedmodeHandStartPlayers(gameState.players);

	// Shuffle and deal new hole cards
	dealCards();
	if (totalHands === 1 && !SPEED_MODE) {
		globalThis.umami?.track("Poker", {
			players: gameState.players.length,
			bots: gameState.players.filter((p) => p.isBot).length,
			humans: gameState.players.filter((p) => !p.isBot).length,
		});
	}
	logSpeedmodeEvent("hand_start", {
		handId: gameState.handId,
		blindLevel: gameState.blindLevel,
		smallBlind: gameState.smallBlind,
		bigBlind: gameState.bigBlind,
		dealerSeatIndex: gameState.players.find((player) =>
			player.dealer
		)?.seatIndex ?? null,
		communityCards: [],
		players: handStartPlayers,
	});

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
		const card = trackUsedCard(
			gameState.cardGraveyard,
			takeDeckCard(gameState.deck),
		);
		if (card) {
			dealtCards.push(card);
		}
	}
	appendCommunityCards(dealtCards);
	updateHandStrengthDisplays();
	if (
		gameState.spectatorMode ||
		isAllInRunout(gameState.players, gameState.currentBet)
	) {
		computeSpectatorWinProbabilities("dealCommunityCards");
	}
}

function setPhase() {
	logFlow("setPhase", {
		phase: getCurrentPhase(gameState.currentPhaseIndex),
	});
	// EARLY EXIT: If only one player remains, skip straight to showdown
	const activePlayers = gameState.players.filter((p) => !p.folded);
	if (activePlayers.length <= 1) {
		return doShowdown();
	}

	const completedPhase = getCurrentPhase(gameState.currentPhaseIndex);
	if (gameState.handContext && gameState.currentPhaseIndex > 0) {
		const checkedThrough =
			gameState.handContext.streetAggressorSeatIndex === null;
		if (completedPhase === "flop") {
			gameState.handContext.flopCheckedThrough = checkedThrough;
		} else if (completedPhase === "turn") {
			gameState.handContext.turnCheckedThrough = checkedThrough;
		}
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
	humanTurnController.hide();
	const runoutPhaseDelay = getRunoutPhaseDelay();
	if (
		!isAllInRunout(gameState.players, gameState.currentBet) ||
		runoutPhaseDelay === 0
	) {
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

function notifyPlayerAction(player, action = "", amount = 0, actionMeta = {}) {
	recordPlayerActionStats(gameState, player, action, actionMeta);

	const msg = getPlayerActionNotificationText(player.name, action, amount);
	if (action) {
		setPlayerActionState(
			player,
			action,
			Date.now() + getActionLabelDuration(),
		);
	} else {
		clearPlayerActionState(player);
	}

	renderPlayerResolvedAction(player);

	const followUpEffects = getPlayerActionFollowUpEffects(
		gameState,
		player,
		action,
	);
	if (followUpEffects.clearWinProbability) {
		player.winProbability = 0;
	}
	if (followUpEffects.revealActiveHoleCards) {
		revealActiveHoleCards();
	} else if (followUpEffects.refreshHandStrength) {
		updateHandStrengthDisplays();
	}
	if (followUpEffects.recomputeSpectatorWinProbabilities) {
		computeSpectatorWinProbabilities(followUpEffects.probabilityReason);
	} else if (followUpEffects.skipProbabilityLogReason) {
		logSkippedPlayerActionProbability(
			player,
			action,
			followUpEffects.skipProbabilityLogReason,
		);
	}
	queueStateSync(0);
	updateFastForwardButton();
	enqueueNotification(msg);
}

function setActiveTurnPlayer(player) {
	document.querySelectorAll(".seat").forEach((seat) =>
		seat.classList.remove("active")
	);
	addPlayerSeatClasses(player, "active");
	if (gameState.activeSeatIndex !== player.seatIndex) {
		gameState.activeSeatIndex = player.seatIndex;
		queueStateSync(0);
	}
}

function clearActiveTurnPlayer(sync = true) {
	document.querySelectorAll(".seat").forEach((seat) =>
		seat.classList.remove("active")
	);
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

function getResolvedTurnMeta(resolvedAction) {
	if (resolvedAction?.action === "fold") {
		return {
			logPrefix: "fold",
			advanceReason: "fold",
		};
	}
	if (resolvedAction?.action === "allin") {
		return {
			logPrefix: "human",
			advanceReason: "human-allin",
		};
	}
	return {
		logPrefix: "human",
		advanceReason: "human",
	};
}

function applyTurnAction(player, actionRequest) {
	if (!player || !actionRequest) {
		return null;
	}

	const currentActionState = getPlayerActionState(gameState, player);

	switch (actionRequest.action) {
		case "fold":
			player.folded = true;
			notifyPlayerAction(player, "fold", 0, {
				aggressive: false,
				voluntary: false,
			});
			hidePlayerQr(player);
			return { action: "fold", amount: 0 };
		case "check":
			notifyPlayerAction(player, "check", 0, {
				aggressive: false,
				voluntary: false,
			});
			return { action: "check", amount: 0 };
		case "call": {
			const callAmount = Math.min(
				player.chips,
				currentActionState.needToCall,
			);
			if (
				callAmount === player.chips &&
				player.chips > 0 &&
				currentActionState.needToCall > 0
			) {
				return applyTurnAction(player, {
					action: "allin",
					amount: player.chips,
				});
			}
			const actual = placePlayerBet(player, callAmount);
			addToPot(actual);
			notifyPlayerAction(player, "call", actual, {
				aggressive: false,
				voluntary: actual > 0,
			});
			return { action: "call", amount: actual };
		}
		case "allin": {
			const actual = placePlayerBet(player, player.chips);
			const isAggressiveAllIn = actual > currentActionState.needToCall;
			addToPot(actual);
			if (actual >= currentActionState.minRaise) {
				gameState.currentBet = player.roundBet;
				gameState.lastRaise = actual - currentActionState.needToCall;
				gameState.raisesThisRound++;
			} else if (actual >= currentActionState.needToCall) {
				gameState.currentBet = Math.max(
					gameState.currentBet,
					player.roundBet,
				);
			}
			notifyPlayerAction(player, "allin", actual, {
				aggressive: isAggressiveAllIn,
				voluntary: actual > 0,
			});
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
				return applyTurnAction(player, {
					action: "allin",
					amount: player.chips,
				});
			}
			const actual = placePlayerBet(player, bet);
			if (actual > currentActionState.needToCall) {
				gameState.currentBet = player.roundBet;
				gameState.lastRaise = actual - currentActionState.needToCall;
				gameState.raisesThisRound++;
			}
			addToPot(actual);
			notifyPlayerAction(player, "raise", actual, {
				aggressive: actual > currentActionState.needToCall,
				voluntary: actual > 0,
			});
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
			return {
				action: "call",
				amount: Math.min(player.chips, actionState.needToCall),
			};
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

function runBotTurn({ player, cycles, anyUncalled, nextPlayer }) {
	setActiveTurnPlayer(player);
	humanTurnController.hide();
	clearPlayerActionLabel(player);
	removePlayerSeatClasses(player, "checked", "called", "raised", "allin");
	setPlayerSeatName(player, "thinking …");

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
				fallbackActionState.canCheck
					? { action: "check" }
					: { action: "fold" },
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

function startBettingRound() {
	// --- Round Reset -------------------------------------------------------------
	if (gameState.currentPhaseIndex > 0) {
		// Reset state for post-flop rounds before any checks/logging
		gameState.currentBet = 0;
		gameState.lastRaise = gameState.bigBlind;
		gameState.players.forEach((p) => resetPlayerRoundBet(p));
	}
	if (!gameState.handContext) {
		gameState.handContext = createHandContextState();
	}
	gameState.handContext.streetAggressorSeatIndex = null;
	gameState.players.forEach((p) => resetPlayerSpotStateForStreet(p));
	logFlow("startBettingRound", {
		phase: getCurrentPhase(gameState.currentPhaseIndex),
		currentBet: gameState.currentBet,
		lastRaise: gameState.lastRaise,
		order: gameState.players.map((p) => p.name),
	});
	// Clear action indicators from the previous betting round
	clearActiveTurnPlayer(false);
	gameState.players.forEach((p) =>
		removePlayerSeatClasses(p, "checked", "called", "raised")
	);
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
	const startIdx = getBettingRoundStartIndex(
		gameState.players,
		gameState.currentPhaseIndex,
	);

	logFlow("betting start index", {
		index: startIdx,
		player: gameState.players[startIdx].name,
	});

	gameState.raisesThisRound = 0;
	let idx = startIdx;
	let cycles = 0;

	function anyUncalled() {
		if (gameState.currentBet === 0) {
			// Post-flop: Prüfe ob alle Spieler schon dran waren
			return cycles <
				gameState.players.filter((p) => !p.folded && !p.allIn).length;
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
				(gameState.currentPhaseIndex === 0 &&
					cycles <= gameState.players.length) ||
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
		return humanTurnController.runHumanTurn({
			player,
			cycles,
			anyUncalled,
			nextPlayer,
		});
	}

	nextPlayer();
}

/* --------------------------------------------------------------------------------------------------
Showdown And Payout Flow
---------------------------------------------------------------------------------------------------*/

// Build the synchronized payout transfer plan and let the shared table-view renderer
// animate the visible pot and stack counts from the final canonical state.
function getChipTransferStepCount() {
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_CHIP_TRANSFER_STEPS;
	}
	return DEFAULT_CHIP_TRANSFER_STEPS;
}

function getChipTransferDurationMs(amount) {
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_CHIP_TRANSFER_DURATION;
	}
	return Math.min(Math.max(amount * 20, 300), 3000);
}

function buildChipTransferState(transferQueue) {
	if (
		SPEED_MODE ||
		!Array.isArray(transferQueue) ||
		transferQueue.length === 0
	) {
		return null;
	}

	const startedAt = Date.now();
	return {
		id: nextChipTransferId++,
		startedAt,
		transfers: transferQueue.map((transfer) => ({
			seatIndex: transfer.player.seatIndex,
			amount: transfer.amount,
			durationMs: getChipTransferDurationMs(transfer.amount),
			stepCount: getChipTransferStepCount(),
		})),
	};
}

function applyChipTransferResults(transferQueue) {
	transferQueue.forEach((transfer) => {
		transfer.player.chips += transfer.amount;
	});
	gameState.pot = 0;
}

function getChipTransferRemainingDuration(chipTransfer) {
	if (
		!chipTransfer || !Array.isArray(chipTransfer.transfers) ||
		chipTransfer.transfers.length === 0
	) {
		return 0;
	}

	const endAt = chipTransfer.transfers.reduce(
		(maxEndAt, transfer) =>
			Math.max(maxEndAt, chipTransfer.startedAt + transfer.durationMs),
		chipTransfer.startedAt,
	);
	return Math.max(0, Math.ceil(endAt - Date.now()));
}

function startChipTransferAnimation(transferQueue, onDone) {
	if (!Array.isArray(transferQueue) || transferQueue.length === 0) {
		if (onDone) {
			onDone();
		}
		return;
	}

	clearChipTransferFinishTimer();
	clearChipTransferAnimation(tableRenderTarget);

	const chipTransfer = buildChipTransferState(transferQueue);
	gameState.chipTransfer = chipTransfer;
	applyChipTransferResults(transferQueue);

	if (!chipTransfer) {
		if (onDone) {
			onDone();
		}
		return;
	}

	renderChipTransferAnimation(tableRenderTarget, {
		finalPot: gameState.pot,
		players: getPlayerSeatRenderData(gameState.players),
		chipTransfer,
	});
	queueStateSync(0);

	chipTransferFinishTimer = setTimeout(() => {
		chipTransferFinishTimer = null;
		gameState.chipTransfer = null;
		clearChipTransferAnimation(tableRenderTarget);
		queueStateSync(0);
		if (onDone) {
			onDone();
		}
	}, getChipTransferRemainingDuration(chipTransfer));
}

function finishHandAfterShowdown() {
	renderPlayerChipStacks();
	setPot(0);

	clearActiveTurnPlayer(false);

	gameState.handInProgress = false;
	clearPendingAction();
	humanTurnController.hide();
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
	gameState.players.forEach((p) => resetPlayerRoundBet(p));

	const communityCards = getCommunityCardCodes();
	const {
		activePlayers,
		contributors,
		hadShowdown,
		uncontestedWinner,
		mainPotWinners,
		winningPlayers,
		transferQueue,
		potResults,
		totalPayoutByPlayer,
		totalPot,
	} = resolveShowdown(gameState.players, communityCards, CHIP_UNIT);
	logSpeedmodeEvent("hand_result", {
		handId: gameState.handId,
		communityCards: communityCards.slice(),
		hadShowdown,
		uncontestedWinner: uncontestedWinner?.name ?? null,
		uncontestedWinnerSeatIndex: uncontestedWinner?.seatIndex ?? null,
		mainPotWinners: mainPotWinners.map((player) => player.name),
		mainPotWinnerSeatIndexes: mainPotWinners.map((player) =>
			player.seatIndex
		),
		winningPlayers: winningPlayers.map((player) => player.name),
		winningSeatIndexes: winningPlayers.map((player) => player.seatIndex),
		potResults: potResults.map((result) => ({ ...result })),
		totalPayoutByPlayer: buildSpeedmodePayoutByPlayer(totalPayoutByPlayer),
		totalPayoutBySeatIndex: buildSpeedmodePayoutBySeatIndex(
			totalPayoutByPlayer,
		),
		totalBetByPlayer: buildSpeedmodeTotalBetByPlayer(contributors),
		totalBetBySeatIndex: buildSpeedmodeTotalBetBySeatIndex(contributors),
		totalPot,
	});

	if (hadShowdown) {
		activePlayers.forEach((p) => p.stats.showdowns++);
		revealActiveHoleCards();
	}

	winningPlayers.forEach((player) => {
		player.stats.handsWon++;
		if (hadShowdown) {
			player.stats.showdownsWon++;
		}
	});

	mainPotWinners.forEach((player) => {
		player.isWinner = true;
		renderPlayerWinnerState(player, true);
		removePlayerSeatClasses(player, "active");
	});

	if (uncontestedWinner) {
		const revealedPlayers = new Set();
		const revealDecision = getBotRevealDecision(
			uncontestedWinner,
			communityCards,
		);
		if (revealDecision) {
			revealedPlayers.add(uncontestedWinner);
			applyBotReveal(uncontestedWinner, revealDecision);
			registerBotReveal(uncontestedWinner);
			enqueueNotification(
				`${uncontestedWinner.name} reveals ${
					revealDecision.codes.map(formatCardLabel).join(" ")
				}`,
			);
		} else {
			hidePlayerQr(uncontestedWinner);
		}
		triggerMainPotWinnerReactions({
			activePlayerCount: activePlayers.length,
			bigBlind: gameState.bigBlind,
			communityCards,
			contributors,
			hadShowdown,
			mainPotWinnerCount: mainPotWinners.length,
			mainPotWinners,
			revealedPlayers,
			showdownPlayers: activePlayers,
			totalPayoutByPlayer,
		});
		enqueueNotification(`${uncontestedWinner.name} wins ${totalPot}!`);
		startChipTransferAnimation(transferQueue, () => {
			finishHandAfterShowdown();
		});
		return;
	}

	// Skip pure refund-only side pots in the log. They animate correctly, but they are not real wins.
	const filteredResults = potResults.filter((result) =>
		result.isRefundOnly !== true
	);

	// --- Notification Consolidation ----------------------------------------------
	// Consolidate notifications: if same player wins all pots, combine amounts
	if (filteredResults.length > 0) {
		const allSame = filteredResults.every((r) =>
			r.players.length === 1 &&
			r.players[0] === filteredResults[0].players[0]
		);
		if (allSame) {
			const total = filteredResults.reduce((sum, r) => sum + r.amount, 0);
			let msg = `${filteredResults[0].players[0]} wins ${total}`;
			if (filteredResults[0].hand) {
				msg += ` with ${filteredResults[0].hand}`;
			}
			enqueueNotification(msg);
		} else {
			filteredResults.forEach((r) => {
				if (r.players.length === 1) {
					let msg = `${r.players[0]} wins ${r.amount}`;
					if (r.hand) msg += ` with ${r.hand}`;
					enqueueNotification(msg);
				} else {
					enqueueNotification(
						`${r.players.join(" & ")} split ${r.amount}`,
					);
				}
			});
		}
	}

	triggerMainPotWinnerReactions({
		activePlayerCount: activePlayers.length,
		bigBlind: gameState.bigBlind,
		communityCards,
		contributors,
		hadShowdown,
		mainPotWinnerCount: mainPotWinners.length,
		mainPotWinners,
		revealedPlayers: new Set(),
		showdownPlayers: activePlayers,
		totalPayoutByPlayer,
	});

	// --- Payout Animation --------------------------------------------------------
	// Build one synced transfer plan and let host and remote play the same animation locally.
	startChipTransferAnimation(transferQueue, () => {
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
			alert(
				"No framing allowed. Please visit: https://tehes.github.io/poker/",
			);
			throw new Error(
				"No framing allowed. Open the original: https://tehes.github.io/poker/",
			);
		}
	}

	if (versionButton) {
		versionButton.textContent = `v${APP_VERSION}`;
	}

	document.addEventListener("touchstart", function () {}, false);
	document.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape") {
			closeAllOverlays();
		}
	}, false);
	startButton.addEventListener("click", startGame, false);
	instructionsButton.addEventListener(
		"click",
		() => openOverlay("instructions"),
		false,
	);
	versionButton.addEventListener(
		"click",
		() => openOverlay("version"),
		false,
	);
	notification.addEventListener("click", () => openOverlay("log"), false);
	statsButton.addEventListener("click", () => openOverlay("stats"), false);
	logButton.addEventListener("click", () => openOverlay("log"), false);
	fastForwardButton.addEventListener("click", activateFastForward, false);
	statsCloseButton.addEventListener(
		"click",
		() => closeOverlay("stats"),
		false,
	);
	logCloseButton.addEventListener("click", () => closeOverlay("log"), false);
	versionCloseButton.addEventListener(
		"click",
		() => closeOverlay("version"),
		false,
	);
	instructionsCloseButton.addEventListener(
		"click",
		() => closeOverlay("instructions"),
		false,
	);
	overlayBackdrop.addEventListener("click", closeAllOverlays, false);
	globalThis.addEventListener("pagehide", () => trackUnfinishedExit(), false);
	globalThis.addEventListener(
		"beforeunload",
		() => trackUnfinishedExit(),
		false,
	);
	humanTurnController.init();
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
	get gameFinished() {
		return gameState.gameFinished;
	},
	get handInProgress() {
		return gameState.handInProgress;
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
const SERVICE_WORKER_VERSION = "2026-04-26-v4";
const AUTO_RELOAD_ON_SW_UPDATE = true;

initServiceWorker({
	useServiceWorker: USE_SERVICE_WORKER,
	serviceWorkerVersion: SERVICE_WORKER_VERSION,
	autoReloadOnUpdate: AUTO_RELOAD_ON_SW_UPDATE,
});
