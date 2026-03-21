/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

import {
	clampActionAmount,
	getActionButtonLabel,
	getActionRequestForAmount,
	isInvalidRaiseAmount,
	normalizeActionAmount,
} from "./shared/actionModel.js";
import { getSeatView, getTableView } from "./shared/syncViewModel.js";

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/

// The single view is a projection consumer.
// It renders the synced seat/table payload and must not reimplement poker logic or visibility rules.
const singleViewEl = document.getElementById("single");
const cardSlots = document.querySelectorAll(".hole-cards img");
const nameBadge = document.querySelector("h3");
const chipsEl = document.querySelector(".total");
const betEl = document.querySelector(".bet");
const potEl = document.querySelector("#pot");
const notificationsEl = document.querySelector("#singleview-notifications");
const handStrengthEl = document.querySelector("#single .hand-strength");
const winProbabilityEl = document.querySelector("#single .win-probability");
const singleActionPanelEl = document.getElementById("single-action-panel");
const singleFoldButton = document.getElementById("single-fold-button");
const singleActionButton = document.getElementById("single-action-button");
const singleAmountSlider = document.getElementById("single-amount-slider");
const singleSliderOutput = document.getElementById("single-slider-output");
const onlineOnlyElements = [betEl, potEl];
const urlParams = new URLSearchParams(globalThis.location.search);
const tableId = urlParams.get("tableId") || "";
const STATE_ENDPOINT = "https://poker.tehes.deno.net/state";
const ACTION_ENDPOINT = "https://poker.tehes.deno.net/action";
const REFRESH_INTERVAL = 2500;
const ACTION_STEP = 10;
let lastVersion = 0;
let pollTimeoutId = null;
let isPolling = false;
let currentPendingAction = null;
let isSubmittingAction = false;

function parseOptionalInt(value) {
	if (value === null || value === "") {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

function getInitialViewState() {
	return {
		card1: urlParams.get("card1") || "",
		card2: urlParams.get("card2") || "",
		playerName: urlParams.get("name") || "",
		chips: parseOptionalInt(urlParams.get("chips")),
		seatIndex: parseOptionalInt(urlParams.get("seatIndex")),
	};
}

const initialViewState = getInitialViewState();
const seatIndexParam = initialViewState.seatIndex;

/* --------------------------------------------------------------------------------------------------
Functions
---------------------------------------------------------------------------------------------------*/

function init() {
	document.addEventListener("touchstart", function () {}, false);
	document.addEventListener("visibilitychange", handleVisibilityChange);
	singleAmountSlider.addEventListener("input", handleActionSliderInput);
	singleAmountSlider.addEventListener("change", handleActionSliderChange);
	singleFoldButton.addEventListener("click", handleFoldAction);
	singleActionButton.addEventListener("click", handlePrimaryAction);
	clearSyncedDisplays();
	applyParams();
	if (!tableId || seatIndexParam === null) {
		setOnlineElementsVisible(false);
		hideActionControls();
		return;
	}
	pollState();
}

function applyParams() {
	setCards(initialViewState.card1, initialViewState.card2);
	nameBadge.textContent = initialViewState.playerName;
	if (typeof initialViewState.chips === "number") {
		chipsEl.textContent = initialViewState.chips;
	}
}

function setCards(card1, card2, folded = false) {
	cardSlots[0].src = card1 ? `cards/${card1}.svg` : "cards/1B.svg";
	cardSlots[1].src = card2 ? `cards/${card2}.svg` : "cards/1B.svg";

	if (folded) {
		singleViewEl.classList.add("folded");
	} else {
		singleViewEl.classList.remove("folded");
	}
}

function setChips(amount, roundBet, pot) {
	if (typeof amount === "number") {
		chipsEl.textContent = amount;
	}
	if (typeof roundBet === "number") {
		betEl.textContent = roundBet;
	}
	if (typeof pot === "number") {
		potEl.textContent = pot;
	}
}

function setOnlineElementsVisible(isOnline) {
	onlineOnlyElements.forEach((el) => {
		if (!el) {
			return;
		}
		el.classList.toggle("hidden", !isOnline);
	});
	if (!isOnline) {
		notificationsEl.classList.add("hidden");
		hideActionControls();
		clearSyncedDisplays();
	}
}

function clearSyncedDisplays() {
	renderHandStrength("");
	renderWinProbability(null, false);
}

function renderNotifications(notifications = []) {
	notificationsEl.textContent = "";
	for (const message of notifications) {
		const item = document.createElement("div");
		item.textContent = message;
		notificationsEl.appendChild(item);
	}
	notificationsEl.classList.toggle("hidden", notifications.length === 0);
}

function renderHandStrength(label) {
	if (!handStrengthEl) {
		return;
	}
	handStrengthEl.textContent = label || "";
	handStrengthEl.classList.toggle("hidden", !label);
}

function renderWinProbability(value, shouldShow) {
	if (!winProbabilityEl) {
		return;
	}
	const showValue = shouldShow && typeof value === "number";
	winProbabilityEl.textContent = showValue ? `${Math.round(value)}%` : "";
	winProbabilityEl.classList.toggle("hidden", !showValue);
}

function setActionControlsEnabled(enabled) {
	singleFoldButton.disabled = !enabled;
	singleActionButton.disabled = !enabled;
	singleAmountSlider.disabled = !enabled;
}

function hideActionControls() {
	currentPendingAction = null;
	isSubmittingAction = false;
	singleActionPanelEl.classList.add("hidden");
	singleSliderOutput.classList.remove("invalid");
	setActionControlsEnabled(false);
}

function getSeatPendingAction(tableView) {
	const tablePendingAction = tableView?.pendingAction ?? null;
	if (tablePendingAction?.seatIndex === seatIndexParam) {
		return tablePendingAction;
	}
	return null;
}

function renderActionControls(seatView, pendingAction) {
	if (
		!pendingAction ||
		pendingAction.seatIndex !== seatIndexParam ||
		seatView.folded ||
		seatView.allIn
	) {
		hideActionControls();
		return;
	}

	const isNewTurn = currentPendingAction?.turnToken !== pendingAction.turnToken;
	currentPendingAction = pendingAction;
	singleActionPanelEl.classList.remove("hidden");

	singleAmountSlider.min = pendingAction.minAmount;
	singleAmountSlider.max = pendingAction.maxAmount;
	singleAmountSlider.step = ACTION_STEP;

	if (isNewTurn) {
		isSubmittingAction = false;
		singleAmountSlider.value = pendingAction.minAmount;
	} else {
		const currentAmount = Number.parseInt(singleAmountSlider.value, 10);
		singleAmountSlider.value = clampActionAmount(currentAmount, pendingAction);
	}

	updatePrimaryActionLabel();
	setActionControlsEnabled(!isSubmittingAction);
}

function updatePrimaryActionLabel() {
	if (!currentPendingAction) {
		return;
	}

	const amount = clampActionAmount(
		Number.parseInt(singleAmountSlider.value, 10),
		currentPendingAction,
	);
	singleSliderOutput.value = amount;
	singleSliderOutput.classList.toggle(
		"invalid",
		isInvalidRaiseAmount(amount, currentPendingAction),
	);
	singleActionButton.textContent = getActionButtonLabel(amount, currentPendingAction);
}

function handleActionSliderInput() {
	updatePrimaryActionLabel();
}

function handleActionSliderChange() {
	if (!currentPendingAction) {
		return;
	}
	const amount = Number.parseInt(singleAmountSlider.value, 10);
	const normalizedAmount = normalizeActionAmount(amount, currentPendingAction);
	singleAmountSlider.value = normalizedAmount;
	singleSliderOutput.value = normalizedAmount;
	singleSliderOutput.classList.remove("invalid");
	updatePrimaryActionLabel();
}

async function submitActionRequest(action, amount = null) {
	if (!currentPendingAction || !tableId || seatIndexParam === null || isSubmittingAction) {
		return;
	}

	isSubmittingAction = true;
	setActionControlsEnabled(false);

	try {
		const res = await fetch(ACTION_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tableId,
				seatIndex: seatIndexParam,
				turnToken: currentPendingAction.turnToken,
				action,
				amount,
			}),
		});
		if (!res.ok) {
			throw new Error(`action request failed with status ${res.status}`);
		}
	} catch (error) {
		console.warn("action request failed", error);
		isSubmittingAction = false;
		setActionControlsEnabled(true);
	}
}

