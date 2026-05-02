import { Hand } from "./pokersolver.js";
import { getPlayerActionState } from "./shared/actionModel.js";

/* ==================================================================================================
MODULE BOUNDARY: Pure Poker Engine
================================================================================================== */

// CURRENT STATE: Owns hand evaluation, payout math, showdown resolution, showdown commit state,
// hand-end/next-hand transition state, a browserless hand runner, hand-start setup, turn-action
// resolution, betting-round start state, betting-round progress decisions, street progression
// decisions, and other pure poker helpers used by the table runtime. Browser scheduling and
// rendering remain in app.js.
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

function buildShowdownStatsPatch(player, showdownResult) {
	if (!player.stats) {
		return null;
	}

	const isActive = showdownResult.activePlayers.includes(player);
	const isWinner = showdownResult.winningPlayers.includes(player);
	const patch = {};
	if (showdownResult.hadShowdown && isActive) {
		patch.showdowns = player.stats.showdowns + 1;
	}
	if (isWinner) {
		patch.handsWon = player.stats.handsWon + 1;
		if (showdownResult.hadShowdown) {
			patch.showdownsWon = player.stats.showdownsWon + 1;
		}
	}
	if (Object.keys(patch).length === 0) {
		return null;
	}
	return {
		...player.stats,
		...patch,
	};
}

export function createShowdownCommitPlan(gameState, showdownResult) {
	const playerPatches = [];
	const payoutPlayerPatches = [];
	const mainPotWinnerSet = new Set(showdownResult.mainPotWinners);

	gameState.players.forEach((player) => {
		const patch = {
			roundBet: 0,
		};
		const statsPatch = buildShowdownStatsPatch(player, showdownResult);
		if (statsPatch) {
			patch.stats = statsPatch;
		}
		if (showdownResult.hadShowdown && showdownResult.activePlayers.includes(player)) {
			patch.visibleHoleCards = [true, true];
		}
		if (mainPotWinnerSet.has(player)) {
			patch.isWinner = true;
		}
		addPlayerPatch(playerPatches, player, patch);

		const payout = showdownResult.totalPayoutByPlayer.get(player) || 0;
		if (payout > 0) {
			addPlayerPatch(payoutPlayerPatches, player, {
				chips: player.chips + payout,
			});
		}
	});

	return {
		playerPatches,
		payoutPlayerPatches,
		payoutGameStatePatch: {
			pot: 0,
		},
		transferQueue: showdownResult.transferQueue.slice(),
		revealPlayers: showdownResult.hadShowdown
			? showdownResult.activePlayers.slice()
			: [],
		mainPotWinners: showdownResult.mainPotWinners.slice(),
		winningPlayers: showdownResult.winningPlayers.slice(),
	};
}

