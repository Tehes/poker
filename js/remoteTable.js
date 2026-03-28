/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

// Synced remote-table runtime.
// Put code here for polling one table projection and mapping synced state into shared table-view
// renderer and action-control helpers.
// Do not reimplement poker rules, sync schema helpers, or generic render-only primitives here.

import {
	configureViewSwitchLink,
	createSeatActionControls,
	getSeatPendingAction,
	setViewSwitchLinkVisible,
	shouldShowSeatActionControls,
} from "./shared/seatActionControls.js";
import { getSeatView, getTableView } from "./shared/syncViewModel.js";
import {
	clearChipTransferAnimation,
	clearWinnerReaction,
	clearRenderedSeat,
	renderChipTransferAnimation,
	renderChipStacks,
	renderCommunityCards,
	renderNotificationBar,
	renderProjectedSeat,
	renderSeatActionLabel,
	showWinnerReaction,
} from "./shared/tableViewRenderer.js";

/* --------------------------------------------------------------------------------------------------
Constants And DOM References
---------------------------------------------------------------------------------------------------*/

const notificationEl = document.getElementById("notification");
const potEl = document.getElementById("pot");
const communityCardSlots = document.querySelectorAll("#community-cards .cardslot");
const tableRenderTarget = {
	potEl,
	chipTransferTimer: null,
	activeChipTransferId: null,
	activeChipTransferState: null,
};
const foldButton = document.getElementById("fold-button");
const actionButton = document.getElementById("action-button");
const amountControls = document.getElementById("amount-controls");
const amountDecrementButton = document.getElementById("amount-decrement-button");
const amountSlider = document.getElementById("amount-slider");
const amountIncrementButton = document.getElementById("amount-increment-button");
const sliderOutput = document.querySelector("output");
const remoteSwitchLink = document.getElementById("remote-switch-link");
const seatRefs = Array.from(document.querySelectorAll(".seat")).map((seatEl, seatSlot) => ({
	seatSlot,
	seatEl,
	cardEls: seatEl.querySelectorAll(".card"),
	nameEl: seatEl.querySelector("h3"),
	totalEl: seatEl.querySelector(".chips .total"),
	betEl: seatEl.querySelector(".chips .bet"),
	stackChipEls: seatEl.querySelectorAll(".stack-visual img"),
	dealerEl: seatEl.querySelector(".dealer"),
	smallBlindEl: seatEl.querySelector(".small-blind"),
	bigBlindEl: seatEl.querySelector(".big-blind"),
	winProbabilityEl: seatEl.querySelector(".win-probability"),
	handStrengthEl: seatEl.querySelector(".hand-strength"),
	actionLabelTimer: null,
	winnerReactionEl: seatEl.querySelector(".winner-reaction"),
	winnerReactionTimer: null,
}));
const urlParams = new URLSearchParams(globalThis.location.search);
const tableId = urlParams.get("tableId") || "";
const seatIndexParam = parseOptionalInt(urlParams.get("seatIndex"));
const STATE_ENDPOINT = "https://poker.tehes.deno.net/state";
const ACTION_ENDPOINT = "https://poker.tehes.deno.net/action";
const REFRESH_INTERVAL = 750;
const ACTION_STEP = 10;
const DEFAULT_NOTIFICATION = "Waiting for updates...";
let lastVersion = 0;
let pollTimeoutId = null;
let isPolling = false;

/* --------------------------------------------------------------------------------------------------
Helpers
---------------------------------------------------------------------------------------------------*/

