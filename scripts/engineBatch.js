/* ==================================================================================================
MODULE BOUNDARY: Browserless Engine Batch Runner
================================================================================================== */

// CURRENT STATE: Runs bot-only tournaments directly through the pure engine without launching a
// browser, static server, DevTools connection, DOM, or timers, then feeds captured engine/bot events
// through the shared speedmode analysis layer.
// TARGET STATE: Provide the fast structural and bot-quality batch runner for engine flow regressions.
// PUT HERE: Deno batch orchestration, bot action provider wiring, compact engine event summaries, and
// JSON report writing.
// DO NOT PUT HERE: Poker rules, bot heuristics, browser automation, DOM assumptions, or UI behavior.

import {
	calculateWinProbabilities,
	createBotLineState,
	createHandContextState,
	createPlayerSpotState,
	INITIAL_BIG_BLIND,
	INITIAL_DECK,
	INITIAL_SMALL_BLIND,
	runEngineTournament,
} from "../js/gameEngine.js";
import { chooseBotAction, normalizeBotActionRequest, setBotDecisionSink } from "../js/bot.js";
import { getPlayerActionState } from "../js/shared/actionModel.js";
import {
	analyzeOutcomeLogs,
	analyzeRunDecisions,
	createEmptyMetrics,
	createEmptyOutcomeMetricsAccumulator,
	createMdfAnalysis,
	createPostflopLineReadAnalysis,
	finalizeOutcomeMetrics,
	incrementCount,
	mergeOutcomeMetrics,
	mergeRunMetrics,
	SPEEDMODE_EVENT_PREFIX,
} from "./speedmodeAnalysis.js";

const DEFAULT_RUN_COUNT = 100;
const DEFAULT_MAX_HANDS = 1000;
const DEFAULT_PLAYER_COUNT = 6;
const DEFAULT_STARTING_CHIPS = 2000;
const DEFAULT_OUTPUT_BASE = "tmp";
const DEFAULT_OUTPUT_PREFIX = "poker-engine-batch";
const DEFAULT_EQUITY_MAX_DECISIONS_PER_RUN = 5000;
const DEFAULT_EQUITY_EXACT_MAX_BOARDS = 50000;
const DEFAULT_EQUITY_APPROX_BOARDS = 300;
const CARD_RANK_ORDER = "23456789TJQKA";
const WEAK_PREFLOP_FAMILIES = new Set([
	"dominatedOffsuitBroadway",
	"weakAxo",
	"weakKxo",
	"suitedJunk",
	"offsuitJunk",
]);
const PLAYABLE_PREFLOP_FOLD_FAMILIES = new Set([
	"pair",
	"suitedBroadway",
	"premiumOffsuitBroadway",
	"weakAxs",
	"suitedConnector",
]);
const STRONG_POSTFLOP_HANDS = new Set([
	"Two Pair",
	"Three of a Kind",
	"Straight",
	"Flush",
	"Full House",
	"Four of a Kind",
	"Straight Flush",
]);
const EQUITY_HIGH_FOLD_MIN = 42;
const EQUITY_LOW_RAISE_PREFLOP = 20;
const EQUITY_LOW_RAISE_POSTFLOP = 28;
const EQUITY_CALL_MARGIN_PCT = 6;
const EQUITY_FOLD_MARGIN_PCT = 12;
const EQUITY_EXAMPLE_LIMIT = 10;