export function createHandEndPlan() {
	return {
		gameStatePatch: {
			pot: 0,
			handInProgress: false,
			activeSeatIndex: null,
			pendingAction: null,
			chipTransfer: null,
		},
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

export function createBotLineState() {
	return {
		preflopAggressor: false,
		cbetIntent: null,
		barrelIntent: null,
		cbetMade: false,
		barrelMade: false,
		nonValueAggressionMade: false,
		checkRaiseIntent: null,
		passiveValueCheckIntent: null,
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
		if (player.stats && isVoluntaryAction) {
			player.stats.vpip++;
		}
		if (player.stats && isAggressiveAction) {
			player.stats.pfr++;
		}
		if (isAggressiveAction) {
			handContext.preflopRaiseCount++;
			handContext.preflopAggressorSeatIndex = player.seatIndex;
		}
	} else {
		if (player.stats && isAggressiveAction) {
			player.stats.aggressiveActs++;
		}
		if (player.stats && actionName === "call") {
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

	if (player.stats && actionName === "allin") {
		player.stats.allins++;
	}

	if (player.stats && actionName === "fold") {
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

function buildNextHandStats(stats) {
	if (!stats) {
		return stats;
	}
	return {
		...stats,
		hands: (stats.hands ?? 0) + 1,
	};
}

function addPlayerPatch(playerPatches, player, patch) {
	const existingPatch = playerPatches.find((entry) => entry.player === player);
	if (existingPatch) {
		Object.assign(existingPatch.patch, patch);
		return;
	}
	playerPatches.push({ player, patch: { ...patch } });
}

function buildCommittedBetPatch(player, amount) {
	const actual = Math.min(amount, player.chips);
	const nextChips = player.chips - actual;
	const patch = {
		roundBet: player.roundBet + actual,
		totalBet: player.totalBet + actual,
		chips: nextChips,
	};
	if (nextChips === 0) {
		patch.allIn = true;
	}
	return { actual, patch };
}

export function resetPlayersForNewHand(gameState) {
	const playerPatches = [];
	const remainingPlayers = [];
	const bustedPlayers = [];

	gameState.players.forEach((player) => {
		const patch = {
			folded: false,
			allIn: false,
			totalBet: 0,
			roundBet: 0,
			winProbability: null,
			lastNonFinalWinProbability: null,
			isWinner: false,
			winnerReactionEmoji: "",
			winnerReactionUntil: 0,
			holeCards: [null, null],
			visibleHoleCards: [false, false],
		};

		if (player.chips <= 0) {
			patch.chips = 0;
			bustedPlayers.push(player);
		} else {
			remainingPlayers.push(player);
			const nextStats = buildNextHandStats(player.stats);
			if (nextStats) {
				patch.stats = nextStats;
			}
			patch.botLine = createBotLineState();
			patch.spotState = createPlayerSpotState();
		}

		addPlayerPatch(playerPatches, player, patch);
	});

	const humanCount = remainingPlayers.filter((player) => !player.isBot).length;

	return {
		playerPatches,
		bustedPlayers,
		remainingPlayers,
		gameStatePatch: {
			currentPhaseIndex: 0,
			gameFinished: false,
			handInProgress: false,
			chipTransfer: null,
			communityCards: [],
			players: remainingPlayers,
			openCardsMode: humanCount === 1,
			spectatorMode: humanCount === 0,
			handContext: createHandContextState(),
		},
	};
}

export function createNextHandTransitionPlan(gameState, handId) {
	const resetPlan = resetPlayersForNewHand(gameState);
	const gameStatePatch = {
		...resetPlan.gameStatePatch,
		pot: 0,
		currentBet: 0,
		raisesThisRound: 0,
		activeSeatIndex: null,
		pendingAction: null,
	};
	if (resetPlan.remainingPlayers.length === 1) {
		const champion = resetPlan.remainingPlayers[0];
		addPlayerPatch(resetPlan.playerPatches, champion, {
			isWinner: true,
		});
		return {
			type: "game-over",
			champion,
			playerPatches: resetPlan.playerPatches,
			bustedPlayers: resetPlan.bustedPlayers,
			remainingPlayers: resetPlan.remainingPlayers,
			gameStatePatch: {
				...gameStatePatch,
				gameFinished: true,
				handInProgress: false,
			},
		};
	}

	return {
		type: "next-hand",
		champion: null,
		playerPatches: resetPlan.playerPatches,
		bustedPlayers: resetPlan.bustedPlayers,
		remainingPlayers: resetPlan.remainingPlayers,
		gameStatePatch: {
			...gameStatePatch,
			gameFinished: false,
			handInProgress: true,
			handId,
			nextDecisionId: 1,
		},
	};
}

function applyEnginePlayerPatches(playerPatches) {
	playerPatches.forEach(({ player, patch }) => {
		Object.assign(player, patch);
	});
}

function applyEngineGameStatePatch(gameState, gameStatePatch) {
	Object.assign(gameState, gameStatePatch);
}

function applyEngineHandContextPatch(gameState, handContextPatch) {
	if (!handContextPatch) {
		return;
	}
	if (!gameState.handContext) {
		gameState.handContext = createHandContextState();
	}
	Object.assign(gameState.handContext, handContextPatch);
}

function createEngineHandRunResult(handId, maxSteps) {
	return {
		type: "running",
		handId,
		maxSteps,
		stepCount: 0,
		nextHandPlan: null,
		blindLevelUpdate: null,
		dealerPlan: null,
		blindPlan: null,
		dealPlan: null,
		roundStartPlans: [],
		bettingSteps: [],
		bettingRoundExits: [],
		actions: [],
		continuations: [],
		phasePlans: [],
		communityDealPlans: [],
		showdownResult: null,
		showdownCommitPlan: null,
		handEndPlan: null,
		invalidAction: null,
	};
}

function finishEngineHandRun(result, type, patch = {}) {
	Object.assign(result, patch);
	result.type = type;
	return result;
}

function commitResolvedEngineAction(gameState, player, actionRequest) {
	const resolvedAction = resolveTurnAction(gameState, player, actionRequest);
	if (!resolvedAction) {
		return null;
	}

	Object.assign(player, resolvedAction.playerPatch);
	Object.assign(gameState, resolvedAction.gameStatePatch);
	recordPlayerActionStats(
		gameState,
		player,
		resolvedAction.action,
		resolvedAction.actionMeta,
	);
	return resolvedAction;
}

function runEngineBettingRound(gameState, actionProvider, result) {
	const roundStartPlan = createBettingRoundStartPlan(gameState);
	applyEnginePlayerPatches(roundStartPlan.playerPatches);
	applyEngineGameStatePatch(gameState, roundStartPlan.gameStatePatch);
	applyEngineHandContextPatch(gameState, roundStartPlan.handContextPatch);
	result.roundStartPlans.push(roundStartPlan);

	const startExit = getBettingRoundStartExit(gameState);
	if (startExit) {
		result.bettingRoundExits.push(startExit);
		return { type: "advance", reason: startExit.reason };
	}

	let progressState = createBettingRoundProgressState(gameState);
	while (true) {
		result.stepCount++;
		if (result.stepCount > result.maxSteps) {
			return { type: "max-steps" };
		}

		const step = getNextBettingRoundStep(gameState, progressState);
		result.bettingSteps.push(step);
		if (step.progressState) {
			progressState = step.progressState;
		}

		if (step.type === "skip") {
			continue;
		}
		if (step.type === "advance") {
			result.bettingRoundExits.push(step);
			return { type: "advance", reason: step.reason };
		}

		const actionRequest = actionProvider(gameState, step.player, step, result);
		const resolvedAction = commitResolvedEngineAction(
			gameState,
			step.player,
			actionRequest,
		);
		if (!resolvedAction) {
			return {
				type: "invalid-action",
				player: step.player,
				actionRequest,
				step,
			};
		}

		result.actions.push({
			phase: getCurrentPhase(gameState.currentPhaseIndex),
			player: step.player,
			actionRequest,
			resolvedAction,
			step,
		});

		const continuation = getResolvedTurnContinuation(gameState, step.cycles);
		result.continuations.push({
			player: step.player,
			action: resolvedAction.action,
			cycles: step.cycles,
			continuation,
		});
		if (continuation.type === "advance") {
			return { type: "advance", reason: resolvedAction.action };
		}
	}
}

function advanceEngineHandRunPhase(gameState, result) {
	const phasePlan = getNextPhasePlan(gameState);
	result.phasePlans.push(phasePlan);
	if (phasePlan.reason === "onlyActivePlayer") {
		return { type: "showdown" };
	}

	applyEngineGameStatePatch(gameState, phasePlan.gameStatePatch);
	applyEngineHandContextPatch(gameState, phasePlan.handContextPatch);
	if (phasePlan.type === "deal") {
		const dealPlan = dealCommunityCardsForPhase(gameState, phasePlan.cardsToDeal);
		if (!dealPlan) {
			return { type: "deal-error", phasePlan };
		}
		applyEngineGameStatePatch(gameState, dealPlan.gameStatePatch);
		result.communityDealPlans.push(dealPlan);
		return { type: "continue" };
	}

	return { type: "showdown" };
}

function commitEngineShowdown(gameState, result, chipUnit) {
	const showdownResult = resolveShowdown(gameState.players, gameState.communityCards, chipUnit);
	const showdownCommitPlan = createShowdownCommitPlan(gameState, showdownResult);
	applyEnginePlayerPatches(showdownCommitPlan.playerPatches);
	applyEnginePlayerPatches(showdownCommitPlan.payoutPlayerPatches);
	applyEngineGameStatePatch(gameState, showdownCommitPlan.payoutGameStatePatch);

	const handEndPlan = createHandEndPlan(gameState);
	applyEngineGameStatePatch(gameState, handEndPlan.gameStatePatch);

	result.showdownResult = showdownResult;
	result.showdownCommitPlan = showdownCommitPlan;
	result.handEndPlan = handEndPlan;
}

export function runEngineHand(gameState, actionProvider, options = {}) {
	const handId = options.handId ?? gameState.handId ?? 1;
	const maxSteps = options.maxSteps ?? 1000;
	const chipUnit = options.chipUnit ?? 10;
	const dealerRandomValue = options.dealerRandomValue ?? 0;
	const shuffleFn = options.shuffleFn ?? shuffleArray;
	const result = createEngineHandRunResult(handId, maxSteps);

	if (typeof actionProvider !== "function") {
		return finishEngineHandRun(result, "invalid-action-provider");
	}

	const nextHandPlan = createNextHandTransitionPlan(gameState, handId);
	applyEnginePlayerPatches(nextHandPlan.playerPatches);
	applyEngineGameStatePatch(gameState, nextHandPlan.gameStatePatch);
	result.nextHandPlan = nextHandPlan;
	if (nextHandPlan.type === "game-over") {
		return finishEngineHandRun(result, "game-over");
	}
	if (nextHandPlan.remainingPlayers.length === 0) {
		return finishEngineHandRun(result, "no-players");
	}

	const dealerPlan = advanceDealer(gameState.players, dealerRandomValue);
	if (!dealerPlan) {
		return finishEngineHandRun(result, "no-dealer");
	}
	applyEnginePlayerPatches(dealerPlan.playerPatches);
	gameState.players = dealerPlan.players;
	result.dealerPlan = dealerPlan;

	const blindLevelUpdate = getBlindLevelUpdateForHand(handId, gameState);
	if (blindLevelUpdate) {
		applyEngineGameStatePatch(gameState, blindLevelUpdate.gameStatePatch);
	}
	result.blindLevelUpdate = blindLevelUpdate;

	const blindPlan = postBlinds(gameState);
	applyEnginePlayerPatches(blindPlan.playerPatches);
	applyEngineGameStatePatch(gameState, blindPlan.gameStatePatch);
	result.blindPlan = blindPlan;

	const dealPlan = dealHoleCardsForNewHand(gameState, shuffleFn);
	applyEnginePlayerPatches(dealPlan.playerPatches);
	applyEngineGameStatePatch(gameState, dealPlan.gameStatePatch);
	result.dealPlan = dealPlan;

	while (true) {
		const bettingRoundResult = runEngineBettingRound(
			gameState,
			actionProvider,
			result,
		);
		if (bettingRoundResult.type === "invalid-action") {
			return finishEngineHandRun(result, "invalid-action", {
				invalidAction: bettingRoundResult,
			});
		}
		if (bettingRoundResult.type === "max-steps") {
			return finishEngineHandRun(result, "max-steps");
		}

		const phaseResult = advanceEngineHandRunPhase(gameState, result);
		if (phaseResult.type === "deal-error") {
			return finishEngineHandRun(result, "deal-error", {
				dealError: phaseResult,
			});
		}
		if (phaseResult.type === "showdown") {
			break;
		}
	}

	commitEngineShowdown(gameState, result, chipUnit);
	return finishEngineHandRun(result, "showdown");
}

export function getBlindLevelUpdateForHand(totalHands, gameState) {
	const nextBlindLevel = getBlindLevelForHand(totalHands);
	if (nextBlindLevel <= gameState.blindLevel) {
		return null;
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

	return {
		gameStatePatch: {
			blindLevel: nextBlindLevel,
			bigBlind: nextBigBlind,
			smallBlind: nextSmallBlind,
		},
		blindsChanged: nextBigBlind !== gameState.bigBlind ||
			nextSmallBlind !== gameState.smallBlind,
	};
}

export function advanceDealer(players, randomValue = Math.random()) {
	const nextDealerIndex = getNextDealerIndex(players, randomValue);
	if (nextDealerIndex === -1) {
		return null;
	}

	const dealer = players[nextDealerIndex];
	const previousDealer = players.find((player) => player.dealer) ?? null;
	const playerPatches = [];
	if (previousDealer && previousDealer !== dealer) {
		addPlayerPatch(playerPatches, previousDealer, { dealer: false });
	}
	addPlayerPatch(playerPatches, dealer, { dealer: true });

	const orderedPlayers = players.slice();
	while (orderedPlayers[0] !== dealer) {
		orderedPlayers.unshift(orderedPlayers.pop());
	}

	return {
		previousDealer,
		dealer,
		players: orderedPlayers,
		playerPatches,
	};
}

export function postBlinds(gameState) {
	const { smallBlindIndex, bigBlindIndex } = getBlindSeatIndexes(gameState.players.length);
	const smallBlindPlayer = gameState.players[smallBlindIndex];
	const bigBlindPlayer = gameState.players[bigBlindIndex];
	const playerPatches = [];

	gameState.players.forEach((player) => {
		addPlayerPatch(playerPatches, player, {
			smallBlind: false,
			bigBlind: false,
		});
	});

	const smallBlindBet = buildCommittedBetPatch(smallBlindPlayer, gameState.smallBlind);
	const bigBlindBet = buildCommittedBetPatch(bigBlindPlayer, gameState.bigBlind);
	addPlayerPatch(playerPatches, smallBlindPlayer, {
		...smallBlindBet.patch,
		smallBlind: true,
	});
	addPlayerPatch(playerPatches, bigBlindPlayer, {
		...bigBlindBet.patch,
		bigBlind: true,
	});

	return {
		smallBlindIndex,
		bigBlindIndex,
		smallBlindPlayer,
		bigBlindPlayer,
		smallBlindAmount: smallBlindBet.actual,
		bigBlindAmount: bigBlindBet.actual,
		playerPatches,
		gameStatePatch: {
			pot: gameState.pot + smallBlindBet.actual + bigBlindBet.actual,
			currentBet: gameState.bigBlind,
			lastRaise: gameState.bigBlind,
		},
	};
}

export function dealHoleCardsForNewHand(gameState, shuffleFn = shuffleArray) {
	const deck = shuffleFn(gameState.deck.concat(gameState.cardGraveyard));
	const cardGraveyard = [];
	const playerPatches = [];
	const dealtPlayers = [];

	gameState.players.forEach((player) => {
		const card1 = takeDeckCard(deck);
		const card2 = takeDeckCard(deck);
		trackUsedCard(cardGraveyard, card1);
		trackUsedCard(cardGraveyard, card2);
		const showCards = gameState.spectatorMode ||
			(!player.isBot && gameState.openCardsMode);

		addPlayerPatch(playerPatches, player, {
			holeCards: [card1, card2],
			visibleHoleCards: [showCards, showCards],
		});
		dealtPlayers.push({
			player,
			card1,
			card2,
			showCards,
		});
	});

	return {
		playerPatches,
		dealtPlayers,
		gameStatePatch: {
			deck,
			cardGraveyard,
		},
	};
}

function getCommunityCardsToDealForPhase(phase) {
	switch (phase) {
		case "flop":
			return 3;
		case "turn":
		case "river":
			return 1;
		default:
			return 0;
	}
}

function buildCompletedStreetPatch(gameState, completedPhase) {
	if (!gameState.handContext || gameState.currentPhaseIndex <= 0) {
		return {
			handContextPatch: null,
			streetEndReason: null,
			checkedThrough: null,
		};
	}

	const checkedThrough = gameState.handContext.streetAggressorSeatIndex === null;
	const handContextPatch = {};
	if (completedPhase === "flop") {
		handContextPatch.flopCheckedThrough = checkedThrough;
	} else if (completedPhase === "turn") {
		handContextPatch.turnCheckedThrough = checkedThrough;
	}

	return {
		handContextPatch: Object.keys(handContextPatch).length > 0 ? handContextPatch : null,
		streetEndReason: checkedThrough ? "street_end_no_bet" : "street_end_unfired",
		checkedThrough,
	};
}

export function getNextPhasePlan(gameState) {
	const activePlayers = gameState.players.filter((player) => !player.folded);
	if (activePlayers.length <= 1) {
		return {
			type: "showdown",
			reason: "onlyActivePlayer",
			phase: "showdown",
			activePlayers,
			gameStatePatch: {},
			handContextPatch: null,
			streetEndReason: null,
			checkedThrough: null,
			botIntentResetReason: gameState.currentPhaseIndex > 0 ? "hand_end" : null,
		};
	}

	const completedPhase = getCurrentPhase(gameState.currentPhaseIndex);
	const streetPatch = buildCompletedStreetPatch(gameState, completedPhase);
	const nextPhaseIndex = gameState.currentPhaseIndex + 1;
	const nextPhase = getCurrentPhase(nextPhaseIndex);
	const cardsToDeal = getCommunityCardsToDealForPhase(nextPhase);
	const type = cardsToDeal > 0 ? "deal" : "showdown";

	return {
		type,
		reason: type,
		completedPhase,
		phase: nextPhase,
		cardsToDeal,
		activePlayers,
		gameStatePatch: {
			currentPhaseIndex: nextPhaseIndex,
		},
		handContextPatch: streetPatch.handContextPatch,
		streetEndReason: streetPatch.streetEndReason,
		checkedThrough: streetPatch.checkedThrough,
		botIntentResetReason: streetPatch.streetEndReason,
	};
}

export function dealCommunityCardsForPhase(gameState, amount, maxCommunityCards = 5) {
	if (maxCommunityCards - gameState.communityCards.length < amount) {
		return null;
	}

	const deck = gameState.deck.slice();
	const cardGraveyard = gameState.cardGraveyard.slice();
	const burnedCard = trackUsedCard(cardGraveyard, takeDeckCard(deck));
	const dealtCards = [];
	for (let i = 0; i < amount; i++) {
		const card = trackUsedCard(cardGraveyard, takeDeckCard(deck));
		if (card) {
			dealtCards.push(card);
		}
	}

	return {
		burnedCard,
		dealtCards,
		gameStatePatch: {
			deck,
			cardGraveyard,
			communityCards: gameState.communityCards.concat(dealtCards),
		},
	};
}

function buildStreetSpotState(player) {
	const spotState = player.spotState ?? createPlayerSpotState();
	return {
		...spotState,
		actedThisStreet: false,
		voluntaryThisStreet: false,
		aggressiveThisStreet: false,
	};
}

export function createBettingRoundStartPlan(gameState) {
	const isPostflop = gameState.currentPhaseIndex > 0;
	const playerPatches = gameState.players.map((player) => {
		const patch = {
			spotState: buildStreetSpotState(player),
		};
		if (isPostflop) {
			patch.roundBet = 0;
		}
		return { player, patch };
	});
	const gameStatePatch = {
		raisesThisRound: 0,
	};
	if (isPostflop) {
		gameStatePatch.currentBet = 0;
		gameStatePatch.lastRaise = gameState.bigBlind;
	}
	if (!gameState.handContext) {
		gameStatePatch.handContext = createHandContextState();
	}

	return {
		playerPatches,
		gameStatePatch,
		handContextPatch: gameState.handContext ? { streetAggressorSeatIndex: null } : null,
		botIntentResetReason: isPostflop ? "street_reset" : null,
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
