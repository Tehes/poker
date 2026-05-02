import { Hand } from "./pokersolver.js";
import { getPlayerActionState } from "./shared/actionModel.js";

/* ==================================================================================================
MODULE BOUNDARY: Pure Poker Engine
================================================================================================== */

// CURRENT STATE: Owns hand evaluation, payout math, showdown resolution, turn-action resolution,
// betting-round progress decisions, and other pure poker helpers used by the table runtime. Some
// street setup/reset orchestration still remains in app.js.
// TARGET STATE: gameEngine.js should own every pure poker rule and state transform that can run
// without DOM, fetch, timers, or view objects, while app.js only orchestrates browser-facing flow.
// PUT HERE: Deterministic poker rules, hand evaluation, payouts, betting order helpers, and state
// transforms derived from explicit inputs.
// DO NOT PUT HERE: Element refs, sync payload shaping, notification handling, network access, or
// browser side effects.
// PREFERENCE: Extend this module or the existing shared modules before creating new modules.

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
export const BLIND_LEVEL_HAND_INTERVAL = 6;
export const BLIND_GROWTH_FACTOR = 1.3;
export const BLIND_BIG_BLIND_STEP = 20;

const BOT_REVEAL_CHANCE = 0.3;
const BOT_DOUBLE_REVEAL_HANDS = new Set(["Straight Flush", "Four of a Kind", "Full House"]);
const CARD_RANK_ORDER = "23456789TJQKA";
const MAX_WIN_PROBABILITY_BOARDS = 50000;
const NICE_BIG_BLIND_FACTORS = [1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.4, 2.5, 3, 4, 5, 6, 8];

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

export function getBlindLevelForHand(totalHands, handsPerLevel = BLIND_LEVEL_HAND_INTERVAL) {
	if (totalHands <= 0) {
		return 0;
	}
	return Math.floor((totalHands - 1) / handsPerLevel);
}

export function getBigBlindForLevel(
	level,
	previousBigBlind = INITIAL_BIG_BLIND,
	initialBigBlind = INITIAL_BIG_BLIND,
	growthFactor = BLIND_GROWTH_FACTOR,
	bigBlindStep = BLIND_BIG_BLIND_STEP,
) {
	if (level <= 0) {
		return initialBigBlind;
	}
	const targetBigBlind = initialBigBlind * Math.pow(growthFactor, level);
	const safeCandidates = getNiceBigBlindCandidates(
		targetBigBlind,
		previousBigBlind,
		bigBlindStep,
	);
	const nextBigBlind = safeCandidates.reduce((closest, candidate) => {
		if (candidate <= previousBigBlind) {
			return closest;
		}
		if (closest === null) {
			return candidate;
		}
		const candidateDistance = Math.abs(candidate - targetBigBlind);
		const closestDistance = Math.abs(closest - targetBigBlind);
		if (candidateDistance < closestDistance) {
			return candidate;
		}
		if (candidateDistance === closestDistance && candidate < closest) {
			return candidate;
		}
		return closest;
	}, null);

	if (nextBigBlind !== null) {
		return nextBigBlind;
	}

	return previousBigBlind + bigBlindStep;
}

