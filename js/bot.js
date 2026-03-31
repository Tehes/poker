/* ==================================================================================================
MODULE BOUNDARY: Bot Decision Engine
================================================================================================== */

// CURRENT STATE: Owns poker bot decision logic, including hand evaluation, action selection, debug
// instrumentation, and queued action playback timing.
// TARGET STATE: Stay the single place for autonomous bot behavior, while pure generic poker rules
// remain in gameEngine.js and browser-facing flow stays in app.js.
// PUT HERE: Bot heuristics, opponent-independent decision rules, debug hooks, and delayed execution
// control for bot actions.
// DO NOT PUT HERE: DOM updates, sync payload shaping, notification flow, or generic poker helpers
// that should be reused outside bot play.
// STRATEGY NOTE: Winner-take-all tournament with no payout ladder. Bot decisions are chip-EV driven
// with M-ratio zones and a light elimination-risk guardrail for large calls.

import { Card, Hand } from "./pokersolver.js";

/* ===========================
   Configuration
========================== */
// Configuration constants
// Delay in milliseconds between enqueued bot actions
export let BOT_ACTION_DELAY = 3000;
const FAST_FORWARD_BOT_ACTION_DELAY = 140;
const RANK_ORDER = "23456789TJQKA";

// Enable verbose logging of bot decisions
let DEBUG_DECISIONS = false;
let DEBUG_DECISIONS_DETAIL = false;

const locationSearch = globalThis.location?.search ?? "";
const speedModeParam = new URLSearchParams(locationSearch).get("speedmode");
const debugBotParam = new URLSearchParams(locationSearch).get("botdebug");
DEBUG_DECISIONS_DETAIL = debugBotParam === "1" || debugBotParam === "true" ||
	debugBotParam === "detail";
if (DEBUG_DECISIONS_DETAIL) {
	DEBUG_DECISIONS = true;
}
const SPEED_MODE = speedModeParam !== null && speedModeParam !== "0" && speedModeParam !== "false";
if (SPEED_MODE) {
	BOT_ACTION_DELAY = 0;
	DEBUG_DECISIONS = true;
}
// Maximum number of raises allowed per betting round
const MAX_RAISES_PER_ROUND = 3;
// Extra required strengthRatio per prior raise in the same betting round
const RERAISE_RATIO_STEP = 0.12;
// Minimum strengthRatio to allow reraises (value gate)
const RERAISE_VALUE_RATIO = 0.34;
const RERAISE_TOP_PAIR_RATIO = 0.32;
// Tie-breaker thresholds for close decisions
const STRENGTH_TIE_DELTA = 0.25; // Threshold for treating strength close to the raise threshold as a tie
const ODDS_TIE_DELTA = 0.02; // Threshold for treating pot odds close to expected value as a tie
// Opponent-aware aggression tuning
const OPPONENT_THRESHOLD = 3; // Consider "few" opponents when fewer than this
const AGG_FACTOR = 0.1; // Aggressiveness increase per missing opponent
// Lower raise threshold slightly as opponents drop out; using a small factor so
// heads-up play only reduces it by ~0.6
const THRESHOLD_FACTOR = 0.3;
// Minimum average hands before opponent stats influence the bot
const MIN_HANDS_FOR_WEIGHT = 10;
// Maximum influence allowed before the normal confidence curve takes over
const EARLY_STATS_WEIGHT_MAX = 0.2;
// Controls how quickly stat influence grows as more hands are played
const WEIGHT_GROWTH = 10;
// Detect opponents that shove frequently
const ALLIN_HAND_POSTFLOP = 0.38;
// Harrington M-ratio zones and strength thresholds
const M_RATIO_DEAD_MAX = 1;
const M_RATIO_RED_MAX = 5;
const M_RATIO_ORANGE_MAX = 10;
const M_RATIO_YELLOW_MAX = 20;
const DEAD_PUSH_RATIO = 0.35;
const RED_PUSH_RATIO = 0.7;
const RED_CALL_RATIO = 0.85;
const ORANGE_PUSH_RATIO = 0.6;
const ORANGE_CALL_RATIO = 0.8;
const PREMIUM_POSTFLOP_RATIO = 0.55;
const GREEN_MAX_STACK_BET = 0.25;
const CHIP_LEADER_RAISE_DELTA = 0.05;
const SHORTSTACK_CALL_DELTA = 0.05;
const SHORTSTACK_RELATIVE = 0.6;
const MIN_PREFLOP_BLUFF_RATIO = 0.45;
// Hand-level commitment tuning to reduce multi-street bleeding
const COMMIT_SPR_MIN = 1.5;
const COMMIT_SPR_MAX = 5.5;
const COMMIT_INVEST_START = 0.1;
const COMMIT_INVEST_END = 0.6;
const COMMIT_CALL_RATIO_REF = 0.25;
const COMMITMENT_PENALTY_MAX = 0.25;
const POSTFLOP_CALL_BARRIER = 0.16;
const ELIMINATION_RISK_START = 0.25;
const ELIMINATION_RISK_FULL = 0.8;
const ELIMINATION_PENALTY_MAX = 0.25;
const PREFLOP_PREMIUM_KEYS = new Set(["AA", "KK", "QQ", "JJ", "TT", "AKs", "AKo", "AQs"]);
const PREFLOP_STRONG_KEYS = new Set([
	"99",
	"88",
	"77",
	"AJs",
	"ATs",
	"AQo",
	"AJo",
	"KQs",
	"KJs",
	"QJs",
	"JTs",
]);
const PREFLOP_MEDIUM_KEYS = new Set([
	"66",
	"55",
	"44",
	"A9s",
	"A8s",
	"A7s",
	"A6s",
	"A5s",
	"ATo",
	"A9o",
	"A8o",
	"KTs",
	"K9s",
	"QTs",
	"Q9s",
	"T9s",
	"98s",
	"87s",
]);
const PREFLOP_LIGHT_KEYS = new Set([
	"33",
	"22",
	"A4s",
	"A3s",
	"A2s",
	"A7o",
	"A6o",
	"A5o",
	"A4o",
	"A3o",
	"A2o",
	"K8s",
	"K7s",
	"K6s",
	"Q8s",
	"J9s",
	"J8s",
	"T8s",
	"97s",
	"76s",
	"65s",
	"KTo",
	"QTo",
	"JTo",
]);
const PREFLOP_UPPER_MEDIUM_KEYS = new Set([
	"66",
	"55",
	"A9s",
	"A8s",
	"A7s",
	"ATo",
	"A9o",
	"KTs",
	"QTs",
	"T9s",
	"98s",
]);
const PREFLOP_UPPER_LIGHT_KEYS = new Set([
	"33",
	"22",
	"A4s",
	"A3s",
	"A2s",
	"A7o",
	"A6o",
	"K8s",
	"Q8s",
	"J9s",
	"T8s",
	"97s",
	"76s",
	"KTo",
	"QTo",
	"JTo",
]);
const PREFLOP_LIGHT_3BET_KEYS = new Set([
	"A5s",
	"A4s",
	"A3s",
	"A2s",
	"KQs",
	"KJs",
	"QJs",
	"QTs",
	"JTs",
]);

const botActionQueue = [];
let processingBotActions = false;
let botActionTimer = null;
let runtimeBotPlaybackFast = false;

function getBotActionDelay() {
	if (SPEED_MODE) {
		return 0;
	}
	if (runtimeBotPlaybackFast) {
		return FAST_FORWARD_BOT_ACTION_DELAY;
	}
	return BOT_ACTION_DELAY;
}

/* ===========================
   Action Queue Management
========================== */
function scheduleBotQueue() {
	if (!processingBotActions || botActionQueue.length === 0 || botActionTimer) {
		return;
	}
	botActionTimer = setTimeout(() => {
		botActionTimer = null;
		processBotQueue();
	}, getBotActionDelay());
}

export function setBotPlaybackFast(enabled) {
	runtimeBotPlaybackFast = enabled;
	if (!processingBotActions || botActionQueue.length === 0) {
		return;
	}
	if (botActionTimer) {
		clearTimeout(botActionTimer);
		botActionTimer = null;
	}
	scheduleBotQueue();
}

// Task queue management: enqueue bot actions for delayed execution
export function enqueueBotAction(fn) {
	botActionQueue.push(fn);
	if (!processingBotActions) {
		processingBotActions = true;
	}
	scheduleBotQueue();
}

// Execute queued actions at fixed intervals
function processBotQueue() {
	if (botActionQueue.length === 0) {
		processingBotActions = false;
		return;
	}
	const fn = botActionQueue.shift();
	fn();
	if (botActionQueue.length > 0) {
		scheduleBotQueue();
	} else {
		processingBotActions = false;
	}
}

/* ===========================
   Logging and Utilities
========================== */

// Card display utilities
// Map suit codes to their Unicode symbols
const SUIT_SYMBOLS = { C: "♣", D: "♦", H: "♥", S: "♠" };
// Convert internal card code to human-readable symbol string
function formatCard(code) {
	return code[0].replace("T", "10") + SUIT_SYMBOLS[code[1]];
}

function ceilTo10(x) {
	return Math.ceil(x / 10) * 10;
}

