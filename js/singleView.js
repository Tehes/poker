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
const params = urlParams.get("params") ? urlParams.get("params").split("-") : [];
const tableId = urlParams.get("tableId") || "";
const seatIndexParam = params[4] ? parseInt(params[4], 10) : null;
const STATE_ENDPOINT = "https://poker.tehes.deno.net/state";
const REFRESH_INTERVAL = 2500;
let lastVersion = 0;

/* --------------------------------------------------------------------------------------------------
functions
---------------------------------------------------------------------------------------------------*/

function init() {
	document.addEventListener("touchstart", function () {}, false);
	applyParams();
	pollState();
}

function applyParams() {
	const card1 = params[0];
	const card2 = params[1];
	const playerName = params[2];
	const chipsVal = Number.parseInt(params[3], 10);

	setCards(card1, card2);
	nameBadge.textContent = playerName;
	chipsEl.textContent = chipsVal;
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

async function pollState() {
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
		setTimeout(pollState, REFRESH_INTERVAL);
	}
}

function applyRemoteState(payload) {
	if (!payload || !payload.state || !Array.isArray(payload.state.players)) return;
	const player = payload.state.players.find((p) => p.seatIndex === seatIndexParam);
	if (!player) return;
	nameBadge.textContent = player.name;
	const pot = payload.state.pot || 0;

	setCards(player.cards?.[0], player.cards?.[1], player.folded);
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
