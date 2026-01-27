/*
 * bot.js
 *
 * Implements the poker bot's decision-making logic, including hand evaluation,
 * action selection based on game context, and managing delayed execution of bot actions.
 */

import { Card, Hand } from "./pokersolver.js";

/* ===========================
   Configuration
========================== */
// Configuration constants
// Delay in milliseconds between enqueued bot actions
export const BOT_ACTION_DELAY = 3000;

// Enable verbose logging of bot decisions
const DEBUG_DECISIONS = true;
// Maximum number of raises allowed per betting round
const MAX_RAISES_PER_ROUND = 3;
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
// Controls how quickly stat influence grows as more hands are played
const WEIGHT_GROWTH = 10;
// Detect opponents that shove frequently
const ALLIN_HAND_PREFLOP = 0.85;
const ALLIN_HAND_POSTFLOP = 0.5;
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
const YELLOW_RAISE_RATIO = 0.6;
const YELLOW_CALL_RATIO = 0.7;
const YELLOW_SHOVE_RATIO = 0.85;
const PREMIUM_PREFLOP_RATIO = 0.8;
const PREMIUM_POSTFLOP_RATIO = 0.7;
const GREEN_MAX_STACK_BET = 0.2;
const CHIP_LEADER_RAISE_DELTA = 0.05;
const SHORTSTACK_CALL_DELTA = 0.05;
const SHORTSTACK_RELATIVE = 0.6;
// Hand-level commitment tuning to reduce multi-street bleeding
const COMMIT_SPR_MIN = 1.5;
const COMMIT_SPR_MAX = 5.5;
const COMMIT_INVEST_START = 0.1;
const COMMIT_INVEST_END = 0.6;
const COMMIT_CALL_RATIO_REF = 0.25;
const COMMITMENT_PENALTY_MAX = 0.25;

const botActionQueue = [];
let processingBotActions = false;