function floorTo10(x) {
	return Math.floor(x / 10) * 10;
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function normalizePreflopCards(cardA, cardB) {
	let highRank = cardA[0];
	let lowRank = cardB[0];
	let highSuit = cardA[1];
	let lowSuit = cardB[1];
	let highIndex = RANK_ORDER.indexOf(highRank);
	let lowIndex = RANK_ORDER.indexOf(lowRank);

	if (highIndex < lowIndex) {
		[highRank, lowRank] = [lowRank, highRank];
		[highSuit, lowSuit] = [lowSuit, highSuit];
		[highIndex, lowIndex] = [lowIndex, highIndex];
	}

	return { highRank, lowRank, highSuit, lowSuit, highIndex, lowIndex };
}

function getPreflopComboKey(cardA, cardB) {
	const normalized = normalizePreflopCards(cardA, cardB);
	if (normalized.highRank === normalized.lowRank) {
		return `${normalized.highRank}${normalized.lowRank}`;
	}
	return `${normalized.highRank}${normalized.lowRank}${
		normalized.highSuit === normalized.lowSuit ? "s" : "o"
	}`;
}

function handTiebreaker(handObj) {
	const base = 15;
	let value = 0;
	let factor = 1 / base;
	for (const card of handObj.cards) {
		value += card.rank * factor;
		factor /= base;
	}
	return value;
}

function getSolvedHandScore(handObj) {
	return handObj ? handObj.rank + handTiebreaker(handObj) : 0;
}

function compareRankArrays(left, right) {
	const maxLength = Math.max(left.length, right.length);
	for (let i = 0; i < maxLength; i++) {
		const leftRank = left[i] ?? -1;
		const rightRank = right[i] ?? -1;
		if (leftRank > rightRank) {
			return 1;
		}
		if (leftRank < rightRank) {
			return -1;
		}
	}
	return 0;
}

function getRankGroups(cards) {
	const counts = new Map();
	cards.forEach((card) => {
		counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
	});
	return Array.from(counts.entries()).sort((left, right) => {
		if (right[1] !== left[1]) {
			return right[1] - left[1];
		}
		return right[0] - left[0];
	});
}

function getSortedRanks(cards) {
	return cards.map((card) => card.rank).sort((left, right) => right - left);
}

function getStraightHighRank(cards) {
	const ranks = [...new Set(cards.map((card) => card.rank))].sort((left, right) => right - left);
	const isWheel = ranks.includes(13) && ranks.includes(4) && ranks.includes(3) &&
		ranks.includes(2) && ranks.includes(1);
	return isWheel ? 4 : (ranks[0] ?? -1);
}

function describeSolvedHand(handObj) {
	if (!handObj) {
		return { primary: [], kickers: [] };
	}

	const groups = getRankGroups(handObj.cards);
	switch (handObj.name) {
		case "Pair": {
			const pairRank = groups.find(([, count]) => count === 2)?.[0] ?? -1;
			const kickers = groups
				.filter(([, count]) => count === 1)
				.map(([rank]) => rank)
				.sort((left, right) => right - left);
			return { primary: [pairRank], kickers };
		}
		case "Two Pair": {
			const pairRanks = groups
				.filter(([, count]) => count === 2)
				.map(([rank]) => rank)
				.sort((left, right) => right - left);
			const kickerRank = groups.find(([, count]) => count === 1)?.[0];
			return {
				primary: pairRanks,
				kickers: kickerRank === undefined ? [] : [kickerRank],
			};
		}
		case "Three of a Kind": {
			const tripRank = groups.find(([, count]) => count === 3)?.[0] ?? -1;
			const kickers = groups
				.filter(([, count]) => count === 1)
				.map(([rank]) => rank)
				.sort((left, right) => right - left);
			return { primary: [tripRank], kickers };
		}
		case "Straight":
		case "Straight Flush":
			return { primary: [getStraightHighRank(handObj.cards)], kickers: [] };
		case "Flush":
			return { primary: getSortedRanks(handObj.cards), kickers: [] };
		case "Full House": {
			const tripRank = groups.find(([, count]) => count === 3)?.[0] ?? -1;
			const pairRank = groups.find(([, count]) => count === 2)?.[0] ?? -1;
			return { primary: [tripRank, pairRank], kickers: [] };
		}
		case "Four of a Kind": {
			const quadRank = groups.find(([, count]) => count === 4)?.[0] ?? -1;
			const kickerRank = groups.find(([, count]) => count === 1)?.[0];
			return {
				primary: [quadRank],
				kickers: kickerRank === undefined ? [] : [kickerRank],
			};
		}
		case "High Card":
		default:
			return { primary: [], kickers: getSortedRanks(handObj.cards) };
	}
}

function classifyPrivateLift(rawHand, publicHand) {
	if (!rawHand || !publicHand) {
		return "none";
	}
	if (rawHand.rank > publicHand.rank) {
		return "category";
	}
	if (rawHand.rank < publicHand.rank) {
		return "none";
	}

	const rawDescriptor = describeSolvedHand(rawHand);
	const publicDescriptor = describeSolvedHand(publicHand);
	const primaryCompare = compareRankArrays(rawDescriptor.primary, publicDescriptor.primary);
	if (primaryCompare > 0) {
		return "structural";
	}
	if (primaryCompare < 0) {
		return "none";
	}

	return compareRankArrays(rawDescriptor.kickers, publicDescriptor.kickers) > 0
		? "kicker"
		: "none";
}

function getTextureBucket(textureRisk) {
	if (textureRisk < 0.25) {
		return "dry";
	}
	if (textureRisk < 0.55) {
		return "neutral";
	}
	return "wet";
}

function getPostflopHandTier({ solvedHand, publicHand, liftType, topPair, overPair }) {
	if (!solvedHand || solvedHand.rank < 2) {
		return "air";
	}
	if (solvedHand.rank >= 3) {
		const publicRank = publicHand?.rank ?? 0;
		return solvedHand.rank > publicRank || liftType === "structural" || liftType === "category"
			? "two-pair-plus"
			: "weak-showdown";
	}
	if (overPair) {
		return "overpair";
	}
	if (topPair) {
		return "top-pair";
	}
	return "weak-showdown";
}

function getPostflopAggressionRatio({
	handTier,
	solvedHand,
	liftType,
	isStrongDraw,
	isWeakDraw,
	textureRisk,
	activeOpponents,
	headsUp,
	shownStrengthCount,
	isFlop,
	isTurn,
}) {
	let ratio;
	switch (handTier) {
		case "top-pair":
			ratio = 0.34;
			break;
		case "overpair":
			ratio = 0.40;
			break;
		case "two-pair-plus":
			ratio = solvedHand?.rank >= 7
				? 0.90
				: solvedHand?.rank >= 5
				? 0.72
				: solvedHand?.rank === 4
				? 0.60
				: 0.52;
			break;
		case "weak-showdown":
			ratio = 0.18;
			break;
		case "air":
		default:
			ratio = 0.08;
			break;
	}

	if (isStrongDraw) {
		ratio = Math.max(ratio, 0.26);
	}

	if (headsUp) {
		ratio += 0.04;
	} else {
		ratio -= Math.min(0.06, Math.max(0, activeOpponents - 1) * 0.02);
	}

	if (handTier === "top-pair" || handTier === "overpair") {
		if (textureRisk < 0.25) {
			ratio += 0.03;
		} else if (textureRisk > 0.55) {
			ratio -= 0.04;
		}
	}

	if (handTier === "weak-showdown" && textureRisk > 0.55) {
		ratio -= 0.03;
	}

	if (isStrongDraw && isFlop) {
		ratio += 0.02;
	} else if (isStrongDraw && isTurn) {
		ratio += 0.03;
	}

	if (isWeakDraw) {
		ratio -= 0.02;
	}

	if (shownStrengthCount > 1 && (handTier === "air" || handTier === "weak-showdown")) {
		ratio -= 0.04;
	}

	if (liftType === "structural") {
		ratio += 0.03;
	} else if (
		liftType === "category" &&
		(handTier === "top-pair" || handTier === "overpair" || handTier === "two-pair-plus")
	) {
		ratio += 0.02;
	}

	return Math.max(0, Math.min(0.95, ratio));
}

function getPostflopDefenseStructure({ handContext, headsUp }) {
	const preflopRaiseCount = handContext?.preflopRaiseCount ?? 0;
	if (preflopRaiseCount <= 0) {
		return headsUp ? "limped-hu" : "limped-mw";
	}
	if (preflopRaiseCount === 1) {
		return headsUp ? "single-raised-hu" : "single-raised-mw";
	}
	return headsUp ? "multi-raised-hu" : "multi-raised-mw";
}

function getPostflopDefenseProfile({ handTier, solvedHand, liftType, defenseStructure }) {
	let defenseClass = "none";

	if (handTier === "weak-showdown") {
		defenseClass = "weak-showdown";
	} else if (handTier === "top-pair") {
		const promotedTopPair = defenseStructure === "single-raised-hu" ||
			liftType === "kicker" || liftType === "structural";
		defenseClass = promotedTopPair ? "top-pair-plus" : "top-pair-marginal";
	} else if (handTier === "overpair") {
		defenseClass = "overpair";
	} else if (handTier === "two-pair-plus") {
		defenseClass = solvedHand?.rank >= 4 ? "trips-plus" : "two-pair";
	}

	switch (defenseClass) {
		case "weak-showdown":
			return {
				defenseClass,
				passiveFloor: 0.20,
				barrierRelief: 0,
				tighteningScale: 1,
				stackRatioCap: 0.70,
				eliminationScale: 1,
			};
		case "top-pair-marginal":
			return {
				defenseClass,
				passiveFloor: 0.28,
				barrierRelief: 0,
				tighteningScale: 1,
				stackRatioCap: 0.75,
				eliminationScale: 1,
			};
		case "top-pair-plus":
			return {
				defenseClass,
				passiveFloor: 0.36,
				barrierRelief: -0.03,
				tighteningScale: 0.5,
				stackRatioCap: 0.90,
				eliminationScale: 0.75,
			};
		case "overpair":
			return {
				defenseClass,
				passiveFloor: 0.42,
				barrierRelief: -0.04,
				tighteningScale: 0.5,
				stackRatioCap: 0.95,
				eliminationScale: 0.70,
			};
		case "two-pair":
			return {
				defenseClass,
				passiveFloor: 0.56,
				barrierRelief: -0.06,
				tighteningScale: 0.25,
				stackRatioCap: 1,
				eliminationScale: 0.50,
			};
		case "trips-plus":
			return {
				defenseClass,
				passiveFloor: 0.72,
				barrierRelief: -0.08,
				tighteningScale: 0,
				stackRatioCap: 1,
				eliminationScale: 0.30,
			};
		default:
			return {
				defenseClass,
				passiveFloor: 0,
				barrierRelief: 0,
				tighteningScale: 1,
				stackRatioCap: 0.70,
				eliminationScale: 1,
			};
	}
}

function getPostflopPassiveRatio({
	passiveFloor,
	basePassiveStrengthRatio,
	aggressionStrengthRatio,
	isStrongDraw,
	isWeakDraw,
}) {
	let ratio = Math.max(basePassiveStrengthRatio, aggressionStrengthRatio);
	if (passiveFloor > 0) {
		ratio = Math.max(ratio, passiveFloor);
	}

	if (isStrongDraw) {
		ratio = Math.max(ratio, 0.22);
	} else if (isWeakDraw) {
		ratio = Math.max(ratio, 0.18);
	}

	return Math.max(0, Math.min(0.95, ratio));
}

function getPublicDefenseFloor(publicHand, boardLength) {
	if (!publicHand || boardLength < 3) {
		return 0;
	}

	switch (publicHand.rank) {
		case 2:
			return boardLength === 3 ? 0.10 : boardLength === 4 ? 0.12 : 0.14;
		case 3:
			return boardLength === 3 ? 0.12 : boardLength === 4 ? 0.14 : 0.16;
		case 4:
			return boardLength === 3 ? 0.14 : boardLength === 4 ? 0.16 : 0.18;
		default:
			return publicHand.rank >= 5
				? (boardLength === 3 ? 0.16 : boardLength === 4 ? 0.18 : 0.20)
				: 0;
	}
}

function getPassiveBonus(liftType) {
	switch (liftType) {
		case "kicker":
			return 0.02;
		case "structural":
			return 0.04;
		case "category":
			return 0.06;
		default:
			return 0;
	}
}

function buildPostflopStrengthProfile(solvedHand, communityCards) {
	const rawScore = getSolvedHandScore(solvedHand);
	if (!solvedHand || communityCards.length < 3) {
		return {
			publicHand: null,
			publicScore: 0,
			rawScore,
			liftType: "none",
			publicDefenseFloor: 0,
			privateAggressionRatio: 0,
			passiveBonus: 0,
			passiveStrengthRatio: 0,
		};
	}

	const publicHand = Hand.solve(communityCards);
	const publicScore = getSolvedHandScore(publicHand);
	const liftType = classifyPrivateLift(solvedHand, publicHand);
	const publicDefenseFloor = getPublicDefenseFloor(publicHand, communityCards.length);
	const passiveBonus = getPassiveBonus(liftType);
	const passiveStrengthRatio = publicDefenseFloor + passiveBonus;

	return {
		publicHand,
		publicScore,
		rawScore,
		liftType,
		publicDefenseFloor,
		privateAggressionRatio: 0,
		passiveBonus,
		passiveStrengthRatio,
	};
}

// Calculate how often a player folds
function calcFoldRate(p) {
	return p.stats.hands > 0 ? p.stats.folds / p.stats.hands : 0;
}

// Average fold rate across a set of opponents
function avgFoldRate(opponents) {
	if (opponents.length === 0) return 0;
	return opponents.reduce((s, p) => s + calcFoldRate(p), 0) / opponents.length;
}

/* -----------------------------
   Post-flop Board Evaluation
----------------------------- */

// Determine if the two hole cards form a pocket pair
function isPocketPair(hole) {
	return new Card(hole[0]).rank === new Card(hole[1]).rank;
}

// Analyze hand context using pokersolver. Returns whether the bot has
// top pair (pair made with the highest board card) or over pair (pocket
// pair higher than any board card).
function analyzeHandContext(hole, board) {
	const hand = Hand.solve([...hole, ...board]);

	const boardRanks = board.map((c) => new Card(c).rank);
	const highestBoard = Math.max(...boardRanks);
	const pocketPair = isPocketPair(hole);

	let isTopPair = false;
	let isOverPair = false;

	if (hand.name === "Pair") {
		const pairRank = hand.cards[0].rank;
		isTopPair = pairRank === highestBoard;
		isOverPair = pocketPair && pairRank > highestBoard;
	}

	return { isTopPair, isOverPair };
}

// Detect draw potential after the flop. Straight draws should not trigger when
// a made straight already exists.
function analyzeDrawPotential(hole, board) {
	const allCards = [...hole, ...board];

	const draws = {
		flushDraw: false,
		straightDraw: false,
		outs: 0,
	};

	// Count suits for flush draws
	const suits = {};
	allCards.forEach((c) => {
		const suit = c[1];
		suits[suit] = (suits[suit] || 0) + 1;
	});
	const suitCounts = Object.values(suits);
	const hasFlush = suitCounts.some((c) => c >= 5);
	if (!hasFlush) {
		draws.flushDraw = suitCounts.some((c) => c === 4);
	}
	const flushOuts = draws.flushDraw ? 9 : 0;

	// Straight draw check
	const ranks = allCards.map((c) => new Card(c).rank);
	if (ranks.includes(14)) ranks.push(1); // allow A-2-3-4-5
	const unique = [...new Set(ranks)].sort((a, b) => a - b);

	const straights = [];
	for (let start = 1; start <= 10; start++) {
		straights.push([start, start + 1, start + 2, start + 3, start + 4]);
	}
	let straightOuts = 0;
	let hasStraight = false;
	const missingRanks = new Set();
	for (const seq of straights) {
		const missing = seq.filter((r) => !unique.includes(r));
		if (missing.length === 0) {
			// Already a straight; no draw
			hasStraight = true;
			break;
		}
		if (missing.length === 1) {
			draws.straightDraw = true;
			const missingRank = missing[0];
			missingRanks.add(missingRank);
			if (missingRank === seq[0] || missingRank === seq[4]) {
				straightOuts = 8;
			}
		}
	}

	if (hasStraight) {
		draws.straightDraw = false;
		straightOuts = 0;
	} else if (draws.straightDraw && straightOuts === 0) {
		straightOuts = missingRanks.size >= 2 ? 8 : 4;
	}

	draws.outs = flushOuts + straightOuts;

	return draws;
}

// Evaluate board "texture" based on connectedness, suitedness and pairing.
// Returns a number between 0 (dry) and 1 (very wet).
function evaluateBoardTexture(board) {
	if (!board || board.length < 3) return 0;

	const rankMap = {
		"2": 2,
		"3": 3,
		"4": 4,
		"5": 5,
		"6": 6,
		"7": 7,
		"8": 8,
		"9": 9,
		"T": 10,
		"J": 11,
		"Q": 12,
		"K": 13,
		"A": 14,
	};
	const suitMap = { "♣": "C", "♦": "D", "♥": "H", "♠": "S" };

	const ranks = [];
	const rankCounts = {};
	const suitCounts = {};

	board.forEach((card) => {
		const r = card[0];
		let s = card[1];
		s = suitMap[s] || s;
		ranks.push(rankMap[r]);
		rankCounts[r] = (rankCounts[r] || 0) + 1;
		suitCounts[s] = (suitCounts[s] || 0) + 1;
	});

	// ----- Pairing -----
	const maxRankCount = Math.max(...Object.values(rankCounts));
	const pairRisk = maxRankCount > 1 ? (maxRankCount - 1) / (board.length - 1) : 0;

	// ----- Suitedness -----
	const maxSuitCount = Math.max(...Object.values(suitCounts));
	const suitRisk = (maxSuitCount - 1) / (board.length - 1);

	// ----- Connectedness -----
	const ranksForStraight = ranks.slice();
	if (ranksForStraight.includes(14)) ranksForStraight.push(1); // wheel
	const unique = [...new Set(ranksForStraight)].sort((a, b) => a - b);
	let maxConsecutive = 1;
	let currentRun = 1;
	for (let i = 1; i < unique.length; i++) {
		if (unique[i] === unique[i - 1] + 1) {
			currentRun += 1;
		} else {
			currentRun = 1;
		}
		if (currentRun > maxConsecutive) maxConsecutive = currentRun;
	}
	const connectedness = maxConsecutive >= 3
		? Math.max(0, (maxConsecutive - 2) / (board.length - 2))
		: 0;

	const textureRisk = (connectedness + suitRisk + pairRisk) / 3;
	return Math.max(0, Math.min(1, textureRisk));
}

function isScareTurnCard(board, textureRisk) {
	if (!board || board.length !== 4) {
		return false;
	}

	const turnCard = new Card(board[3]);
	const flopRanks = board.slice(0, 3).map((card) => new Card(card).rank);
	const flopHighRank = Math.max(...flopRanks);
	const pairedBoard = new Set(board.map((card) => new Card(card).rank)).size < board.length;
	const suitCounts = {};
	board.forEach((card) => {
		const suit = card[1];
		suitCounts[suit] = (suitCounts[suit] || 0) + 1;
	});
	const flushPressure = Object.values(suitCounts).some((count) => count >= 3);

	return turnCard.rank > flopHighRank || pairedBoard || flushPressure || textureRisk > 0.55;
}

/* ===========================
   Preflop Hand Evaluation
========================== */
function getPreflopHandProfile(cardA, cardB) {
	const normalized = normalizePreflopCards(cardA, cardB);
	const suited = normalized.highSuit === normalized.lowSuit;
	const pair = normalized.highRank === normalized.lowRank;
	const highValue = normalized.highIndex + 2;
	const lowValue = normalized.lowIndex + 2;
	const gap = pair ? -1 : normalized.highIndex - normalized.lowIndex - 1;
	const broadwayCount = (highValue >= 10 ? 1 : 0) + (lowValue >= 10 ? 1 : 0);

	return {
		key: getPreflopComboKey(cardA, cardB),
		highRank: normalized.highRank,
		lowRank: normalized.lowRank,
		highValue,
		lowValue,
		suited,
		pair,
		gap,
		connected: gap === 0,
		oneGap: gap === 1,
		broadwayCount,
		bothBroadway: broadwayCount === 2,
		hasAce: normalized.highRank === "A" || normalized.lowRank === "A",
		hasKing: normalized.highRank === "K" || normalized.lowRank === "K",
		hasQueen: normalized.highRank === "Q" || normalized.lowRank === "Q",
		hasJack: normalized.highRank === "J" || normalized.lowRank === "J",
		hasTen: normalized.highRank === "T" || normalized.lowRank === "T",
		wheelAce: normalized.highRank === "A" && lowValue <= 5,
		suitedConnector54Plus: suited && gap === 0 && lowValue >= 5,
	};
}

function getPreflopHandBand(profile) {
	if (PREFLOP_PREMIUM_KEYS.has(profile.key)) {
		return "premium";
	}
	if (PREFLOP_STRONG_KEYS.has(profile.key)) {
		return "strong";
	}
	if (PREFLOP_MEDIUM_KEYS.has(profile.key)) {
		return "medium";
	}
	if (PREFLOP_LIGHT_KEYS.has(profile.key)) {
		return "light";
	}
	return "trash";
}

function getPreflopHandDetail(profile, band) {
	if (band === "medium") {
		return PREFLOP_UPPER_MEDIUM_KEYS.has(profile.key) ? "upper-medium" : "lower-medium";
	}
	if (band === "light") {
		return PREFLOP_UPPER_LIGHT_KEYS.has(profile.key) ? "upper-light" : "lower-light";
	}
	return band;
}

function getPreflopStrengthScore(profile, band = null, detail = null) {
	const resolvedBand = band ?? getPreflopHandBand(profile);
	const resolvedDetail = detail ?? getPreflopHandDetail(profile, resolvedBand);

	if (resolvedBand === "premium") {
		return 10;
	}

	let score = 2.75;
	if (resolvedBand === "strong") {
		score = 8.75;
	} else if (resolvedDetail === "upper-medium") {
		score = 7.3;
	} else if (resolvedDetail === "lower-medium") {
		score = 6.35;
	} else if (resolvedDetail === "upper-light") {
		score = 5.4;
	} else if (resolvedDetail === "lower-light") {
		score = 4.75;
	} else {
		score = 3.2;
	}

	if (resolvedBand === "trash") {
		if (profile.hasAce) {
			score += profile.suited ? 2 : 1.7;
		} else if (profile.bothBroadway) {
			score += 1.7;
		} else if (profile.hasKing && profile.lowValue >= 8) {
			score += 1.3;
		} else if (profile.suitedConnector54Plus) {
			score += 1.15;
		} else if (profile.suited && (profile.connected || profile.oneGap)) {
			score += 0.9;
		} else if (profile.suited && profile.highValue >= 9) {
			score += 0.6;
		}
		if (profile.suited) {
			score += 0.25;
		}
		if (profile.connected) {
			score += 0.3;
		} else if (profile.oneGap) {
			score += 0.15;
		}
		if (profile.highValue <= 8 && !profile.suited) {
			score -= 0.2;
		}
		return clamp(score, 2.3, 5.3);
	}

	if (profile.pair) {
		score += 0.5;
	}
	if (profile.hasAce) {
		score += resolvedBand === "strong" ? 0.2 : 0.4;
	}
	if (profile.suited && !profile.pair) {
		score += 0.22;
	}
	if (profile.connected) {
		score += 0.2;
	} else if (profile.oneGap) {
		score += 0.1;
	}
	if (profile.bothBroadway) {
		score += 0.2;
	}
	if (profile.wheelAce) {
		score += 0.1;
	}

	const maxScore = resolvedBand === "strong"
		? 9.35
		: resolvedDetail === "upper-medium"
		? 7.95
		: resolvedDetail === "lower-medium"
		? 6.95
		: resolvedDetail === "upper-light"
		? 6.05
		: 5.35;
	return clamp(score, 0, maxScore);
}

function getPreflopSeatClass(players, player) {
	const active = players.filter((currentPlayer) => !currentPlayer.folded);
	if (player.smallBlind) {
		return "smallBlind";
	}
	if (player.bigBlind) {
		return "bigBlind";
	}
	if (player.dealer) {
		return "button";
	}

	const activeIndex = active.indexOf(player);
	const betweenBlindAndButton = Math.max(0, active.length - 3);
	if (betweenBlindAndButton <= 1) {
		return "cutoff";
	}

	const relativeIndex = Math.max(0, activeIndex - 3);
	if (betweenBlindAndButton === 2) {
		return relativeIndex === 0 ? "early" : "cutoff";
	}
	return relativeIndex === 0
		? "early"
		: relativeIndex === betweenBlindAndButton - 1
		? "cutoff"
		: "middle";
}

function getPreflopMixChance(profile, seatClass, activePlayers, baseChance) {
	const band = getPreflopHandBand(profile);
	const detail = getPreflopHandDetail(profile, band);
	let chance = baseChance;
	if (band === "premium" || band === "strong" || detail === "upper-medium") {
		chance += 0.05;
	} else if (
		band === "medium" ||
		detail === "upper-light" ||
		(band === "trash" && (profile.hasAce || profile.bothBroadway))
	) {
		chance += 0.03;
	}
	if (profile.suited) {
		chance += 0.03;
	}
	if (profile.pair) {
		chance += 0.04;
	}
	if (profile.connected) {
		chance += 0.03;
	} else if (profile.oneGap) {
		chance += 0.01;
	}
	if (seatClass === "button" || seatClass === "smallBlind" || activePlayers <= 3) {
		chance += 0.02;
	}
	if (detail === "upper-light") {
		chance += 0.02;
	}
	if (
		(seatClass === "button" || seatClass === "smallBlind") &&
		(detail === "upper-light" || detail === "lower-light")
	) {
		chance += 0.02;
	}
	if (detail === "lower-light") {
		if (seatClass === "cutoff" || seatClass === "button") {
			chance += 0.02;
		}
		if (seatClass === "smallBlind" || activePlayers <= 3) {
			chance += 0.03;
		}
	}
	if (seatClass === "smallBlind") {
		chance += 0.02;
	}
	const maxChance = activePlayers <= 2 && seatClass === "smallBlind" ? 0.85 : 0.4;
	return clamp(chance, 0.2, maxChance);
}

function rollPreflopMix(profile, seatClass, activePlayers, baseChance) {
	return Math.random() < getPreflopMixChance(profile, seatClass, activePlayers, baseChance);
}

function isLatePreflopSeat(seatClass, activePlayers) {
	return activePlayers <= 2 || seatClass === "cutoff" || seatClass === "button" ||
		seatClass === "smallBlind";
}

function isHeadsUpOpenCandidate(profile) {
	if (profile.pair || profile.hasAce || profile.hasKing || profile.suitedConnector54Plus) {
		return true;
	}
	if ((profile.hasQueen || profile.hasJack) && profile.suited) {
		return true;
	}
	if (profile.bothBroadway) {
		return true;
	}
	if (
		!profile.suited && (
			(profile.hasQueen && profile.lowValue >= 9) ||
			(profile.hasJack && profile.lowValue >= 9) ||
			(profile.hasTen && profile.lowValue >= 9)
		)
	) {
		return true;
	}
	return false;
}

function isClearHeadsUpTrash(profile) {
	return !profile.pair &&
		!profile.hasAce &&
		!profile.hasKing &&
		!profile.suited &&
		!profile.bothBroadway &&
		!profile.connected &&
		!profile.oneGap &&
		profile.highValue < 10;
}

function isFiveHandedEarlyLowerLightCandidate(profile) {
	return profile.hasAce || profile.bothBroadway || profile.suited || profile.connected ||
		profile.oneGap;
}

function isThreeHandedButtonTrashCandidate(profile) {
	return profile.hasAce ||
		profile.bothBroadway ||
		profile.highValue >= 10 ||
		(profile.hasKing && profile.lowValue >= 7) ||
		(profile.hasQueen && profile.lowValue >= 8) ||
		(profile.hasJack && profile.lowValue >= 8) ||
		profile.suited ||
		profile.connected ||
		profile.oneGap;
}

function shouldOpenRaisePreflop({ activePlayers, seatClass, band, detail, profile }) {
	if (seatClass === "bigBlind") {
		return false;
	}

	if (activePlayers <= 2 && seatClass === "smallBlind") {
		const pureHeadsUpOpen = isHeadsUpOpenCandidate(profile) ||
			profile.wheelAce ||
			(profile.suited && (profile.hasKing || profile.hasQueen || profile.hasJack));
		if (pureHeadsUpOpen) {
			return true;
		}
		if (isClearHeadsUpTrash(profile)) {
			return false;
		}
		return rollPreflopMix(profile, seatClass, activePlayers, 0.82);
	}

	if (activePlayers === 3) {
		if (seatClass === "button") {
			if (
				band === "premium" || band === "strong" || band === "medium" ||
				detail === "upper-light" || detail === "lower-light"
			) {
				return true;
			}
			if (band === "trash" && isThreeHandedButtonTrashCandidate(profile)) {
				return rollPreflopMix(profile, seatClass, activePlayers, 0.40);
			}
			return false;
		}
		if (
			band === "premium" || band === "strong" || band === "medium" || detail === "upper-light"
		) {
			return true;
		}
		if (detail === "lower-light") {
			return rollPreflopMix(profile, seatClass, activePlayers, 0.32);
		}
		return false;
	}

	if (activePlayers === 4) {
		const lateSpot = seatClass === "cutoff" || seatClass === "button" ||
			seatClass === "smallBlind";
		if (band === "premium" || band === "strong" || band === "medium") {
			return true;
		}
		if (detail === "upper-light") {
			return lateSpot || rollPreflopMix(profile, seatClass, activePlayers, 0.25);
		}
		if (detail === "lower-light" && lateSpot) {
			return rollPreflopMix(profile, seatClass, activePlayers, 0.35);
		}
		return false;
	}

	if (activePlayers === 5) {
		const lateSpot = seatClass === "cutoff" || seatClass === "button" ||
			seatClass === "smallBlind";
		if (
			band === "premium" || band === "strong" || band === "medium" ||
			detail === "upper-light"
		) {
			return true;
		}
		if (detail === "lower-light" && seatClass === "early") {
			return isFiveHandedEarlyLowerLightCandidate(profile) &&
				rollPreflopMix(profile, seatClass, activePlayers, 0.18);
		}
		if (detail === "lower-light" && lateSpot) {
			return rollPreflopMix(profile, seatClass, activePlayers, 0.24);
		}
		return false;
	}

	const lateSpot = seatClass === "cutoff" || seatClass === "button";
	if (band === "premium" || band === "strong") {
		return true;
	}
	if (seatClass === "early") {
		return band === "medium";
	}
	if (seatClass === "middle") {
		if (band === "medium") {
			return true;
		}
		if (detail === "upper-light") {
			return rollPreflopMix(profile, seatClass, activePlayers, 0.2);
		}
		return false;
	}
	if (lateSpot) {
		if (band === "medium" || detail === "upper-light") {
			return true;
		}
		if (detail === "lower-light") {
			return rollPreflopMix(profile, seatClass, activePlayers, 0.25);
		}
		return false;
	}
	if (seatClass === "smallBlind") {
		if (band === "medium" || detail === "upper-light") {
			return true;
		}
		if (detail === "lower-light") {
			return rollPreflopMix(profile, seatClass, activePlayers, 0.25);
		}
	}
	return false;
}

function isValueThreeBetPreflop(profile, seatClass, activePlayers) {
	if (profile.pair && profile.highValue >= 12) {
		return true;
	}
	if (profile.key === "AKs" || profile.key === "AKo" || profile.key === "AQs") {
		return true;
	}
	return profile.key === "JJ" && isLatePreflopSeat(seatClass, activePlayers);
}

function isLightThreeBetPreflop(profile, seatClass, activePlayers, mZone) {
	if (mZone !== "green" || !isLatePreflopSeat(seatClass, activePlayers)) {
		return false;
	}
	return PREFLOP_LIGHT_3BET_KEYS.has(profile.key);
}

function shouldFlatCallPreflopRaise({
	profile,
	band,
	detail,
	seatClass,
	activePlayers,
	potOdds,
	stackRatio,
}) {
	const priceOkay = potOdds <= 0.45 && stackRatio <= 0.35;
	const priceGood = potOdds <= 0.34 && stackRatio <= 0.4;
	const bigBlindDefend = seatClass === "bigBlind";
	const lateSpot = isLatePreflopSeat(seatClass, activePlayers);

	if (!priceOkay) {
		return false;
	}
	if (profile.pair) {
		return true;
	}
	if (bigBlindDefend) {
		if (band === "strong" || band === "medium") {
			return true;
		}
		if (detail === "upper-light") {
			if (activePlayers <= 2) {
				return rollPreflopMix(profile, seatClass, activePlayers, 0.34);
			}
			return priceGood && rollPreflopMix(profile, seatClass, activePlayers, 0.24);
		}
		if (detail === "lower-light") {
			return activePlayers <= 2 && priceGood &&
				(profile.suited || profile.connected || profile.oneGap) &&
				rollPreflopMix(profile, seatClass, activePlayers, 0.22);
		}
		return false;
	}
	if (lateSpot) {
		if (band === "strong") {
			return true;
		}
		if (band === "medium") {
			return activePlayers <= 2 || priceGood || profile.suited;
		}
		if (detail === "upper-light") {
			return activePlayers <= 2 && priceGood &&
				(profile.suited || profile.connected || profile.hasAce) &&
				rollPreflopMix(profile, seatClass, activePlayers, 0.24);
		}
	}
	return false;
}

function getPreflopSpotType(spotContext) {
	if (spotContext.unopened) {
		return "unopened";
	}
	if (spotContext.limped) {
		return "limped";
	}
	if (spotContext.multiRaised) {
		return "multiRaised";
	}
	if (spotContext.singleRaised) {
		return "singleRaised";
	}
	return "other";
}

function shouldIsoRaisePreflop({ activePlayers, seatClass, band, detail }) {
	if (band === "premium" || band === "strong") {
		return true;
	}
	return detail === "upper-medium" &&
		(isLatePreflopSeat(seatClass, activePlayers) || activePlayers <= 3);
}

function shouldCallMultiRaisedPreflop({
	band,
	seatClass,
	activePlayers,
	potOdds,
	stackRatio,
}) {
	if (band !== "strong") {
		return false;
	}
	const lateSpot = isLatePreflopSeat(seatClass, activePlayers);
	return (seatClass === "bigBlind" || lateSpot || activePlayers <= 3) &&
		potOdds <= 0.3 && stackRatio <= 0.22;
}

function shouldShoveShortStackPreflop({
	spotType,
	activePlayers,
	seatClass,
	band,
	detail,
	spr,
	playerChips,
	bigBlind,
}) {
	const veryShort = spr <= 1.2;
	const shortStack = playerChips <= bigBlind * 10;

	if (!veryShort && !shortStack) {
		return false;
	}
	if (spotType === "multiRaised" && band !== "premium") {
		return false;
	}
	if (band === "premium" || band === "strong") {
		return true;
	}
	if (detail !== "upper-medium") {
		return false;
	}
	const lateSpot = isLatePreflopSeat(seatClass, activePlayers);
	if (veryShort) {
		return lateSpot || activePlayers <= 3;
	}
	return (spotType === "unopened" || spotType === "singleRaised") &&
		(lateSpot || activePlayers <= 3);
}

/* ===========================
   Decision Helpers
========================== */
function findNextActivePlayer(players, startIdx) {
	for (let i = 1; i <= players.length; i++) {
		const idx = (startIdx + i) % players.length;
		if (!players[idx].folded) return players[idx];
	}
	return players[startIdx];
}

function computePositionFactor(players, active, player, currentPhaseIndex) {
	if (currentPhaseIndex === 0) {
		const seatClass = getPreflopSeatClass(players, player);
		if (active.length <= 2) {
			return seatClass === "smallBlind" ? 1 : 0;
		}
		const factorMap = {
			early: 0.2,
			middle: 0.45,
			cutoff: 0.8,
			button: 1,
			smallBlind: 0.65,
			bigBlind: 0,
		};
		return factorMap[seatClass] ?? 0.35;
	}

	const seatIdx = active.indexOf(player);
	const firstToAct = currentPhaseIndex === 0
		? findNextActivePlayer(players, players.findIndex((p) => p.bigBlind))
		: findNextActivePlayer(players, players.findIndex((p) => p.dealer));
	const refIdx = active.indexOf(firstToAct);
	const pos = (seatIdx - refIdx + active.length) % active.length;
	return active.length > 1 ? pos / (active.length - 1) : 0;
}

function getActionOrder(players, currentPhaseIndex) {
	const active = players.filter((p) => !p.folded);
	if (active.length === 0) {
		return [];
	}
	const firstToAct = currentPhaseIndex === 0
		? findNextActivePlayer(players, players.findIndex((p) => p.bigBlind))
		: findNextActivePlayer(players, players.findIndex((p) => p.dealer));
	const startIdx = active.indexOf(firstToAct);
	return startIdx === -1 ? active : active.slice(startIdx).concat(active.slice(0, startIdx));
}

function getStatsWeight(avgHands) {
	if (avgHands <= 0) {
		return 0;
	}
	const earlyWeight = Math.min(
		EARLY_STATS_WEIGHT_MAX,
		(avgHands / MIN_HANDS_FOR_WEIGHT) * EARLY_STATS_WEIGHT_MAX,
	);
	if (avgHands < MIN_HANDS_FOR_WEIGHT) {
		return earlyWeight;
	}
	const standardWeight = 1 - Math.exp(-(avgHands - MIN_HANDS_FOR_WEIGHT) / WEIGHT_GROWTH);
	return Math.max(earlyWeight, standardWeight);
}

function aggregateOpponentStats(opponents) {
	if (opponents.length === 0) {
		return {
			opponents,
			count: 0,
			vpip: 0,
			aggression: 1,
			foldRate: 0,
			avgHands: 0,
			weight: 0,
		};
	}
	const avgHands = opponents.reduce((sum, currentPlayer) => sum + currentPlayer.stats.hands, 0) /
		opponents.length;
	return {
		opponents,
		count: opponents.length,
		vpip: opponents.reduce(
			(sum, currentPlayer) =>
				sum + (currentPlayer.stats.vpip + 1) / (currentPlayer.stats.hands + 2),
			0,
		) /
			opponents.length,
		aggression: opponents.reduce(
			(sum, currentPlayer) =>
				sum +
				(currentPlayer.stats.aggressiveActs + 1) / (currentPlayer.stats.calls + 1),
			0,
		) /
			opponents.length,
		foldRate: avgFoldRate(opponents),
		avgHands,
		weight: getStatsWeight(avgHands),
	};
}

function createProfileEntry(source, profile) {
	return { source, profile };
}

function selectProfileEntry(...profileEntries) {
	const reliableEntry = profileEntries.find((entry) =>
		entry.profile.count > 0 && entry.profile.weight > 0
	);
	if (reliableEntry) {
		return reliableEntry;
	}
	return profileEntries.find((entry) => entry.profile.count > 0) ??
		createProfileEntry("none", aggregateOpponentStats([]));
}

function formatProfileForDebug(profile) {
	return `${profile.vpip.toFixed(2)}/${profile.aggression.toFixed(2)}/${
		profile.foldRate.toFixed(2)
	}/${profile.weight.toFixed(2)}`;
}

function getPlayerBySeatIndex(players, seatIndex) {
	return seatIndex === null
		? null
		: players.find((currentPlayer) => currentPlayer.seatIndex === seatIndex) ?? null;
}

function uniquePlayers(players) {
	return Array.from(new Set(players.filter(Boolean)));
}

function buildSpotContext({
	players,
	player,
	currentPhaseIndex,
	preflop,
	facingRaise,
	raisesThisRound,
	handContext,
}) {
	const liveOpponents = players.filter((currentPlayer) =>
		currentPlayer !== player && !currentPlayer.folded
	);
	const actionOrder = getActionOrder(players, currentPhaseIndex);
	const heroIndex = actionOrder.indexOf(player);
	const actionableOrder = actionOrder.filter((currentPlayer) => !currentPlayer.allIn);
	const actingSlotIndex = actionableOrder.indexOf(player);
	const remainingBehind = heroIndex === -1
		? []
		: actionOrder.slice(heroIndex + 1).filter((currentPlayer) =>
			currentPlayer !== player && !currentPlayer.folded && !currentPlayer.allIn
		);
	const voluntaryOpponents = liveOpponents.filter((currentPlayer) => {
		const spotState = currentPlayer.spotState || {};
		return preflop
			? spotState.enteredPreflop
			: spotState.voluntaryThisStreet || spotState.enteredPreflop;
	});
	const primaryAggressorCandidate = getPlayerBySeatIndex(
		players,
		handContext?.streetAggressorSeatIndex,
	);
	const primaryAggressor = primaryAggressorCandidate && !primaryAggressorCandidate.folded &&
			primaryAggressorCandidate !== player
		? primaryAggressorCandidate
		: null;
	const preflopAggressor = getPlayerBySeatIndex(players, handContext?.preflopAggressorSeatIndex);
	const shownStrengthOpponents = uniquePlayers([
		...liveOpponents.filter((currentPlayer) => currentPlayer.spotState?.aggressiveThisStreet),
		!preflop && preflopAggressor && !preflopAggressor.folded && preflopAggressor !== player
			? preflopAggressor
			: null,
	]);
	const raiseCountForSpot = facingRaise
		? (preflop ? handContext?.preflopRaiseCount ?? 0 : raisesThisRound)
		: (preflop ? handContext?.preflopRaiseCount ?? 0 : handContext?.preflopRaiseCount ?? 0);
	const limped = preflop && !facingRaise && (handContext?.preflopRaiseCount ?? 0) === 0 &&
		voluntaryOpponents.length > 0;
	const unopened = !facingRaise && !limped;
	return {
		liveOpponents,
		remainingBehind,
		voluntaryOpponents,
		shownStrengthOpponents,
		primaryAggressor,
		unopened,
		limped,
		singleRaised: raiseCountForSpot === 1,
		multiRaised: raiseCountForSpot > 1,
		headsUp: liveOpponents.length <= 1,
		multiway: liveOpponents.length > 1,
		facingAggression: facingRaise,
		actingSlotIndex: actingSlotIndex === -1 ? 0 : actingSlotIndex,
		actingSlotCount: Math.max(1, actionableOrder.length),
	};
}

function evaluateHandStrength(player, communityCards, preflop) {
	if (preflop) {
		const profile = getPreflopHandProfile(player.holeCards[0], player.holeCards[1]);
		const band = getPreflopHandBand(profile);
		const detail = getPreflopHandDetail(profile, band);
		return {
			strength: getPreflopStrengthScore(profile, band, detail),
			solvedHand: null,
		};
	}

	const cards = [...player.holeCards, ...communityCards];
	const solvedHand = Hand.solve(cards);
	// pokersolver: rank is a category score (1..9, higher is stronger) + small tiebreaker
	return { strength: solvedHand.rank + handTiebreaker(solvedHand), solvedHand };
}

function computePostflopContext(player, communityCards, preflop) {
	const context = {
		topPair: false,
		overPair: false,
		drawChance: false,
		drawOuts: 0,
		drawEquity: 0,
		textureRisk: 0,
	};

	if (preflop || communityCards.length < 3) {
		return context;
	}

	const hole = player.holeCards.slice();
	const ctxInfo = analyzeHandContext(hole, communityCards);
	context.topPair = ctxInfo.isTopPair;
	context.overPair = ctxInfo.isOverPair;

	const draws = analyzeDrawPotential(hole, communityCards);
	context.drawChance = draws.flushDraw || draws.straightDraw;
	context.drawOuts = draws.outs;
	if (context.drawOuts > 0) {
		const drawFactor = communityCards.length === 3
			? 0.04
			: communityCards.length === 4
			? 0.02
			: 0;
		context.drawEquity = Math.min(1, context.drawOuts * drawFactor);
	}

	context.textureRisk = evaluateBoardTexture(communityCards);

	return context;
}

function getMZone(mRatio) {
	if (mRatio < M_RATIO_DEAD_MAX) return "dead";
	if (mRatio <= M_RATIO_RED_MAX) return "red";
	if (mRatio <= M_RATIO_ORANGE_MAX) return "orange";
	if (mRatio <= M_RATIO_YELLOW_MAX) return "yellow";
	return "green";
}

function computeCommitmentMetrics(needToCall, player, spr, remainingStreets) {
	const projectedInvested = player.totalBet + Math.max(0, needToCall);
	const investedRatio = projectedInvested / Math.max(1, projectedInvested + player.chips);
	const callCostRatio = needToCall / Math.max(1, player.chips);
	const sprPressure = Math.max(
		0,
		Math.min(1, (spr - COMMIT_SPR_MIN) / (COMMIT_SPR_MAX - COMMIT_SPR_MIN)),
	);
	const investPressure = Math.max(
		0,
		Math.min(
			1,
			(investedRatio - COMMIT_INVEST_START) / (COMMIT_INVEST_END - COMMIT_INVEST_START),
		),
	);
	const callPressure = Math.max(0, Math.min(1, callCostRatio / COMMIT_CALL_RATIO_REF));
	const streetPressure = Math.min(1, remainingStreets / 2);
	const commitmentPressure = (investPressure * 0.6 + callPressure * 0.4) *
		sprPressure * streetPressure;
	const commitmentPenalty = commitmentPressure * COMMITMENT_PENALTY_MAX;

	return { commitmentPressure, commitmentPenalty };
}

function computeEliminationRisk(stackRatio) {
	const risk = Math.max(
		0,
		Math.min(
			1,
			(stackRatio - ELIMINATION_RISK_START) /
				(ELIMINATION_RISK_FULL - ELIMINATION_RISK_START),
		),
	);
	const eliminationPenalty = risk * ELIMINATION_PENALTY_MAX;

	return { eliminationRisk: risk, eliminationPenalty };
}

function decideHarringtonAction({
	mZone,
	facingRaise,
	needsToCall,
	strengthRatio,
	deadPushThreshold,
	redPushThreshold,
	orangePushThreshold,
	redCallThreshold,
	orangeCallThreshold,
	canShove,
	needToCall,
	playerChips,
}) {
	let decision = null;

	if (mZone === "dead") {
		if (facingRaise && needsToCall) {
			if (strengthRatio >= deadPushThreshold) {
				decision = canShove
					? { action: "raise", amount: playerChips }
					: { action: "call", amount: Math.min(playerChips, needToCall) };
			} else {
				decision = { action: "fold" };
			}
		} else if (canShove && strengthRatio >= deadPushThreshold) {
			decision = { action: "raise", amount: playerChips };
		} else {
			decision = needsToCall ? { action: "fold" } : { action: "check" };
		}
	} else if (mZone === "red") {
		if (facingRaise && needsToCall) {
			if (strengthRatio >= redCallThreshold) {
				decision = { action: "call", amount: Math.min(playerChips, needToCall) };
			} else {
				decision = { action: "fold" };
			}
		} else if (canShove && strengthRatio >= redPushThreshold) {
			decision = { action: "raise", amount: playerChips };
		} else {
			decision = needsToCall ? { action: "fold" } : { action: "check" };
		}
	} else if (mZone === "orange") {
		if (facingRaise && needsToCall) {
			if (strengthRatio >= orangeCallThreshold) {
				decision = { action: "call", amount: Math.min(playerChips, needToCall) };
			} else {
				decision = { action: "fold" };
			}
		} else if (canShove && strengthRatio >= orangePushThreshold) {
			decision = { action: "raise", amount: playerChips };
		} else {
			decision = needsToCall ? { action: "fold" } : { action: "check" };
		}
	}

	return decision;
}

function choosePreflopAction({
	spotType,
	facingRaise,
	activePlayers,
	seatClass,
	mZone,
	potOdds,
	stackRatio,
	canRaise,
	canShove,
	needToCall,
	playerChips,
	bigBlind,
	spr,
	headsUp,
	profile,
	band,
	detail,
	strengthRatio,
	deadPushThreshold,
	redPushThreshold,
	orangePushThreshold,
	redCallThreshold,
	orangeCallThreshold,
	openRaiseSize,
	reraiseSize,
}) {
	const needsToCall = needToCall > 0;
	if (
		(mZone === "dead" || mZone === "red" || mZone === "orange") &&
		!(spotType === "multiRaised" && band !== "premium")
	) {
		const harringtonDecision = decideHarringtonAction({
			mZone,
			facingRaise,
			needsToCall,
			strengthRatio,
			deadPushThreshold,
			redPushThreshold,
			orangePushThreshold,
			redCallThreshold,
			orangeCallThreshold,
			canShove,
			needToCall,
			playerChips,
		});
		if (harringtonDecision) {
			return harringtonDecision;
		}
	}

	if (
		canShove &&
		shouldShoveShortStackPreflop({
			spotType,
			activePlayers,
			seatClass,
			band,
			detail,
			spr,
			playerChips,
			bigBlind,
		})
	) {
		return { action: "raise", amount: playerChips };
	}

	if (spotType === "unopened") {
		if (
			canRaise &&
			shouldOpenRaisePreflop({
				activePlayers,
				seatClass,
				band,
				detail,
				profile,
			})
		) {
			return { action: "raise", amount: openRaiseSize() };
		}
		return needsToCall ? { action: "fold" } : { action: "check" };
	}

	if (spotType === "singleRaised") {
		const lateSeat = isLatePreflopSeat(seatClass, activePlayers);
		const valueThreeBet = isValueThreeBetPreflop(profile, seatClass, activePlayers);
		const lightThreeBet = isLightThreeBetPreflop(profile, seatClass, activePlayers, mZone);
		const flatCall = shouldFlatCallPreflopRaise({
			profile,
			band,
			detail,
			seatClass,
			activePlayers,
			potOdds,
			stackRatio,
		});

		if (canRaise && valueThreeBet) {
			return { action: "raise", amount: reraiseSize() };
		}
		if (
			canRaise &&
			lightThreeBet &&
			rollPreflopMix(profile, seatClass, activePlayers, 0.24)
		) {
			return { action: "raise", amount: reraiseSize() };
		}
		if (band === "premium" && needsToCall) {
			return { action: "call", amount: Math.min(playerChips, needToCall) };
		}
		if (flatCall) {
			return { action: "call", amount: Math.min(playerChips, needToCall) };
		}
		if (
			canRaise &&
			lateSeat &&
			band === "strong" &&
			profile.suited &&
			profile.broadwayCount === 2 &&
			mZone === "green" &&
			headsUp &&
			rollPreflopMix(profile, seatClass, activePlayers, 0.2)
		) {
			return { action: "raise", amount: reraiseSize() };
		}
		return needsToCall ? { action: "fold" } : { action: "check" };
	}

	if (spotType === "limped") {
		if (
			canRaise &&
			shouldIsoRaisePreflop({
				activePlayers,
				seatClass,
				band,
				detail,
			})
		) {
			return { action: "raise", amount: openRaiseSize() };
		}
		return needsToCall ? { action: "fold" } : { action: "check" };
	}

	if (spotType === "multiRaised") {
		if (band === "premium") {
			if (canRaise) {
				return { action: "raise", amount: reraiseSize() };
			}
			if (needsToCall) {
				return { action: "call", amount: Math.min(playerChips, needToCall) };
			}
			return { action: "check" };
		}
		if (
			needsToCall &&
			shouldCallMultiRaisedPreflop({
				band,
				seatClass,
				activePlayers,
				potOdds,
				stackRatio,
			})
		) {
			return { action: "call", amount: Math.min(playerChips, needToCall) };
		}
		return needsToCall ? { action: "fold" } : { action: "check" };
	}

	return needsToCall ? { action: "fold" } : { action: "check" };
}

/* ===========================
   Decision Engine: Bot Action Selection
========================== */
export function chooseBotAction(player, gameState) {
	const {
		currentBet,
		pot,
		smallBlind,
		bigBlind,
		raisesThisRound,
		currentPhaseIndex,
		players,
		lastRaise,
		communityCards,
		handContext,
	} = gameState;
	// Determine amount needed to call the current bet
	const needToCall = currentBet - player.roundBet;
	const needsToCall = needToCall > 0;
	const minRaiseAmount = Math.max(lastRaise, needToCall + lastRaise);

	// Calculate pot odds to assess call viability
	const potOdds = needToCall / (pot + needToCall);
	// Compute risk as fraction of stack required
	const stackRatio = needToCall / player.chips;
	const effectiveCallRatio = Math.min(1, stackRatio);
	// Stack-to-pot ratio used for shove decisions
	const spr = player.chips / Math.max(1, pot + needToCall);
	const blindLevel = { small: smallBlind, big: bigBlind };
	const mRatio = player.chips / (smallBlind + bigBlind);
	const facingRaise = currentPhaseIndex === 0 ? currentBet > blindLevel.big : currentBet > 0;
	// Check if bot is allowed to raise this round
	const canRaise = raisesThisRound < MAX_RAISES_PER_ROUND && player.chips > blindLevel.big;
	const canShove = raisesThisRound < MAX_RAISES_PER_ROUND;

	// Compute positional factor dynamically based on active players
	const active = players.filter((p) => !p.folded);
	const allOpponents = players.filter((p) => p !== player);
	const opponents = players.filter((p) => !p.folded && p !== player);
	const activeOpponents = opponents.length;
	const opponentStacks = opponents.map((p) => p.chips);
	const maxOpponentStack = opponentStacks.length > 0 ? Math.max(...opponentStacks) : 0;
	const effectiveStack = opponentStacks.length > 0
		? Math.min(player.chips, maxOpponentStack)
		: player.chips;
	const amChipleader = opponentStacks.length > 0 ? player.chips > maxOpponentStack : true;
	const shortstackRelative = opponentStacks.length > 0 &&
		effectiveStack === player.chips && player.chips < maxOpponentStack * SHORTSTACK_RELATIVE;
	const botLine = player.botLine || null;
	const nonValueAggressionMade = botLine ? botLine.nonValueAggressionMade : false;

	const positionFactor = computePositionFactor(players, active, player, currentPhaseIndex);

	// Determine if we are in pre-flop stage
	const preflop = communityCards.length === 0;
	const spotContext = buildSpotContext({
		players,
		player,
		currentPhaseIndex,
		preflop,
		facingRaise,
		raisesThisRound,
		handContext,
	});

	// Evaluate hand strength
	const { strength, solvedHand } = evaluateHandStrength(player, communityCards, preflop);
	const preflopHandProfile = preflop
		? getPreflopHandProfile(player.holeCards[0], player.holeCards[1])
		: null;
	const preflopSeatClass = preflop ? getPreflopSeatClass(players, player) : null;
	const preflopBand = preflop ? getPreflopHandBand(preflopHandProfile) : null;
	const preflopDetail = preflop ? getPreflopHandDetail(preflopHandProfile, preflopBand) : null;
	const preflopSpotType = preflop ? getPreflopSpotType(spotContext) : null;
	const postflopStrengthProfile = preflop
		? null
		: buildPostflopStrengthProfile(solvedHand, communityCards);
	const publicHand = postflopStrengthProfile?.publicHand ?? null;
	const publicScore = postflopStrengthProfile?.publicScore ?? 0;
	const rawScore = postflopStrengthProfile?.rawScore ?? strength;
	const liftType = postflopStrengthProfile?.liftType ?? "none";
	const publicDefenseFloor = postflopStrengthProfile?.publicDefenseFloor ?? 0;
	const passiveBonus = postflopStrengthProfile?.passiveBonus ?? 0;

	// Post-flop board context
	const postflopContext = computePostflopContext(player, communityCards, preflop);
	const topPair = postflopContext.topPair;
	const overPair = postflopContext.overPair;
	const drawChance = postflopContext.drawChance;
	const drawOuts = postflopContext.drawOuts;
	const drawEquity = postflopContext.drawEquity;
	const textureRisk = postflopContext.textureRisk;
	const isMadeHand = !preflop && solvedHand && solvedHand.rank >= 2;
	const isDraw = drawOuts >= 8;
	const isWeakDraw = drawOuts > 0 && drawOuts < 8;
	const isDeadHand = !preflop && !isMadeHand && !isDraw && !isWeakDraw;
	const handTier = preflop
		? null
		: getPostflopHandTier({ solvedHand, publicHand, liftType, topPair, overPair });
	const postflopDefenseStructure = preflop ? null : getPostflopDefenseStructure({
		handContext,
		headsUp: spotContext.headsUp,
	});
	const postflopDefenseProfile = preflop ? null : getPostflopDefenseProfile({
		handTier,
		solvedHand,
		liftType,
		defenseStructure: postflopDefenseStructure,
	});
	const privateAggressionRatio = preflop ? strength / 10 : getPostflopAggressionRatio({
		handTier,
		solvedHand,
		liftType,
		isStrongDraw: isDraw,
		isWeakDraw,
		textureRisk,
		activeOpponents,
		headsUp: spotContext.headsUp,
		shownStrengthCount: spotContext.shownStrengthOpponents.length,
		isFlop: communityCards.length === 3,
		isTurn: communityCards.length === 4,
	});
	const passiveStrengthRatio = preflop ? strength / 10 : getPostflopPassiveRatio({
		passiveFloor: postflopDefenseProfile?.passiveFloor ?? 0,
		basePassiveStrengthRatio: postflopStrengthProfile?.passiveStrengthRatio ?? 0,
		aggressionStrengthRatio: privateAggressionRatio,
		isStrongDraw: isDraw,
		isWeakDraw,
	});
	const hasPrivateValue = !preflop &&
		(handTier === "top-pair" || handTier === "overpair" || handTier === "two-pair-plus" ||
			liftType === "structural" || liftType === "category");

	const aggressionStrengthRatio = privateAggressionRatio;
	const mZone = getMZone(mRatio);
	const isGreenZone = mZone === "green";
	const isFlop = communityCards.length === 3;
	const isTurn = communityCards.length === 4;
	const isRiver = communityCards.length === 5;
	const textureBucket = getTextureBucket(textureRisk);
	const hasStrongComboDraw = drawOuts >= 12;
	const isTopPairPlus = handTier === "top-pair" || handTier === "overpair" ||
		handTier === "two-pair-plus";
	const valueProtectionHand = isTopPairPlus;
	const flopCheckedThrough = handContext?.flopCheckedThrough === true;
	const turnCheckedThrough = handContext?.turnCheckedThrough === true;
	const doubleCheckedThrough = flopCheckedThrough && turnCheckedThrough;
	const actingLastPostflop = spotContext.actingSlotIndex === spotContext.actingSlotCount - 1;
	const turnScareCard = isScareTurnCard(communityCards, textureRisk);
	const allowPublicDrawSemibluffRaise = !preflop &&
		(liftType === "none" || liftType === "kicker") &&
		(
			(
				publicHand?.rank === 1 &&
				isFlop &&
				activeOpponents <= 1 &&
				!facingRaise &&
				hasStrongComboDraw &&
				isGreenZone
			) ||
			(
				publicHand?.rank === 1 &&
				isTurn &&
				activeOpponents <= 1 &&
				!facingRaise &&
				hasStrongComboDraw &&
				spr <= 1.2 &&
				canShove
			)
		);
	const premiumHand = preflop
		? preflopBand === "premium"
		: aggressionStrengthRatio >= PREMIUM_POSTFLOP_RATIO;
	const raiseAggAdj = amChipleader ? -CHIP_LEADER_RAISE_DELTA : 0;
	const callTightAdj = shortstackRelative && stackRatio < ELIMINATION_RISK_START
		? -SHORTSTACK_CALL_DELTA
		: 0;
	const deadPushThreshold = Math.max(0, DEAD_PUSH_RATIO + raiseAggAdj);
	const redPushThreshold = Math.max(0, RED_PUSH_RATIO + raiseAggAdj);
	const orangePushThreshold = Math.max(0, ORANGE_PUSH_RATIO + raiseAggAdj);
	const redCallThreshold = Math.min(1, RED_CALL_RATIO + callTightAdj);
	const orangeCallThreshold = Math.min(1, ORANGE_CALL_RATIO + callTightAdj);
	const remainingStreets = preflop
		? 3
		: communityCards.length === 3
		? 2
		: communityCards.length === 4
		? 1
		: 0;
	const { commitmentPressure, commitmentPenalty } = computeCommitmentMetrics(
		needToCall,
		player,
		spr,
		remainingStreets,
	);
	const { eliminationRisk, eliminationPenalty } = needsToCall
		? computeEliminationRisk(stackRatio)
		: { eliminationRisk: 0, eliminationPenalty: 0 };
	const effectiveEliminationPenalty = preflop
		? eliminationPenalty
		: eliminationPenalty * (postflopDefenseProfile?.eliminationScale ?? 1);
	const riskAdjustedRedCallThreshold = Math.min(1, redCallThreshold + eliminationPenalty);
	const riskAdjustedOrangeCallThreshold = Math.min(1, orangeCallThreshold + eliminationPenalty);

	const callBarrierBase = preflop
		? Math.min(1, Math.max(0, potOdds + callTightAdj))
		: Math.min(1, Math.max(0, POSTFLOP_CALL_BARRIER + callTightAdj));
	let callBarrier = preflop ? Math.min(1, callBarrierBase + commitmentPenalty) : callBarrierBase;
	if (!preflop) {
		let callBarrierAdj = 0;
		if (hasPrivateValue) {
			if (overPair) {
				callBarrierAdj -= 0.03;
			} else if (topPair) {
				callBarrierAdj -= 0.02;
			}
		}
		if (drawOuts >= 8) {
			if (communityCards.length === 3) {
				callBarrierAdj -= 0.02;
			} else if (communityCards.length === 4) {
				callBarrierAdj -= 0.01;
			}
		}
		if (activeOpponents <= 1) {
			callBarrierAdj -= 0.02;
		}
		if (textureRisk > 0.6) {
			callBarrierAdj += 0.02;
		}
		if (spr < 3) {
			callBarrierAdj -= 0.01;
		} else if (spr > 6) {
			callBarrierAdj += 0.01;
		}
		callBarrierAdj = Math.max(-0.04, Math.min(0.04, callBarrierAdj));

		const streetIndex = communityCards.length === 3
			? 1
			: communityCards.length === 4
			? 2
			: communityCards.length === 5
			? 3
			: 0;
		const raiseLevelForCalls = facingRaise && raisesThisRound > 0 ? raisesThisRound : 0;
		const streetPressure = needsToCall ? streetIndex * 0.01 : 0;
		const weakDrawPressure = needsToCall && isWeakDraw && !isMadeHand ? streetIndex * 0.01 : 0;
		const deadHandPressure = needsToCall && isDeadHand ? streetIndex * 0.02 : 0;
		const barrelPressure = needsToCall ? raiseLevelForCalls * 0.02 : 0;

		const potOddsAdj = needsToCall
			? Math.max(-0.12, Math.min(0.08, (0.25 - potOdds) * 0.6))
			: 0;
		let potOddsShift = -potOddsAdj;
		if (needsToCall && isDeadHand) {
			potOddsShift *= 0.35;
		} else if (needsToCall && isWeakDraw && !isMadeHand) {
			potOddsShift *= 0.5;
		}
		const commitmentShift = needsToCall ? commitmentPenalty * 0.8 : 0;

		callBarrier = callBarrierBase + callBarrierAdj + potOddsShift + commitmentShift;
		callBarrier += streetPressure + weakDrawPressure + deadHandPressure + barrelPressure;
		if (needsToCall && isDeadHand) {
			const deadHandFloor = streetIndex === 1 ? 0.2 : streetIndex === 2 ? 0.22 : 0.24;
			callBarrier = Math.max(callBarrier, deadHandFloor);
		}
		if (needsToCall && isWeakDraw && !isMadeHand) {
			if (streetIndex >= 2) {
				callBarrier = 1;
			} else if (streetIndex === 1 && (potOdds > 0.18 || raiseLevelForCalls > 0)) {
				callBarrier = 1;
			}
		}
		callBarrier = Math.min(1, Math.max(0.10, callBarrier));
		callBarrier = Math.min(
			1,
			Math.max(0.10, callBarrier + (postflopDefenseProfile?.barrierRelief ?? 0)),
		);
	}
	let eliminationBarrier = needsToCall
		? Math.min(1, callBarrier + effectiveEliminationPenalty)
		: callBarrier;
	const postflopCallStackRatioCap = preflop ? 0.7 : postflopDefenseProfile?.stackRatioCap ?? 0.70;

	// Base thresholds for raising depend on stage and pot size
	// When only a few opponents remain, play slightly more aggressively
	const oppAggAdj = activeOpponents < OPPONENT_THRESHOLD
		? (OPPONENT_THRESHOLD - activeOpponents) * AGG_FACTOR
		: 0;
	const thresholdAdj = activeOpponents < OPPONENT_THRESHOLD
		? (OPPONENT_THRESHOLD - activeOpponents) * THRESHOLD_FACTOR
		: 0;
	const baseAggressiveness = preflop ? 0.8 + 0.4 * positionFactor : 1 + 0.6 * positionFactor;
	let aggressiveness = preflop ? baseAggressiveness + oppAggAdj : baseAggressiveness;
	let raiseThreshold = preflop ? 8 - 2 * positionFactor : 2.6 - 0.8 * positionFactor;
	raiseThreshold = Math.max(1, raiseThreshold - (preflop ? thresholdAdj : 0));
	if (amChipleader) {
		raiseThreshold = Math.max(1, raiseThreshold - CHIP_LEADER_RAISE_DELTA * 10);
	}
	const decisionStrength = aggressionStrengthRatio * 10;

	let bluffChance = 0;
	let foldRate = 0;
	let statsWeight = 0;

	function capGreenNonPremium(amount) {
		if (!isGreenZone || premiumHand) return amount;
		const capRatio = spr < 3 ? 0.3 : spr > 6 ? 0.2 : GREEN_MAX_STACK_BET;
		const rawCap = Math.floor(player.chips * capRatio);
		const cap = floorTo10(rawCap);
		const capped = Math.min(amount, cap);
		return Math.max(0, floorTo10(capped));
	}

	function valueBetSize() {
		let base;
		if (preflop) {
			base = 0.55;
			if (aggressionStrengthRatio >= 0.9) base += 0.15;
			base += activeOpponents * 0.04;
			base += (1 - positionFactor) * 0.05;
			if (positionFactor < 0.3 && aggressionStrengthRatio >= 0.8) {
				base += 0.1; // bigger open from early position
			}
		} else {
			base = textureRisk > 0.6 ? 0.7 : textureRisk > 0.3 ? 0.6 : 0.45;
			if (aggressionStrengthRatio > 0.95) base += 0.1; // polarise with very strong hands
			base += activeOpponents * 0.03;
			base += (1 - positionFactor) * 0.05;
		}
		if (spr < 2) base += 0.1;
		else if (spr < 4) base += 0.05;
		else if (spr > 6) base -= 0.05;
		const rand = Math.random() * 0.2 - 0.1;
		const factor = Math.min(1, Math.max(0.35, base + rand));
		const sized = floorTo10(Math.min(player.chips, (pot + needToCall) * factor * betAggFactor));
		return capGreenNonPremium(sized);
	}

	function bluffBetSize() {
		let base = 0.25 + textureRisk * 0.05;
		base += activeOpponents * 0.02;
		base += (1 - positionFactor) * 0.03;
		if (spr < 3) base += 0.05;
		else if (spr > 5) base -= 0.05;
		const rand = Math.random() * 0.08 - 0.04;
		const factor = Math.min(0.45, Math.max(0.2, base + rand));
		const sized = floorTo10(Math.min(player.chips, (pot + needToCall) * factor * betAggFactor));
		return capGreenNonPremium(sized);
	}

	function protectionBetSize() {
		let base = 0.45 + textureRisk * 0.25;
		base += activeOpponents * 0.03;
		base += (1 - positionFactor) * 0.04;
		if (spr < 3) base += 0.1;
		else if (spr > 5) base -= 0.05;
		const rand = Math.random() * 0.1 - 0.05;
		const factor = Math.min(0.8, Math.max(0.35, base + rand));
		const sized = floorTo10(Math.min(player.chips, (pot + needToCall) * factor * betAggFactor));
		return capGreenNonPremium(sized);
	}

	function overBetSize() {
		let base = 1.2 - textureRisk * 0.1;
		base += activeOpponents * 0.05;
		if (spr < 2) base += 0.3;
		const rand = Math.random() * 0.15 - 0.05;
		const factor = Math.max(1.1, Math.min(1.5, base + rand));
		const sized = floorTo10(Math.min(player.chips, (pot + needToCall) * factor * betAggFactor));
		return capGreenNonPremium(sized);
	}

	function tournamentOpenRaiseSize() {
		const sized = floorTo10(bigBlind * 2.5);
		const normalizedMinRaise = ceilTo10(minRaiseAmount);
		return Math.min(player.chips, Math.max(normalizedMinRaise, sized));
	}

	function tournamentReraiseSize() {
		let multiplier = spotContext.headsUp ? 3 : 3.2;
		if (preflopSeatClass === "smallBlind" || preflopSeatClass === "bigBlind") {
			multiplier += 0.3;
		}
		const sized = ceilTo10(currentBet * multiplier);
		const normalizedMinRaise = ceilTo10(minRaiseAmount);
		return Math.min(player.chips, Math.max(normalizedMinRaise, sized));
	}

	function decideCbetIntent(lineAbort) {
		if (lineAbort) return false;
		let chance = spotContext.headsUp
			? textureBucket === "dry" ? 0.65 : textureBucket === "neutral" ? 0.55 : 0.40
			: textureBucket === "dry"
			? 0.30
			: textureBucket === "neutral"
			? 0.22
			: 0.12;
		if (isTopPairPlus) {
			chance += 0.20;
		} else if (handTier === "weak-showdown") {
			chance -= 0.10;
		}
		if (isDraw) {
			chance += 0.12;
		}
		chance += (positionFactor - 0.5) * 0.08;
		if (statsWeight > 0) {
			chance += Math.max(-0.05, Math.min(0.05, (foldRate - 0.45) * 0.25));
		}
		chance = Math.max(0.05, Math.min(0.90, chance));
		return Math.random() < chance;
	}

	function decideBarrelIntent(lineAbort) {
		if (lineAbort) return false;
		let chance = spotContext.headsUp
			? textureBucket === "wet" ? 0.25 : 0.35
			: textureBucket === "dry"
			? 0.18
			: textureBucket === "neutral"
			? 0.12
			: 0.08;
		if (isTopPairPlus) {
			chance += 0.25;
		} else if (handTier === "weak-showdown") {
			chance -= 0.08;
		}
		if (isDraw) {
			chance += 0.15;
		}
		if (handTier === "air" && !turnScareCard) {
			chance = Math.min(chance, 0.08);
		}
		chance += (positionFactor - 0.5) * 0.06;
		if (statsWeight > 0) {
			chance += Math.max(-0.04, Math.min(0.04, (foldRate - 0.45) * 0.2));
		}
		chance = Math.max(0.05, Math.min(0.85, chance));
		return Math.random() < chance;
	}

	function getDelayedRiverProbeChance() {
		if (!isRiver || !doubleCheckedThrough || !spotContext.headsUp) {
			return 0;
		}

		let chance;
		if (isTopPairPlus || liftType === "structural" || liftType === "category") {
			chance = actingLastPostflop ? 0.72 : 0.58;
		} else if (handTier === "weak-showdown") {
			chance = actingLastPostflop ? 0.36 : 0.24;
		} else if (isDraw || isWeakDraw) {
			chance = actingLastPostflop ? 0.24 : 0.12;
		} else {
			chance = actingLastPostflop ? 0.16 : 0.08;
			if (botLine && botLine.preflopAggressor) {
				chance += 0.06;
			}
		}

		if (statsWeight > 0) {
			chance += Math.max(-0.05, Math.min(0.08, (foldRate - 0.45) * 0.35));
		}
		if (textureRisk < 0.25) {
			chance += 0.04;
		} else if (textureRisk > 0.55) {
			chance -= 0.04;
		}
		chance += (positionFactor - 0.5) * 0.06;

		return Math.max(0, Math.min(0.85, chance));
	}

	function classifyWeakNoBetStabSpot() {
		const actingLast = actingLastPostflop &&
			(spotContext.actingSlotCount === 2 || spotContext.actingSlotCount === 3);
		if (
			preflop || currentBet !== 0 || !canRaise || facingRaise ||
			(botLine && botLine.preflopAggressor) || !actingLast ||
			topPair || overPair || isDraw || (publicHand?.rank ?? 0) >= 3
		) {
			return null;
		}

		if (solvedHand?.rank === 1) {
			return isWeakDraw ? "weak-draw" : "air";
		}

		if (solvedHand?.rank === 2 && (publicHand?.rank ?? 0) <= 2) {
			return "weak-pair";
		}

		return null;
	}

	function getWeakNoBetStabChanceFloor(weakNoBetClass) {
		if (spotContext.headsUp) {
			if (weakNoBetClass === "air") {
				return 0.34;
			}
			if (weakNoBetClass === "weak-draw") {
				return 0.30;
			}
			if (weakNoBetClass === "weak-pair") {
				return 0.22;
			}
			return 0;
		}

		if (weakNoBetClass === "air") {
			return 0.18;
		}
		if (weakNoBetClass === "weak-draw") {
			return 0.16;
		}
		if (weakNoBetClass === "weak-pair") {
			return 0.10;
		}
		return 0;
	}

	function classifyWeakHeadsUpFirstProbeSpot() {
		if (
			preflop || currentBet !== 0 || !canRaise || facingRaise || !spotContext.headsUp ||
			spotContext.actingSlotCount !== 2 || spotContext.actingSlotIndex !== 0 ||
			(botLine && botLine.preflopAggressor) || topPair || overPair || isDraw ||
			(publicHand?.rank ?? 0) >= 3
		) {
			return null;
		}
		if (isTurn && !flopCheckedThrough) {
			return null;
		}
		if (isRiver && !turnCheckedThrough) {
			return null;
		}
		if (!isFlop && !isTurn && !isRiver) {
			return null;
		}
		if (solvedHand?.rank === 1) {
			return isWeakDraw ? "weak-draw" : "air";
		}
		if (solvedHand?.rank === 2 && (publicHand?.rank ?? 0) <= 2) {
			return "weak-pair";
		}
		return null;
	}

	function getWeakHeadsUpFirstProbeChance(weakProbeClass) {
		if (isFlop) {
			if (weakProbeClass === "air") {
				return 0.24;
			}
			if (weakProbeClass === "weak-draw") {
				return 0.20;
			}
			if (weakProbeClass === "weak-pair") {
				return 0.16;
			}
			return 0;
		}
		if (isTurn) {
			if (weakProbeClass === "air") {
				return 0.30;
			}
			if (weakProbeClass === "weak-draw") {
				return 0.28;
			}
			if (weakProbeClass === "weak-pair") {
				return 0.22;
			}
			return 0;
		}
		if (isRiver) {
			if (weakProbeClass === "air") {
				return 0.34;
			}
			if (weakProbeClass === "weak-draw") {
				return 0.32;
			}
			if (weakProbeClass === "weak-pair") {
				return 0.26;
			}
		}
		return 0;
	}

	const tableProfile = aggregateOpponentStats(allOpponents);
	const liveProfile = aggregateOpponentStats(spotContext.liveOpponents);
	const behindProfile = aggregateOpponentStats(spotContext.remainingBehind);
	const voluntaryProfile = aggregateOpponentStats(spotContext.voluntaryOpponents);
	const shownStrengthProfile = aggregateOpponentStats(spotContext.shownStrengthOpponents);
	const aggressorProfile = spotContext.primaryAggressor
		? aggregateOpponentStats([spotContext.primaryAggressor])
		: aggregateOpponentStats([]);
	const tableProfileEntry = createProfileEntry("table", tableProfile);
	const liveProfileEntry = createProfileEntry("live", liveProfile);
	const behindProfileEntry = createProfileEntry("behind", behindProfile);
	const voluntaryProfileEntry = createProfileEntry("voluntary", voluntaryProfile);
	const shownStrengthProfileEntry = createProfileEntry("shown", shownStrengthProfile);
	const aggressorProfileEntry = createProfileEntry("aggr", aggressorProfile);
	const pressureProfileEntry = facingRaise
		? selectProfileEntry(
			aggressorProfileEntry,
			shownStrengthProfileEntry,
			liveProfileEntry,
			tableProfileEntry,
		)
		: preflop && spotContext.unopened
		? selectProfileEntry(behindProfileEntry, liveProfileEntry, tableProfileEntry)
		: preflop && spotContext.limped
		? selectProfileEntry(
			voluntaryProfileEntry,
			behindProfileEntry,
			liveProfileEntry,
			tableProfileEntry,
		)
		: selectProfileEntry(liveProfileEntry, behindProfileEntry, tableProfileEntry);
	const foldProfileEntry = preflop
		? spotContext.limped
			? selectProfileEntry(
				voluntaryProfileEntry,
				behindProfileEntry,
				liveProfileEntry,
				tableProfileEntry,
			)
			: selectProfileEntry(behindProfileEntry, liveProfileEntry, tableProfileEntry)
		: selectProfileEntry(liveProfileEntry, behindProfileEntry, tableProfileEntry);
	const pressureProfile = pressureProfileEntry.profile;
	const foldProfile = foldProfileEntry.profile;

	foldRate = foldProfile.foldRate;
	statsWeight = foldProfile.weight;
	bluffChance = Math.min(0.3, foldRate) * statsWeight;
	bluffChance *= 1 - textureRisk * 0.5;

	if (pressureProfile.count > 0) {
		const weight = pressureProfile.weight;
		if (facingRaise) {
			if (pressureProfile.vpip < 0.25) {
				raiseThreshold += 0.75 * weight;
				aggressiveness -= 0.08 * weight;
			} else if (pressureProfile.vpip > 0.5) {
				raiseThreshold -= 0.35 * weight;
				aggressiveness += 0.04 * weight;
			}

			if (pressureProfile.aggression > 1.5) {
				raiseThreshold -= 0.2 * weight;
			} else if (pressureProfile.aggression < 0.7) {
				raiseThreshold += 0.25 * weight;
				aggressiveness -= 0.06 * weight;
			}

			let callBarrierAdj = 0;
			if (pressureProfile.vpip < 0.25) {
				callBarrierAdj += 0.03 * weight;
			} else if (pressureProfile.vpip > 0.5) {
				callBarrierAdj -= 0.02 * weight;
			}
			if (pressureProfile.aggression > 1.5) {
				callBarrierAdj -= 0.02 * weight;
			} else if (pressureProfile.aggression < 0.7) {
				callBarrierAdj += 0.02 * weight;
			}
			if (!preflop && callBarrierAdj > 0) {
				callBarrierAdj *= postflopDefenseProfile?.tighteningScale ?? 1;
			}
			callBarrier = Math.min(1, Math.max(preflop ? 0 : 0.10, callBarrier + callBarrierAdj));
			eliminationBarrier = needsToCall
				? Math.min(1, callBarrier + effectiveEliminationPenalty)
				: callBarrier;
		} else {
			if (pressureProfile.vpip < 0.25) {
				raiseThreshold -= 0.45 * weight;
				aggressiveness += 0.12 * weight;
			} else if (pressureProfile.vpip > 0.5) {
				raiseThreshold += 0.4 * weight;
				aggressiveness -= 0.1 * weight;
			}

			if (pressureProfile.aggression > 1.5) {
				aggressiveness -= 0.08 * weight;
			} else if (pressureProfile.aggression < 0.7) {
				aggressiveness += 0.08 * weight;
			}
		}
	}

	if (spotContext.limped) {
		const limpWeight = Math.max(voluntaryProfile.weight, behindProfile.weight);
		if (voluntaryProfile.count > 0 && voluntaryProfile.vpip > 0.45) {
			raiseThreshold += 0.2 * limpWeight;
		}
		bluffChance *= 0.75;
	}

	if (!preflop && !facingRaise && spotContext.singleRaised && spotContext.headsUp) {
		foldRate = Math.min(1, foldRate + 0.05 * foldProfile.weight);
		aggressiveness += 0.05;
		bluffChance *= 1.1;
	}

	if (spotContext.multiway) {
		const extraOpponents = Math.max(0, activeOpponents - 1);
		if (valueProtectionHand) {
			raiseThreshold += Math.min(0.35, extraOpponents * 0.08);
		} else {
			raiseThreshold += Math.min(0.9, extraOpponents * 0.22);
			aggressiveness -= Math.min(0.18, extraOpponents * 0.05);
		}
		foldRate *= Math.max(0.35, 1 - extraOpponents * 0.2);
		bluffChance *= Math.max(0.2, 1 - extraOpponents * 0.25);
	}

	if (spotContext.shownStrengthOpponents.length > 1) {
		if (valueProtectionHand) {
			raiseThreshold += 0.10;
		} else {
			raiseThreshold += 0.35;
			aggressiveness -= 0.08;
		}
		bluffChance *= 0.3;
	}

	if (spotContext.multiRaised) {
		raiseThreshold += facingRaise ? 0.8 : valueProtectionHand ? 0.1 : 0.3;
		if (!valueProtectionHand) {
			aggressiveness -= 0.12;
		}
		bluffChance = 0;
	}

	const bluffAggFactor = Math.max(0.8, Math.min(1.2, aggressiveness));
	bluffChance = Math.min(0.3, bluffChance * bluffAggFactor);

	raiseThreshold = Math.max(1, raiseThreshold - (aggressiveness - 1) * 0.8);
	if (!preflop) {
		let raiseAdj = 0;
		if (hasPrivateValue) {
			if (overPair) {
				raiseAdj -= 0.35;
			} else if (topPair) {
				raiseAdj -= 0.2;
			}
		}
		if (drawOuts >= 8) {
			if (communityCards.length === 3) {
				raiseAdj -= 0.15;
			} else if (communityCards.length === 4) {
				raiseAdj -= 0.08;
			}
		}
		if (activeOpponents <= 1) {
			raiseAdj -= 0.15;
		}
		if (textureRisk > 0.6) {
			raiseAdj += 0.15;
		}
		if (spr < 3) {
			raiseAdj -= 0.1;
		} else if (spr > 6) {
			raiseAdj += 0.1;
		}
		raiseAdj = Math.max(-0.5, Math.min(0.5, raiseAdj));
		raiseThreshold += raiseAdj;
		raiseThreshold = Math.max(1.4, raiseThreshold);
	}
	const raiseLevel = (facingRaise && raisesThisRound > 0) ? Math.max(0, raisesThisRound) : 0;
	raiseThreshold += raiseLevel * RERAISE_RATIO_STEP * 10;
	const betAggFactor = Math.max(0.9, Math.min(1.1, aggressiveness));
	const nonValueAggressionBlocked = spotContext.multiRaised;

	// Keep a simple betting-line memory for the preflop aggressor.
	let lineAbort = false;
	if (!preflop && botLine && botLine.preflopAggressor) {
		lineAbort = textureRisk > 0.7 && aggressionStrengthRatio < 0.45 && drawEquity === 0;
		if (currentPhaseIndex === 1 && botLine.cbetIntent === null) {
			botLine.cbetIntent = decideCbetIntent(lineAbort);
		}
		if (currentPhaseIndex === 2 && botLine.cbetMade && botLine.barrelIntent === null) {
			botLine.barrelIntent = decideBarrelIntent(lineAbort);
		}
	}

	/* -------------------------
       Decision logic with tie-breakers
    ------------------------- */
	/* Tie-breaker explanation:
       - When the difference between hand strength and the raise threshold is within STRENGTH_TIE_DELTA,
         the bot randomly chooses between the two close options to introduce unpredictability.
       - Similarly, when the difference between passiveStrengthRatio and callBarrier is within
         ODDS_TIE_DELTA,
         the bot randomly resolves between call and fold to break ties.
     */
	let decision = preflop
		? choosePreflopAction({
			spotType: preflopSpotType,
			facingRaise,
			activePlayers: active.length,
			seatClass: preflopSeatClass,
			mZone,
			potOdds,
			stackRatio,
			canRaise,
			canShove,
			needToCall,
			playerChips: player.chips,
			bigBlind: blindLevel.big,
			spr,
			headsUp: spotContext.headsUp,
			profile: preflopHandProfile,
			band: preflopBand,
			detail: preflopDetail,
			strengthRatio: aggressionStrengthRatio,
			deadPushThreshold,
			redPushThreshold,
			orangePushThreshold,
			redCallThreshold: riskAdjustedRedCallThreshold,
			orangeCallThreshold: riskAdjustedOrangeCallThreshold,
			openRaiseSize: tournamentOpenRaiseSize,
			reraiseSize: tournamentReraiseSize,
		})
		: null;

	if (!decision && !preflop) {
		if (needToCall <= 0) {
			if (canRaise && decisionStrength >= raiseThreshold) {
				let raiseAmt = valueBetSize();
				raiseAmt = Math.max(minRaiseAmount, raiseAmt);
				if (Math.abs(decisionStrength - raiseThreshold) <= STRENGTH_TIE_DELTA) {
					decision = Math.random() < 0.5
						? { action: "check" }
						: { action: "raise", amount: raiseAmt };
				} else {
					decision = { action: "raise", amount: raiseAmt };
				}
			} else {
				decision = { action: "check" };
			}
		} else if (canRaise && decisionStrength >= raiseThreshold && stackRatio <= 1 / 3) {
			let raiseAmt = protectionBetSize();
			raiseAmt = Math.max(minRaiseAmount, raiseAmt);
			if (Math.abs(decisionStrength - raiseThreshold) <= STRENGTH_TIE_DELTA) {
				const callAmt = Math.min(player.chips, needToCall);
				const alt = (passiveStrengthRatio >= eliminationBarrier &&
						effectiveCallRatio <= postflopCallStackRatioCap)
					? { action: "call", amount: callAmt }
					: { action: "fold" };
				decision = Math.random() < 0.5 ? { action: "raise", amount: raiseAmt } : alt;
			} else {
				decision = { action: "raise", amount: raiseAmt };
			}
		} else if (
			passiveStrengthRatio >= eliminationBarrier &&
			effectiveCallRatio <= postflopCallStackRatioCap
		) {
			const callAmt = Math.min(player.chips, needToCall);
			if (Math.abs(passiveStrengthRatio - eliminationBarrier) <= ODDS_TIE_DELTA) {
				decision = Math.random() < 0.5
					? { action: "call", amount: callAmt }
					: { action: "fold" };
			} else {
				decision = { action: "call", amount: callAmt };
			}
		} else {
			decision = { action: "fold" };
		}
	}
	if (!decision) {
		decision = needToCall > 0 ? { action: "fold" } : { action: "check" };
	}

	let isBluff = false;
	let isStab = false;
	if (!preflop) {
		const facingAllIn = allOpponents.some((p) => p.allIn);
		if (decision.action === "fold" && facingAllIn) {
			const riskAdjustedThreshold = Math.min(1, ALLIN_HAND_POSTFLOP + eliminationPenalty);
			if (passiveStrengthRatio >= riskAdjustedThreshold) {
				decision = { action: "call", amount: Math.min(player.chips, needToCall) };
			}
		}

		if (
			!preflop && bluffChance > 0 && canRaise && !facingRaise &&
			aggressionStrengthRatio >= MIN_PREFLOP_BLUFF_RATIO &&
			(decision.action === "check" || decision.action === "fold") && !facingAllIn &&
			!nonValueAggressionMade && !nonValueAggressionBlocked
		) {
			if (Math.random() < bluffChance) {
				const bluffAmt = Math.max(ceilTo10(minRaiseAmount), bluffBetSize());
				decision = { action: "raise", amount: bluffAmt };
				isBluff = true;
			}
		}

		if (
			!preflop && currentBet === 0 && decision.action === "check" && canRaise &&
			!facingRaise &&
			botLine && botLine.preflopAggressor && !lineAbort && aggressionStrengthRatio < 0.9
		) {
			if (currentPhaseIndex === 1 && botLine.cbetIntent) {
				const wantsBluff = !isMadeHand && aggressionStrengthRatio < 0.6 && drawEquity === 0;
				if (!wantsBluff || (!nonValueAggressionMade && !nonValueAggressionBlocked)) {
					const bet = aggressionStrengthRatio >= 0.6 || drawEquity > 0
						? protectionBetSize()
						: bluffBetSize();
					decision = {
						action: "raise",
						amount: Math.min(player.chips, Math.max(ceilTo10(lastRaise), bet)),
					};
					if (wantsBluff) {
						isBluff = true;
					}
				}
			} else if (currentPhaseIndex === 2 && botLine.barrelIntent) {
				const wantsBluff = !isMadeHand && aggressionStrengthRatio < 0.6 && drawEquity === 0;
				if (!wantsBluff || (!nonValueAggressionMade && !nonValueAggressionBlocked)) {
					const bet = aggressionStrengthRatio >= 0.65 || drawEquity > 0
						? protectionBetSize()
						: bluffBetSize();
					decision = {
						action: "raise",
						amount: Math.min(player.chips, Math.max(ceilTo10(lastRaise), bet)),
					};
					if (wantsBluff) {
						isBluff = true;
					}
				}
			}
		}

		if (
			!preflop && decision.action === "raise" && aggressionStrengthRatio >= 0.95 &&
			spr <= 2 &&
			Math.random() < 0.3
		) {
			decision.amount = Math.max(decision.amount, overBetSize());
		}

		if (
			!preflop && !needsToCall && aggressionStrengthRatio >= 0.9 &&
			decision.action === "raise" &&
			Math.random() < 0.3
		) {
			decision = { action: "check" };
		}

		if (
			!preflop && currentBet === 0 && decision.action === "check" && canRaise &&
			!facingRaise &&
			textureRisk < 0.4 && (foldRate > 0.25 || drawEquity > 0) &&
			!nonValueAggressionMade && !nonValueAggressionBlocked
		) {
			const baseStabChance = Math.max(0.05, Math.min(0.35, 0.05 + positionFactor * 0.3));
			const weakNoBetStabClass = classifyWeakNoBetStabSpot();
			const stabChance = weakNoBetStabClass
				? Math.max(baseStabChance, getWeakNoBetStabChanceFloor(weakNoBetStabClass))
				: baseStabChance;
			if (Math.random() < stabChance) {
				const betAmt = protectionBetSize();
				decision = { action: "raise", amount: Math.max(ceilTo10(lastRaise), betAmt) };
				isStab = true;
			}
		}

		const weakHeadsUpFirstProbeClass = classifyWeakHeadsUpFirstProbeSpot();
		if (
			weakHeadsUpFirstProbeClass &&
			decision.action === "check" &&
			!nonValueAggressionMade &&
			!nonValueAggressionBlocked
		) {
			if (Math.random() < getWeakHeadsUpFirstProbeChance(weakHeadsUpFirstProbeClass)) {
				const betAmt = weakHeadsUpFirstProbeClass === "weak-pair"
					? protectionBetSize()
					: bluffBetSize();
				decision = {
					action: "raise",
					amount: Math.max(ceilTo10(lastRaise), betAmt),
				};
				isStab = true;
			}
		}

		if (
			!preflop && isRiver && currentBet === 0 && decision.action === "check" && canRaise &&
			!facingRaise && spotContext.headsUp && doubleCheckedThrough &&
			!weakHeadsUpFirstProbeClass
		) {
			const wantsThinValue = isTopPairPlus || handTier === "weak-showdown" ||
				liftType === "structural" || liftType === "category";
			const canProbeRiver = wantsThinValue ||
				(!nonValueAggressionMade && !nonValueAggressionBlocked);
			if (canProbeRiver && Math.random() < getDelayedRiverProbeChance()) {
				const betAmt = wantsThinValue
					? (isTopPairPlus || liftType === "structural" || liftType === "category"
						? valueBetSize()
						: protectionBetSize())
					: bluffBetSize();
				decision = {
					action: "raise",
					amount: Math.max(ceilTo10(lastRaise), betAmt),
				};
				if (!wantsThinValue && !isMadeHand) {
					isBluff = true;
				}
			}
		}
	}

	const reraiseValueRatio = hasPrivateValue && (topPair || overPair)
		? RERAISE_TOP_PAIR_RATIO
		: RERAISE_VALUE_RATIO;
	if (
		decision.action === "raise" && raiseLevel > 0 && aggressionStrengthRatio < reraiseValueRatio
	) {
		decision = needToCall > 0
			? { action: "call", amount: Math.min(player.chips, needToCall) }
			: { action: "check" };
		isBluff = false;
		isStab = false;
	}

	const thinPublicValueRaiseBlocked = !preflop && decision.action === "raise" &&
		(liftType === "none" || liftType === "kicker") &&
		publicHand?.rank >= 2 &&
		!allowPublicDrawSemibluffRaise;
	if (thinPublicValueRaiseBlocked) {
		decision = needToCall > 0
			? { action: "call", amount: Math.min(player.chips, needToCall) }
			: { action: "check" };
		isBluff = false;
		isStab = false;
	}
	if (
		!preflop && isTurn && decision.action === "raise" && allowPublicDrawSemibluffRaise &&
		(liftType === "none" || liftType === "kicker")
	) {
		decision.amount = player.chips;
	}

	const h1 = formatCard(player.holeCards[0]);
	const h2 = formatCard(player.holeCards[1]);
	const handName = !preflop ? solvedHand.name : "preflop";

	// --- Ensure raises meet the minimum requirements ---
	if (decision.action === "raise") {
		const minRaise = needToCall + lastRaise; // minimum legal raise
		if (decision.amount < player.chips) {
			decision.amount = Math.min(player.chips, floorTo10(decision.amount));
		}
		if (decision.amount < minRaise && decision.amount < player.chips) {
			const roundedMinRaise = ceilTo10(minRaise);
			if (player.chips >= roundedMinRaise) {
				decision.amount = roundedMinRaise;
			} else if (player.chips >= needToCall) {
				decision.amount = player.chips; // all-in below full raise size is allowed
			} else {
				// Downgrade to call (or check if nothing to call)
				decision = needToCall > 0
					? { action: "call", amount: Math.min(player.chips, needToCall) }
					: { action: "check" };
			}
		}
	}

	if (botLine && decision.action === "raise" && (isBluff || isStab)) {
		botLine.nonValueAggressionMade = true;
	}

	if (
		botLine && botLine.preflopAggressor && !preflop && currentBet === 0 &&
		decision.action === "raise"
	) {
		if (currentPhaseIndex === 1) {
			botLine.cbetMade = true;
		} else if (currentPhaseIndex === 2 && botLine.cbetMade) {
			botLine.barrelMade = true;
		}
	}

	if (DEBUG_DECISIONS) {
		const boardCtx = overPair ? "OP" : (topPair ? "TP" : (drawChance ? "DR" : "-"));
		const drawFlag = isDraw ? "S" : (isWeakDraw ? "W" : "-");
		const preflopRaiseCount = handContext?.preflopRaiseCount ?? 0;
		const spotType = preflop
			? spotContext.unopened
				? "UO"
				: spotContext.limped
				? "L"
				: spotContext.multiRaised
				? "MR"
				: spotContext.singleRaised
				? "SR"
				: "-"
			: preflopRaiseCount > 1
			? "MR"
			: preflopRaiseCount === 1
			? "SR"
			: "L";
		const structureTag = spotContext.headsUp ? "HU" : "MW";
		const pressureTag = spotContext.facingAggression ? "FR" : "NF";
		const primaryAggressorName = spotContext.primaryAggressor
			? spotContext.primaryAggressor.name
			: "-";
		const groupTag =
			`L${spotContext.liveOpponents.length} B${spotContext.remainingBehind.length} V${spotContext.voluntaryOpponents.length} S${spotContext.shownStrengthOpponents.length}`;
		const pressureProfileTag = `${pressureProfileEntry.source}:${
			formatProfileForDebug(pressureProfile)
		}`;
		const foldProfileTag = `${foldProfileEntry.source}:${formatProfileForDebug(foldProfile)}`;
		const lineTag = botLine && botLine.preflopAggressor ? "PFA" : "-";
		const cbetPlan = botLine && botLine.preflopAggressor
			? (botLine.cbetIntent === null ? "-" : (botLine.cbetIntent ? "Y" : "N"))
			: "-";
		const barrelPlan = botLine && botLine.preflopAggressor
			? (botLine.barrelIntent === null ? "-" : (botLine.barrelIntent ? "Y" : "N"))
			: "-";
		const cbetMade = botLine && botLine.preflopAggressor ? (botLine.cbetMade ? "Y" : "N") : "-";
		const barrelMade = botLine && botLine.preflopAggressor
			? (botLine.barrelMade ? "Y" : "N")
			: "-";
		const lineAbortFlag = botLine && botLine.preflopAggressor ? (lineAbort ? "Y" : "N") : "-";
		const preflopSeatTag = preflopSeatClass ?? "-";
		const preflopBandTag = preflopBand ?? "-";
		const preflopDetailTag = preflopDetail ?? "-";
		const loggedRaiseThreshold = preflop ? 0 : raiseThreshold;
		const noBetTag = currentBet === 0 ? "Y" : "N";
		const canRaiseTag = canRaise ? "Y" : "N";
		const actingSlotTag = `${spotContext.actingSlotIndex + 1}/${spotContext.actingSlotCount}`;

		console.log(
			`${player.name} ${h1} ${h2} → ${decision.action} | ` +
				`H:${handName} Amt:${decision.amount ?? 0} | ` +
				`PA:${aggressionStrengthRatio.toFixed(2)} PS:${passiveStrengthRatio.toFixed(2)} M:${
					mRatio.toFixed(2)
				} Z:${mZone} | ` +
				`PO:${potOdds.toFixed(2)} CB:${eliminationBarrier.toFixed(2)} SR:${
					stackRatio.toFixed(2)
				} | ` +
				`CP:${commitmentPressure.toFixed(2)} CPen:${commitmentPenalty.toFixed(2)} | ` +
				`ER:${eliminationRisk.toFixed(2)} EP:${eliminationPenalty.toFixed(2)} | ` +
				`Pos:${positionFactor.toFixed(2)} Opp:${activeOpponents} Eff:${effectiveStack} | ` +
				`NB:${noBetTag} CR:${canRaiseTag} Act:${actingSlotTag} | ` +
				`RT10:${(loggedRaiseThreshold / 10).toFixed(2)} Agg:${
					aggressiveness.toFixed(2)
				} RL:${raiseLevel} RAdj:${(raiseLevel * RERAISE_RATIO_STEP).toFixed(2)} | ` +
				`Spot:${spotType}/${structureTag}/${pressureTag} Grp:${groupTag} Aggr:${primaryAggressorName} | ` +
				`ProfP:${pressureProfileTag} ProfF:${foldProfileTag} NVB:${
					nonValueAggressionBlocked ? "Y" : "N"
				} | ` +
				`Pre:${preflopSeatTag}/${preflopBandTag}/${preflopDetailTag} | ` +
				`Ctx:${boardCtx} Draw:${drawFlag} Tex:${textureRisk.toFixed(2)} LT:${liftType} | ` +
				`PH:${publicHand?.name ?? "-"} RH:${solvedHand?.name ?? "-"} PF:${
					publicDefenseFloor.toFixed(2)
				} PB:${passiveBonus.toFixed(2)} | ` +
				`Pub:${publicScore.toFixed(2)} Raw:${rawScore.toFixed(2)} | ` +
				`CL:${amChipleader ? "Y" : "N"} SS:${shortstackRelative ? "Y" : "N"} Prem:${
					premiumHand ? "Y" : "N"
				} | ` +
				`Line:${lineTag} CP:${cbetPlan} BP:${barrelPlan} CM:${cbetMade} BM:${barrelMade} LA:${lineAbortFlag} | ` +
				`Stab:${isStab ? "Y" : "N"} Bluff:${isBluff ? "Y" : "N"}`,
		);
	}

	return decision;
}
