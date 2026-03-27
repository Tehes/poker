import { Hand } from "./pokersolver.js";

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

const BOT_REVEAL_CHANCE = 0.3;
const BOT_DOUBLE_REVEAL_HANDS = new Set(["Straight Flush", "Four of a Kind", "Full House"]);
const CARD_RANK_ORDER = "23456789TJQKA";
const MAX_WIN_PROBABILITY_BOARDS = 50000;

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

export function isAllInRunout(players, currentBet) {
	const activePlayers = players.filter((player) => !player.folded);
	const actionablePlayers = activePlayers.filter((player) => !player.allIn);
	if (activePlayers.length <= 1 || actionablePlayers.length > 1) {
		return false;
	}
	if (actionablePlayers.length === 0) {
		return true;
	}
	return actionablePlayers[0].roundBet === currentBet;
}

export function areHoleCardsFaceUp(player) {
	return player.visibleHoleCards.every(Boolean);
}

export function getSolvedHandCardCodes(solvedHand) {
	if (!solvedHand) {
		return [];
	}
	return solvedHand.cards.map((card) => `${card.value}${card.suit.toUpperCase()}`);
}

export function getHighestBoardRank(boardCards, rankOrder = CARD_RANK_ORDER) {
	return boardCards.reduce((highestRank, cardCode) => {
		if (!highestRank || rankOrder.indexOf(cardCode[0]) > rankOrder.indexOf(highestRank)) {
			return cardCode[0];
		}
		return highestRank;
	}, "");
}

export function getPlayerSolvedHand(player, communityCards) {
	if (!player.holeCards.every(Boolean) || communityCards.length < 3) {
		return null;
	}
	return Hand.solve([...player.holeCards, ...communityCards]);
}

export function getVisibleSolvedHand(player, communityCards) {
	if (!areHoleCardsFaceUp(player) || communityCards.length !== 5) {
		return null;
	}
	return Hand.solve([...player.holeCards, ...communityCards]);
}

export function getShortHandStrengthLabel(solvedHand) {
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

export function getPlayerHandStrengthLabel(player, communityCards) {
	const solvedHand = getPlayerSolvedHand(player, communityCards);
	if (!solvedHand) {
		return "";
	}
	return getShortHandStrengthLabel(solvedHand);
}

export function getBotRevealDecision(player, communityCards, randomValue = Math.random()) {
	if (!player.isBot || communityCards.length === 0) {
		return null;
	}
	if (randomValue >= BOT_REVEAL_CHANCE) {
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

export function getNextDealerIndex(players, randomValue = Math.random()) {
	if (players.length === 0) {
		return -1;
	}
	const currentDealerIndex = players.findIndex((player) => player.dealer);
	if (currentDealerIndex === -1) {
		const normalizedRandom = Math.min(Math.max(randomValue, 0), 0.9999999999999999);
		return Math.floor(normalizedRandom * players.length);
	}
	return (currentDealerIndex + 1) % players.length;
}

export function getBlindSeatIndexes(playerCount) {
	if (playerCount <= 1) {
		return { smallBlindIndex: 0, bigBlindIndex: 0 };
	}
	return {
		smallBlindIndex: playerCount > 2 ? 1 : 0,
		bigBlindIndex: playerCount > 2 ? 2 : 1,
	};
}

export function getBettingRoundStartIndex(players, currentPhaseIndex) {
	if (players.length === 0) {
		return 0;
	}
	if (currentPhaseIndex === 0) {
		const bigBlindIndex = players.findIndex((player) => player.bigBlind);
		return bigBlindIndex === -1 ? 0 : (bigBlindIndex + 1) % players.length;
	}
	const dealerIndex = players.findIndex((player) => player.dealer);
	return dealerIndex === -1 ? 0 : (dealerIndex + 1) % players.length;
}

export function calculateWinProbabilities(
	players,
	communityCards,
	deck,
	maxBoards = MAX_WIN_PROBABILITY_BOARDS,
) {
	const missingCount = 5 - communityCards.length;
	if (missingCount < 0) {
		return {
			status: "invalid_board",
			totalBoards: 0,
			boardsSeen: 0,
			activePlayers: [],
			probabilities: new Map(),
		};
	}

	const activePlayers = players.filter((player) => !player.folded);
	if (activePlayers.length === 0) {
		return {
			status: "no_players",
			totalBoards: 0,
			boardsSeen: 0,
			activePlayers,
			probabilities: new Map(),
		};
	}

	if (activePlayers.length === 1) {
		return {
			status: "ok",
			totalBoards: 1,
			boardsSeen: 1,
			activePlayers,
			probabilities: new Map([[activePlayers[0], 100]]),
		};
	}

	const totalBoards = combinationCount(deck.length, missingCount);
	if (totalBoards > maxBoards) {
		return {
			status: "too_many_boards",
			totalBoards,
			boardsSeen: 0,
			activePlayers,
			probabilities: new Map(),
		};
	}
	if (totalBoards === 0) {
		return {
			status: "no_boards",
			totalBoards,
			boardsSeen: 0,
			activePlayers,
			probabilities: new Map(),
		};
	}

	const scores = new Map();
	const playerHoles = activePlayers.map((player) => ({
		player,
		hole: player.holeCards.slice(),
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
		const winners = Hand.winners(entries.map((entry) => entry.handObj));
		const share = 1 / winners.length;
		winners.forEach((winnerHand) => {
			const winnerEntry = entries.find((entry) => entry.handObj === winnerHand);
			scores.set(winnerEntry.player, scores.get(winnerEntry.player) + share);
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
		return {
			status: "no_boards",
			totalBoards,
			boardsSeen,
			activePlayers,
			probabilities: new Map(),
		};
	}

	const probabilities = new Map();
	activePlayers.forEach((player) => {
		probabilities.set(player, (scores.get(player) / boardsSeen) * 100);
	});

	return {
		status: "ok",
		totalBoards,
		boardsSeen,
		activePlayers,
		probabilities,
	};
}