/* ===========================
   Action Queue Management
========================== */
// Task queue management: enqueue bot actions for delayed execution
export function enqueueBotAction(fn) {
	botActionQueue.push(fn);
	if (!processingBotActions) {
		processingBotActions = true;
		setTimeout(processBotQueue, BOT_ACTION_DELAY);
	}
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
		setTimeout(processBotQueue, BOT_ACTION_DELAY);
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

// Numeric utility: round to nearest multiple of 10
function roundTo10(x) {
	return Math.round(x / 10) * 10;
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

/* ===========================
   Preflop Hand Evaluation
========================== */
// Preflop hand evaluation using simplified Chen formula
function preflopHandScore(cardA, cardB) {
	const order = "23456789TJQKA";
	const base = {
		A: 10,
		K: 8,
		Q: 7,
		J: 6,
		T: 5,
		"9": 4.5,
		"8": 4,
		"7": 3.5,
		"6": 3,
		"5": 2.5,
		"4": 2,
		"3": 1.5,
		"2": 1,
	};

	let r1 = cardA[0];
	let r2 = cardB[0];
	let s1 = cardA[1];
	let s2 = cardB[1];

	let i1 = order.indexOf(r1);
	let i2 = order.indexOf(r2);
	if (i1 < i2) {
		[r1, r2] = [r2, r1];
		[s1, s2] = [s2, s1];
		[i1, i2] = [i2, i1];
	}

	let score = base[r1];
	if (r1 === r2) {
		score *= 2;
		if (score < 5) score = 5;
	}

	if (s1 === s2) score += 2;

	const gap = i1 - i2 - 1;
	if (gap === 1) score -= 1;
	else if (gap === 2) score -= 2;
	else if (gap === 3) score -= 4;
	else if (gap >= 4) score -= 5;

	if (gap <= 1 && i1 < order.indexOf("Q")) score += 1;

	if (score < 0) score = 0;

	return Math.min(10, score);
}

/* ===========================
   Decision Engine: Bot Action Selection
========================== */
export function chooseBotAction(player, ctx) {
	const {
		currentBet,
		pot,
		smallBlind,
		bigBlind,
		raisesThisRound,
		currentPhaseIndex,
		players,
		lastRaise,
	} = ctx;
	// Determine amount needed to call the current bet
	const needToCall = currentBet - player.roundBet;
	const needsToCall = needToCall > 0;

	// Calculate pot odds to assess call viability
	const potOdds = needToCall / (pot + needToCall);
	// Compute risk as fraction of stack required
	const stackRatio = needToCall / player.chips;
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

	// Helper: find the next active player after the given index
	function nextActive(startIdx) {
		for (let i = 1; i <= players.length; i++) {
			const idx = (startIdx + i) % players.length;
			if (!players[idx].folded) return players[idx];
		}
		return players[startIdx];
	}

	const seatIdx = active.indexOf(player);
	const firstToAct = currentPhaseIndex === 0
		? nextActive(players.findIndex((p) => p.bigBlind))
		: nextActive(players.findIndex((p) => p.dealer));
	const refIdx = active.indexOf(firstToAct);

	const pos = (seatIdx - refIdx + active.length) % active.length;
	const positionFactor = active.length > 1 ? pos / (active.length - 1) : 0;

	// Collect community cards from the board
	const communityCards = Array.from(
		document.querySelectorAll("#community-cards .cardslot img"),
	).map((img) => {
		const m = img.src.match(/\/cards\/([2-9TJQKA][CDHS])\.svg$/);
		return m ? m[1] : null;
	}).filter(Boolean);

	// Determine if we are in pre-flop stage
	const preflop = communityCards.length === 0;

	// Evaluate hand strength
	let strength;
	let solvedHand = null;
	if (preflop) {
		strength = preflopHandScore(player.cards[0].dataset.value, player.cards[1].dataset.value);
	} else {
		const cards = [
			player.cards[0].dataset.value,
			player.cards[1].dataset.value,
			...communityCards,
		];
		solvedHand = Hand.solve(cards);
		strength = solvedHand.rank + handTiebreaker(solvedHand);
	}

	// Post-flop board context
	let topPair = false;
	let overPair = false;
	let drawChance = false;
	let drawOuts = 0;
	let drawEquity = 0;
	let textureRisk = 0;
	if (!preflop && communityCards.length >= 3) {
		const ctxInfo = analyzeHandContext(
			[player.cards[0].dataset.value, player.cards[1].dataset.value],
			communityCards,
		);
		topPair = ctxInfo.isTopPair;
		overPair = ctxInfo.isOverPair;

		const draws = analyzeDrawPotential(
			[player.cards[0].dataset.value, player.cards[1].dataset.value],
			communityCards,
		);
		drawChance = draws.flushDraw || draws.straightDraw;
		drawOuts = draws.outs;
		if (drawOuts > 0) {
			const drawFactor = communityCards.length === 3
				? 0.04
				: communityCards.length === 4
				? 0.02
				: 0;
			drawEquity = Math.min(1, drawOuts * drawFactor);
		}

		textureRisk = evaluateBoardTexture(communityCards);
	}

	// Normalize strength to [0,1]
	const strengthRatio = strength / 10;
	let mZone = "green";
	if (mRatio < M_RATIO_DEAD_MAX) {
		mZone = "dead";
	} else if (mRatio <= M_RATIO_RED_MAX) {
		mZone = "red";
	} else if (mRatio <= M_RATIO_ORANGE_MAX) {
		mZone = "orange";
	} else if (mRatio <= M_RATIO_YELLOW_MAX) {
		mZone = "yellow";
	}
	const premiumHand = preflop
		? strengthRatio >= PREMIUM_PREFLOP_RATIO
		: strengthRatio >= PREMIUM_POSTFLOP_RATIO;
	const raiseAggAdj = amChipleader ? -CHIP_LEADER_RAISE_DELTA : 0;
	const callTightAdj = shortstackRelative ? SHORTSTACK_CALL_DELTA : 0;
	const deadPushThreshold = Math.max(0, DEAD_PUSH_RATIO + raiseAggAdj);
	const redPushThreshold = Math.max(0, RED_PUSH_RATIO + raiseAggAdj);
	const orangePushThreshold = Math.max(0, ORANGE_PUSH_RATIO + raiseAggAdj);
	const yellowRaiseThreshold = Math.max(0, YELLOW_RAISE_RATIO + raiseAggAdj);
	const yellowShoveThreshold = Math.max(0, YELLOW_SHOVE_RATIO + raiseAggAdj);
	const redCallThreshold = Math.min(1, RED_CALL_RATIO + callTightAdj);
	const orangeCallThreshold = Math.min(1, ORANGE_CALL_RATIO + callTightAdj);
	const yellowCallThreshold = Math.min(1, YELLOW_CALL_RATIO + callTightAdj);
	const callBarrierBase = Math.min(1, potOdds + callTightAdj);
	const useHarringtonStrategy = mZone !== "green";
	const remainingStreets = preflop
		? 3
		: communityCards.length === 3
		? 2
		: communityCards.length === 4
		? 1
		: 0;
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
	const callBarrier = Math.min(1, callBarrierBase + commitmentPenalty);

	// Base thresholds for raising depend on stage and pot size
	// When only a few opponents remain, play slightly more aggressively
	const oppAggAdj = activeOpponents < OPPONENT_THRESHOLD
		? (OPPONENT_THRESHOLD - activeOpponents) * AGG_FACTOR
		: 0;
	const thresholdAdj = activeOpponents < OPPONENT_THRESHOLD
		? (OPPONENT_THRESHOLD - activeOpponents) * THRESHOLD_FACTOR
		: 0;
	let aggressiveness = (preflop ? 0.8 + 0.4 * positionFactor : 1 + 0.6 * positionFactor) +
		oppAggAdj;
	let raiseThreshold = preflop ? 8 - 2 * positionFactor : Math.max(2, 4 - 2 * positionFactor);
	raiseThreshold = Math.max(1, raiseThreshold - thresholdAdj);

	if (!preflop) {
		if (overPair) {
			aggressiveness += 0.2;
			raiseThreshold -= 0.5;
		} else if (topPair) {
			aggressiveness += 0.1;
			raiseThreshold -= 0.3;
		}
		if (drawEquity > 0) {
			const effectiveStrength = Math.min(1, strengthRatio + drawEquity);
			aggressiveness *= effectiveStrength / strengthRatio;
		}
		if (drawOuts > 0) {
			raiseThreshold -= Math.min(0.4, drawEquity * 0.8);
		}

		// Reduce aggression on wet boards
		aggressiveness *= 1 - textureRisk * 0.5;
		raiseThreshold = Math.min(10, raiseThreshold + textureRisk);
	}
	if (amChipleader) {
		raiseThreshold = Math.max(1, raiseThreshold - CHIP_LEADER_RAISE_DELTA * 10);
	}

	let bluffChance = 0;
	let foldRate = 0;
	let statsWeight = 0;

	function capGreenNonPremium(amount) {
		if (useHarringtonStrategy || premiumHand) return amount;
		const cap = Math.floor(player.chips * GREEN_MAX_STACK_BET);
		return Math.min(amount, cap);
	}

	function valueBetSize() {
		let base;
		if (preflop) {
			base = 0.55;
			if (strengthRatio >= 0.9) base += 0.15;
			base += activeOpponents * 0.04;
			base += (1 - positionFactor) * 0.05;
			if (positionFactor < 0.3 && strengthRatio >= 0.8) {
				base += 0.1; // bigger open from early position
			}
		} else {
			base = textureRisk > 0.6 ? 0.7 : textureRisk > 0.3 ? 0.6 : 0.45;
			if (strengthRatio > 0.95) base += 0.1; // polarise with very strong hands
			base += activeOpponents * 0.03;
			base += (1 - positionFactor) * 0.05;
		}
		if (spr < 2) base += 0.1;
		else if (spr < 4) base += 0.05;
		else if (spr > 6) base -= 0.05;
		const rand = Math.random() * 0.2 - 0.1;
		const factor = Math.min(1, Math.max(0.35, base + rand));
		const sized = roundTo10(Math.min(player.chips, (pot + needToCall) * factor));
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
		const sized = roundTo10(Math.min(player.chips, (pot + needToCall) * factor));
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
		const sized = roundTo10(Math.min(player.chips, (pot + needToCall) * factor));
		return capGreenNonPremium(sized);
	}

	function overBetSize() {
		let base = 1.2 - textureRisk * 0.1;
		base += activeOpponents * 0.05;
		if (spr < 2) base += 0.3;
		const rand = Math.random() * 0.15 - 0.05;
		const factor = Math.max(1.1, Math.min(1.5, base + rand));
		const sized = roundTo10(Math.min(player.chips, (pot + needToCall) * factor));
		return capGreenNonPremium(sized);
	}

	function yellowRaiseSize() {
		const base = bigBlind * (2.5 + Math.random() * 0.5);
		const sized = roundTo10(base);
		return Math.min(player.chips, Math.max(currentBet + lastRaise, sized));
	}

	function decideCbetIntent(lineAbort) {
		if (lineAbort) return false;
		let chance = 0.55;
		if (textureRisk < 0.35) chance += 0.15;
		else if (textureRisk > 0.6) chance -= 0.2;
		chance -= Math.max(0, activeOpponents - 1) * 0.06;
		chance += positionFactor * 0.08;
		chance += Math.min(0.2, foldRate * 0.25);
		if (strengthRatio >= 0.7) chance += 0.15;
		if (drawEquity > 0) chance += 0.08;
		const weightScale = 0.6 + 0.4 * statsWeight;
		chance *= weightScale;
		chance = Math.max(0.15, Math.min(0.85, chance));
		return Math.random() < chance;
	}

	function decideBarrelIntent(lineAbort) {
		if (lineAbort) return false;
		let chance = 0.35;
		if (textureRisk < 0.35) chance += 0.1;
		else if (textureRisk > 0.6) chance -= 0.15;
		chance -= Math.max(0, activeOpponents - 1) * 0.05;
		chance += positionFactor * 0.06;
		chance += Math.min(0.15, foldRate * 0.2);
		if (strengthRatio >= 0.75) chance += 0.1;
		if (drawEquity > 0) chance += 0.06;
		const weightScale = 0.6 + 0.4 * statsWeight;
		chance *= weightScale;
		chance = Math.max(0.1, Math.min(0.75, chance));
		return Math.random() < chance;
	}

	// Adjust based on observed opponent tendencies
	const statOpponents = players.filter((p) => p !== player);
	if (statOpponents.length > 0) {
		const avgVPIP = statOpponents.reduce((s, p) =>
			s + (p.stats.vpip + 1) / (p.stats.hands + 2), 0) /
			statOpponents.length;
		const avgAgg = statOpponents.reduce((s, p) =>
			s + (p.stats.aggressiveActs + 1) / (p.stats.calls + 1), 0) /
			statOpponents.length;
		foldRate = avgFoldRate(statOpponents);

		// Weight adjustments by average hands played to avoid overreacting in early rounds
		const avgHands = statOpponents.reduce((s, p) =>
			s + p.stats.hands, 0) /
			statOpponents.length;
		const weight = avgHands < MIN_HANDS_FOR_WEIGHT
			? 0
			: 1 - Math.exp(-(avgHands - MIN_HANDS_FOR_WEIGHT) / WEIGHT_GROWTH);
		statsWeight = weight;
		bluffChance = Math.min(0.3, foldRate) * weight;
		bluffChance *= 1 - textureRisk * 0.5;

		if (avgVPIP < 0.25) {
			raiseThreshold -= 0.5 * weight;
			aggressiveness += 0.1 * weight;
		} else if (avgVPIP > 0.5) {
			raiseThreshold += 0.5 * weight;
			aggressiveness -= 0.1 * weight;
		}

		if (avgAgg > 1.5) {
			aggressiveness -= 0.1 * weight;
		} else if (avgAgg < 0.7) {
			aggressiveness += 0.1 * weight;
		}
	}

	// Keep a simple betting-line memory for the preflop aggressor.
	let lineAbort = false;
	if (!preflop && botLine && botLine.preflopAggressor) {
		lineAbort = textureRisk > 0.7 && strengthRatio < 0.45 && drawEquity === 0;
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
       - Similarly, when the difference between (strengthRatio * aggressiveness) and callBarrier is within ODDS_TIE_DELTA,
         the bot randomly resolves between call and fold to break ties.
     */
	let decision;

	if (useHarringtonStrategy) {
		if (mZone === "dead") {
			if (facingRaise && needsToCall) {
				decision = { action: "call", amount: Math.min(player.chips, needToCall) };
			} else if (canShove && strengthRatio >= deadPushThreshold) {
				decision = { action: "raise", amount: player.chips };
			} else {
				decision = needsToCall
					? { action: "call", amount: Math.min(player.chips, needToCall) }
					: { action: "check" };
			}
		} else if (mZone === "red") {
			if (facingRaise && needsToCall) {
				if (strengthRatio >= redCallThreshold) {
					decision = { action: "call", amount: Math.min(player.chips, needToCall) };
				} else {
					decision = { action: "fold" };
				}
			} else if (canShove && strengthRatio >= redPushThreshold) {
				decision = { action: "raise", amount: player.chips };
			} else {
				decision = needsToCall ? { action: "fold" } : { action: "check" };
			}
		} else if (mZone === "orange") {
			if (facingRaise && needsToCall) {
				if (strengthRatio >= orangeCallThreshold) {
					decision = { action: "call", amount: Math.min(player.chips, needToCall) };
				} else {
					decision = { action: "fold" };
				}
			} else if (canShove && strengthRatio >= orangePushThreshold) {
				decision = { action: "raise", amount: player.chips };
			} else {
				decision = needsToCall ? { action: "fold" } : { action: "check" };
			}
		} else if (mZone === "yellow") {
			if (facingRaise && needsToCall) {
				if (canShove && strengthRatio >= yellowShoveThreshold) {
					decision = { action: "raise", amount: player.chips };
				} else if (strengthRatio >= yellowCallThreshold) {
					decision = { action: "call", amount: Math.min(player.chips, needToCall) };
				} else {
					decision = { action: "fold" };
				}
			} else if (canShove && strengthRatio >= yellowShoveThreshold) {
				decision = { action: "raise", amount: player.chips };
			} else if (canRaise && strengthRatio >= yellowRaiseThreshold) {
				decision = { action: "raise", amount: yellowRaiseSize() };
			} else {
				decision = needsToCall ? { action: "fold" } : { action: "check" };
			}
		}
	}

	// Automatic shove logic when stacks are shallow
	if (!decision) {
		if (spr <= 1.2 && strengthRatio >= 0.65) {
			decision = { action: "raise", amount: player.chips };
		} else if (preflop && player.chips <= blindLevel.big * 10 && strengthRatio >= 0.75) {
			decision = { action: "raise", amount: player.chips };
		}
	}

	if (!decision) {
		if (needToCall <= 0) {
			if (canRaise && strength >= raiseThreshold) {
				let raiseAmt = valueBetSize();
				raiseAmt = Math.max(currentBet + lastRaise, raiseAmt);
				if (Math.abs(strength - raiseThreshold) <= STRENGTH_TIE_DELTA) {
					decision = Math.random() < 0.5
						? { action: "check" }
						: { action: "raise", amount: raiseAmt };
				} else {
					decision = { action: "raise", amount: raiseAmt };
				}
			} else {
				decision = { action: "check" };
			}
		} else if (canRaise && strength >= raiseThreshold && stackRatio <= 1 / 3) {
			let raiseAmt = protectionBetSize();
			raiseAmt = Math.max(currentBet + lastRaise, raiseAmt);
			if (Math.abs(strength - raiseThreshold) <= STRENGTH_TIE_DELTA) {
				const callAmt = Math.min(player.chips, needToCall);
				const alt = (strengthRatio * aggressiveness >= callBarrier &&
						stackRatio <= (preflop ? 0.5 : 0.7))
					? { action: "call", amount: callAmt }
					: { action: "fold" };
				decision = Math.random() < 0.5 ? { action: "raise", amount: raiseAmt } : alt;
			} else {
				decision = { action: "raise", amount: raiseAmt };
			}
		} else if (
			strengthRatio * aggressiveness >= callBarrier && stackRatio <= (preflop ? 0.5 : 0.7)
		) {
			const callAmt = Math.min(player.chips, needToCall);
			if (Math.abs(strengthRatio * aggressiveness - callBarrier) <= ODDS_TIE_DELTA) {
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

	let isBluff = false;
	if (!useHarringtonStrategy) {
		// If facing any all-in, do not fold always
		const facingAllIn = statOpponents.some((p) => p.allIn);
		if (decision.action === "fold" && facingAllIn) {
			const goodThreshold = preflop ? ALLIN_HAND_PREFLOP : ALLIN_HAND_POSTFLOP;
			if (strengthRatio >= goodThreshold) {
				decision = { action: "call", amount: Math.min(player.chips, needToCall) };
			}
		}

		if (
			bluffChance > 0 && canRaise &&
			(decision.action === "check" || decision.action === "fold") && !facingAllIn
		) {
			if (Math.random() < bluffChance) {
				const bluffAmt = Math.max(currentBet + lastRaise, bluffBetSize());
				decision = { action: "raise", amount: bluffAmt };
				isBluff = true;
			}
		}

		if (
			!preflop && currentBet === 0 && decision.action === "check" && canRaise &&
			botLine && botLine.preflopAggressor && !lineAbort && strengthRatio < 0.9
		) {
			if (currentPhaseIndex === 1 && botLine.cbetIntent) {
				const bet = strengthRatio >= 0.6 || drawEquity > 0
					? protectionBetSize()
					: bluffBetSize();
				decision = {
					action: "raise",
					amount: Math.min(player.chips, Math.max(lastRaise, bet)),
				};
				if (strengthRatio < 0.6 && drawEquity === 0) {
					isBluff = true;
				}
			} else if (currentPhaseIndex === 2 && botLine.barrelIntent) {
				const bet = strengthRatio >= 0.65 || drawEquity > 0
					? protectionBetSize()
					: bluffBetSize();
				decision = {
					action: "raise",
					amount: Math.min(player.chips, Math.max(lastRaise, bet)),
				};
				if (strengthRatio < 0.6 && drawEquity === 0) {
					isBluff = true;
				}
			}
		}

		if (
			!preflop && decision.action === "raise" && strengthRatio >= 0.95 && spr <= 2 &&
			Math.random() < 0.3
		) {
			decision.amount = Math.max(decision.amount, overBetSize());
		}

		if (
			!preflop && !needsToCall && strengthRatio >= 0.9 && decision.action === "raise" &&
			Math.random() < 0.3
		) {
			decision = { action: "check" };
		}

		if (!preflop && currentBet === 0 && decision.action === "check" && Math.random() < 0.3) {
			const betAmt = protectionBetSize();
			decision = { action: "raise", amount: Math.max(lastRaise, betAmt) };
		}
	}

	const h1 = formatCard(player.cards[0].dataset.value);
	const h2 = formatCard(player.cards[1].dataset.value);
	const handName = !preflop ? solvedHand.name : "preflop";

	// --- Ensure raises meet the minimum requirements ---
	if (decision.action === "raise") {
		const minRaise = needToCall + lastRaise; // minimum legal raise
		if (decision.amount < minRaise && decision.amount < player.chips) {
			// Downgrade to call (or check if nothing to call)
			decision = needToCall > 0
				? { action: "call", amount: Math.min(player.chips, needToCall) }
				: { action: "check" };
		}
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
		// Map aggressiveness to an emoji for logging
		let aggrEmoji;
		if (aggressiveness >= 1.5) aggrEmoji = "🔥";
		else if (aggressiveness >= 1.2) aggrEmoji = "⚡";
		else if (aggressiveness >= 1.0) aggrEmoji = "👌";
		else if (aggressiveness >= 0.8) aggrEmoji = "🐌";
		else aggrEmoji = "❄️";

		console.groupCollapsed(
			`${player.name} ${h1} ${h2} → ${decision.action} ${aggrEmoji}`,
		);
		console.log(`Hand: ${handName}`);
		console.log(
			`Strength: ${strengthRatio.toFixed(2)} | M: ${mRatio.toFixed(2)} | Zone: ${mZone}`,
		);
		console.log(
			`PotOdds: ${potOdds.toFixed(2)} | CallBarrier: ${callBarrier.toFixed(2)} | ` +
				`StackRatio: ${stackRatio.toFixed(2)}`,
		);
		console.log(
			`CommitPressure: ${commitmentPressure.toFixed(2)} | CommitPenalty: ` +
				`${commitmentPenalty.toFixed(2)}`,
		);
		console.log(
			`Position: ${positionFactor.toFixed(2)} | Opponents: ${activeOpponents} | ` +
				`EffStack: ${effectiveStack}`,
		);
		console.log(
			`RaiseThreshold: ${(raiseThreshold / 10).toFixed(2)} | Aggressiveness: ` +
				`${aggressiveness.toFixed(2)}`,
		);
		console.log(
			`BoardCtx: ${
				overPair ? "overpair" : (topPair ? "top pair" : (drawChance ? "draw" : "-"))
			} | ` +
				`Texture: ${textureRisk.toFixed(2)}`,
		);
		console.log(
			`ChipLead: ${amChipleader ? "Y" : "N"} | ShortRel: ${
				shortstackRelative ? "Y" : "N"
			} | ` +
				`Premium: ${premiumHand ? "Y" : "N"}`,
		);
		console.log(
			`Line: ${botLine && botLine.preflopAggressor ? "PFA" : "-"} | ` +
				`CbetPlan: ${
					botLine && botLine.preflopAggressor
						? (botLine.cbetIntent === null ? "-" : (botLine.cbetIntent ? "Y" : "N"))
						: "-"
				} | BarrelPlan: ${
					botLine && botLine.preflopAggressor
						? (botLine.barrelIntent === null ? "-" : (botLine.barrelIntent ? "Y" : "N"))
						: "-"
				}`,
		);
		console.log(
			`CbetMade: ${
				botLine && botLine.preflopAggressor ? (botLine.cbetMade ? "Y" : "N") : "-"
			} | ` +
				`BarrelMade: ${
					botLine && botLine.preflopAggressor ? (botLine.barrelMade ? "Y" : "N") : "-"
				} | LineAbort: ${
					botLine && botLine.preflopAggressor ? (lineAbort ? "Y" : "N") : "-"
				}`,
		);
		console.log(`Bluff: ${isBluff ? "Y" : "N"}`);
		console.groupEnd();
	}

	return decision;
}