function formatTimestamp(date = new Date()) {
	const yyyy = String(date.getFullYear());
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	const hh = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	const ss = String(date.getSeconds()).padStart(2, "0");
	return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function parsePositiveInteger(value, label) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${label}: ${value}`);
	}
	return parsed;
}

function resolveOutputDir(outputDir) {
	const requestedOutputDir = outputDir || `${DEFAULT_OUTPUT_BASE}/${DEFAULT_OUTPUT_PREFIX}-${formatTimestamp()}`;
	const normalizedOutputDir = requestedOutputDir.replace(/\/+$/, "");
	if (normalizedOutputDir.startsWith("/")) {
		return normalizedOutputDir;
	}

	const normalizedCwd = Deno.cwd().replace(/\/+$/, "");
	const relativePath = normalizedOutputDir.replace(/^\.?\//, "");
	return `${normalizedCwd}/${relativePath}`;
}

function parseArgs(args) {
	const config = {
		runCount: DEFAULT_RUN_COUNT,
		maxHands: DEFAULT_MAX_HANDS,
		playerCount: DEFAULT_PLAYER_COUNT,
		startingChips: DEFAULT_STARTING_CHIPS,
		outputDir: null,
		equity: {
			enabled: false,
			includePreflop: false,
			maxDecisionsPerRun: DEFAULT_EQUITY_MAX_DECISIONS_PER_RUN,
			exactMaxBoards: DEFAULT_EQUITY_EXACT_MAX_BOARDS,
			approxBoards: DEFAULT_EQUITY_APPROX_BOARDS,
		},
	};

	for (const arg of args) {
		if (arg === "--") {
			continue;
		} else if (arg.startsWith("--runs=")) {
			config.runCount = parsePositiveInteger(arg.slice(7), "runs");
		} else if (arg.startsWith("--max-hands=")) {
			config.maxHands = parsePositiveInteger(arg.slice(12), "max hands");
		} else if (arg.startsWith("--players=")) {
			config.playerCount = parsePositiveInteger(arg.slice(10), "players");
		} else if (arg.startsWith("--chips=")) {
			config.startingChips = parsePositiveInteger(arg.slice(8), "chips");
		} else if (arg.startsWith("--out=")) {
			config.outputDir = arg.slice(6);
		} else if (arg === "--equity") {
			config.equity.enabled = true;
		} else if (arg === "--equity-preflop") {
			config.equity.enabled = true;
			config.equity.includePreflop = true;
		} else if (arg.startsWith("--equity-limit=")) {
			config.equity.maxDecisionsPerRun = parsePositiveInteger(arg.slice(15), "equity limit");
		} else if (arg.startsWith("--equity-exact-max-boards=")) {
			config.equity.exactMaxBoards = parsePositiveInteger(arg.slice(26), "equity exact max boards");
		} else if (arg.startsWith("--equity-approx-boards=")) {
			config.equity.approxBoards = parsePositiveInteger(arg.slice(23), "equity approximate boards");
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (config.playerCount < 2) {
		throw new Error("Invalid players: at least 2 players are required");
	}

	return config;
}

function createStats() {
	return {
		hands: 0,
		handsWon: 0,
		vpip: 0,
		pfr: 0,
		calls: 0,
		aggressiveActs: 0,
		reveals: 0,
		showdowns: 0,
		showdownsWon: 0,
		folds: 0,
		foldsPreflop: 0,
		foldsPostflop: 0,
		allins: 0,
	};
}

function createBotPlayer(index, startingChips) {
	return {
		name: `Bot ${index + 1}`,
		isBot: true,
		seatSlot: index,
		winnerReactionEmoji: "",
		winnerReactionUntil: 0,
		isWinner: false,
		actionState: null,
		winProbability: null,
		lastNonFinalWinProbability: null,
		seatIndex: index,
		holeCards: [null, null],
		visibleHoleCards: [false, false],
		dealer: false,
		smallBlind: false,
		bigBlind: false,
		folded: false,
		chips: startingChips,
		allIn: false,
		totalBet: 0,
		roundBet: 0,
		stats: createStats(),
		botLine: createBotLineState(),
		spotState: createPlayerSpotState(),
	};
}

function createEngineBatchGameState({ playerCount, startingChips }) {
	const players = Array.from({ length: playerCount }, (_, index) => createBotPlayer(index, startingChips));
	return {
		currentPhaseIndex: 0,
		currentBet: 0,
		pot: 0,
		activeSeatIndex: null,
		handId: 0,
		nextDecisionId: 1,
		blindLevel: 0,
		gameStarted: true,
		gameFinished: false,
		openCardsMode: false,
		spectatorMode: true,
		raisesThisRound: 0,
		handInProgress: false,
		deck: INITIAL_DECK.slice(),
		cardGraveyard: [],
		communityCards: [],
		players,
		allPlayers: players.slice(),
		chipTransfer: null,
		pendingAction: null,
		smallBlind: INITIAL_SMALL_BLIND,
		bigBlind: INITIAL_BIG_BLIND,
		lastRaise: INITIAL_BIG_BLIND,
		handContext: createHandContextState(),
	};
}

function chooseEngineBotAction(gameState, player) {
	const decision = chooseBotAction(player, gameState);
	const actionRequest = normalizeBotActionRequest(decision);
	if (actionRequest) {
		return actionRequest;
	}

	const actionState = getPlayerActionState(gameState, player);
	return actionState.canCheck ? { action: "check" } : { action: "fold" };
}

async function ensureDirectory(path) {
	await Deno.mkdir(path, { recursive: true });
}

function formatSpeedmodeEventLine(event) {
	return `${SPEEDMODE_EVENT_PREFIX}${JSON.stringify(event)}`;
}

function createEmptyDecisionJoinCoverage() {
	return {
		totalDecisions: 0,
		joinedDecisions: 0,
		missingHandResult: 0,
		totalHands: 0,
		joinedHands: 0,
		missingHandResults: 0,
		pct: 0,
	};
}

function finalizeDecisionJoinCoverage(coverage) {
	return {
		...coverage,
		pct: coverage.totalDecisions > 0
			? Number(((coverage.joinedDecisions / coverage.totalDecisions) * 100).toFixed(2))
			: 100,
	};
}

function createEmptyEngineBatchMetrics() {
	return {
		decisionCount: 0,
		actionCounts: {},
		requestedActionCounts: {},
		phaseCounts: {},
		handCount: 0,
		showdownHands: 0,
		uncontestedHands: 0,
		playerBustCount: 0,
		tournamentEndCount: 0,
		stoppedCounts: {},
		decisionJoinCoverage: createEmptyDecisionJoinCoverage(),
	};
}

function analyzeEngineEvents(events, result) {
	const metrics = createEmptyEngineBatchMetrics();
	const handResultEvents = events.filter((event) => event.type === "hand_result");
	const handResultById = new Map(handResultEvents.map((event) => [event.handId, event]));

	metrics.handCount = handResultEvents.length;
	metrics.decisionJoinCoverage.totalHands = handResultEvents.length;
	metrics.decisionJoinCoverage.joinedHands = handResultEvents.length;

	for (const event of events) {
		if (event.type === "decision") {
			metrics.decisionCount += 1;
			metrics.decisionJoinCoverage.totalDecisions += 1;
			incrementCount(metrics.actionCounts, event.action);
			incrementCount(metrics.requestedActionCounts, event.requestedAction ?? "unknown");
			incrementCount(metrics.phaseCounts, event.phase);
			if (handResultById.has(event.handId)) {
				metrics.decisionJoinCoverage.joinedDecisions += 1;
			} else {
				metrics.decisionJoinCoverage.missingHandResult += 1;
			}
		} else if (event.type === "hand_result") {
			if (event.hadShowdown) {
				metrics.showdownHands += 1;
			} else {
				metrics.uncontestedHands += 1;
			}
		} else if (event.type === "player_bust") {
			metrics.playerBustCount += 1;
		} else if (event.type === "tournament_end") {
			metrics.tournamentEndCount += 1;
		}
	}

	if (result.type !== "game-over") {
		incrementCount(metrics.stoppedCounts, result.type);
	}
	metrics.decisionJoinCoverage = finalizeDecisionJoinCoverage(metrics.decisionJoinCoverage);
	return metrics;
}

function mergeDecisionJoinCoverage(target, source) {
	target.totalDecisions += source.totalDecisions;
	target.joinedDecisions += source.joinedDecisions;
	target.missingHandResult += source.missingHandResult;
	target.totalHands += source.totalHands;
	target.joinedHands += source.joinedHands;
	target.missingHandResults += source.missingHandResults;
	target.pct = 0;
}

function mergeEngineBatchMetrics(target, source) {
	target.decisionCount += source.decisionCount;
	target.handCount += source.handCount;
	target.showdownHands += source.showdownHands;
	target.uncontestedHands += source.uncontestedHands;
	target.playerBustCount += source.playerBustCount;
	target.tournamentEndCount += source.tournamentEndCount;
	mergeDecisionJoinCoverage(target.decisionJoinCoverage, source.decisionJoinCoverage);

	for (const [key, value] of Object.entries(source.actionCounts)) {
		incrementCount(target.actionCounts, key, value);
	}
	for (const [key, value] of Object.entries(source.requestedActionCounts)) {
		incrementCount(target.requestedActionCounts, key, value);
	}
	for (const [key, value] of Object.entries(source.phaseCounts)) {
		incrementCount(target.phaseCounts, key, value);
	}
	for (const [key, value] of Object.entries(source.stoppedCounts)) {
		incrementCount(target.stoppedCounts, key, value);
	}
}

function summarizePlayers(players) {
	return players.map((player) => ({
		name: player.name,
		seatIndex: player.seatIndex,
		chips: player.chips,
		isWinner: player.isWinner,
		hands: player.stats?.hands ?? 0,
		handsWon: player.stats?.handsWon ?? 0,
	}));
}

function getDecisionKey(handId, decisionId) {
	return `${handId}:${decisionId}`;
}

function createDecisionEquityContext(gameState) {
	return {
		handId: gameState.handId ?? 0,
		communityCards: gameState.communityCards.slice(),
		deck: gameState.deck.slice(),
		activePlayers: gameState.players
			.filter((player) => !player.folded && player.holeCards.every(Boolean))
			.map((player) => ({
				name: player.name,
				seatIndex: player.seatIndex,
				holeCards: player.holeCards.slice(),
				chips: player.chips,
				totalBet: player.totalBet,
				roundBet: player.roundBet,
				allIn: player.allIn === true,
			})),
	};
}

function classifyEquityHandFamily(holeCards) {
	if (!Array.isArray(holeCards) || holeCards.length < 2) {
		return "unknown";
	}

	const [cardA, cardB] = holeCards;
	if (
		typeof cardA !== "string" ||
		typeof cardB !== "string" ||
		cardA.length < 2 ||
		cardB.length < 2
	) {
		return "unknown";
	}

	const rankA = cardA[0];
	const rankB = cardB[0];
	const rankIndexA = CARD_RANK_ORDER.indexOf(rankA);
	const rankIndexB = CARD_RANK_ORDER.indexOf(rankB);
	if (rankIndexA === -1 || rankIndexB === -1) {
		return "unknown";
	}

	const suited = cardA[1] === cardB[1];
	const pair = rankA === rankB;
	const highRank = rankIndexA >= rankIndexB ? rankA : rankB;
	const lowRank = rankIndexA >= rankIndexB ? rankB : rankA;
	const highIndex = Math.max(rankIndexA, rankIndexB);
	const lowIndex = Math.min(rankIndexA, rankIndexB);
	const gap = highIndex - lowIndex - 1;
	const broadway = highIndex >= CARD_RANK_ORDER.indexOf("T") &&
		lowIndex >= CARD_RANK_ORDER.indexOf("T");
	const weakAce = highRank === "A" && lowIndex <= CARD_RANK_ORDER.indexOf("9");
	const weakKing = highRank === "K" && lowIndex <= CARD_RANK_ORDER.indexOf("9");

	if (pair) {
		return "pair";
	}
	if (suited && broadway) {
		return "suitedBroadway";
	}
	if (!suited && broadway) {
		if (
			(highRank === "A" && (lowRank === "K" || lowRank === "Q")) ||
			(highRank === "K" && lowRank === "Q")
		) {
			return "premiumOffsuitBroadway";
		}
		return "dominatedOffsuitBroadway";
	}
	if (weakAce) {
		return suited ? "weakAxs" : "weakAxo";
	}
	if (weakKing) {
		return suited ? "weakKxs" : "weakKxo";
	}
	if (suited && gap <= 0) {
		return "suitedConnector";
	}
	if (suited && gap <= 2) {
		return "suitedGapper";
	}
	if (suited) {
		return "suitedJunk";
	}
	return "offsuitJunk";
}

function getPostflopStreet(decision) {
	const communityCardCount = decision.communityCards?.length ?? 0;
	if (communityCardCount === 3) {
		return "flop";
	}
	if (communityCardCount === 4) {
		return "turn";
	}
	if (communityCardCount === 5) {
		return "river";
	}
	return `cc${communityCardCount}`;
}

function getHighestBoardRankIndex(decision) {
	const communityCards = Array.isArray(decision.communityCards) ? decision.communityCards : [];
	return communityCards.reduce((highestRankIndex, card) => {
		if (typeof card !== "string" || card.length === 0) {
			return highestRankIndex;
		}
		return Math.max(highestRankIndex, CARD_RANK_ORDER.indexOf(card[0]));
	}, -1);
}

function hasBadPrice(decision, threshold = 0.18) {
	return typeof decision.potOdds === "number" && decision.potOdds >= threshold;
}

function isTurnOrRiverPressureSpot(decision) {
	const street = getPostflopStreet(decision);
	return (street === "turn" || street === "river") &&
		(decision.pressureTag === "FR" || decision.raiseLevel > 0 || hasBadPrice(decision));
}

function getPreflopRaiseScore(decision) {
	if (decision.raiseLevel > 0) {
		return Math.max(
			decision.threeBetValueScore ?? 0,
			decision.threeBetBluffScore ?? 0,
			decision.pushScore ?? 0,
		);
	}
	return decision.openRaiseScore ?? decision.strengthScore ?? 0;
}

function selectPreflopEquityCandidate(decision) {
	const handClass = classifyEquityHandFamily(decision.holeCards);
	const flatScore = decision.flatScore ?? 0;
	const strengthScore = decision.strengthScore ?? 0;
	const raiseScore = getPreflopRaiseScore(decision);

	if (decision.action === "call" && WEAK_PREFLOP_FAMILIES.has(handClass)) {
		return {
			reason: decision.spotType === "UO" ? "preflopWeakLimp" : "preflopWeakCall",
			handClass,
			priority: decision.spotType === "UO" ? 45 : 60,
		};
	}
	if (decision.action === "call" && flatScore < 3 && !PLAYABLE_PREFLOP_FOLD_FAMILIES.has(handClass)) {
		return { reason: "preflopLowScoreCall", handClass, priority: 50 };
	}
	if (
		decision.action === "raise" && decision.premium !== true &&
		(WEAK_PREFLOP_FAMILIES.has(handClass) || raiseScore < 4)
	) {
		return { reason: "preflopThinRaise", handClass, priority: 40 };
	}
	if (
		decision.action === "fold" &&
		PLAYABLE_PREFLOP_FOLD_FAMILIES.has(handClass) &&
		((decision.toCall ?? 0) > 0 || decision.activePlayers <= 3 || strengthScore >= 5)
	) {
		return { reason: "preflopPlayableFold", handClass, priority: 35 };
	}

	return null;
}

function getPostflopHandClass(decision) {
	if (decision.drawFlag === "S") {
		return "strongDraw";
	}
	if (decision.drawFlag === "W") {
		return "weakDraw";
	}
	if (decision.pairClass && decision.pairClass !== "-") {
		return decision.pairClass;
	}
	if (decision.liftType && decision.liftType !== "-") {
		return decision.liftType;
	}
	return decision.rawHand ?? "unknown";
}

function isPostflopTrashCallCandidate(decision) {
	return decision.action === "call" && (decision.toCall ?? 0) > 0 && (
		(decision.rawHand === "High Card" && decision.drawFlag === "-") ||
		(decision.drawFlag === "W" && hasBadPrice(decision)) ||
		(decision.pairClass === "board-pair-only" && isTurnOrRiverPressureSpot(decision)) ||
		(decision.pairClass === "weak-pair" && decision.pressureTag === "FR") ||
		(decision.pairClass === "pocket-underpair" &&
			getHighestBoardRankIndex(decision) >= CARD_RANK_ORDER.indexOf("T")) ||
		(decision.liftType === "kicker" && isTurnOrRiverPressureSpot(decision))
	);
}

function isPostflopStrongFoldCandidate(decision) {
	return decision.action === "fold" && (decision.toCall ?? 0) > 0 && (
		STRONG_POSTFLOP_HANDS.has(decision.rawHand) ||
		decision.pairClass === "overpair" ||
		decision.pairClass === "top-pair" ||
		decision.pairClass === "second-pair" ||
		decision.drawFlag === "S" ||
		decision.favoriteStrongHandFold === true
	);
}

function isPostflopThinRaiseCandidate(decision) {
	if (decision.action !== "raise") {
		return false;
	}
	return decision.bluff === true ||
		decision.stab === true ||
		decision.marginalEdge === true ||
		decision.liftType === "kicker" ||
		decision.pairClass === "weak-pair" ||
		decision.pairClass === "board-pair-only" ||
		(decision.rawHand === "Pair" && decision.hasPrivateRaiseEdge !== true) ||
		(typeof decision.edge === "number" && decision.edge < 1 && decision.hasPrivateRaiseEdge !== true);
}

function formatReasonAction(action) {
	if (!action) {
		return "Decision";
	}
	return `${action[0].toUpperCase()}${action.slice(1)}`;
}

function selectPostflopEquityCandidate(decision) {
	const handClass = getPostflopHandClass(decision);

	if (isPostflopStrongFoldCandidate(decision)) {
		return { reason: "postflopStrongFold", handClass, priority: 100 };
	}
	if (decision.action === "fold" && (decision.toCall ?? 0) > 0) {
		return { reason: "postflopPressureFold", handClass, priority: 70 };
	}
	if (isPostflopTrashCallCandidate(decision)) {
		return { reason: "postflopThinOrWeakCall", handClass, priority: 90 };
	}
	if (isPostflopThinRaiseCandidate(decision)) {
		return { reason: "postflopThinRaise", handClass, priority: 80 };
	}

	return { reason: `postflop${formatReasonAction(decision.action)}`, handClass, priority: 50 };
}

function selectEquityCandidate(decision, equityConfig) {
	if (decision.phase === "preflop" && equityConfig.includePreflop) {
		return selectPreflopEquityCandidate(decision);
	}
	if (decision.phase === "postflop") {
		return selectPostflopEquityCandidate(decision);
	}
	return null;
}

function combinationCount(n, k) {
	if (k < 0 || k > n) {
		return 0;
	}
	const normalizedK = Math.min(k, n - k);
	let result = 1;
	for (let index = 1; index <= normalizedK; index++) {
		result = (result * (n - normalizedK + index)) / index;
	}
	return Math.round(result);
}

function chooseApproxDeckLength(deckLength, missingCount, maxBoards) {
	let sampleLength = Math.min(deckLength, missingCount);
	while (
		sampleLength < deckLength &&
		combinationCount(sampleLength + 1, missingCount) <= maxBoards
	) {
		sampleLength += 1;
	}
	return sampleLength;
}

function toRoundedNumber(value, digits = 2) {
	return Number(value.toFixed(digits));
}

function createDiagnosticPlayers(context) {
	return context.activePlayers.map((player) => ({
		name: player.name,
		seatIndex: player.seatIndex,
		holeCards: player.holeCards.slice(),
		folded: false,
	}));
}

function getEquityContextCacheKey(context) {
	const playerKey = context.activePlayers
		.map((player) => `${player.seatIndex}:${player.holeCards.join("")}`)
		.join("|");
	return [
		context.communityCards.join(""),
		context.deck.join(""),
		playerKey,
	].join(";");
}

function computeContextEquities(context, equityConfig) {
	const missingCount = 5 - context.communityCards.length;
	if (missingCount < 0 || missingCount > context.deck.length) {
		return { status: "invalidBoard", method: "none" };
	}

	const players = createDiagnosticPlayers(context);
	const fullBoardCount = combinationCount(context.deck.length, missingCount);
	let deck = context.deck;
	let method = "exact";
	let maxBoards = equityConfig.exactMaxBoards;
	if (fullBoardCount > equityConfig.exactMaxBoards) {
		const sampleLength = chooseApproxDeckLength(context.deck.length, missingCount, equityConfig.approxBoards);
		deck = context.deck.slice(0, sampleLength);
		method = "sampledDeckExact";
		maxBoards = equityConfig.approxBoards;
	}

	const result = calculateWinProbabilities(
		players,
		context.communityCards,
		deck,
		maxBoards,
	);
	if (result.status !== "ok") {
		return {
			status: result.status,
			method,
			fullBoardCount,
			sampledBoardCount: combinationCount(deck.length, missingCount),
			boardsSeen: result.boardsSeen,
			activePlayers: players.length,
		};
	}

	const equities = players.map((player) => ({
		player,
		equity: result.probabilities.get(player) ?? 0,
	}));
	const playerEquities = new Map();
	for (const entry of equities) {
		const opponentEquities = equities
			.filter((opponentEntry) => opponentEntry.player !== entry.player)
			.map((opponentEntry) => opponentEntry.equity);
		const bestOpponentEquity = opponentEquities.reduce((best, equity) => Math.max(best, equity), 0);
		const equityRank = 1 + opponentEquities.filter((equity) => equity > entry.equity).length;
		playerEquities.set(entry.player.seatIndex, {
			equityPct: toRoundedNumber(entry.equity),
			bestOpponentEquityPct: toRoundedNumber(bestOpponentEquity),
			equityRank,
		});
	}

	return {
		status: "ok",
		method,
		activePlayers: players.length,
		opponents: Math.max(0, players.length - 1),
		fullBoardCount,
		sampledDeckCards: method === "sampledDeckExact" ? deck.length : null,
		sampledBoardCount: combinationCount(deck.length, missingCount),
		boardsSeen: result.boardsSeen,
		playerEquities,
	};
}

function getCachedContextEquities(context, equityConfig, equityCache) {
	const contextKey = getEquityContextCacheKey(context);
	if (!equityCache.has(contextKey)) {
		equityCache.set(contextKey, computeContextEquities(context, equityConfig));
	}
	return equityCache.get(contextKey);
}

function computeDecisionEquity(context, decision, equityConfig, equityCache) {
	const contextEquity = getCachedContextEquities(context, equityConfig, equityCache);
	if (contextEquity.status !== "ok") {
		return contextEquity;
	}

	const playerEquity = contextEquity.playerEquities.get(decision.seatIndex);
	if (!playerEquity) {
		return { status: "missingPlayer", method: "none" };
	}

	return {
		status: "ok",
		method: contextEquity.method,
		equityPct: playerEquity.equityPct,
		bestOpponentEquityPct: playerEquity.bestOpponentEquityPct,
		equityRank: playerEquity.equityRank,
		activePlayers: contextEquity.activePlayers,
		opponents: contextEquity.opponents,
		fullBoardCount: contextEquity.fullBoardCount,
		sampledDeckCards: contextEquity.sampledDeckCards,
		sampledBoardCount: contextEquity.sampledBoardCount,
		boardsSeen: contextEquity.boardsSeen,
		potOddsPct: typeof decision.potOdds === "number" ? toRoundedNumber(decision.potOdds * 100) : null,
	};
}

function classifyEquitySignal(decision, equity) {
	if (equity.status !== "ok" || typeof equity.equityPct !== "number") {
		return "notCalculated";
	}

	const potOddsPct = typeof equity.potOddsPct === "number" ? equity.potOddsPct : 0;
	if (decision.action === "fold" && (decision.toCall ?? 0) > 0) {
		const liveThreshold = Math.max(EQUITY_HIGH_FOLD_MIN, potOddsPct + EQUITY_FOLD_MARGIN_PCT);
		if (equity.equityPct >= liveThreshold) {
			return "highEquityFold";
		}
		if (equity.equityPct + EQUITY_CALL_MARGIN_PCT < potOddsPct) {
			return "lowEquityFold";
		}
		return "pricedFold";
	}
	if (decision.action === "call" && (decision.toCall ?? 0) > 0) {
		if (equity.equityPct + EQUITY_CALL_MARGIN_PCT < potOddsPct) {
			return "lowEquityCall";
		}
		return "pricedCall";
	}
	if (decision.action === "raise") {
		const lowRaiseThreshold = decision.phase === "preflop" ? EQUITY_LOW_RAISE_PREFLOP : EQUITY_LOW_RAISE_POSTFLOP;
		if (equity.equityPct < lowRaiseThreshold) {
			return "lowEquityRaise";
		}
		return "liveRaise";
	}
	return "neutral";
}

function createEmptyEquityDiagnostics(enabled = false) {
	return {
		enabled,
		candidates: 0,
		attempted: 0,
		enriched: 0,
		capped: 0,
		skipped: 0,
		elapsedMs: 0,
		skippedByReason: {},
		statuses: {},
		methods: {},
		candidateByReason: {},
		evaluatedByReason: {},
		byPhaseAction: {},
		byHandClass: {},
		signals: {},
		examples: {
			highEquityFold: [],
			lowEquityCall: [],
			lowEquityRaise: [],
		},
	};
}

function pushEquityExample(target, line) {
	if (target.length < EQUITY_EXAMPLE_LIMIT) {
		target.push(line);
	}
}

function formatEquityExample(decision, diagnostic) {
	const equity = diagnostic.equity;
	const potOdds = typeof equity.potOddsPct === "number" ? `${equity.potOddsPct}%` : "-";
	const handLabel = decision.phase === "preflop"
		? diagnostic.candidate.handClass
		: `${decision.rawHand ?? "-"}:${diagnostic.candidate.handClass}`;
	return `H${decision.handId}/D${decision.decisionId} ${decision.player} ${decision.action} ` +
		`${diagnostic.candidate.reason} ${handLabel} eq=${equity.equityPct}% potOdds=${potOdds} ` +
		`rank=${equity.equityRank}/${equity.activePlayers}`;
}

function enrichDecisionsWithEquity(decisions, decisionContexts, equityConfig) {
	const diagnostics = createEmptyEquityDiagnostics(equityConfig.enabled);
	if (!equityConfig.enabled) {
		return diagnostics;
	}
	const startedAt = Date.now();

	const contextByDecision = new Map(
		decisionContexts.map((context) => [getDecisionKey(context.handId, context.decisionId), context]),
	);
	const equityCache = new Map();
	const candidates = decisions
		.map((decision, index) => ({
			decision,
			index,
			candidate: selectEquityCandidate(decision, equityConfig),
		}))
		.filter((entry) => entry.candidate)
		.sort((a, b) => {
			if (a.candidate.priority !== b.candidate.priority) {
				return b.candidate.priority - a.candidate.priority;
			}
			return a.index - b.index;
		});

	diagnostics.candidates = candidates.length;
	for (const entry of candidates) {
		incrementCount(diagnostics.candidateByReason, entry.candidate.reason);
	}

	const selectedCandidates = candidates.slice(0, equityConfig.maxDecisionsPerRun);
	diagnostics.capped = Math.max(0, candidates.length - selectedCandidates.length);
	if (diagnostics.capped > 0) {
		diagnostics.skipped += diagnostics.capped;
		incrementCount(diagnostics.skippedByReason, "limit", diagnostics.capped);
	}

	for (const entry of selectedCandidates) {
		const { decision, candidate } = entry;
		const decisionKey = getDecisionKey(decision.handId, decision.decisionId);
		const context = contextByDecision.get(decisionKey);
		diagnostics.attempted += 1;
		if (!context) {
			diagnostics.skipped += 1;
			incrementCount(diagnostics.skippedByReason, "missingContext");
			continue;
		}

		const equity = computeDecisionEquity(context, decision, equityConfig, equityCache);
		incrementCount(diagnostics.statuses, equity.status);
		if (equity.method !== "none") {
			incrementCount(diagnostics.methods, equity.method);
		}
		if (equity.status !== "ok") {
			diagnostics.skipped += 1;
			incrementCount(diagnostics.skippedByReason, equity.status);
			continue;
		}

		const signal = classifyEquitySignal(decision, equity);
		const diagnostic = {
			candidate: {
				reason: candidate.reason,
				handClass: candidate.handClass,
			},
			equity,
			signal,
		};

		decision.equityDiagnostic = diagnostic;
		diagnostics.enriched += 1;
		incrementCount(diagnostics.evaluatedByReason, candidate.reason);
		incrementCount(diagnostics.byPhaseAction, `${decision.phase}:${decision.action}`);
		incrementCount(diagnostics.byHandClass, candidate.handClass);
		incrementCount(diagnostics.signals, signal);

		if (signal === "highEquityFold") {
			pushEquityExample(diagnostics.examples.highEquityFold, formatEquityExample(decision, diagnostic));
		} else if (signal === "lowEquityCall") {
			pushEquityExample(diagnostics.examples.lowEquityCall, formatEquityExample(decision, diagnostic));
		} else if (signal === "lowEquityRaise") {
			pushEquityExample(diagnostics.examples.lowEquityRaise, formatEquityExample(decision, diagnostic));
		}
	}

	diagnostics.elapsedMs = Date.now() - startedAt;
	return diagnostics;
}

function mergeCountObjects(target, source) {
	for (const [key, value] of Object.entries(source)) {
		incrementCount(target, key, value);
	}
}

function mergeEquityExamples(target, source) {
	for (const [key, lines] of Object.entries(source)) {
		if (!target[key]) {
			target[key] = [];
		}
		lines.forEach((line) => pushEquityExample(target[key], line));
	}
}

function mergeEquityDiagnostics(target, source) {
	if (!source?.enabled) {
		return;
	}

	target.enabled = true;
	target.candidates += source.candidates;
	target.attempted += source.attempted;
	target.enriched += source.enriched;
	target.capped += source.capped;
	target.skipped += source.skipped;
	target.elapsedMs += source.elapsedMs;
	mergeCountObjects(target.skippedByReason, source.skippedByReason);
	mergeCountObjects(target.statuses, source.statuses);
	mergeCountObjects(target.methods, source.methods);
	mergeCountObjects(target.candidateByReason, source.candidateByReason);
	mergeCountObjects(target.evaluatedByReason, source.evaluatedByReason);
	mergeCountObjects(target.byPhaseAction, source.byPhaseAction);
	mergeCountObjects(target.byHandClass, source.byHandClass);
	mergeCountObjects(target.signals, source.signals);
	mergeEquityExamples(target.examples, source.examples);
}

async function runSingleEngineBatch(config, runIndex, outputDir) {
	const runLabel = String(runIndex).padStart(2, "0");
	const gameState = createEngineBatchGameState(config);
	const engineEvents = [];
	const speedmodeEvents = [];
	const decisionContexts = [];
	const startedAt = Date.now();
	let result = null;
	let pendingDecisionContext = null;

	console.log(`run ${runLabel}: engine`);
	setBotDecisionSink((decision) => {
		speedmodeEvents.push({ type: "bot_decision", ...decision });
		if (
			config.equity.enabled &&
			pendingDecisionContext &&
			typeof decision.handId === "number" &&
			typeof decision.decisionId === "number"
		) {
			decisionContexts.push({
				...pendingDecisionContext,
				handId: decision.handId,
				decisionId: decision.decisionId,
				seatIndex: decision.seatIndex,
			});
		}
	});
	try {
		const actionProvider = (state, player) => {
			if (config.equity.enabled) {
				pendingDecisionContext = createDecisionEquityContext(state);
			}
			try {
				return chooseEngineBotAction(state, player);
			} finally {
				pendingDecisionContext = null;
			}
		};
		result = runEngineTournament(gameState, actionProvider, {
			eventSink: (event) => {
				engineEvents.push(event);
				if (event.type === "hand_start" || event.type === "hand_result") {
					speedmodeEvents.push(event);
				}
			},
			maxHands: config.maxHands,
		});
	} finally {
		setBotDecisionSink(null);
	}
	const elapsedMs = Date.now() - startedAt;
	const speedmodeLogs = speedmodeEvents.map(formatSpeedmodeEventLine);
	const runOutcome = analyzeOutcomeLogs(speedmodeLogs);
	const metrics = analyzeRunDecisions(runOutcome.decisions, runOutcome.hands);
	const engineMetrics = analyzeEngineEvents(engineEvents, result);
	const equityDiagnostics = enrichDecisionsWithEquity(
		runOutcome.decisions,
		decisionContexts,
		config.equity,
	);
	const champion = result.champion?.name ?? null;
	const logPath = `${outputDir}/run-${runLabel}.log`;
	const summaryPath = `${outputDir}/run-${runLabel}.json`;
	const detailsPath = `${outputDir}/run-${runLabel}.details.json`;
	const players = summarizePlayers(gameState.players);

	await Deno.writeTextFile(logPath, speedmodeLogs.join("\n"));
	await Deno.writeTextFile(
		summaryPath,
		JSON.stringify(
			{
				run: runIndex,
				type: result.type,
				champion,
				elapsedMs,
				handCount: result.handCount,
				eventCount: engineEvents.length,
				logCount: speedmodeLogs.length,
				players,
				metrics,
				analysis: {
					postflop: {
						mdf: createMdfAnalysis(metrics.postflop.mdf),
						lineReads: createPostflopLineReadAnalysis(metrics.postflop),
					},
					equity: equityDiagnostics,
				},
				outcomeMetrics: runOutcome.metrics,
				engineMetrics,
			},
			null,
			2,
		),
	);
	await Deno.writeTextFile(
		detailsPath,
		JSON.stringify(
			{
				run: runIndex,
				type: result.type,
				champion,
				elapsedMs,
				engineEvents,
				speedmodeEvents,
				hands: runOutcome.hands,
				decisions: runOutcome.decisions,
				equityDiagnostics,
				outcomeMetrics: runOutcome.metrics,
				players,
			},
			null,
			2,
		),
	);

	console.log(
		`run ${runLabel}: done type=${result.type} champion=${
			champion ?? "none"
		} hands=${result.handCount} decisions=${metrics.decisionCount}`,
	);

	return {
		run: runIndex,
		type: result.type,
		champion,
		elapsedMs,
		handCount: result.handCount,
		eventCount: engineEvents.length,
		logCount: speedmodeLogs.length,
		logPath,
		summaryPath,
		detailsPath,
		metrics,
		rawOutcomeMetrics: runOutcome.rawMetrics,
		outcomeMetrics: runOutcome.metrics,
		engineMetrics,
		equityDiagnostics,
	};
}

async function main() {
	const args = parseArgs(Deno.args);
	const projectRootUrl = new URL("../", import.meta.url);
	const projectRootPath = Deno.realPathSync(projectRootUrl);
	const outputDir = resolveOutputDir(args.outputDir);
	const aggregateMetrics = createEmptyMetrics();
	const aggregateOutcomeMetrics = createEmptyOutcomeMetricsAccumulator();
	const aggregateEngineMetrics = createEmptyEngineBatchMetrics();
	const aggregateEquityDiagnostics = createEmptyEquityDiagnostics(args.equity.enabled);
	const champions = {};
	const runSummaries = [];
	const startedAt = Date.now();

	await ensureDirectory(outputDir);

	for (let runIndex = 1; runIndex <= args.runCount; runIndex++) {
		const runSummary = await runSingleEngineBatch(args, runIndex, outputDir);
		runSummaries.push(runSummary);
		if (runSummary.champion) {
			incrementCount(champions, runSummary.champion);
		}
		mergeRunMetrics(aggregateMetrics, runSummary.metrics);
		mergeOutcomeMetrics(aggregateOutcomeMetrics, runSummary.rawOutcomeMetrics);
		mergeEngineBatchMetrics(aggregateEngineMetrics, runSummary.engineMetrics);
		mergeEquityDiagnostics(aggregateEquityDiagnostics, runSummary.equityDiagnostics);
	}

	aggregateEngineMetrics.decisionJoinCoverage = finalizeDecisionJoinCoverage(
		aggregateEngineMetrics.decisionJoinCoverage,
	);
	const elapsedMs = Date.now() - startedAt;
	const outcomeMetrics = finalizeOutcomeMetrics(aggregateOutcomeMetrics);
	const summary = {
		generatedAt: new Date().toISOString(),
		config: {
			mode: "engine-batch",
			runCount: args.runCount,
			maxHands: args.maxHands,
			playerCount: args.playerCount,
			startingChips: args.startingChips,
			outputDir,
			projectRootPath,
			equity: {
				enabled: args.equity.enabled,
				includePreflop: args.equity.includePreflop,
				maxDecisionsPerRun: args.equity.maxDecisionsPerRun,
				exactMaxBoards: args.equity.exactMaxBoards,
				approxBoards: args.equity.approxBoards,
			},
		},
		elapsedMs,
		champions,
		runs: runSummaries.map((runSummary) => ({
			run: runSummary.run,
			type: runSummary.type,
			champion: runSummary.champion,
			elapsedMs: runSummary.elapsedMs,
			handCount: runSummary.handCount,
			eventCount: runSummary.eventCount,
			logCount: runSummary.logCount,
			logPath: runSummary.logPath,
			summaryPath: runSummary.summaryPath,
			detailsPath: runSummary.detailsPath,
			equity: {
				candidates: runSummary.equityDiagnostics.candidates,
				enriched: runSummary.equityDiagnostics.enriched,
				capped: runSummary.equityDiagnostics.capped,
			},
		})),
		metrics: aggregateMetrics,
		analysis: {
			postflop: {
				mdf: createMdfAnalysis(aggregateMetrics.postflop.mdf),
				lineReads: createPostflopLineReadAnalysis(aggregateMetrics.postflop),
			},
			equity: aggregateEquityDiagnostics,
		},
		outcomeMetrics,
		engineMetrics: aggregateEngineMetrics,
	};

	await Deno.writeTextFile(`${outputDir}/summary.json`, JSON.stringify(summary, null, 2));

	console.log(`runs=${args.runCount}`);
	console.log(`hands=${aggregateEngineMetrics.handCount}`);
	console.log(`decisions=${aggregateMetrics.decisionCount}`);
	console.log(
		`decision_join_coverage=${outcomeMetrics.decisionJoinCoverage.joinedDecisions}/${outcomeMetrics.decisionJoinCoverage.totalDecisions}`,
	);
	console.log(`preflop_spots=${aggregateMetrics.preflop.decisions}`);
	console.log(`postflop_spots=${aggregateMetrics.postflopSpots}`);
	console.log(`postflop_made_hand_folds=${aggregateMetrics.postflop.madeHandFoldCount}`);
	console.log(`preflop_premium_folds=${aggregateMetrics.preflop.premiumFoldCount}`);
	console.log(`bluff_raises_with_made_hand=${aggregateMetrics.postflop.bluffRaiseClassCounts["made-hand"] ?? 0}`);
	if (args.equity.enabled) {
		console.log(`equity_enriched=${aggregateEquityDiagnostics.enriched}/${aggregateEquityDiagnostics.candidates}`);
	}
	console.log(`showdown_hands=${aggregateEngineMetrics.showdownHands}`);
	console.log(`uncontested_hands=${aggregateEngineMetrics.uncontestedHands}`);
	console.log(`player_busts=${aggregateEngineMetrics.playerBustCount}`);
	console.log(`output_dir=${outputDir}`);
}

await main();
