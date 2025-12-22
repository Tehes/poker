/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/
const cardSlots = document.querySelectorAll("img");
const nameBadge = document.querySelector("h3");
const chipsEl = document.querySelector(".total");
const urlParams = new URLSearchParams(globalThis.location.search);
const params = urlParams.get("params") ? urlParams.get("params").split("-") : [];
const tableId = urlParams.get("tableId") || "";
const seatIndexParam = params[4] ? parseInt(params[4], 10) : null;
const STATE_ENDPOINT = "https://poker.tehes.deno.net/state";
const REFRESH_INTERVAL = 5000;
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

function setCards(card1, card2) {
	if (card1) {
		cardSlots[0].src = `cards/${card1}.svg`;
	}
	if (card2) {
		cardSlots[1].src = `cards/${card2}.svg`;
	}
}

function setChips(amount) {
	if (typeof amount === "number") {
		chipsEl.textContent = amount;
	}
}

async function pollState() {
	try {
		const url = `${STATE_ENDPOINT}?tableId=${
			encodeURIComponent(tableId)
		}&sinceVersion=${lastVersion}`;
		const res = await fetch(url);
		if (res.status === 204) {
			return;
		}
		if (res.ok) {
			const payload = await res.json();
			lastVersion = payload.version;
			applyRemoteState(payload);
		}
	} catch (error) {
		console.warn("state fetch failed", error);
	}
	setTimeout(pollState, REFRESH_INTERVAL);
}

function applyRemoteState(payload) {
	if (!payload || !payload.state || !Array.isArray(payload.state.players)) return;
	const player = payload.state.players.find((p) => p.seatIndex === seatIndexParam);
	if (!player) return;

	setCards(player.cards?.[0], player.cards?.[1]);
	setChips(player.chips);
}

/* --------------------------------------------------------------------------------------------------
public members, exposed with return statement
---------------------------------------------------------------------------------------------------*/
globalThis.app = {
	init,
};

app.init();
