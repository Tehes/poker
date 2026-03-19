/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/
const singleViewEl = document.getElementById("single");
const cardSlots = document.querySelectorAll("img");
const nameBadge = document.querySelector("h3");
const chipsEl = document.querySelector(".total");
const betEl = document.querySelector(".bet");
const potEl = document.querySelector("#pot");
const notificationsEl = document.querySelector("#singleview-notifications");
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
functions
---------------------------------------------------------------------------------------------------*/

function init() {
	document.addEventListener("touchstart", function () {}, false);
	document.addEventListener("visibilitychange", handleVisibilityChange);
	singleAmountSlider.addEventListener("input", handleActionSliderInput);
	singleAmountSlider.addEventListener("change", handleActionSliderChange);
	singleFoldButton.addEventListener("click", handleFoldAction);
	singleActionButton.addEventListener("click", handlePrimaryAction);
	applyParams();
	if (!tableId) {
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
	if (card1) {
		cardSlots[0].src = `cards/${card1}.svg`;
	}
	if (card2) {
		cardSlots[1].src = `cards/${card2}.svg`;
	}
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
		if (!el) return;
		el.classList.toggle("hidden", !isOnline);
	});
	if (!isOnline) {
		notificationsEl.classList.add("hidden");
		hideActionControls();
	}
}

function renderNotifications(notifications) {
	notificationsEl.textContent = "";
	for (const message of notifications) {
		const item = document.createElement("div");
		item.textContent = message;
		notificationsEl.appendChild(item);
	}
	notificationsEl.classList.toggle("hidden", notifications.length === 0);
}

function getActionButtonLabel(amount, pendingAction) {
	if (amount === 0) {
		return "Check";
	}
	if (amount === pendingAction.maxAmount) {
		return "All-In";
	}
	if (amount === pendingAction.needToCall) {
		return "Call";
	}
	return "Raise";
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

function renderActionControls(player, pendingAction) {
	if (
		!pendingAction ||
		pendingAction.seatIndex !== seatIndexParam ||
		player.folded ||
		player.allIn
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
		const nextAmount = Number.isNaN(currentAmount) ? pendingAction.minAmount : Math.max(
			pendingAction.minAmount,
			Math.min(currentAmount, pendingAction.maxAmount),
		);
		singleAmountSlider.value = nextAmount;
	}

	updatePrimaryActionLabel();
	setActionControlsEnabled(!isSubmittingAction);
}

function updatePrimaryActionLabel() {
	if (!currentPendingAction) {
		return;
	}
	const amount = Number.parseInt(singleAmountSlider.value, 10);
	singleSliderOutput.value = Number.isNaN(amount) ? 0 : amount;
	const isInvalidRaise = amount > currentPendingAction.needToCall &&
		amount < currentPendingAction.minRaise &&
		amount < currentPendingAction.maxAmount;
	if (isInvalidRaise) {
		singleSliderOutput.classList.add("invalid");
	} else {
		singleSliderOutput.classList.remove("invalid");
	}
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
	if (amount > currentPendingAction.needToCall && amount < currentPendingAction.minRaise) {
		const minRaiseValue = Math.min(
			currentPendingAction.maxAmount,
			currentPendingAction.minRaise,
		);
		singleAmountSlider.value = minRaiseValue;
		singleSliderOutput.value = minRaiseValue;
		singleSliderOutput.classList.remove("invalid");
	}
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
	if (amount === 0) {
		submitActionRequest("check", 0);
		return;
	}
	if (amount === currentPendingAction.maxAmount) {
		submitActionRequest("allin", amount);
		return;
	}
	if (amount === currentPendingAction.needToCall) {
		submitActionRequest("call", amount);
		return;
	}
	submitActionRequest("raise", amount);
}

function handleFoldAction() {
	submitActionRequest("fold");
}

// Constant polling is intentional.
// Poker tables have bursty activity; 204 does not imply inactivity ahead.
async function pollState() {
	if (!tableId || isPolling || document.visibilityState !== "visible") {
		return;
	}
	isPolling = true;
	try {
		const url = `${STATE_ENDPOINT}?tableId=${
			encodeURIComponent(tableId)
		}&sinceVersion=${lastVersion}`;
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
	if (!payload || !payload.gameState || !Array.isArray(payload.gameState.players)) return;
	const player = payload.gameState.players.find((p) => p.seatIndex === seatIndexParam);
	if (!player) {
		hideActionControls();
		return;
	}
	nameBadge.textContent = player.name;
	const pot = payload.gameState.pot || 0;

	setCards(player.holeCards?.[0], player.holeCards?.[1], player.folded);
	setChips(player.chips, player.roundBet, pot);
	renderNotifications(payload.notifications);
	renderActionControls(player, payload.gameState.pendingAction ?? null);
}

/* --------------------------------------------------------------------------------------------------
public members, exposed with return statement
---------------------------------------------------------------------------------------------------*/
globalThis.app = {
	init,
};

app.init();