function handlePrimaryAction() {
	if (!currentPendingAction) {
		return;
	}

	const amount = Number.parseInt(singleAmountSlider.value, 10);
	if (Number.isNaN(amount)) {
		return;
	}

	const request = getActionRequestForAmount(amount, currentPendingAction);
	submitActionRequest(request.action, request.amount);
}

function handleFoldAction() {
	submitActionRequest("fold");
}

// Constant polling is intentional.
// Poker tables have bursty activity; 204 does not imply inactivity ahead.
async function pollState() {
	if (
		!tableId || seatIndexParam === null || isPolling || document.visibilityState !== "visible"
	) {
		return;
	}
	isPolling = true;
	try {
		const url = `${STATE_ENDPOINT}?tableId=${
			encodeURIComponent(tableId)
		}&seatIndex=${seatIndexParam}&sinceVersion=${lastVersion}`;
		const res = await fetch(url);
		if (res.status === 204) {
			setOnlineElementsVisible(true);
			return;
		}
		if (res.ok) {
			const payload = await res.json();
			lastVersion = payload.version;
			applyRemoteState(payload);
			setOnlineElementsVisible(true);
		} else {
			setOnlineElementsVisible(false);
		}
	} catch (error) {
		console.warn("state fetch failed", error);
		setOnlineElementsVisible(false);
	} finally {
		isPolling = false;
		schedulePoll();
	}
}

function schedulePoll() {
	if (document.visibilityState !== "visible") {
		pollTimeoutId = null;
		return;
	}
	pollTimeoutId = setTimeout(pollState, REFRESH_INTERVAL);
}

function handleVisibilityChange() {
	if (pollTimeoutId !== null) {
		clearTimeout(pollTimeoutId);
		pollTimeoutId = null;
	}
	if (document.visibilityState !== "visible") {
		return;
	}
	if (!isPolling) {
		pollState();
	}
}

function applyRemoteState(payload) {
	const tableView = getTableView(payload);
	const seatView = getSeatView(payload);
	if (!tableView || !seatView || seatView.seatIndex !== seatIndexParam) {
		hideActionControls();
		clearSyncedDisplays();
		return;
	}

	nameBadge.textContent = seatView.name;
	setCards(seatView.holeCards?.[0], seatView.holeCards?.[1], seatView.folded);
	setChips(seatView.chips, seatView.roundBet, tableView.pot);
	renderNotifications(tableView.notifications);
	// Display values are prepared by the table before syncing.
	// The single view only applies them and does not compute odds or hand labels itself.
	renderHandStrength(seatView.handStrengthLabel || "");
	renderWinProbability(seatView.winProbability, seatView.showWinProbability === true);
	renderActionControls(seatView, getSeatPendingAction(tableView));
}

/* --------------------------------------------------------------------------------------------------
Public API
---------------------------------------------------------------------------------------------------*/

globalThis.app = {
	init,
};

app.init();