function getNiceBigBlindCandidates(targetBigBlind, previousBigBlind, bigBlindStep) {
	const baseline = Math.max(targetBigBlind, previousBigBlind + bigBlindStep, INITIAL_BIG_BLIND);
	const exponent = Math.floor(Math.log10(baseline));
	const candidates = new Set([INITIAL_BIG_BLIND]);

	for (let power = Math.max(1, exponent - 1); power <= exponent + 1; power++) {
		const scale = Math.pow(10, power);
		for (const factor of NICE_BIG_BLIND_FACTORS) {
			const candidate = factor * scale;
			if (Number.isInteger(candidate) && candidate % bigBlindStep === 0) {
				candidates.add(candidate);
			}
		}
	}

	return Array.from(candidates).sort((a, b) => a - b);
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

function buildSidePots(contributors) {
	const sidePots = [];
	const sorted = contributors.slice().sort((a, b) => a.totalBet - b.totalBet);
	let previousLevel = 0;

	for (let i = 0; i < sorted.length; i++) {
		const level = sorted[i].totalBet;
		const diff = level - previousLevel;
		if (diff <= 0) {
			continue;
		}
		const eligible = sorted.slice(i);
		sidePots.push({
			amount: diff * eligible.length,
			eligible,
		});
		previousLevel = level;
	}

	return sidePots;
}

function mergeEquivalentSidePots(sidePots) {
	for (let i = 0; i < sidePots.length - 1;) {
		const eligibleA = sidePots[i].eligible.filter((player) => !player.folded);
		const eligibleB = sidePots[i + 1].eligible.filter((player) => !player.folded);

		const sameEligible = eligibleA.length === eligibleB.length &&
			eligibleA.every((player) => eligibleB.includes(player));

		if (sameEligible) {
			sidePots[i].amount += sidePots[i + 1].amount;
			sidePots.splice(i + 1, 1);
		} else {
			i++;
		}
	}

	return sidePots;
}

function buildTotalPayoutByPlayer(transferQueue) {
	return transferQueue.reduce((payouts, transfer) => {
		const currentTotal = payouts.get(transfer.player) || 0;
		payouts.set(transfer.player, currentTotal + transfer.amount);
		return payouts;
	}, new Map());
}

export function resolveShowdown(players, communityCards, chipUnit = 10) {
	const activePlayers = players.filter((player) => !player.folded);
	const contributors = players.filter((player) => player.totalBet > 0);
	const totalPot = contributors.reduce((sum, player) => sum + player.totalBet, 0);
	const hadShowdown = activePlayers.length > 1;
	const emptyResult = {
		activePlayers,
		contributors,
		hadShowdown,
		uncontestedWinner: null,
		mainPotWinners: [],
		winningPlayers: [],
		transferQueue: [],
		potResults: [],
		totalPayoutByPlayer: new Map(),
		totalPot,
	};

	if (activePlayers.length === 0) {
		return emptyResult;
	}

	if (activePlayers.length === 1) {
		const winner = activePlayers[0];
		const transferQueue = [{ player: winner, amount: totalPot }];
		return {
			...emptyResult,
			uncontestedWinner: winner,
			mainPotWinners: [winner],
			winningPlayers: [winner],
			transferQueue,
			totalPayoutByPlayer: buildTotalPayoutByPlayer(transferQueue),
		};
	}

	const sidePots = mergeEquivalentSidePots(buildSidePots(contributors));
	const transferQueue = [];
	const potResults = [];
	let mainPotWinners = [];
	const winningPlayers = new Set();

	sidePots.forEach((sidePot, potIndex) => {
		const eligiblePlayers = sidePot.eligible.filter((player) => !player.folded);
		if (eligiblePlayers.length === 0) {
			return;
		}

		if (eligiblePlayers.length === 1) {
			const solePlayer = eligiblePlayers[0];
			const isRefundOnly = sidePot.eligible.length === 1;
			if (potIndex === 0) {
				mainPotWinners = [solePlayer];
			}
			transferQueue.push({ player: solePlayer, amount: sidePot.amount });
			if (!isRefundOnly) {
				winningPlayers.add(solePlayer);
			}
			potResults.push({
				players: [solePlayer.name],
				amount: sidePot.amount,
				hand: null,
				isRefundOnly,
			});
			return;
		}

		const handEntries = eligiblePlayers.map((player) => ({
			player,
			handObj: Hand.solve([...player.holeCards, ...communityCards]),
		}));
		const winningHands = Hand.winners(handEntries.map((entry) => entry.handObj));
		const potWinners = winningHands.map((winnerHand) => {
			const winnerEntry = handEntries.find((entry) => entry.handObj === winnerHand);
			return winnerEntry.player;
		});
		const splitPayouts = buildSplitPayouts(sidePot.amount, potWinners, players, chipUnit);

		if (potIndex === 0) {
			mainPotWinners = potWinners.slice();
		}

		winningHands.forEach((winnerHand) => {
			const winnerEntry = handEntries.find((entry) => entry.handObj === winnerHand);
			winningPlayers.add(winnerEntry.player);
			transferQueue.push({
				player: winnerEntry.player,
				amount: splitPayouts.get(winnerEntry.player) || 0,
			});
		});

		if (winningHands.length === 1) {
			const winnerEntry = handEntries.find((entry) => entry.handObj === winningHands[0]);
			potResults.push({
				players: [winnerEntry.player.name],
				amount: sidePot.amount,
				hand: winningHands[0].name,
				isRefundOnly: false,
			});
			return;
		}

		potResults.push({
			players: winningHands.map((winnerHand) => {
				const winnerEntry = handEntries.find((entry) => entry.handObj === winnerHand);
				return winnerEntry.player.name;
			}),
			amount: sidePot.amount,
			hand: null,
			isRefundOnly: false,
		});
	});

	return {
		...emptyResult,
		mainPotWinners,
		winningPlayers: Array.from(winningPlayers),
		transferQueue,
		potResults,
		totalPayoutByPlayer: buildTotalPayoutByPlayer(transferQueue),
	};
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

function buildEmptyTurnActionResolution(action, amount, actionMeta = {}) {
	return {
		action,
		amount,
		actionMeta,
		playerPatch: {},
		gameStatePatch: {},
	};
}

function buildBetPlayerPatch(player, amount) {
	const actual = Math.min(amount, player.chips);
	const nextChips = player.chips - actual;
	const playerPatch = {
		roundBet: player.roundBet + actual,
		totalBet: player.totalBet + actual,
		chips: nextChips,
	};
	if (nextChips === 0) {
		playerPatch.allIn = true;
	}

	return {
		actual,
		playerPatch,
	};
}

function buildPotPatch(gameState, amount) {
	return {
		pot: gameState.pot + amount,
	};
}

function buildAllInActionResolution(gameState, player, currentActionState) {
	if (player.chips <= 0) {
		return null;
	}

	const { actual, playerPatch } = buildBetPlayerPatch(player, player.chips);
	const nextRoundBet = playerPatch.roundBet;
	const isAggressiveAllIn = actual > currentActionState.needToCall;
	const gameStatePatch = buildPotPatch(gameState, actual);

	if (actual >= currentActionState.minRaise) {
		gameStatePatch.currentBet = nextRoundBet;
		gameStatePatch.lastRaise = actual - currentActionState.needToCall;
		gameStatePatch.raisesThisRound = gameState.raisesThisRound + 1;
	} else if (actual >= currentActionState.needToCall) {
		gameStatePatch.currentBet = Math.max(gameState.currentBet, nextRoundBet);
	}

	return {
		action: "allin",
		amount: actual,
		actionMeta: {
			aggressive: isAggressiveAllIn,
			voluntary: actual > 0,
		},
		playerPatch,
		gameStatePatch,
	};
}

function buildCallActionResolution(gameState, player, currentActionState) {
	if (currentActionState.needToCall <= 0) {
		return null;
	}

	const callAmount = Math.min(player.chips, currentActionState.needToCall);
	if (callAmount === player.chips && player.chips > 0) {
		return buildAllInActionResolution(gameState, player, currentActionState);
	}

	const { actual, playerPatch } = buildBetPlayerPatch(player, callAmount);

	return {
		action: "call",
		amount: actual,
		actionMeta: {
			aggressive: false,
			voluntary: actual > 0,
		},
		playerPatch,
		gameStatePatch: buildPotPatch(gameState, actual),
	};
}

function buildRaiseActionResolution(gameState, player, actionRequest, currentActionState) {
	let bet = Number.parseInt(actionRequest.amount, 10);
	if (Number.isNaN(bet)) {
		return null;
	}
	if (bet >= player.chips && player.chips > 0) {
		return buildAllInActionResolution(gameState, player, currentActionState);
	}
	if (bet < currentActionState.minRaise && bet < player.chips) {
		bet = Math.min(player.chips, currentActionState.minRaise);
	}
	if (bet > currentActionState.maxRaiseAmount && bet < player.chips) {
		bet = currentActionState.maxRaiseAmount;
	}
	if (bet < currentActionState.minRaise && bet < player.chips) {
		return currentActionState.canCheck
			? buildEmptyTurnActionResolution("check", 0, {
				aggressive: false,
				voluntary: false,
			})
			: buildCallActionResolution(gameState, player, currentActionState);
	}
	if (bet >= player.chips && player.chips > 0) {
		return buildAllInActionResolution(gameState, player, currentActionState);
	}

	const { actual, playerPatch } = buildBetPlayerPatch(player, bet);
	const gameStatePatch = buildPotPatch(gameState, actual);
	if (actual > currentActionState.needToCall) {
		gameStatePatch.currentBet = playerPatch.roundBet;
		gameStatePatch.lastRaise = actual - currentActionState.needToCall;
		gameStatePatch.raisesThisRound = gameState.raisesThisRound + 1;
	}

	return {
		action: "raise",
		amount: actual,
		actionMeta: {
			aggressive: actual > currentActionState.needToCall,
			voluntary: actual > 0,
		},
		playerPatch,
		gameStatePatch,
	};
}

export function resolveTurnAction(gameState, player, actionRequest) {
	if (!gameState || !player || !actionRequest || player.folded || player.allIn) {
		return null;
	}

	const currentActionState = getPlayerActionState(gameState, player);

	switch (actionRequest.action) {
		case "fold":
			return {
				action: "fold",
				amount: 0,
				actionMeta: {
					aggressive: false,
					voluntary: false,
				},
				playerPatch: {
					folded: true,
				},
				gameStatePatch: {},
			};
		case "check":
			if (!currentActionState.canCheck) {
				return null;
			}
			return buildEmptyTurnActionResolution("check", 0, {
				aggressive: false,
				voluntary: false,
			});
		case "call":
			return buildCallActionResolution(gameState, player, currentActionState);
		case "allin":
			return buildAllInActionResolution(gameState, player, currentActionState);
		case "raise":
			return buildRaiseActionResolution(gameState, player, actionRequest, currentActionState);
		default:
			return null;
	}
}

export function createHandContextState() {
	return {
		preflopRaiseCount: 0,
		preflopAggressorSeatIndex: null,
		streetAggressorSeatIndex: null,
		flopCheckedThrough: false,
		turnCheckedThrough: false,
		streetCheckCounts: {
			flop: 0,
			turn: 0,
			river: 0,
		},
		streetAggressiveActionCounts: {
			flop: 0,
			turn: 0,
			river: 0,
		},
	};
}

export function createPlayerSpotState() {
	return {
		actedThisStreet: false,
		voluntaryThisStreet: false,
		aggressiveThisStreet: false,
		enteredPreflop: false,
	};
}

function ensureHandContext(gameState) {
	if (!gameState.handContext) {
		gameState.handContext = createHandContextState();
	}
	return gameState.handContext;
}

function ensurePlayerSpotState(player) {
	if (!player.spotState) {
		player.spotState = createPlayerSpotState();
	}
	return player.spotState;
}

export function recordPlayerActionStats(gameState, player, actionName, actionMeta = {}) {
	if (!gameState || !player) {
		return;
	}

	const handContext = ensureHandContext(gameState);
	const spotState = ensurePlayerSpotState(player);
	const isVoluntaryAction = actionMeta.voluntary ??
		(actionName === "call" || actionName === "raise" || actionName === "allin");
	const isAggressiveAction = actionMeta.aggressive ??
		(actionName === "raise" || actionName === "allin");

	spotState.actedThisStreet = true;
	if (isVoluntaryAction) {
		spotState.voluntaryThisStreet = true;
	}
	if (isAggressiveAction) {
		spotState.aggressiveThisStreet = true;
		handContext.streetAggressorSeatIndex = player.seatIndex;
	}
	const phase = getCurrentPhase(gameState.currentPhaseIndex);
	if (phase === "flop" || phase === "turn" || phase === "river") {
		if (!handContext.streetCheckCounts) {
			handContext.streetCheckCounts = createHandContextState().streetCheckCounts;
		}
		if (!handContext.streetAggressiveActionCounts) {
			handContext.streetAggressiveActionCounts = createHandContextState().streetAggressiveActionCounts;
		}
		if (actionName === "check") {
			handContext.streetCheckCounts[phase] =
				(handContext.streetCheckCounts[phase] ?? 0) + 1;
		}
		if (isAggressiveAction) {
			handContext.streetAggressiveActionCounts[phase] =
				(handContext.streetAggressiveActionCounts[phase] ?? 0) + 1;
		}
	}
	if (gameState.currentPhaseIndex === 0 && isVoluntaryAction) {
		spotState.enteredPreflop = true;
	}

	if (gameState.currentPhaseIndex === 0) {
		if (isVoluntaryAction) {
			player.stats.vpip++;
		}
		if (isAggressiveAction) {
			player.stats.pfr++;
			handContext.preflopRaiseCount++;
			handContext.preflopAggressorSeatIndex = player.seatIndex;
		}
	} else {
		if (isAggressiveAction) {
			player.stats.aggressiveActs++;
		}
		if (actionName === "call") {
			player.stats.calls++;
		}
	}

	if (gameState.currentPhaseIndex === 0 && isAggressiveAction) {
		gameState.players.forEach((currentPlayer) => {
			if (currentPlayer.botLine) {
				currentPlayer.botLine.preflopAggressor = false;
			}
		});
		if (player.botLine) {
			player.botLine.preflopAggressor = true;
		}
	}

	if (actionName === "allin") {
		player.stats.allins++;
	}

	if (actionName === "fold") {
		player.stats.folds++;
		if (gameState.currentPhaseIndex === 0) {
			player.stats.foldsPreflop++;
		} else {
			player.stats.foldsPostflop++;
		}
	}
}

export function getPlayerActionFollowUpEffects(gameState, player, actionName) {
	const followUpEffects = {
		clearWinProbability: actionName === "fold",
		refreshHandStrength: actionName === "fold",
		revealActiveHoleCards: false,
		recomputeSpectatorWinProbabilities: false,
		probabilityReason: "",
		skipProbabilityLogReason: "",
	};

	if (!gameState || !player) {
		return followUpEffects;
	}

	if (actionName !== "check" && isAllInRunout(gameState.players, gameState.currentBet)) {
		followUpEffects.revealActiveHoleCards = true;
		if (gameState.currentPhaseIndex > 0) {
			followUpEffects.recomputeSpectatorWinProbabilities = true;
			followUpEffects.probabilityReason = "allin-runout";
		} else {
			followUpEffects.skipProbabilityLogReason = "allin-runout-preflop";
		}
		return followUpEffects;
	}

	if (gameState.spectatorMode && actionName === "fold") {
		if (gameState.currentPhaseIndex > 0) {
			followUpEffects.recomputeSpectatorWinProbabilities = true;
			followUpEffects.probabilityReason = "fold";
		} else {
			followUpEffects.skipProbabilityLogReason = "fold-preflop";
		}
	}

	return followUpEffects;
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

export function createBettingRoundProgressState(gameState) {
	return {
		nextIndex: getBettingRoundStartIndex(gameState.players, gameState.currentPhaseIndex),
		cycles: 0,
	};
}

export function getBettingRoundStartExit(gameState) {
	const activePlayers = gameState.players.filter((player) => !player.folded);
	const actionablePlayers = activePlayers.filter((player) => !player.allIn);
	if (activePlayers.length > 1 && actionablePlayers.length > 1) {
		return null;
	}

	return {
		type: "advance",
		reason: "startBettingRound",
		activePlayerCount: activePlayers.length,
		actionablePlayerCount: actionablePlayers.length,
	};
}

export function hasPendingBettingRoundAction(gameState, cycles) {
	if (gameState.currentBet === 0) {
		return cycles < gameState.players.filter((player) => !player.folded && !player.allIn).length;
	}
	return gameState.players.some((player) =>
		!player.folded && !player.allIn && player.roundBet < gameState.currentBet
	);
}

function shouldMatchedPlayerActThisPass(gameState, cycles) {
	return (gameState.currentPhaseIndex === 0 && cycles <= gameState.players.length) ||
		(
			gameState.currentPhaseIndex > 0 &&
			gameState.currentBet === 0 &&
			cycles <= gameState.players.length
		);
}

export function getNextBettingRoundStep(gameState, progressState) {
	const activePlayers = gameState.players.filter((player) => !player.folded);
	const actionablePlayers = activePlayers.filter((player) => !player.allIn);
	if (activePlayers.length <= 1 || actionablePlayers.length === 0) {
		return {
			type: "advance",
			reason: "nextPlayer",
			activePlayers,
			progressState,
		};
	}

	const index = progressState.nextIndex % gameState.players.length;
	const player = gameState.players[index];
	const nextProgressState = {
		nextIndex: progressState.nextIndex + 1,
		cycles: progressState.cycles + 1,
	};

	if (player.folded || player.allIn) {
		return {
			type: "skip",
			reason: "foldedAllIn",
			player,
			index,
			previousCycles: progressState.cycles,
			cycles: nextProgressState.cycles,
			progressState: nextProgressState,
		};
	}

	if (player.roundBet >= gameState.currentBet) {
		if (shouldMatchedPlayerActThisPass(gameState, nextProgressState.cycles)) {
			return {
				type: "act",
				reason: "firstPassMatched",
				player,
				index,
				previousCycles: progressState.cycles,
				cycles: nextProgressState.cycles,
				progressState: nextProgressState,
			};
		}
		if (hasPendingBettingRoundAction(gameState, nextProgressState.cycles)) {
			return {
				type: "skip",
				reason: "waitUncalled",
				player,
				index,
				previousCycles: progressState.cycles,
				cycles: nextProgressState.cycles,
				progressState: nextProgressState,
			};
		}
		return {
			type: "advance",
			reason: "matched",
			player,
			index,
			previousCycles: progressState.cycles,
			cycles: nextProgressState.cycles,
			progressState: nextProgressState,
		};
	}

	return {
		type: "act",
		reason: "owesAction",
		player,
		index,
		previousCycles: progressState.cycles,
		cycles: nextProgressState.cycles,
		progressState: nextProgressState,
	};
}

export function getResolvedTurnContinuation(gameState, cycles) {
	if (cycles < gameState.players.length) {
		return { type: "next" };
	}
	if (hasPendingBettingRoundAction(gameState, cycles)) {
		return { type: "wait" };
	}
	return { type: "advance" };
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
