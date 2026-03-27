/* --------------------------------------------------------------------------------------------------
Engine Foundations
---------------------------------------------------------------------------------------------------*/

// Pure poker engine helpers and constants used by the table runtime.
// Current state: this module is intentionally partial; some legacy engine logic still lives in app.js
// and should move here gradually when it can be separated from DOM and runtime concerns.
// Target state: gameEngine.js should own pure poker rules and state transforms, while app.js only
// orchestrates browser-facing flow.
// Put code here when logic depends only on explicit inputs and can run without DOM, fetch, timers, or view objects.
// Do not add element refs, sync payload shaping, notification handling, or browser side effects here.
// Prefer extending this module or the existing shared modules instead of creating new ones.

export const PHASES = ["preflop", "flop", "turn", "river", "showdown"];

// Clubs, Diamonds, Hearts, Spades
// 2,3,4,5,6,7,8,9,T,J,Q,K,A
// deno-fmt-ignore-start
export const INITIAL_DECK = [
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

export const INITIAL_SMALL_BLIND = 10;
export const INITIAL_BIG_BLIND = 20;

export function shuffleArray(array) {
	let i = array.length;
	while (i) {
		const j = Math.floor(Math.random() * i);
		const t = array[--i];
		array[i] = array[j];
		array[j] = t;
	}
	return array;
}

export function getCurrentPhase(currentPhaseIndex, phases = PHASES) {
	return phases[currentPhaseIndex] ?? null;
}

export function takeDeckCard(deck) {
	return deck.shift() ?? null;
}

export function trackUsedCard(cardGraveyard, cardCode) {
	if (cardCode) {
		cardGraveyard.push(cardCode);
	}
	return cardCode;
}

export function getOddChipOrder(players, winners) {
	const winnerSet = new Set(winners);
	const dealerIdx = players.findIndex((player) => player.dealer);
	const orderedWinners = [];

	if (dealerIdx === -1) {
		return winners.slice().sort((a, b) => a.seatIndex - b.seatIndex);
	}

	for (let offset = 1; offset <= players.length; offset++) {
		const player = players[(dealerIdx + offset) % players.length];
		if (winnerSet.has(player)) {
			orderedWinners.push(player);
		}
	}

	return orderedWinners;
}

export function buildSplitPayouts(amount, winners, players, chipUnit = 10) {
	const share = Math.floor(amount / winners.length / chipUnit) * chipUnit;
	let remainder = amount - share * winners.length;
	const payouts = new Map(winners.map((player) => [player, share]));
	const oddChipOrder = getOddChipOrder(players, winners);

	for (const player of oddChipOrder) {
		if (remainder < chipUnit) {
			break;
		}
		payouts.set(player, payouts.get(player) + chipUnit);
		remainder -= chipUnit;
	}

	return payouts;
}

export function combinationCount(n, k) {
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