function parseOptionalInt(value) {
	if (value === null || value === "") {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

const actionControls = createSeatActionControls({
	tableId,
	seatIndex: seatIndexParam,
	actionEndpoint: ACTION_ENDPOINT,
	actionStep: ACTION_STEP,
	visibleElements: [
		foldButton,
		actionButton,
		amountControls,
	],
	foldButton,
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton: amountDecrementButton,
	incrementButton: amountIncrementButton,
	onActionError: () => setNotification("Action request failed."),
});

function setNotification(message) {
	renderNotificationBar(notificationEl, [], message || DEFAULT_NOTIFICATION);
}

function renderNotifications(messages = []) {
	renderNotificationBar(notificationEl, messages, DEFAULT_NOTIFICATION);
}

function findSeatRef(publicSeat) {
	if (typeof publicSeat?.seatSlot === "number" && seatRefs[publicSeat.seatSlot]) {
		return seatRefs[publicSeat.seatSlot];
	}
	return seatRefs.find((seatRef) => seatRef.seatSlot === publicSeat?.seatIndex) ?? null;
}

function getRemotePlayerRenderData(playersPublic = []) {
	return playersPublic
		.map((publicSeat) => {
			const seatRef = findSeatRef(publicSeat);
			if (!seatRef) {
				return null;
			}
			return {
				seatIndex: publicSeat.seatIndex,
				chips: publicSeat.chips,
				totalEl: seatRef.totalEl,
				stackChipEls: seatRef.stackChipEls,
			};
		})
		.filter((player) => player !== null);
}

function applyRemoteState(payload) {
	const tableView = getTableView(payload);
	const seatView = getSeatView(payload);
	if (!tableView || !seatView || seatView.seatIndex !== seatIndexParam) {
		setViewSwitchLinkVisible(remoteSwitchLink, false);
		actionControls.hide();
		setNotification("Seat unavailable.");
		clearChipTransferAnimation(tableRenderTarget);
		seatRefs.forEach(clearRenderedSeat);
		renderCommunityCards(communityCardSlots, []);
		potEl.textContent = "0";
		return;
	}

	const pendingAction = getSeatPendingAction(tableView, seatIndexParam);
	const showTurnControls = shouldShowSeatActionControls(seatView, pendingAction, seatIndexParam);
	const playersPublic = Array.isArray(tableView.playersPublic) ? tableView.playersPublic : [];
	seatRefs.forEach(clearRenderedSeat);
	playersPublic.forEach((publicSeat) => {
		const seatRef = findSeatRef(publicSeat);
		if (!seatRef) {
			return;
		}

		renderProjectedSeat(seatRef, publicSeat, {
			activeSeatIndex: tableView.activeSeatIndex,
			ownSeatIndex: seatIndexParam,
			ownSeatView: seatView,
		});
		renderSeatActionLabel(seatRef, {
			playerName: publicSeat.name,
			actionName: publicSeat.actionState?.name,
			labelUntil: publicSeat.actionState?.labelUntil,
		});
		if (publicSeat.winnerReaction?.emoji) {
			showWinnerReaction(
				seatRef,
				publicSeat.winnerReaction.emoji,
				publicSeat.winnerReaction.visibleUntil,
			);
		} else {
			clearWinnerReaction(seatRef);
		}
	});
	const remotePlayerRenderData = getRemotePlayerRenderData(playersPublic);
	renderChipStacks(remotePlayerRenderData);
	potEl.textContent = `${tableView.pot ?? 0}`;
	if (tableView.chipTransfer) {
		renderChipTransferAnimation(tableRenderTarget, {
			finalPot: tableView.pot ?? 0,
			players: remotePlayerRenderData,
			chipTransfer: tableView.chipTransfer,
		});
	} else {
		clearChipTransferAnimation(tableRenderTarget);
	}
	renderCommunityCards(communityCardSlots, tableView.communityCards);
	actionControls.render(seatView, pendingAction);
	setViewSwitchLinkVisible(remoteSwitchLink, !showTurnControls);
	renderNotifications(tableView.notifications);
}

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
		const res = await fetch(url, { cache: "no-store" });
		if (res.status === 204) {
			return;
		}
		if (res.ok) {
			const payload = await res.json();
			lastVersion = payload.version;
			applyRemoteState(payload);
			return;
		}
		setViewSwitchLinkVisible(remoteSwitchLink, false);
		actionControls.hide();
		setNotification("Table unavailable.");
	} catch (error) {
		console.warn("state fetch failed", error);
		setViewSwitchLinkVisible(remoteSwitchLink, false);
		actionControls.hide();
		setNotification("Connection lost.");
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

/* --------------------------------------------------------------------------------------------------
Bootstrap
---------------------------------------------------------------------------------------------------*/

function init() {
	document.addEventListener("visibilitychange", handleVisibilityChange);
	actionControls.init();
	configureViewSwitchLink(remoteSwitchLink, "hole-cards.html", tableId, seatIndexParam);
	clearChipTransferAnimation(tableRenderTarget);
	seatRefs.forEach(clearRenderedSeat);
	setViewSwitchLinkVisible(remoteSwitchLink, false);
	renderCommunityCards(communityCardSlots, []);
	actionControls.hide();

	if (!tableId || seatIndexParam === null) {
		setNotification("Missing table link.");
		return;
	}

	setNotification("Loading table...");
	pollState();
}

globalThis.remoteTable = {
	init,
};

remoteTable.init();
