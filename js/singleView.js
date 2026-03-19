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
const onlineOnlyElements = [betEl, potEl, notificationsEl];
const urlParams = new URLSearchParams(globalThis.location.search);
const tableId = urlParams.get("tableId") || "";
const STATE_ENDPOINT = "https://poker.tehes.deno.net/state";
const REFRESH_INTERVAL = 2500;
let lastVersion = 0;
let pollTimeoutId = null;
let isPolling = false;

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
	applyParams();
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
}

function renderNotifications(notifications) {
	notificationsEl.textContent = "";
	for (const message of notifications) {
		const item = document.createElement("div");
		item.textContent = message;
		notificationsEl.appendChild(item);
	}
}

// Constant polling is intentional.
// Poker tables have bursty activity; 204 does not imply inactivity ahead.
async function pollState() {
	if (isPolling || document.visibilityState !== "visible") {
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
	if (!player) return;
	nameBadge.textContent = player.name;
	const pot = payload.gameState.pot || 0;

	setCards(player.holeCards?.[0], player.holeCards?.[1], player.folded);
	setChips(player.chips, player.roundBet, pot);
	renderNotifications(payload.notifications);
}

/* --------------------------------------------------------------------------------------------------
public members, exposed with return statement
---------------------------------------------------------------------------------------------------*/
globalThis.app = {
	init,
};

app.init();
