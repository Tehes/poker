/* ==================================================================================================
MODULE BOUNDARY: Bot Decision Engine
================================================================================================== */

// CURRENT STATE: Owns poker bot decision logic, including hand evaluation, action selection, action
// request normalization, debug instrumentation, and queued action playback timing.
// TARGET STATE: Stay the single place for autonomous bot behavior, while pure generic poker rules
// remain in gameEngine.js and browser-facing flow stays in app.js.
// PUT HERE: Bot heuristics, opponent-independent decision rules, debug hooks, and delayed execution
// control for bot actions.
// DO NOT PUT HERE: DOM updates, sync payload shaping, notification flow, or generic poker helpers
// that should be reused outside bot play.
// STRATEGY NOTE: Winner-take-all tournament with no payout ladder. Bot decisions are chip-EV driven
// with M-ratio zones and a light elimination-risk guardrail for large calls.
//
// BOT NORTH STAR:
// Build lively, plausible, hard-to-exploit tournament poker, not solver-clean but lifeless play.
// Calls are a core action path. Raise / call / fold must all stay real options.
// SB heads-up and BTN 3-handed are the main action engines, so avoid open patterns that kill blind
// defense and produce too many uncontested pots.
// Prefer playability over sterile tightness: suited hands, connected hands, broadways, and pairs
// should reach the flop at healthy frequencies, while weak dominated offsuit hands should be
// dampened on purpose.
// Postflop, protect hands with real equity from collapsing into automatic folds. Defense should be
// carried by plausible, range-relevant hand classes with credible equity; weak bluffcatchers should
// not be used merely to fill defense frequency.
// Core safety guardrails are non-negotiable: no premium preflop folds, no bluff raises with made
// hands, no absurd kicker or board-made folds, and no broken multi-raised lines.
//
// STRATEGIC INVARIANTS:
// - Dead / Red / Orange zones must preserve real push-fold pressure.
// - Deep and healthy stacks must not drift into panic shoves or shallow-stack behavior.
// - Multiway ranges must stay tighter and more value-heavy than heads-up ranges.
// - Thin raises and loose bluffcatch calls should be rarer multiway.
// - Position must remain meaningful.
// - BTN / CO should keep wider profitable opens and more flexible continues than early position or
//   OOP spots.
// - Strong value should keep aggression priority over marginal fancy lines.
// - Fixes must not solve one leak by reducing obvious value betting or obvious value raising.
//
// ACCEPTANCE CRITERIA:
// - Judge changes by decision quality and strategic coherence, not by raw tightness.
// - A pass is acceptable only if it improves the target leak without pushing the bot into a
//   clearly overfolding, spewy, or degenerate style.
// - Hard fails: preflop_premium_folds must stay 0, bluff_raises_with_made_hand must stay 0, and
//   postflop_reraises_allin_edge_lt_1.0 must stay 0.
// - Watchpoints: postflop_reraises_edge_lt_1.0 must stay rare and must not materially worsen vs
//   baseline; non-target regressions such as marginal raises, weak calls, and early large pots
//   must not clearly rise as a side effect.
// - Defense guardrails: range-defense overfold is only a problem when it comes from plausible
//   defending range segments collapsing, or when street-wide regression remains chronic after
//   hand-quality review.
// - candidateOverall.overfold is diagnostic only. It must be interpreted by hand-quality class;
//   defendable and thin candidates should not collapse, while trash candidates may overfold.
// - Call quality must be judged by range defense and context, not only by showdown win rate.
// - Not every profitable defense call is a pure value call; some marginal calls are strategically
//   required heads-up versus polarized aggression to prevent exploitable overfolding.
// - MDF / range-defense analysis is a measurement layer, not a decision engine. Hand quality,
//   price, street, position, and pressure must determine calls in the normal decision path.
// - Slight tournament overfold is acceptable; chronic street-wide or overall overfold is not.
//   Higher Flop overfold can be acceptable when the missing defense would otherwise come from
//   trash, board-only hands, kicker-only hands, weak draws with bad price, or weak bluffcatchers.
// - When the pass targets calls, marginal_river_calls and marginal_facing_raise_calls should be
//   monitored, but not improved at the cost of more trash calls.
// - Good folds are part of playability: the bot should defend enough versus standard pressure,
//   but still release weak pairs, board-only hands, weak draws, dead hands, and kicker-only hands
//   in bad contexts.
// - Weak bluffcatchers and weak pair classes should fold more often in bad contexts.
// - overpair, top-pair, and good second-pair must remain defendable when price and structure are
//   reasonable.
// - Raise / call / fold must all remain live options postflop.
// - SB heads-up and BTN 3-handed should keep healthy open / defend dynamics.
// - firstBustAvg, firstBustMedian, early bust share <= 10, and early 800+ pots must not show
//   clear multi-metric regression versus the latest 1000-run baseline.
// - One noisy metric alone is not enough to fail a pass; clustered regressions are.
// - Batch rule: engine:batch is the required structure check, engine:batch:500 is the stability
//   check for promising passes, and engine:batch:1000 is the acceptance run against the latest
//   1000-run baseline; a candidate wins only if target metrics improve and core health metrics
//   remain stable.
//
// TUNING PRINCIPLE:
// Prefer adjusting existing numeric thresholds, ratios, caps, and hand-context classification
// before adding new hard guards or binary filters.
// New guardrails should be rare and reserved for true safety or coherence failures, not as the
// default fix for ordinary balance leaks.
// When a leak appears, first try to solve it by improving continuous evaluation so the bot stays
// readable, playable, and less fragmented across many spot-specific rules.
// Batch rule: measure first, then change. One lever per pass. A change is only good if it creates
// more plausible poker or more real postflop play without breaking the core safety guardrails.

import { Card, Hand } from "./pokersolver.js";
import { getPlayerActionState } from "./shared/actionModel.js";

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
let botDecisionSink = null;

const runtimeSearchParams = new URLSearchParams(globalThis.location?.search ?? "");
const speedModeParam = runtimeSearchParams.get("speedmode");
const debugBotParam = runtimeSearchParams.get("botdebug");
DEBUG_DECISIONS_DETAIL = debugBotParam === "1" || debugBotParam === "true" ||
	debugBotParam === "detail";
if (DEBUG_DECISIONS_DETAIL) {
	DEBUG_DECISIONS = true;
}
const SPEED_MODE = speedModeParam !== null && speedModeParam !== "0" &&
	speedModeParam !== "false";
if (SPEED_MODE) {
	BOT_ACTION_DELAY = 0;
	DEBUG_DECISIONS = true;
}

export function setBotDecisionSink(sink) {
	botDecisionSink = typeof sink === "function" ? sink : null;
}

function logSpeedmodeEvent(type, payload) {
	if (!SPEED_MODE) {
		return;
	}
	console.log("speedmode_event", { type, ...payload });
}

function toRoundedNumber(value, digits = 2) {
	return Number(value.toFixed(digits));
}
// Maximum number of raises allowed per betting round
const MAX_RAISES_PER_ROUND = 3;
// Extra required strengthRatio per prior raise in the same betting round
const RERAISE_RATIO_STEP = 0.18;
// Minimum strengthRatio to allow reraises (value gate)
const RERAISE_VALUE_RATIO = 0.42;
const RERAISE_TOP_PAIR_RATIO = 0.40;
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
const YELLOW_RAISE_RATIO = 0.6;
const YELLOW_CALL_RATIO = 0.7;
const YELLOW_SHOVE_RATIO = 0.85;
const PREMIUM_PREFLOP_SCORE = 9;
const PREMIUM_POSTFLOP_RATIO = 0.55;
const CHIP_LEADER_RAISE_DELTA = 0.05;
const SHORTSTACK_CALL_DELTA = 0.05;
const SHORTSTACK_RELATIVE = 0.6;
const PASSIVE_CALL_WEAK_OFFSUIT_LOW_KICKER_MULTIWAY_RAISE_CAP = 2.00;
const MIN_PREFLOP_BLUFF_RATIO = 0.45;
const CHECK_RAISE_INTENT_CHANCE = 0.35;
const CHECK_RAISE_TWO_PAIR_TRIPS_MAX_TEXTURE = 0.45;
const CHECK_RAISE_STRAIGHT_PLUS_MAX_TEXTURE = 0.72;
const PASSIVE_VALUE_CHECK_CHANCE = 0.3;
const PASSIVE_VALUE_CHECK_MAX_TEXTURE = 0.4;
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
const POSTFLOP_ELIMINATION_RISK_FULL = 1.0;
const POSTFLOP_ELIMINATION_PENALTY_MAX = 0.35;
const TOP_TIER_POSTFLOP_GUARD_RANK_MIN = 5;
const RIVER_SPLIT_PROTECTED_PUBLIC_RANK_MIN = 5;

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
	if (
		!processingBotActions || botActionQueue.length === 0 || botActionTimer
	) {
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

export function normalizeBotActionRequest(decision) {
	if (!decision) {
		return null;
	}

	switch (decision.action) {
		case "fold":
		case "check":
		case "call":
		case "allin":
			return { action: decision.action };
		case "raise": {
			const amount = Number.parseInt(decision.amount, 10);
			if (Number.isNaN(amount)) {
				return null;
			}
			return { action: "raise", amount };
		}
		default:
			return null;
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
	return relativeIndex === 0 ? "early" : relativeIndex === betweenBlindAndButton - 1 ? "cutoff" : "middle";
}

function getPreflopLogSeatTag(seatClass, activePlayers) {
	if (!seatClass) {
		return "-";
	}
	return `${seatClass}/${activePlayers <= 2 ? "HU" : activePlayers}`;
}

function getActionOrder(players, currentPhaseIndex) {
	const active = players.filter((currentPlayer) => !currentPlayer.folded);
	if (active.length === 0) {
		return [];
	}
	const firstToAct = currentPhaseIndex === 0
		? findNextActivePlayer(
			players,
			players.findIndex((currentPlayer) => currentPlayer.bigBlind),
		)
		: findNextActivePlayer(
			players,
			players.findIndex((currentPlayer) => currentPlayer.dealer),
		);
	const startIdx = active.indexOf(firstToAct);
	return startIdx === -1 ? active : active.slice(startIdx).concat(active.slice(0, startIdx));
}

function getPreflopActionOrder(players) {
	return getActionOrder(players, 0);
}

function getLastPreflopAggressor(players, handContext) {
	const aggressorSeatIndex = handContext?.preflopAggressorSeatIndex;
	if (aggressorSeatIndex === null || aggressorSeatIndex === undefined) {
		return null;
	}
	return players.find((currentPlayer) => currentPlayer.seatIndex === aggressorSeatIndex && !currentPlayer.folded) ??
		null;
}

function isIndexInCircularForwardSegment(startIndex, endExclusiveIndex, targetIndex, length) {
	let index = (startIndex + 1 + length) % length;
	while (index !== endExclusiveIndex) {
		if (index === targetIndex) {
			return true;
		}
		index = (index + 1) % length;
	}
	return false;
}

function isPreflopInPositionToAggressor(players, player, handContext) {
	const actionOrder = getPreflopActionOrder(players);
	if (actionOrder.length <= 1) {
		return false;
	}

	const aggressor = getLastPreflopAggressor(players, handContext);
	if (!aggressor) {
		return false;
	}

	const aggressorIndex = actionOrder.indexOf(aggressor);
	const playerIndex = actionOrder.indexOf(player);
	if (
		aggressorIndex === -1 ||
		playerIndex === -1 ||
		playerIndex === aggressorIndex
	) {
		return false;
	}

	const blindBoundaryIndex = actionOrder.findIndex((currentPlayer) =>
		currentPlayer.smallBlind || currentPlayer.bigBlind
	);
	if (blindBoundaryIndex === -1) {
		return playerIndex > aggressorIndex;
	}

	// In the preflop action ring, players between the aggressor and the blind-closing segment
	// retain position to the aggression. The blind segment itself and wrapped early positions do not.
	return isIndexInCircularForwardSegment(
		aggressorIndex,
		blindBoundaryIndex,
		playerIndex,
		actionOrder.length,
	);
}

function buildLegacyLogSpotContext({
	players,
	player,
	currentPhaseIndex,
	preflop,
	facingRaise,
	raisesThisRound,
	handContext,
}) {
	const liveOpponents = players.filter((currentPlayer) => currentPlayer !== player && !currentPlayer.folded);
	const actionOrder = getActionOrder(players, currentPhaseIndex);
	const actionableOrder = actionOrder.filter((currentPlayer) => !currentPlayer.allIn);
	const actingSlotIndex = actionableOrder.indexOf(player);
	const voluntaryOpponents = liveOpponents.filter((currentPlayer) => {
		const spotState = currentPlayer.spotState || {};
		return preflop ? spotState.enteredPreflop : spotState.voluntaryThisStreet || spotState.enteredPreflop;
	});
	const preflopRaiseCount = handContext?.preflopRaiseCount ?? 0;
	const raiseCountForSpot = facingRaise
		? (preflop ? preflopRaiseCount : raisesThisRound)
		: preflop
		? preflopRaiseCount
		: preflopRaiseCount;
	const limped = preflop && !facingRaise && preflopRaiseCount === 0 &&
		voluntaryOpponents.length > 0;

	return {
		unopened: !facingRaise && !limped,
		limped,
		singleRaised: raiseCountForSpot === 1,
		multiRaised: raiseCountForSpot > 1,
		headsUp: liveOpponents.length <= 1,
		facingAggression: facingRaise,
		actingSlotIndex: actingSlotIndex === -1 ? 0 : actingSlotIndex,
		actingSlotCount: Math.max(1, actionableOrder.length),
	};
}

function getLegacyPreflopLogScores(cardA, cardB, context = {}) {
	const profile = buildPreflopHandProfile(cardA, cardB);
	const flatScore = context.preflop
		? getContextualPreflopFlatScore(profile, context)
		: profile.flatScore;
	const defendScore = context.preflop
		? getContextualPreflopDefendScore(profile, context, flatScore)
		: flatScore;
	const openRaiseScore = context.preflop
		? getContextualPreflopOpenRaiseScore(profile, context)
		: profile.chenScore;
	const openLimpScore = context.preflop
		? getContextualPreflopOpenLimpScore(profile, context)
		: clampPreflopScore(
			(profile.chenScore + profile.playability) / 2,
		);

	return {
		handFamily: profile.handFamily,
		strengthScore: profile.chenScore,
		playabilityScore: profile.playability,
		dominationPenalty: profile.dominationRisk,
		smallPair: profile.smallPair,
		lowRank: profile.lowRank,
		openRaiseScore,
		openLimpScore,
		flatScore,
		defendScore,
		threeBetValueScore: profile.chenScore,
		threeBetBluffScore: profile.playability,
		pushScore: profile.chenScore,
	};
}

// Calculate how often a player folds
function buildAggregateRead(opponents) {
	if (opponents.length === 0) {
		return {
			vpip: 0,
			pfr: 0,
			foldRate: 0,
			agg: 1,
			showdownWin: 0.5,
			showdowns: 0,
			weight: 0,
		};
	}

	const count = opponents.length;
	const avgHands = opponents.reduce((sum, opponent) => sum + opponent.stats.hands, 0) /
		count;
	const weight = avgHands < MIN_HANDS_FOR_WEIGHT
		? 0
		: 1 - Math.exp(-(avgHands - MIN_HANDS_FOR_WEIGHT) / WEIGHT_GROWTH);

	return {
		vpip: opponents.reduce(
			(sum, opponent) => sum + (opponent.stats.vpip + 1) / (opponent.stats.hands + 2),
			0,
		) / count,
		pfr: opponents.reduce(
			(sum, opponent) => sum + (opponent.stats.pfr + 1) / (opponent.stats.hands + 2),
			0,
		) / count,
		foldRate: opponents.reduce(
			(sum, opponent) => sum + (opponent.stats.folds + 1) / (opponent.stats.hands + 2),
			0,
		) / count,
		agg: opponents.reduce(
			(sum, opponent) =>
				sum +
				(opponent.stats.aggressiveActs + 1) /
					(opponent.stats.calls + 1),
			0,
		) / count,
		showdownWin: opponents.reduce(
			(sum, opponent) =>
				sum +
				(opponent.stats.showdownsWon + 1) /
					(opponent.stats.showdowns + 2),
			0,
		) / count,
		showdowns: opponents.reduce(
			(sum, opponent) => sum + opponent.stats.showdowns,
			0,
		) / count,
		weight,
	};
}

function hasShowdownStrongRead(opponents) {
	return opponents.some((opponent) =>
		opponent.stats.showdowns >= 4 &&
		(opponent.stats.showdownsWon + 1) / (opponent.stats.showdowns + 2) >=
			0.55
	);
}

function getStreetLineCount(counts, street) {
	const value = counts?.[street];
	return typeof value === "number" ? value : 0;
}

function buildStreetLineRead(currentPhaseIndex, handContext) {
	const flopCheckedThrough = Boolean(handContext?.flopCheckedThrough);
	const turnCheckedThrough = Boolean(handContext?.turnCheckedThrough);
	const streetCheckCounts = handContext?.streetCheckCounts;
	const streetAggressiveActionCounts = handContext?.streetAggressiveActionCounts;
	const priorStreets = [];
	let currentStreet = null;

	if (currentPhaseIndex === 1) {
		currentStreet = "flop";
	} else if (currentPhaseIndex === 2) {
		priorStreets.push("flop");
		currentStreet = "turn";
	} else if (currentPhaseIndex === 3) {
		priorStreets.push("flop", "turn");
		currentStreet = "river";
	}

	const priorCheckedThroughCount = priorStreets.reduce((count, street) => {
		if (street === "flop" && flopCheckedThrough) {
			return count + 1;
		}
		if (street === "turn" && turnCheckedThrough) {
			return count + 1;
		}
		return count;
	}, 0);
	const priorAggressiveStreetCount = priorStreets.reduce(
		(count, street) =>
			getStreetLineCount(streetAggressiveActionCounts, street) > 0
				? count + 1
				: count,
		0,
	);

	return {
		flopCheckedThrough,
		turnCheckedThrough,
		priorCheckedThroughCount,
		priorAggressiveStreetCount,
		passiveLineDepth: priorCheckedThroughCount,
		doubleCheckedThrough: currentPhaseIndex === 3 &&
			flopCheckedThrough &&
			turnCheckedThrough,
		streetCheckCount: currentStreet
			? getStreetLineCount(streetCheckCounts, currentStreet)
			: 0,
		streetAggressiveActionCount: currentStreet
			? getStreetLineCount(streetAggressiveActionCounts, currentStreet)
			: 0,
	};
}

function buildSpotReadProfile(
	{ players, player, currentPhaseIndex, handContext },
) {
	const liveOpponents = players.filter((currentPlayer) => currentPlayer !== player && !currentPlayer.folded);
	const actionOrder = getActionOrder(players, currentPhaseIndex);
	const actionableOrder = actionOrder.filter((currentPlayer) => !currentPlayer.allIn);
	const actingSlotIndex = actionableOrder.indexOf(player);
	const playersBehind = actingSlotIndex === -1
		? []
		: actionableOrder.slice(actingSlotIndex + 1).filter((currentPlayer) => currentPlayer !== player);
	const streetAggressorSeatIndex = handContext?.streetAggressorSeatIndex;
	const streetAggressor = streetAggressorSeatIndex === null ||
			streetAggressorSeatIndex === undefined
		? null
		: players.find((currentPlayer) =>
			currentPlayer.seatIndex === streetAggressorSeatIndex &&
			!currentPlayer.folded
		) || null;
	const previousStreetCheckedThrough = currentPhaseIndex === 2
		? Boolean(handContext?.flopCheckedThrough)
		: currentPhaseIndex === 3
		? Boolean(handContext?.turnCheckedThrough)
		: false;
	const streetLineRead = buildStreetLineRead(currentPhaseIndex, handContext);

	return {
		liveOpponents,
		playersBehind,
		streetAggressor,
		previousStreetCheckedThrough,
		streetLineRead,
		live: buildAggregateRead(liveOpponents),
		behind: buildAggregateRead(playersBehind),
		aggressor: buildAggregateRead(streetAggressor ? [streetAggressor] : []),
		liveHasShowdownStrong: hasShowdownStrongRead(liveOpponents),
		behindHasShowdownStrong: hasShowdownStrongRead(playersBehind),
	};
}

/* -----------------------------
   Post-flop Board Evaluation
----------------------------- */

// Determine if the two hole cards form a pocket pair
function isPocketPair(hole) {
	return new Card(hole[0]).rank === new Card(hole[1]).rank;
}

// Analyze the structural postflop pair context without using showdown-only equity.
function analyzeHandContext(hole, board) {
	const hand = Hand.solve([...hole, ...board]);

	const boardRanks = board.map((c) => new Card(c).rank);
	const holeRanks = hole.map((c) => new Card(c).rank);
	const highestBoard = Math.max(...boardRanks);
	const uniqueBoardRanks = [...new Set(boardRanks)].sort((a, b) => b - a);
	const boardRankCounts = {};
	boardRanks.forEach((rank) => {
		boardRankCounts[rank] = (boardRankCounts[rank] || 0) + 1;
	});
	const pairedBoard = Object.values(boardRankCounts).some((count) => count >= 2);
	const pocketPair = isPocketPair(hole);

	let isTopPair = false;
	let isOverPair = false;
	let pairClass = "none";

	if (hand.name === "Pair") {
		const pairRank = hand.cards[0].rank;
		const hasPrivatePairRank = holeRanks.includes(pairRank);
		isTopPair = hasPrivatePairRank && pairRank === highestBoard;
		isOverPair = pocketPair && pairRank > highestBoard;

		if (!hasPrivatePairRank) {
			pairClass = "board-pair-only";
		} else if (isOverPair) {
			pairClass = "overpair";
		} else if (isTopPair) {
			pairClass = "top-pair";
		} else if (pocketPair) {
			pairClass = "pocket-underpair";
		} else if (pairRank === uniqueBoardRanks[1]) {
			pairClass = "second-pair";
		} else {
			pairClass = "weak-pair";
		}
	} else if (hand.name === "Two Pair" && pairedBoard) {
		const hasPrivatePair = pocketPair ||
			holeRanks.some((rank) => (boardRankCounts[rank] || 0) === 1);
		pairClass = hasPrivatePair ? "paired-board-private-pair" : "board-pair-only";
	}

	return { isTopPair, isOverPair, pairClass };
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
	const connectedness = maxConsecutive >= 3 ? Math.max(0, (maxConsecutive - 2) / (board.length - 2)) : 0;

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

function clampPreflopScore(score) {
	return Math.max(0, Math.min(10, score));
}

function buildPreflopHandProfile(cardA, cardB) {
	const rankA = cardA[0];
	const rankB = cardB[0];
	const rankIndexA = RANK_ORDER.indexOf(rankA);
	const rankIndexB = RANK_ORDER.indexOf(rankB);
	const suited = cardA[1] === cardB[1];
	const pair = rankA === rankB;
	const highRank = rankIndexA >= rankIndexB ? rankA : rankB;
	const lowRank = rankIndexA >= rankIndexB ? rankB : rankA;
	const highIndex = Math.max(rankIndexA, rankIndexB);
	const lowIndex = Math.min(rankIndexA, rankIndexB);
	const gap = highIndex - lowIndex - 1;
	const broadway = highIndex >= RANK_ORDER.indexOf("T") &&
		lowIndex >= RANK_ORDER.indexOf("T");
	const premiumOffsuitBroadway = !suited && broadway &&
		(
			(highRank === "A" && (lowRank === "K" || lowRank === "Q")) ||
			(highRank === "K" && lowRank === "Q")
		);
	const dominatedOffsuitBroadway = !suited && broadway && !premiumOffsuitBroadway;
	const weakAce = highRank === "A" && lowIndex <= RANK_ORDER.indexOf("9");
	const weakKing = highRank === "K" && lowIndex <= RANK_ORDER.indexOf("9");
	const smallPair = pair && highIndex <= RANK_ORDER.indexOf("6");
	const connector = gap <= 0;
	const wheelAxs = suited && highRank === "A" && lowIndex <= RANK_ORDER.indexOf("5");
	const chenScore = preflopHandScore(cardA, cardB);
	let playability = chenScore;
	let handFamily;

	if (pair) {
		handFamily = "pair";
	} else if (suited && broadway) {
		handFamily = "suitedBroadway";
	} else if (premiumOffsuitBroadway) {
		handFamily = "premiumOffsuitBroadway";
	} else if (dominatedOffsuitBroadway) {
		handFamily = "dominatedOffsuitBroadway";
	} else if (weakAce) {
		handFamily = suited ? "weakAxs" : "weakAxo";
	} else if (weakKing) {
		handFamily = suited ? "weakKxs" : "weakKxo";
	} else if (suited && connector) {
		handFamily = "suitedConnector";
	} else if (suited && gap <= 2) {
		handFamily = "suitedGapper";
	} else if (suited) {
		handFamily = "suitedJunk";
	} else {
		handFamily = "offsuitJunk";
	}

	if (suited) {
		playability += 0.6;
	}
	if (pair) {
		playability += 0.4;
	}
	if (connector) {
		playability += 0.5;
	} else if (gap === 1) {
		playability += 0.25;
	} else if (gap >= 3) {
		playability -= 0.5;
	}
	playability = clampPreflopScore(playability);

	let dominationRisk = 0;
	if (handFamily === "weakAxo") {
		dominationRisk = 0.45;
	} else if (handFamily === "weakKxo") {
		dominationRisk = 0.40;
	} else if (handFamily === "dominatedOffsuitBroadway") {
		dominationRisk = 0.35;
	} else if (handFamily === "weakAxs" || handFamily === "weakKxs") {
		dominationRisk = 0.15;
	} else if (!pair && (highRank === "A" || highRank === "K") && gap >= 2) {
		dominationRisk = 0.25;
	}

	let blockerValue = 0;
	if (highRank === "A") {
		blockerValue += 0.45;
	} else if (highRank === "K") {
		blockerValue += 0.25;
	}
	if (lowRank === "A") {
		blockerValue += 0.20;
	} else if (lowRank === "K") {
		blockerValue += 0.10;
	}
	if (premiumOffsuitBroadway || handFamily === "suitedBroadway") {
		blockerValue += 0.15;
	}
	blockerValue = Math.min(0.75, blockerValue);

	let flatScore = playability;
	if (smallPair) {
		flatScore += 0.35;
	}
	if (wheelAxs) {
		flatScore += 0.30;
	}
	if (handFamily === "suitedBroadway") {
		flatScore += 0.20;
	} else if (handFamily === "suitedConnector") {
		flatScore += 0.25;
	} else if (handFamily === "suitedGapper") {
		flatScore += 0.10;
	} else if (handFamily === "weakAxs") {
		flatScore += 0.15;
	} else if (handFamily === "premiumOffsuitBroadway") {
		flatScore += 0.10;
	} else if (handFamily === "dominatedOffsuitBroadway") {
		flatScore -= 0.55;
	} else if (handFamily === "weakAxo" || handFamily === "weakKxo") {
		flatScore -= 0.45;
	} else if (handFamily === "offsuitJunk") {
		flatScore -= 0.35;
	} else if (handFamily === "suitedJunk") {
		flatScore -= 0.10;
	}
	flatScore = clampPreflopScore(flatScore - dominationRisk * 0.8);

	return {
		chenScore,
		handFamily,
		legacyHandFamily: dominatedOffsuitBroadway || premiumOffsuitBroadway
			? "offsuitBroadway"
			: handFamily,
		suited,
		pair,
		gap,
		highRank,
		lowRank,
		playability,
		dominationRisk,
		blockerValue,
		smallPair,
		connector,
		wheelAxs,
		broadway,
		flatScore,
	};
}

function isPassivePreflopTargetFamily(handFamily) {
	return handFamily === "offsuitJunk" || handFamily === "weakAxo" ||
		handFamily === "weakKxo" ||
		handFamily === "dominatedOffsuitBroadway";
}

function isPlayableOpenLimpFamily(handFamily) {
	return handFamily === "pair" || handFamily === "suitedBroadway" ||
		handFamily === "weakAxs" || handFamily === "weakKxs" ||
		handFamily === "suitedConnector" || handFamily === "suitedGapper" ||
		handFamily === "suitedJunk";
}

function isWeakOffsuitAceLowKicker(handFamily, lowRank) {
	return handFamily === "weakAxo" &&
		RANK_ORDER.indexOf(lowRank) <= RANK_ORDER.indexOf("5");
}

function isWeakOffsuitAceKingLowKicker(handFamily, lowRank) {
	return (handFamily === "weakAxo" || handFamily === "weakKxo") &&
		RANK_ORDER.indexOf(lowRank) <= RANK_ORDER.indexOf("5");
}

function isProtectedUnopenedActionSpot({ player, spotContext, preflopSeatClass, activePlayerCount }) {
	return Boolean(player?.smallBlind && spotContext?.headsUp) ||
		(preflopSeatClass === "button" && activePlayerCount === 3);
}

function getContextualPreflopOpenRaiseScore(
	profile,
	{ player, spotContext, positionFactor, preflopSeatClass, activePlayerCount },
) {
	const context = spotContext || {};
	const protectedActionSpot = isProtectedUnopenedActionSpot({
		player,
		spotContext: context,
		preflopSeatClass,
		activePlayerCount,
	});
	const earlyMultiway = !context.headsUp && positionFactor < 0.45;
	let openRaiseScore = profile.chenScore;

	if (profile.pair) {
		openRaiseScore += profile.smallPair ? 0.20 : 0.45;
	} else if (profile.handFamily === "suitedBroadway") {
		openRaiseScore += 0.45;
	} else if (profile.handFamily === "premiumOffsuitBroadway") {
		openRaiseScore += 0.35;
	} else if (profile.handFamily === "weakAxs") {
		openRaiseScore += 0.35;
	} else if (profile.handFamily === "weakKxs") {
		openRaiseScore += 0.10;
	} else if (profile.handFamily === "suitedConnector") {
		openRaiseScore += 0.40;
	} else if (profile.handFamily === "suitedGapper") {
		openRaiseScore += 0.25;
	} else if (profile.handFamily === "dominatedOffsuitBroadway") {
		openRaiseScore -= 0.25;
	} else if (profile.handFamily === "weakAxo") {
		openRaiseScore -= 0.45;
	} else if (profile.handFamily === "weakKxo") {
		openRaiseScore -= 0.55;
	} else if (profile.handFamily === "offsuitJunk") {
		openRaiseScore -= 0.70;
	} else if (profile.handFamily === "suitedJunk") {
		openRaiseScore -= 0.20;
	}

	openRaiseScore += (positionFactor - 0.45) * 0.55;
	if (activePlayerCount <= 3) {
		openRaiseScore += 0.10;
	}
	if (preflopSeatClass === "button" && activePlayerCount === 3) {
		openRaiseScore += 0.15;
	}
	if (player?.smallBlind && context.headsUp) {
		openRaiseScore += 0.20;
	}
	if (earlyMultiway) {
		openRaiseScore -= isPassivePreflopTargetFamily(profile.handFamily) ? 0.25 : 0.10;
	}
	if (profile.handFamily === "offsuitJunk" && !protectedActionSpot) {
		openRaiseScore = Math.min(openRaiseScore, positionFactor >= 0.75 ? 5.45 : 5.05);
	}
	if (
		(profile.handFamily === "weakAxo" || profile.handFamily === "weakKxo") &&
		!protectedActionSpot
	) {
		openRaiseScore = Math.min(openRaiseScore, positionFactor >= 0.75 ? 5.75 : 5.35);
	}

	return clampPreflopScore(openRaiseScore);
}

function getContextualPreflopOpenLimpScore(
	profile,
	{ player, spotContext, positionFactor, preflopSeatClass, activePlayerCount },
) {
	const context = spotContext || {};
	const protectedActionSpot = isProtectedUnopenedActionSpot({
		player,
		spotContext: context,
		preflopSeatClass,
		activePlayerCount,
	});
	const earlyMultiway = !context.headsUp && positionFactor < 0.45;
	let openLimpScore = profile.flatScore;

	if (profile.pair) {
		openLimpScore += profile.smallPair ? 0.50 : 0.25;
	} else if (profile.handFamily === "suitedBroadway") {
		openLimpScore += 0.20;
	} else if (profile.handFamily === "weakAxs") {
		openLimpScore += 0.35;
	} else if (profile.handFamily === "weakKxs") {
		openLimpScore += 0.15;
	} else if (profile.handFamily === "suitedConnector") {
		openLimpScore += 0.45;
	} else if (profile.handFamily === "suitedGapper") {
		openLimpScore += 0.30;
	} else if (profile.handFamily === "suitedJunk") {
		openLimpScore += protectedActionSpot ? 0.15 : -0.15;
	} else if (profile.handFamily === "premiumOffsuitBroadway") {
		openLimpScore -= 0.10;
	} else if (profile.handFamily === "dominatedOffsuitBroadway") {
		openLimpScore -= 0.40;
	} else if (profile.handFamily === "weakAxo" || profile.handFamily === "weakKxo") {
		openLimpScore -= 0.60;
	} else if (profile.handFamily === "offsuitJunk") {
		openLimpScore -= 0.85;
	}

	if (player?.smallBlind && context.headsUp) {
		openLimpScore += 0.70;
	} else if (preflopSeatClass === "button" && activePlayerCount === 3) {
		openLimpScore += 0.10;
	} else if (positionFactor >= 0.75) {
		openLimpScore += 0.10;
	}
	openLimpScore += getOpenLimpRealizationAdjustment(profile, {
		player,
		spotContext: context,
	});
	if (earlyMultiway && isPassivePreflopTargetFamily(profile.handFamily)) {
		openLimpScore -= 0.45;
	}
	if (activePlayerCount >= 5 && positionFactor < 0.60) {
		openLimpScore -= isPassivePreflopTargetFamily(profile.handFamily) ? 0.20 : 0.05;
	}

	return clampPreflopScore(openLimpScore);
}

function getContextualPreflopFlatScore(
	profile,
	{ player, spotContext, potOdds, positionFactor, preflopRaiseCount },
) {
	const context = spotContext || {};
	const blindDefense = Boolean(player?.bigBlind || player?.smallBlind);
	const outOfPosition = context.actingSlotIndex < context.actingSlotCount - 1;
	const passiveReentry = Boolean(
		player?.spotState?.enteredPreflop && !player.spotState.aggressiveThisStreet,
	);
	const targetFamily = isPassivePreflopTargetFamily(profile.handFamily);
	const playableFamily = profile.pair || profile.handFamily === "suitedBroadway" ||
		profile.handFamily === "weakAxs" ||
		profile.handFamily === "suitedConnector" ||
		profile.handFamily === "suitedGapper";
	const goodPrice = potOdds <= 0.25;
	const expensivePrice = potOdds >= 0.36;
	let flatScore = profile.flatScore;

	if (targetFamily) {
		if (context.unopened && !context.headsUp) {
			flatScore -= outOfPosition ? 1.35 : 1.10;
		}
		if (context.unopened && context.headsUp) {
			flatScore -= blindDefense ? 0.70 : 0.45;
		}
		if (context.limped && !context.headsUp) {
			flatScore -= 1.25;
		}
		if (context.facingAggression) {
			flatScore -= 1.00;
		}
		if (passiveReentry && context.facingAggression) {
			flatScore -= 0.65;
		}
		if (!context.headsUp && context.facingAggression) {
			flatScore -= 0.35;
		}
		if (outOfPosition && !blindDefense) {
			flatScore -= 0.30;
		}
		if (context.multiRaised || preflopRaiseCount > 1) {
			flatScore -= 0.50;
		}
		if (expensivePrice) {
			flatScore -= 0.35;
		}
		if ((context.headsUp || blindDefense) && goodPrice) {
			flatScore += 0.15;
		}
		if (profile.handFamily === "offsuitJunk") {
			if (context.unopened && context.headsUp) {
				flatScore -= 0.65;
			}
			if (context.limped && !context.headsUp) {
				flatScore -= 0.25;
			}
			if (context.facingAggression) {
				flatScore -= context.headsUp && blindDefense && goodPrice
					? 0.25
					: 0.40;
			}
		}
	} else {
		if (context.facingAggression && !context.headsUp) {
			flatScore -= 0.05;
		}
		if (context.multiRaised || preflopRaiseCount > 1) {
			flatScore -= 0.10;
		}
		if (passiveReentry && context.facingAggression) {
			flatScore -= 0.08;
		}
		if (playableFamily && goodPrice) {
			flatScore += 0.10;
		}
	}
	if (positionFactor >= 0.75 && !context.facingAggression) {
		flatScore += 0.05;
	}

	return clampPreflopScore(flatScore);
}

function getContextualPreflopDefendScore(
	profile,
	{ player, spotContext, potOdds, positionFactor, preflopRaiseCount },
	baseFlatScore = profile.flatScore,
) {
	const context = spotContext || {};
	const blindDefense = Boolean(player?.bigBlind || player?.smallBlind);
	const outOfPosition = context.actingSlotIndex < context.actingSlotCount - 1;
	const passiveReentry = Boolean(
		player?.spotState?.enteredPreflop && !player.spotState.aggressiveThisStreet,
	);
	const targetFamily = isPassivePreflopTargetFamily(profile.handFamily);
	const goodPrice = potOdds <= 0.25;
	const expensivePrice = potOdds >= 0.36;
	let defendScore = baseFlatScore + profile.blockerValue * 0.35;

	if (context.headsUp) {
		defendScore += 0.35;
	}
	if (blindDefense) {
		defendScore += goodPrice ? 0.45 : 0.20;
	}
	if (positionFactor >= 0.75) {
		defendScore += 0.15;
	}
	if (!outOfPosition) {
		defendScore += 0.15;
	} else if (!blindDefense && !context.headsUp) {
		defendScore -= 0.15;
	}
	if (!context.headsUp && context.facingAggression) {
		defendScore -= 0.20;
	}
	if (context.multiRaised || preflopRaiseCount > 1) {
		defendScore -= 0.35;
	}
	if (targetFamily && passiveReentry && context.facingAggression) {
		defendScore -= blindDefense || context.headsUp ? 0.20 : 0.35;
	}
	if (profile.handFamily === "offsuitJunk" && context.facingAggression) {
		defendScore -= context.headsUp && blindDefense && goodPrice ? 0.15 : 0.25;
	}
	if (goodPrice) {
		defendScore += 0.20;
	} else if (expensivePrice) {
		defendScore -= 0.25;
	}
	if (
		goodPrice &&
		(profile.pair || profile.handFamily === "weakAxs" ||
			profile.handFamily === "suitedConnector" ||
			profile.handFamily === "suitedGapper")
	) {
		defendScore += 0.10;
	}
	defendScore += getDefendScoreRealizationAdjustment(profile, {
		player,
		spotContext: context,
	});

	if (
		profile.handFamily === "weakAxo" ||
		profile.handFamily === "weakKxo" ||
		profile.handFamily === "dominatedOffsuitBroadway"
	) {
		defendScore = Math.min(defendScore, blindDefense || context.headsUp ? 5.40 : 4.90);
	} else if (profile.handFamily === "offsuitJunk") {
		defendScore = Math.min(defendScore, blindDefense || context.headsUp ? 4.90 : 4.30);
	}

	return clampPreflopScore(defendScore);
}

function getOpenLimpRealizationAdjustment(profile, { player, spotContext }) {
	if (
		player?.smallBlind &&
		spotContext.headsUp &&
		isWeakOffsuitAceLowKicker(profile.handFamily, profile.lowRank)
	) {
		return -0.35;
	}

	return 0;
}

function getDefendScoreRealizationAdjustment(profile, { player, spotContext }) {
	if (player?.bigBlind && spotContext.facingAggression && profile.handFamily === "suitedJunk") {
		return -0.15;
	}

	return 0;
}

function getPassiveCallRealizationCap({
	preflopScores,
	spotContext,
}) {
	if (
		spotContext.facingAggression &&
		!spotContext.headsUp &&
		isWeakOffsuitAceKingLowKicker(preflopScores.handFamily, preflopScores.lowRank)
	) {
		return PASSIVE_CALL_WEAK_OFFSUIT_LOW_KICKER_MULTIWAY_RAISE_CAP;
	}

	return null;
}

function applyPassiveCallRealization(passiveCallScore, context) {
	const cap = getPassiveCallRealizationCap(context);

	if (cap === null) {
		return passiveCallScore;
	}

	return Math.min(passiveCallScore, cap);
}

function getPreflopPassiveCallScore({
	preflopScores,
	player,
	spotContext,
	potOdds,
	positionFactor,
}) {
	const shortHandedUnopened = spotContext.unopened && spotContext.actingSlotCount <= 3;
	const pricedLateDefense = potOdds <= 0.22 && positionFactor >= 0.5;
	const shouldUseDefendScore = player.bigBlind || player.smallBlind ||
		spotContext.headsUp || shortHandedUnopened || pricedLateDefense;
	const passiveCallScore = shouldUseDefendScore ? preflopScores.defendScore : preflopScores.flatScore;

	return applyPassiveCallRealization(passiveCallScore, {
		preflopScores,
		spotContext,
	});
}

function getUnopenedPreflopRaiseThreshold({
	baseRaiseThreshold,
	player,
	spotContext,
	positionFactor,
	preflopSeatClass,
	activePlayerCount,
}) {
	let threshold = baseRaiseThreshold + 0.90;

	if (activePlayerCount <= 3) {
		threshold -= 0.15;
	}
	if (preflopSeatClass === "button" && activePlayerCount === 3) {
		threshold -= 0.15;
	}
	if (player.smallBlind && spotContext.headsUp) {
		threshold -= 0.30;
	}
	if (!spotContext.headsUp && positionFactor < 0.75) {
		threshold += 0.20;
	}
	if (!spotContext.headsUp && positionFactor < 0.45) {
		threshold += 0.15;
	}

	return Math.max(4.40, Math.min(8.50, threshold));
}

function getUnopenedPreflopLimpThreshold({
	player,
	spotContext,
	positionFactor,
	preflopSeatClass,
	activePlayerCount,
}) {
	if (player.smallBlind && spotContext.headsUp) {
		return 0.35;
	}
	if (preflopSeatClass === "button" && activePlayerCount === 3) {
		return 0.41;
	}

	let threshold = positionFactor >= 0.75 ? 0.41 : 0.45;
	if (!spotContext.headsUp && positionFactor < 0.45) {
		threshold += 0.04;
	}
	if (activePlayerCount >= 5 && positionFactor < 0.60) {
		threshold += 0.03;
	}

	return Math.max(0.38, Math.min(0.54, threshold));
}

function canOpenLimpPreflop({
	preflopScores,
	player,
	spotContext,
	positionFactor,
	preflopSeatClass,
	activePlayerCount,
}) {
	const protectedActionSpot = isProtectedUnopenedActionSpot({
		player,
		spotContext,
		preflopSeatClass,
		activePlayerCount,
	});
	const handFamily = preflopScores.handFamily;

	if (isOpenLimpBlockedByRealization({ preflopScores, player, spotContext })) {
		return false;
	}
	if (isPlayableOpenLimpFamily(handFamily)) {
		return true;
	}
	if (handFamily === "premiumOffsuitBroadway") {
		return protectedActionSpot || positionFactor >= 0.75;
	}
	if (
		handFamily === "dominatedOffsuitBroadway" ||
		handFamily === "weakAxo" ||
		handFamily === "weakKxo"
	) {
		return protectedActionSpot || positionFactor >= 0.80;
	}
	if (handFamily === "offsuitJunk") {
		return protectedActionSpot && preflopScores.openLimpScore >= 4.40;
	}

	return false;
}

function isOpenLimpBlockedByRealization({
	preflopScores,
	player,
	spotContext,
}) {
	return preflopScores.smallPair === true && !(player.smallBlind && spotContext.headsUp);
}

function isPremiumPreflopHand(cardA, cardB) {
	return preflopHandScore(cardA, cardB) > PREMIUM_PREFLOP_SCORE;
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
	const seatIdx = active.indexOf(player);
	const firstToAct = currentPhaseIndex === 0
		? findNextActivePlayer(players, players.findIndex((p) => p.bigBlind))
		: findNextActivePlayer(players, players.findIndex((p) => p.dealer));
	const refIdx = active.indexOf(firstToAct);
	const pos = (seatIdx - refIdx + active.length) % active.length;
	return active.length > 1 ? pos / (active.length - 1) : 0;
}

function evaluateHandStrength(player, communityCards, preflop) {
	if (preflop) {
		return {
			strength: preflopHandScore(
				player.holeCards[0],
				player.holeCards[1],
			),
			solvedHand: null,
		};
	}

	const cards = [...player.holeCards, ...communityCards];
	const solvedHand = Hand.solve(cards);
	// pokersolver: rank is a category score (1..9, higher is stronger) + small tiebreaker
	return {
		strength: solvedHand.rank + handTiebreaker(solvedHand),
		solvedHand,
	};
}

function computePostflopContext(player, communityCards, preflop) {
	const context = {
		topPair: false,
		overPair: false,
		pairClass: "none",
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
	context.pairClass = ctxInfo.pairClass;

	if (communityCards.length < 5) {
		const draws = analyzeDrawPotential(hole, communityCards);
		context.drawChance = draws.flushDraw || draws.straightDraw;
		context.drawOuts = draws.outs;
		if (context.drawOuts > 0) {
			const drawFactor = communityCards.length === 3 ? 0.04 : communityCards.length === 4 ? 0.02 : 0;
			context.drawEquity = Math.min(1, context.drawOuts * drawFactor);
		}
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
	const investedRatio = projectedInvested /
		Math.max(1, projectedInvested + player.chips);
	const callCostRatio = needToCall / Math.max(1, player.chips);
	const sprPressure = Math.max(
		0,
		Math.min(1, (spr - COMMIT_SPR_MIN) / (COMMIT_SPR_MAX - COMMIT_SPR_MIN)),
	);
	const investPressure = Math.max(
		0,
		Math.min(
			1,
			(investedRatio - COMMIT_INVEST_START) /
				(COMMIT_INVEST_END - COMMIT_INVEST_START),
		),
	);
	const callPressure = Math.max(
		0,
		Math.min(1, callCostRatio / COMMIT_CALL_RATIO_REF),
	);
	const streetPressure = Math.min(1, remainingStreets / 2);
	const commitmentPressure = (investPressure * 0.6 + callPressure * 0.4) *
		sprPressure * streetPressure;
	const commitmentPenalty = commitmentPressure * COMMITMENT_PENALTY_MAX;

	return { commitmentPressure, commitmentPenalty };
}

function computeEliminationRisk(
	stackRatio,
	riskFull = ELIMINATION_RISK_FULL,
	penaltyMax = ELIMINATION_PENALTY_MAX,
) {
	const risk = Math.max(
		0,
		Math.min(
			1,
			(stackRatio - ELIMINATION_RISK_START) /
				(riskFull - ELIMINATION_RISK_START),
		),
	);
	const eliminationPenalty = risk * penaltyMax;

	return { eliminationRisk: risk, eliminationPenalty };
}

function shouldBlockRiverLowEdgeCall({
	decision,
	needsToCall,
	communityCards,
	hasPrivateRaiseEdge,
	isMarginalEdgeHand,
	activeOpponents,
	raiseLevel,
	rawHandRank,
	publicHandRank,
}) {
	if (
		communityCards.length !== 5 || !needsToCall ||
		decision.action !== "call"
	) {
		return false;
	}

	const protectedBoardPlay = rawHandRank === publicHandRank &&
		publicHandRank >= RIVER_SPLIT_PROTECTED_PUBLIC_RANK_MIN;

	if (protectedBoardPlay) {
		return false;
	}
	if (isMarginalEdgeHand && (activeOpponents > 1 || raiseLevel >= 2)) {
		return true;
	}
	if (!hasPrivateRaiseEdge && (activeOpponents > 1 || raiseLevel >= 2)) {
		return true;
	}
	return false;
}

function getCheckRaiseStreetName(streetIndex) {
	if (streetIndex === 1) {
		return "flop";
	}
	if (streetIndex === 2) {
		return "turn";
	}
	if (streetIndex === 3) {
		return "river";
	}
	return "preflop";
}

function getCheckRaiseTextureBlockReason(rawHandRank, textureRisk) {
	if (rawHandRank >= 5) {
		return textureRisk <= CHECK_RAISE_STRAIGHT_PLUS_MAX_TEXTURE
			? null
			: "texture_straight_plus";
	}
	if (rawHandRank >= 3) {
		return textureRisk <= CHECK_RAISE_TWO_PAIR_TRIPS_MAX_TEXTURE
			? null
			: "texture_two_pair_trips";
	}
	return "below_two_pair";
}

function getCheckRaiseStreetBlockReason(streetIndex, handContext) {
	if (streetIndex === 1) {
		return null;
	}
	if (streetIndex === 2) {
		return handContext?.flopCheckedThrough ? "flop_checked_through" : null;
	}
	if (streetIndex === 3) {
		return handContext?.turnCheckedThrough ? "turn_checked_through" : null;
	}
	return "not_postflop";
}

function getCheckRaiseQualityBlockReason({
	preflop,
	streetIndex,
	handContext,
	currentBet,
	needsToCall,
	isLastToAct,
	decision,
	sizingIntent,
	isBluff,
	isStab,
	noBetClass,
	liftType,
	edge,
	rawHandRank,
	textureRisk,
	activeOpponents,
}) {
	if (preflop || streetIndex === 0) {
		return "not_postflop";
	}
	if (currentBet !== 0 || needsToCall) {
		return "street_already_bet";
	}
	if ((handContext?.streetAggressorSeatIndex ?? null) !== null) {
		return "street_already_bet";
	}
	if (isLastToAct) {
		return "last_to_act";
	}
	if (decision.action !== "raise" || sizingIntent !== "value") {
		return "not_value_raise";
	}
	if (isBluff) {
		return "bluff";
	}
	if (isStab) {
		return "stab";
	}
	if (noBetClass !== "auto-value") {
		return "not_auto_value";
	}
	if (liftType !== "structural") {
		return "not_structural_lift";
	}
	if (edge < 2) {
		return "edge_lt_2";
	}
	if (activeOpponents > 1 && rawHandRank < 5) {
		return "multiway_below_straight";
	}

	return getCheckRaiseStreetBlockReason(streetIndex, handContext) ??
		getCheckRaiseTextureBlockReason(rawHandRank, textureRisk);
}

function getPassiveValueCheckBlockReason({
	preflop,
	streetIndex,
	handContext,
	currentBet,
	needsToCall,
	isLastToAct,
	decision,
	sizingIntent,
	isBluff,
	isStab,
	noBetClass,
	rawHandRank,
	hasPrivateMadeHand,
	textureRisk,
	checkRaiseBlockReason,
}) {
	if (checkRaiseBlockReason === null) {
		return "reserved_for_check_raise";
	}
	if (preflop || streetIndex === 0) {
		return "not_postflop";
	}
	if (currentBet !== 0 || needsToCall) {
		return "street_already_bet";
	}
	if ((handContext?.streetAggressorSeatIndex ?? null) !== null) {
		return "street_already_bet";
	}
	if (isLastToAct) {
		return "last_to_act";
	}
	if (decision.action !== "raise" || sizingIntent !== "value") {
		return "not_value_raise";
	}
	if (isBluff) {
		return "bluff";
	}
	if (isStab) {
		return "stab";
	}
	if (noBetClass !== "auto-value") {
		return "not_auto_value";
	}
	if (rawHandRank <= 1) {
		return "pure_draw";
	}
	if (!hasPrivateMadeHand) {
		return "no_private_made_hand";
	}
	if (textureRisk >= PASSIVE_VALUE_CHECK_MAX_TEXTURE) {
		return "wet_board";
	}
	return getCheckRaiseStreetBlockReason(streetIndex, handContext);
}

function hasOpponentWhoCanCallRaise(players, player, currentBet) {
	return players.some((currentPlayer) => {
		if (
			currentPlayer === player ||
			currentPlayer.folded ||
			currentPlayer.allIn ||
			currentPlayer.chips <= 0
		) {
			return false;
		}

		const amountToMatchCurrentBet = Math.max(0, currentBet - currentPlayer.roundBet);
		return currentPlayer.chips > amountToMatchCurrentBet;
	});
}

function getRequiredFoldRate(needToCall, potBefore) {
	if (!(needToCall > 0) || !(potBefore > 0)) {
		return 0;
	}
	return Math.max(0, Math.min(1, needToCall / potBefore));
}

function getPostflopPriceQualityShift({
	baseShift,
	isDeadHand,
	isWeakDraw,
	pairClass,
	liftType,
	edge,
	drawOuts,
	topPair,
	overPair,
	spotContext,
	raiseLevel,
	streetIndex,
	potOdds,
}) {
	if (baseShift === 0) {
		return 0;
	}

	const turnOrRiverPressure = streetIndex >= 2 &&
		(raiseLevel > 0 || !spotContext.headsUp || potOdds >= 0.18);
	let cheapBetFactor = 0.25;
	let expensiveBetFactor = 1.00;

	if (isDeadHand) {
		cheapBetFactor = 0.05;
		expensiveBetFactor = 1.20;
	} else if (
		pairClass === "board-pair-only" &&
		turnOrRiverPressure
	) {
		cheapBetFactor = 0.10;
		expensiveBetFactor = 1.15;
	} else if (
		liftType === "kicker" &&
		turnOrRiverPressure
	) {
		cheapBetFactor = 0.15;
		expensiveBetFactor = 1.10;
	} else if (isWeakDraw) {
		cheapBetFactor = 0.25;
		expensiveBetFactor = 1.10;
	} else if (
		drawOuts >= 8 ||
		topPair ||
		overPair ||
		pairClass === "second-pair" ||
		(liftType === "structural" && edge >= 1)
	) {
		cheapBetFactor = 0.80;
		expensiveBetFactor = 0.90;
	} else if (
		(pairClass === "weak-pair" && spotContext.headsUp && raiseLevel <= 1) ||
		(liftType === "structural" && edge > 0 && edge < 1)
	) {
		cheapBetFactor = 0.45;
		expensiveBetFactor = 1.00;
	}

	return baseShift < 0
		? baseShift * cheapBetFactor
		: baseShift * expensiveBetFactor;
}

function getFlopEquityCallRelief({
	drawOuts,
	isDeadHand,
	isWeakDraw,
	hasPrivateMadeHand,
	pairClass,
	liftType,
	edge,
	topPair,
	overPair,
	spotContext,
	isLastToAct,
	raiseLevel,
	potOdds,
	marginToCall,
}) {
	const priceFactor = potOdds <= 0.25
		? 1
		: potOdds <= 0.35
		? 0.65
		: potOdds <= 0.45
		? 0.35
		: 0;
	if (priceFactor === 0) {
		return 0;
	}
	if (!(marginToCall > 0)) {
		return 0;
	}

	const pressureFactor = raiseLevel === 0 ? 1 : 0.5;
	const nearThresholdMargin = marginToCall <= 0.045;
	if (drawOuts >= 8) {
		const strongDrawPressureFactor = raiseLevel === 1 ? 0.9 : pressureFactor;
		return 0.065 * priceFactor * strongDrawPressureFactor;
	}
	if (isDeadHand || isWeakDraw || pairClass === "board-pair-only") {
		return 0;
	}
	if (
		(topPair || overPair) &&
		nearThresholdMargin
	) {
		return 0.04 * priceFactor * pressureFactor;
	}
	if (
		pairClass === "second-pair" &&
		hasPrivateMadeHand &&
		nearThresholdMargin
	) {
		return 0.036 * priceFactor * pressureFactor;
	}
	if (
		liftType === "structural" &&
		edge > 0 &&
		edge < 1 &&
		hasPrivateMadeHand &&
		pairClass !== "weak-pair" &&
		pairClass !== "pocket-underpair" &&
		pairClass !== "board-pair-only" &&
		(spotContext.headsUp || isLastToAct) &&
		nearThresholdMargin
	) {
		const structuralPressureFactor = raiseLevel === 1 ? 0.75 : pressureFactor;
		return 0.035 * priceFactor * structuralPressureFactor;
	}
	return 0;
}

function getWeakPrivateShowdownPressurePenalty({
	needsToCall,
	streetIndex,
	raiseLevel,
	pairClass,
	liftType,
	edge,
	drawOuts,
	topPair,
	overPair,
	potOdds,
}) {
	if (
		!needsToCall ||
		streetIndex < 2 ||
		raiseLevel < 1
	) {
		return 0;
	}
	if (
		drawOuts >= 8 ||
		topPair ||
		overPair ||
		pairClass === "second-pair" ||
		pairClass === "paired-board-private-pair" ||
		liftType === "structural" ||
		edge >= 0.20
	) {
		return 0;
	}
	if (pairClass !== "board-pair-only" && liftType !== "kicker") {
		return 0;
	}

	const streetPenalty = streetIndex === 3 ? 0.025 : 0.02;
	const pricePenalty = potOdds >= 0.25 ? 0.015 : 0;

	return streetPenalty + pricePenalty;
}

function classifyNoBetOpportunity({
	rawHandRank,
	drawOuts,
	hasPrivateMadeHand,
	topPair,
	overPair,
	pairClass,
	textureRisk,
	liftType,
	edge,
	headsUp,
	isLastToAct,
	previousStreetCheckedThrough,
	isMarginalMadeHand,
	communityCardsLength,
}) {
	const isRiver = communityCardsLength === 5;
	const isPair = rawHandRank === 2;
	const premiumPairContext = pairClass === "overpair" ||
		pairClass === "top-pair";
	const mediumPairContext = pairClass === "second-pair";
	const weakPairContext = pairClass === "weak-pair" ||
		pairClass === "pocket-underpair";
	const boardPairOnly = pairClass === "board-pair-only";
	const pairedBoardPrivatePair = pairClass === "paired-board-private-pair";
	const checkedToContext = isLastToAct || previousStreetCheckedThrough;
	let pairAutoValue = false;

	if (isPair && hasPrivateMadeHand && !boardPairOnly) {
		if (headsUp) {
			pairAutoValue = premiumPairContext ||
				(mediumPairContext && checkedToContext && edge >= 0.95) ||
				edge >= 1.20 ||
				(weakPairContext && checkedToContext && edge >= 1.05);
		} else if (isLastToAct) {
			pairAutoValue = (premiumPairContext && edge >= 0.70) ||
				(mediumPairContext && edge >= 1.05) ||
				edge >= 1.35 ||
				(previousStreetCheckedThrough && edge >= 1.15);
		} else if (previousStreetCheckedThrough) {
			pairAutoValue = (premiumPairContext && edge >= 1.00) ||
				(mediumPairContext && edge >= 1.45) ||
				edge >= 1.65;
		} else {
			pairAutoValue = (premiumPairContext && edge >= 1.25) ||
				edge >= 1.85;
		}
	}

	const strongDrawAutoValue = drawOuts >= 8 &&
		(headsUp || isLastToAct || previousStreetCheckedThrough ||
			rawHandRank >= 3);
	const structuralEdgeFloor = isRiver ? 0.65 : 0.12;
	const contextualStructuralAutoValue = !isPair &&
		liftType === "structural" &&
		(
			((topPair || overPair) &&
				edge >= (isRiver ? 0.85 : structuralEdgeFloor) &&
				(headsUp || isLastToAct || previousStreetCheckedThrough ||
					textureRisk >= 0.45)) ||
			(edge >= structuralEdgeFloor &&
				(headsUp || isLastToAct || previousStreetCheckedThrough))
		);
	const pairedBoardPrivatePairAutoValue = pairedBoardPrivatePair &&
		(
			(headsUp && edge >= 1.00) ||
			(isLastToAct && previousStreetCheckedThrough && edge >= 0.95) ||
			(!isRiver && isLastToAct && edge >= 0.85) ||
			edge >= 1.35
		);
	const madeHandAutoValue = !boardPairOnly &&
		(
			rawHandRank >= 4 ||
			(rawHandRank === 3 && !pairedBoardPrivatePair &&
				(!isRiver || edge >= 0.35 || isLastToAct ||
					previousStreetCheckedThrough)) ||
			pairedBoardPrivatePairAutoValue
		);

	if (
		madeHandAutoValue ||
		pairAutoValue ||
		strongDrawAutoValue ||
		contextualStructuralAutoValue
	) {
		return "auto-value";
	}
	if (boardPairOnly) {
		return "probe";
	}
	if (isPair && hasPrivateMadeHand) {
		return "marginal-made";
	}
	if (pairedBoardPrivatePair) {
		return "marginal-made";
	}
	if (rawHandRank <= 1 || (liftType === "none" && !hasPrivateMadeHand)) {
		return "probe";
	}
	if (isMarginalMadeHand) {
		return "marginal-made";
	}
	return "probe";
}

function hasAggroBehind(playersBehind, behindRead, behindHasShowdownStrong) {
	return playersBehind.length > 0 &&
		(behindRead.agg > 1.2 || behindHasShowdownStrong);
}

function getNoBetRaiseBlockReason({
	noBetClass,
	communityCards,
	spotContext,
	isLastToAct,
	playersBehind,
	behindRead,
	behindHasShowdownStrong,
	previousStreetCheckedThrough,
	drawEquity,
	liveRead,
	edge,
	liftType,
	topPair,
	overPair,
	pairClass,
}) {
	if (noBetClass === "auto-value") {
		return null;
	}

	const aggroBehind = hasAggroBehind(
		playersBehind,
		behindRead,
		behindHasShowdownStrong,
	);

	if (noBetClass === "probe") {
		if (communityCards.length === 5) {
			return "river";
		}
		if (!spotContext.headsUp && !isLastToAct) {
			return "mw_not_last";
		}
		if (aggroBehind) {
			return "aggro_behind";
		}
		if (!isLastToAct && !previousStreetCheckedThrough) {
			return "oop_no_checked_through";
		}

		const hasPositiveReason = drawEquity > 0 ||
			liveRead.foldRate >= 0.33 ||
			previousStreetCheckedThrough ||
			(spotContext.headsUp && isLastToAct);

		return hasPositiveReason ? null : "thin_context";
	}

	if (!spotContext.headsUp && !isLastToAct) {
		return "mw_not_last";
	}

	if (pairClass === "board-pair-only") {
		return "board_pair_only";
	}

	if (communityCards.length === 5) {
		if (pairClass === "paired-board-private-pair") {
			const canRaisePairedBoard = liftType === "structural" &&
				isLastToAct &&
				!aggroBehind &&
				edge >= 1.05 &&
				(spotContext.headsUp || previousStreetCheckedThrough);
			return canRaisePairedBoard ? null : "paired_board_context";
		}
		const canRaiseRiver = liftType === "structural" &&
			isLastToAct &&
			!aggroBehind &&
			(
				((topPair || overPair) && edge >= 0.85) ||
				(edge >= 0.65 &&
					(spotContext.headsUp || previousStreetCheckedThrough)));
		return canRaiseRiver ? null : "river";
	}

	if (liftType === "kicker") {
		const canRaiseKicker = spotContext.headsUp &&
			!aggroBehind &&
			(isLastToAct || previousStreetCheckedThrough);
		return canRaiseKicker ? null : "kicker_context";
	}

	if (liftType === "structural") {
		if (
			pairClass === "weak-pair" ||
			pairClass === "pocket-underpair"
		) {
			const canRaiseWeakPair = spotContext.headsUp &&
				isLastToAct &&
				!aggroBehind &&
				edge >= 0.85;
			return canRaiseWeakPair ? null : "weak_pair_context";
		}
		if (pairClass === "paired-board-private-pair") {
			const canRaisePairedBoard = isLastToAct &&
				!aggroBehind &&
				(
					edge >= 1.05 ||
					(previousStreetCheckedThrough && edge >= 0.85)
				);
			return canRaisePairedBoard ? null : "paired_board_context";
		}
		const hasGoodContext = (spotContext.headsUp &&
				((isLastToAct && edge >= 0.35) ||
					(previousStreetCheckedThrough && edge >= 0.45) ||
					edge >= 0.65)) ||
			(isLastToAct && (previousStreetCheckedThrough || edge >= 0.65));
		return hasGoodContext ? null : "light_structural_context";
	}

	const hasContext = spotContext.headsUp || isLastToAct ||
		previousStreetCheckedThrough;
	const hasPositiveReason = drawEquity > 0 ||
		previousStreetCheckedThrough ||
		(spotContext.headsUp && isLastToAct) ||
		edge >= 0.08;

	if (aggroBehind || !hasContext || !hasPositiveReason) {
		return "thin_context";
	}

	return null;
}

function decideHarringtonAction({
	mZone,
	facingRaise,
	needsToCall,
	strengthRatio,
	deadPushThreshold,
	redPushThreshold,
	orangePushThreshold,
	yellowRaiseThreshold,
	yellowShoveThreshold,
	redCallThreshold,
	orangeCallThreshold,
	yellowCallThreshold,
	canShove,
	canRaise,
	needToCall,
	playerChips,
	yellowRaiseSize,
}) {
	let decision = null;

	if (mZone === "dead") {
		if (facingRaise && needsToCall) {
			if (strengthRatio >= deadPushThreshold) {
				decision = canShove ? { action: "raise", amount: playerChips } : {
					action: "call",
					amount: Math.min(playerChips, needToCall),
				};
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
				decision = {
					action: "call",
					amount: Math.min(playerChips, needToCall),
				};
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
				decision = {
					action: "call",
					amount: Math.min(playerChips, needToCall),
				};
			} else {
				decision = { action: "fold" };
			}
		} else if (canShove && strengthRatio >= orangePushThreshold) {
			decision = { action: "raise", amount: playerChips };
		} else {
			decision = needsToCall ? { action: "fold" } : { action: "check" };
		}
	} else if (mZone === "yellow") {
		if (facingRaise && needsToCall) {
			if (canShove && strengthRatio >= yellowShoveThreshold) {
				decision = { action: "raise", amount: playerChips };
			} else if (strengthRatio >= yellowCallThreshold) {
				decision = {
					action: "call",
					amount: Math.min(playerChips, needToCall),
				};
			} else {
				decision = { action: "fold" };
			}
		} else if (canShove && strengthRatio >= yellowShoveThreshold) {
			decision = { action: "raise", amount: playerChips };
		} else if (canRaise && strengthRatio >= yellowRaiseThreshold) {
			decision = { action: "raise", amount: yellowRaiseSize() };
		} else {
			decision = needsToCall ? { action: "fold" } : { action: "check" };
		}
	}

	return decision;
}

/* ===========================
   Decision Engine: Bot Action Selection
========================== */
export function chooseBotAction(player, gameState) {
	const {
		blindLevel: blindLevelIndex,
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
	const actionState = getPlayerActionState(gameState, player);

	// Calculate pot odds to assess call viability
	const potOdds = needToCall / (pot + needToCall);
	// Compute risk as fraction of stack required
	const rawStackRatio = needToCall / player.chips;
	const stackRatio = Math.min(1, rawStackRatio);
	// Stack-to-pot ratio used for shove decisions
	const spr = player.chips / Math.max(1, pot + needToCall);
	const blindLevel = { small: smallBlind, big: bigBlind };
	const mRatio = player.chips / (smallBlind + bigBlind);
	const facingRaise = currentPhaseIndex === 0 ? currentBet > blindLevel.big : currentBet > 0;

	// Compute positional factor dynamically based on active players
	const active = players.filter((p) => !p.folded);
	const opponents = players.filter((p) => !p.folded && p !== player);
	const activeOpponents = opponents.length;
	const opponentStacks = opponents.map((p) => p.chips);
	const maxOpponentStack = opponentStacks.length > 0 ? Math.max(...opponentStacks) : 0;
	const effectiveStack = opponentStacks.length > 0 ? Math.min(player.chips, maxOpponentStack) : player.chips;
	const amChipleader = opponentStacks.length > 0 ? player.chips > maxOpponentStack : true;
	const shortstackRelative = opponentStacks.length > 0 &&
		effectiveStack === player.chips &&
		player.chips < maxOpponentStack * SHORTSTACK_RELATIVE;
	const botLine = player.botLine || null;
	const nonValueAggressionMade = botLine ? botLine.nonValueAggressionMade : false;

	const positionFactor = computePositionFactor(
		players,
		active,
		player,
		currentPhaseIndex,
	);

	// Determine if we are in pre-flop stage
	const preflop = communityCards.length === 0;
	const preflopRaiseCount = handContext?.preflopRaiseCount ?? 0;
	const spotContext = buildLegacyLogSpotContext({
		players,
		player,
		currentPhaseIndex,
		preflop,
		facingRaise,
		raisesThisRound,
		handContext,
	});
	const spotReadProfile = buildSpotReadProfile({
		players,
		player,
		currentPhaseIndex,
		handContext,
	});
	const tableReadProfile = buildAggregateRead(
		players.filter((currentPlayer) => currentPlayer !== player),
	);
	const preflopSeatClass = preflop ? getPreflopSeatClass(players, player) : null;
	const preflopScores = getLegacyPreflopLogScores(
		player.holeCards[0],
		player.holeCards[1],
		{
			preflop,
			player,
			spotContext,
			potOdds,
			positionFactor,
			preflopRaiseCount,
			preflopSeatClass,
			activePlayerCount: active.length,
		},
	);
	const hasCallableRaiseOpponent = hasOpponentWhoCanCallRaise(players, player, currentBet);
	// A raise must create action for at least one opponent; otherwise the bot should only call/check.
	const canRaise = raisesThisRound < MAX_RAISES_PER_ROUND &&
		player.chips > needToCall &&
		player.chips > blindLevel.big &&
		hasCallableRaiseOpponent;
	const canShove = raisesThisRound < MAX_RAISES_PER_ROUND &&
		player.chips > needToCall &&
		hasCallableRaiseOpponent;
	const liveOpponents = spotReadProfile.liveOpponents;
	const activeSizingOpponents = liveOpponents.filter((currentPlayer) =>
		!currentPlayer.allIn && currentPlayer.chips > 0
	);
	const activeOpponentStacks = activeSizingOpponents.map((currentPlayer) => currentPlayer.chips);
	const playersBehind = spotReadProfile.playersBehind;
	const previousStreetCheckedThrough = spotReadProfile.previousStreetCheckedThrough;
	const streetLineRead = spotReadProfile.streetLineRead;
	const liveRead = spotReadProfile.live;
	const behindRead = spotReadProfile.behind;
	const aggressorRead = spotReadProfile.aggressor;
	const liveHasShowdownStrong = spotReadProfile.liveHasShowdownStrong;
	const behindHasShowdownStrong = spotReadProfile.behindHasShowdownStrong;
	const isLastToAct = spotContext.actingSlotIndex === spotContext.actingSlotCount - 1;

	// Evaluate hand strength
	const { strength, solvedHand } = evaluateHandStrength(
		player,
		communityCards,
		preflop,
	);
	const publicHand = preflop ? null : Hand.solve(communityCards);
	const publicHandRank = publicHand?.rank ?? 0;
	const publicHandName = publicHand?.name ?? "-";
	const publicScore = preflop ? 0 : getSolvedHandScore(publicHand);
	const rawHandRank = solvedHand?.rank ?? 0;
	const rawScore = preflop ? strength : getSolvedHandScore(solvedHand);
	const rawHandName = solvedHand?.name ?? "-";
	const edge = preflop ? 0 : rawScore - publicScore;
	const hasPrivateContribution = !preflop && edge > 0;
	const hasPrivateRaiseEdge = preflop || edge >= 0.05;
	const canUsePureBluffLine = preflop || rawHandRank <= 1;
	const isMadeHand = !preflop && rawHandRank >= 2;
	const liftType = preflop
		? "none"
		: rawHandRank > publicHandRank
		? "structural"
		: edge >= 0.05
		? "meaningful"
		: edge > 0 && isMadeHand
		? "kicker"
		: "none";
	/* Private edge now drives contribution, raise gating, and debug lift classification.

     cards in tie best-5 even when they don't improve (Board AA KK Q, Hole Q♦ 2♣
     → solver picks Q♦, but delta = 0).
   - Flop/Turn: No reliable board-vs-full test (board < 5 cards). Uses-hole-cards
     is a conservative gate to prevent obvious plays-the-board cases.
	*/

	// Post-flop board context
	const postflopContext = computePostflopContext(
		player,
		communityCards,
		preflop,
	);
	const topPair = postflopContext.topPair;
	const overPair = postflopContext.overPair;
	const pairClass = postflopContext.pairClass;
	const drawChance = postflopContext.drawChance;
	const drawOuts = postflopContext.drawOuts;
	const drawEquity = postflopContext.drawEquity;
	const textureRisk = postflopContext.textureRisk;
	const hasPrivateMadeHand = hasPrivateContribution && isMadeHand;
	const isDraw = drawOuts >= 8;
	const isWeakDraw = drawOuts > 0 && drawOuts < 8;
	const isDeadHand = !preflop && !isMadeHand && !isDraw && !isWeakDraw;
	const isMarginalMadeHand = !preflop && isMadeHand &&
		edge >= 0.20 && edge < 0.80 &&
		rawHandRank <= 3;
	const isMarginalWeakDraw = !preflop && isWeakDraw &&
		edge >= 0.05 && edge < 0.30;
	const isMarginalEdgeHand = isMarginalMadeHand || isMarginalWeakDraw;
	const marginalReason = isMarginalMadeHand ? "made" : isMarginalWeakDraw ? "weak-draw" : null;
	const streetIndex = communityCards.length === 3
		? 1
		: communityCards.length === 4
		? 2
		: communityCards.length === 5
		? 3
		: 0;
	const raiseLevel = facingRaise && raisesThisRound > 0 ? Math.max(0, raisesThisRound) : 0;
	const isCheckedToSpot = !preflop && currentBet === 0;

	// Normalize strength to [0,1]
	// preflop score and postflop rank both live roughly in 0..10, so /10 is intentional
	const strengthBase = strength / 10;
	const strengthRatio = strengthBase;
	const positiveEdge = Math.max(0, edge);
	let edgeBoost = 0;
	if (!preflop) {
		if (liftType === "structural" && rawHandRank >= 3) {
			edgeBoost = Math.min(0.18, positiveEdge * 0.08);
		} else if (liftType === "structural" && rawHandRank === 2) {
			edgeBoost = Math.min(0.08, positiveEdge * 0.04);
		} else if (liftType === "meaningful") {
			edgeBoost = Math.min(0.04, positiveEdge * 0.08);
		}
	}
	const privateAwareStrength = Math.min(1, strengthRatio + edgeBoost);
	const gateStrengthRatio = preflop ? strengthRatio : privateAwareStrength;
	const mZone = getMZone(mRatio);
	const isGreenZone = mZone === "green";
	const strengthRatioBase = gateStrengthRatio;
	const premiumHand = preflop
		? isPremiumPreflopHand(player.holeCards[0], player.holeCards[1])
		: strengthRatioBase >= PREMIUM_POSTFLOP_RATIO;
	const raiseAggAdj = amChipleader ? -CHIP_LEADER_RAISE_DELTA : 0;
	const callTightAdj = shortstackRelative && stackRatio < ELIMINATION_RISK_START ? -SHORTSTACK_CALL_DELTA : 0;
	const deadPushThreshold = Math.max(0, DEAD_PUSH_RATIO + raiseAggAdj);
	const redPushThreshold = Math.max(0, RED_PUSH_RATIO + raiseAggAdj);
	const orangePushThreshold = Math.max(0, ORANGE_PUSH_RATIO + raiseAggAdj);
	const yellowRaiseThreshold = Math.max(0, YELLOW_RAISE_RATIO + raiseAggAdj);
	const yellowShoveThreshold = Math.max(0, YELLOW_SHOVE_RATIO + raiseAggAdj);
	const redCallThreshold = Math.min(1, RED_CALL_RATIO + callTightAdj);
	const orangeCallThreshold = Math.min(1, ORANGE_CALL_RATIO + callTightAdj);
	const yellowCallThreshold = Math.min(1, YELLOW_CALL_RATIO + callTightAdj);
	const useHarringtonStrategy = preflop && !isGreenZone;

	const remainingStreets = preflop ? 3 : communityCards.length === 3 ? 2 : communityCards.length === 4 ? 1 : 0;
	const { commitmentPressure, commitmentPenalty } = computeCommitmentMetrics(
		needToCall,
		player,
		spr,
		remainingStreets,
	);
	const handInvestmentRatio = player.totalBet /
		Math.max(1, player.totalBet + player.chips);
	const { eliminationRisk, eliminationPenalty } = needsToCall
		? computeEliminationRisk(
			stackRatio,
			preflop ? ELIMINATION_RISK_FULL : POSTFLOP_ELIMINATION_RISK_FULL,
			preflop ? ELIMINATION_PENALTY_MAX : POSTFLOP_ELIMINATION_PENALTY_MAX,
		)
		: { eliminationRisk: 0, eliminationPenalty: 0 };
	const riskAdjustedRedCallThreshold = Math.min(
		1,
		redCallThreshold + eliminationPenalty,
	);
	const riskAdjustedOrangeCallThreshold = Math.min(
		1,
		orangeCallThreshold + eliminationPenalty,
	);
	const riskAdjustedYellowCallThreshold = Math.min(
		1,
		yellowCallThreshold + eliminationPenalty,
	);
	const passesPreflopCallLimit = !preflop || stackRatio <= 0.5;
	const preflopPassiveCallScore = preflop && needsToCall && !useHarringtonStrategy
		? getPreflopPassiveCallScore({
			preflopScores,
			player,
			spotContext,
			potOdds,
			positionFactor,
		})
		: preflopScores.strengthScore;
	const callGateStrengthRatio = preflop && needsToCall && !useHarringtonStrategy
		? preflopPassiveCallScore / 10
		: gateStrengthRatio;
	const isUnopenedPreflopActionSpot = preflop && !useHarringtonStrategy &&
		spotContext.unopened && !facingRaise;

	const callBarrierBase = preflop
		? Math.min(1, Math.max(0, potOdds + callTightAdj))
		: Math.min(1, Math.max(0, POSTFLOP_CALL_BARRIER + callTightAdj));
	let callBarrier = preflop
		? Math.min(1, callBarrierBase + commitmentPenalty)
		: callBarrierBase;
	let marginalCallPenalty = 0;
	if (!preflop) {
		let callBarrierAdj = 0;
		if (hasPrivateContribution) {
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
		if (
			needsToCall && facingRaise && !hasPrivateRaiseEdge &&
			drawEquity === 0 &&
			rawHandRank <= 2
		) {
			let bluffcatchAdj = 0;
			if (
				spotContext.headsUp && aggressorRead.agg >= 1.6 &&
				(aggressorRead.showdownWin <= 0.48 ||
					aggressorRead.showdowns < 4)
			) {
				bluffcatchAdj -= 0.02;
			} else if (
				!spotContext.headsUp || aggressorRead.agg <= 0.90 ||
				(aggressorRead.showdownWin >= 0.55 &&
					aggressorRead.showdowns >= 4)
			) {
				bluffcatchAdj += 0.02;
			}
			callBarrierAdj += bluffcatchAdj;
		}
		callBarrierAdj = Math.max(-0.04, Math.min(0.04, callBarrierAdj));

		const streetPressure = needsToCall ? streetIndex * 0.01 : 0;
		const weakDrawPressure = needsToCall && isWeakDraw ? streetIndex * 0.01 : 0;
		const deadHandPressure = needsToCall && isDeadHand ? streetIndex * 0.02 : 0;
		const barrelPressure = needsToCall ? raiseLevel * 0.02 : 0;
		let marginalCallAdj = 0;
		if (needsToCall && isMarginalEdgeHand) {
			if (spotContext.headsUp && raiseLevel === 0 && streetIndex < 3) {
				marginalCallAdj -= 0.02;
			}
			if (raiseLevel >= 1) {
				marginalCallAdj += 0.03;
				marginalCallPenalty += 0.03;
			}
			if (!spotContext.headsUp) {
				marginalCallAdj += 0.02;
				marginalCallPenalty += 0.02;
			}
			if (textureRisk > 0.6) {
				marginalCallAdj += 0.02;
				marginalCallPenalty += 0.02;
			}
			if (streetIndex === 3) {
				marginalCallAdj += 0.03;
				marginalCallPenalty += 0.03;
			}
			if (
				isMarginalMadeHand && streetIndex === 2 && !spotContext.headsUp
			) {
				marginalCallAdj += 0.02;
				marginalCallPenalty += 0.02;
			}
			if (
				isMarginalMadeHand && streetIndex >= 2 &&
				raiseLevel >= 1 &&
				edge < 0.55
			) {
				marginalCallAdj += 0.02;
				marginalCallPenalty += 0.02;
			}
		}

		const potOddsAdj = needsToCall ? Math.max(-0.12, Math.min(0.08, (0.25 - potOdds) * 0.6)) : 0;
		const potOddsShift = needsToCall
			? getPostflopPriceQualityShift({
				baseShift: -potOddsAdj,
				isDeadHand,
				isWeakDraw,
				pairClass,
				liftType,
				edge,
				drawOuts,
				topPair,
				overPair,
				spotContext,
				raiseLevel,
				streetIndex,
				potOdds,
			})
			: 0;
		const commitmentShift = needsToCall ? commitmentPenalty * 0.8 : 0;
		const weakPrivateShowdownPressurePenalty = getWeakPrivateShowdownPressurePenalty({
			needsToCall,
			streetIndex,
			raiseLevel,
			pairClass,
			liftType,
			edge,
			drawOuts,
			topPair,
			overPair,
			potOdds,
		});
		const preReliefCallBarrier = callBarrierBase + callBarrierAdj + marginalCallAdj +
			potOddsShift + commitmentShift + streetPressure + weakDrawPressure +
			deadHandPressure + barrelPressure + weakPrivateShowdownPressurePenalty;
		const flopEquityCallRelief = needsToCall && streetIndex === 1
			? getFlopEquityCallRelief({
				drawOuts,
				isDeadHand,
				isWeakDraw,
				hasPrivateMadeHand,
				pairClass,
				liftType,
				edge,
				topPair,
				overPair,
				spotContext,
				isLastToAct,
				raiseLevel,
				potOdds,
				marginToCall: preReliefCallBarrier - gateStrengthRatio,
			})
			: 0;

		callBarrier = preReliefCallBarrier - flopEquityCallRelief;
		if (needsToCall && isDeadHand) {
			const deadHandFloor = streetIndex === 1 ? 0.2 : streetIndex === 2 ? 0.22 : 0.24;
			callBarrier = Math.max(callBarrier, deadHandFloor);
		}
		if (needsToCall && isWeakDraw) {
			if (streetIndex >= 2) {
				callBarrier = 1;
			} else if (
				streetIndex === 1 && (potOdds > 0.18 || raiseLevel > 0)
			) {
				callBarrier = 1;
			}
		}
		callBarrier = Math.min(1, Math.max(0.10, callBarrier));
	}
	let adjustedEliminationPenalty = eliminationPenalty;
	const eliminationReliefCandidate = !preflop && needsToCall &&
		eliminationRisk === 1 &&
		spotContext.headsUp &&
		liftType === "structural" &&
		rawHandRank >= 3 &&
		publicHandRank <= 1;
	let eliminationReliefApplied = false;
	if (eliminationReliefCandidate) {
		const edgeRelief = Math.max(0, Math.min(1, (edge - 0.8) / 1.2));
		let penaltyScale = 1 - edgeRelief * 0.5;
		if (raiseLevel >= 2) {
			penaltyScale = Math.max(penaltyScale, 0.75);
		}
		adjustedEliminationPenalty *= penaltyScale;
		eliminationReliefApplied = adjustedEliminationPenalty < eliminationPenalty;
	}
	const eliminationBarrier = needsToCall ? Math.min(1, callBarrier + adjustedEliminationPenalty) : callBarrier;
	const mdfRequiredFoldRate = !preflop && needToCall > 0 ? getRequiredFoldRate(needToCall, pot) : 0;
	let marginalDefenseBlocked = false;
	let riverLowEdgeBlocked = false;

	// Base thresholds for raising depend on stage and pot size
	// When only a few opponents remain, play slightly more aggressively
	const oppAggAdj = activeOpponents < OPPONENT_THRESHOLD ? (OPPONENT_THRESHOLD - activeOpponents) * AGG_FACTOR : 0;
	const thresholdAdj = activeOpponents < OPPONENT_THRESHOLD
		? (OPPONENT_THRESHOLD - activeOpponents) * THRESHOLD_FACTOR
		: 0;
	const baseAggressiveness = preflop ? 0.8 + 0.4 * positionFactor : 1 + 0.6 * positionFactor;
	let aggressiveness = preflop ? baseAggressiveness + oppAggAdj : baseAggressiveness;
	let raiseThreshold = preflop ? 8 - 2 * positionFactor : 2.6 - 0.8 * positionFactor;
	raiseThreshold = Math.max(1, raiseThreshold - (preflop ? thresholdAdj : 0));
	if (amChipleader) {
		raiseThreshold = Math.max(
			1,
			raiseThreshold - CHIP_LEADER_RAISE_DELTA * 10,
		);
	}
	const decisionStrength = preflop ? strength : gateStrengthRatio * 10;

	let bluffChance = 0;
	let bluffAlpha = 0;
	let bluffDecisionChance = 0;
	let foldRate = 0;
	let statsWeight = 0;
	let avgVPIP = 0;
	let avgAgg = 0;
	function countMatchedPreflopCallers(excludedSeatIndexes = []) {
		const excludedSeatIndexSet = new Set(excludedSeatIndexes);
		return players.filter((currentPlayer) => {
			if (currentPlayer === player || currentPlayer.folded) {
				return false;
			}
			if (excludedSeatIndexSet.has(currentPlayer.seatIndex)) {
				return false;
			}
			const spotState = currentPlayer.spotState || {};
			return spotState.enteredPreflop &&
				!spotState.aggressiveThisStreet &&
				currentPlayer.roundBet >= currentBet;
		}).length;
	}

	function getFixedPreflopRaiseTargetTotal() {
		if (!preflop || useHarringtonStrategy) {
			return null;
		}

		if (preflopRaiseCount === 0) {
			const limperCount = countMatchedPreflopCallers();
			if (limperCount > 0) {
				return bigBlind * (3.5 + Math.max(0, limperCount - 1));
			}
			return bigBlind * (player.smallBlind ? 2.5 : 2.2);
		}

		if (preflopRaiseCount >= 3) {
			return player.roundBet + player.chips;
		}

		if (preflopRaiseCount === 2) {
			return currentBet * 2.3;
		}

		const lastPreflopAggressor = getLastPreflopAggressor(players, handContext);
		const coldCallerCount = countMatchedPreflopCallers(
			lastPreflopAggressor ? [lastPreflopAggressor.seatIndex] : [],
		);
		const baseMultiplier = isPreflopInPositionToAggressor(players, player, handContext) ? 3.0 : 3.5;
		return currentBet * (baseMultiplier + coldCallerCount * 0.5);
	}

	function getFixedPreflopRaiseSize() {
		const targetTotal = getFixedPreflopRaiseTargetTotal();
		if (!(targetTotal > 0)) {
			return 0;
		}

		const desiredAction = Math.max(0, targetTotal - player.roundBet);
		if (desiredAction >= player.chips) {
			return player.chips;
		}

		return Math.max(0, floorTo10(desiredAction));
	}

	function getPreflopSizingKind() {
		if (useHarringtonStrategy) {
			return "preflop-harrington";
		}

		if (preflopRaiseCount === 0) {
			return countMatchedPreflopCallers() > 0 ? "preflop-iso" : "preflop-open";
		}
		if (preflopRaiseCount >= 3) {
			return "preflop-5bet-plus";
		}
		if (preflopRaiseCount === 2) {
			return "preflop-4bet";
		}

		const lastPreflopAggressor = getLastPreflopAggressor(players, handContext);
		const coldCallerCount = countMatchedPreflopCallers(
			lastPreflopAggressor ? [lastPreflopAggressor.seatIndex] : [],
		);
		return coldCallerCount > 0 ? "preflop-squeeze" : "preflop-3bet";
	}

	function getPreflopTargetSizeBucket() {
		if (useHarringtonStrategy) {
			return "zone";
		}

		if (preflopRaiseCount === 0) {
			const limperCount = countMatchedPreflopCallers();
			if (limperCount > 0) {
				return `${(3.5 + Math.max(0, limperCount - 1)).toFixed(1)}bb`;
			}
			return player.smallBlind ? "2.5bb" : "2.2bb";
		}
		if (preflopRaiseCount >= 3) {
			return "jam";
		}
		if (preflopRaiseCount === 2) {
			return "2.3x";
		}

		const lastPreflopAggressor = getLastPreflopAggressor(players, handContext);
		const coldCallerCount = countMatchedPreflopCallers(
			lastPreflopAggressor ? [lastPreflopAggressor.seatIndex] : [],
		);
		const baseMultiplier = isPreflopInPositionToAggressor(players, player, handContext) ? 3.0 : 3.5;
		return `${(baseMultiplier + coldCallerCount * 0.5).toFixed(1)}x`;
	}

	function shouldUseLargePostflopBucket(intent) {
		if (intent === "probe") {
			return false;
		}
		const strongValue = rawHandRank >= 5 && edge > 0;
		const polarizedPressure = raiseLevel > 0 &&
			(edge >= 1.0 || drawOuts >= 8);
		return textureRisk >= 0.6 ||
			spr <= 2.5 ||
			strongValue ||
			polarizedPressure;
	}

	function getPostflopBaseBucket(intent) {
		if (intent === "probe") {
			return 0.30;
		}
		if (intent === "cbet") {
			return shouldUseLargePostflopBucket(intent) ? 0.75 : 0.40;
		}
		return shouldUseLargePostflopBucket(intent) ? 0.75 : 0.55;
	}

	function getReraiseInvestmentThresholdAdj(
		investmentRatioValue,
		edgeValue,
	) {
		if (investmentRatioValue < 0.2) {
			return 0;
		}
		if (investmentRatioValue < 0.35) {
			return edgeValue >= 2.0 ? 0.18 : 0.34;
		}
		if (investmentRatioValue < 0.5) {
			if (edgeValue >= 2.0) return 0.30;
			if (edgeValue >= 1.0) return 0.48;
			return 0.70;
		}
		if (investmentRatioValue < 0.65) {
			if (edgeValue >= 2.5) return 0.42;
			if (edgeValue >= 1.5) return 0.64;
			return 0.94;
		}
		if (edgeValue >= 3.0) return 0.52;
		if (edgeValue >= 2.0) return 0.76;
		return 1.08;
	}

	function getPostflopReraiseThresholdAdj(
		raiseLevelValue,
		edgeValue,
		activeOpponentsValue,
	) {
		if (raiseLevelValue === 1) {
			let adj = edgeValue >= 1.20 ? 0.20 : edgeValue >= 1.00 ? 0.26 : 0.34;
			if (activeOpponentsValue >= 2) {
				adj += 0.35;
			}
			if (activeOpponentsValue >= 3) {
				adj += 0.15;
			}
			return adj;
		}
		if (raiseLevelValue < 2) {
			return 0;
		}
		if (edgeValue >= 3.5) {
			return 0.04;
		}
		if (edgeValue >= 2.5) {
			return 0.07;
		}
		return 0.10;
	}

	function getPostflopReraiseGateRatio(
		baseRatio,
		raiseLevelValue,
		edgeValue,
	) {
		if (raiseLevelValue < 2) {
			return baseRatio;
		}

		let bonus = 0.10;
		if (edgeValue >= 3.5) {
			bonus = 0.04;
		} else if (edgeValue >= 2.5) {
			bonus = 0.07;
		}
		return Math.min(0.6, baseRatio + bonus);
	}

	function getPostflopMaxStackFrac(edgeValue, rawRankValue, canBust) {
		let cap = canBust ? 0.28 : 0.36;

		if (edgeValue >= 0.5) {
			cap += canBust ? 0.04 : 0.06;
		}
		if (edgeValue >= 1.0) {
			cap += canBust ? 0.05 : 0.07;
		}
		if (edgeValue >= 2.0) {
			cap += canBust ? 0.08 : 0.12;
		}
		if (edgeValue >= 3.5) {
			cap += canBust ? 0.1 : 0.15;
		}

		if (rawRankValue >= 7) {
			cap += 0.2;
		} else if (rawRankValue >= 5) {
			cap += 0.1;
		} else if (rawRankValue >= 3) {
			cap += 0.04;
		}

		return Math.min(1, cap);
	}

	function getPostflopReraiseMaxStackFrac(
		edgeValue,
		rawRankValue,
		canBust,
		raiseLevelValue,
	) {
		let cap = canBust ? 0.2 : 0.26;

		if (edgeValue >= 0.5) {
			cap += canBust ? 0.03 : 0.05;
		}
		if (edgeValue >= 1.0) {
			cap += canBust ? 0.04 : 0.06;
		}
		if (edgeValue >= 2.0) {
			cap += canBust ? 0.06 : 0.1;
		}
		if (edgeValue >= 3.5) {
			cap += canBust ? 0.08 : 0.12;
		}

		if (rawRankValue >= 7) {
			cap += 0.16;
		} else if (rawRankValue >= 5) {
			cap += 0.08;
		} else if (rawRankValue >= 3) {
			cap += 0.03;
		}

		if (raiseLevelValue >= 2) {
			cap -= canBust ? 0.03 : 0.04;
		}

		const floor = canBust ? 0.16 : 0.2;
		return Math.max(floor, Math.min(0.72, cap));
	}

	function getPostflopBetSize(intent) {
		const baseBucket = getPostflopBaseBucket(intent);
		const intendedBet = (pot + needToCall) * baseBucket;
		const maxActiveStack = activeOpponentStacks.length > 0 ? Math.max(...activeOpponentStacks) : 0;
		const canBust = maxActiveStack >= player.chips;
		let stackCap = player.chips * getPostflopMaxStackFrac(
			edge,
			rawHandRank,
			canBust,
		);
		if (raiseLevel > 0) {
			const reraiseStackCap = player.chips *
				getPostflopReraiseMaxStackFrac(
					edge,
					rawHandRank,
					canBust,
					raiseLevel,
				);
			stackCap = Math.min(stackCap, reraiseStackCap);
		}
		return Math.max(
			0,
			floorTo10(Math.min(player.chips, intendedBet, stackCap)),
		);
	}

	function valueBetSize() {
		if (!preflop) {
			return getPostflopBetSize("value");
		}
		return getFixedPreflopRaiseSize();
	}

	function probeBetSize() {
		if (preflop) {
			return getFixedPreflopRaiseSize();
		}
		return getPostflopBetSize("probe");
	}

	function bluffBetSize() {
		return probeBetSize();
	}

	function continuationBetSize() {
		return getPostflopBetSize("cbet");
	}

	function protectionBetSize() {
		if (!preflop) {
			return getPostflopBetSize("protection");
		}
		return getFixedPreflopRaiseSize();
	}

	function yellowRaiseSize() {
		const base = bigBlind * (2.5 + Math.random() * 0.5);
		const sized = floorTo10(base * betAggFactor);
		const normalizedMinRaise = ceilTo10(minRaiseAmount);
		return Math.min(player.chips, Math.max(normalizedMinRaise, sized));
	}

	function getPostflopSizingIntent() {
		if (preflop || decision.action !== "raise") {
			return null;
		}
		if (isStab || isBluff) {
			return "probe";
		}
		if (
			currentBet === 0 && !facingRaise && botLine && botLine.preflopAggressor &&
			!lineAbort
		) {
			if (currentPhaseIndex === 1 && botLine.cbetIntent) {
				return "cbet";
			}
			if (currentPhaseIndex === 2 && botLine.barrelIntent) {
				return "cbet";
			}
		}
		return "value";
	}

	function getDecisionSizingLogMeta() {
		if (decision.action !== "raise") {
			return {
				sizingKind: null,
				targetSizeBucket: null,
				expectedRaiseAmount: null,
				offBucket: false,
				offBucketReason: null,
			};
		}

		if (preflop) {
			const sizingKind = getPreflopSizingKind();
			if (sizingKind === "preflop-harrington") {
				return {
					sizingKind,
					targetSizeBucket: getPreflopTargetSizeBucket(),
					expectedRaiseAmount: null,
					offBucket: false,
					offBucketReason: null,
				};
			}

			const expectedRaiseAmount = getFixedPreflopRaiseSize();
			const offBucket = expectedRaiseAmount > 0 && decision.amount !== expectedRaiseAmount;
			let offBucketReason = null;
			if (offBucket) {
				offBucketReason = decision.amount >= player.chips
					? "all-in"
					: decision.amount > expectedRaiseAmount
					? "oversized"
					: "undersized";
			}
			return {
				sizingKind,
				targetSizeBucket: getPreflopTargetSizeBucket(),
				expectedRaiseAmount,
				offBucket,
				offBucketReason,
			};
		}

		const sizingIntent = getPostflopSizingIntent();
		if (!sizingIntent) {
			return {
				sizingKind: null,
				targetSizeBucket: null,
				expectedRaiseAmount: null,
				offBucket: false,
				offBucketReason: null,
			};
		}

		const sizingKind = sizingIntent === "probe"
			? "postflop-probe"
			: sizingIntent === "cbet"
			? currentPhaseIndex === 2 ? "postflop-barrel" : "postflop-cbet"
			: "postflop-value";
		const targetSizeBucket = sizingIntent === "probe"
			? "30%"
			: sizingIntent === "cbet"
			? shouldUseLargePostflopBucket("cbet") ? "75%" : "40%"
			: shouldUseLargePostflopBucket("value")
			? "75%"
			: "55%";
		const expectedRaiseAmount = sizingIntent === "probe"
			? probeBetSize()
			: sizingIntent === "cbet"
			? continuationBetSize()
			: valueBetSize();
		const offBucket = expectedRaiseAmount > 0 && decision.amount !== expectedRaiseAmount;
		let offBucketReason = null;
		if (offBucket) {
			offBucketReason = decision.amount >= player.chips
				? "all-in"
				: decision.amount > expectedRaiseAmount
				? "oversized"
				: "undersized";
		}
		return {
			sizingKind,
			targetSizeBucket,
			expectedRaiseAmount,
			offBucket,
			offBucketReason,
		};
	}

	function decideCbetIntent(lineAbort) {
		if (lineAbort) return false;
		let chance = 0.55;
		if (textureRisk < 0.35) chance += 0.15;
		else if (textureRisk > 0.6) chance -= 0.2;
		chance -= Math.max(0, activeOpponents - 1) * 0.06;
		chance += positionFactor * 0.08;
		chance += Math.min(0.14, liveRead.foldRate * 0.18);
		if (spotContext.headsUp && isLastToAct) chance += 0.04;
		if (spotContext.multiRaised) chance -= 0.12;
		if (!spotContext.headsUp && playersBehind.length > 0) chance -= 0.04;
		if (!spotContext.headsUp && behindRead.agg >= 1.2) {
			chance -= 0.05;
		}
		if (
			!spotContext.headsUp && behindRead.vpip >= 0.45 &&
			positionFactor < 0.75
		) {
			chance -= 0.04;
		}
		if (gateStrengthRatio >= 0.7) chance += 0.15;
		if (drawEquity > 0) chance += 0.08;
		const weightScale = 0.75 + 0.25 * statsWeight;
		chance *= weightScale;
		chance = Math.max(0.15, Math.min(0.85, chance));
		return Math.random() < chance;
	}

	function decideBarrelIntent(lineAbort) {
		if (lineAbort) return false;
		let chance = 0.25;
		if (textureRisk < 0.35) chance += 0.1;
		else if (textureRisk > 0.6) chance -= 0.15;
		chance -= Math.max(0, activeOpponents - 1) * 0.05;
		chance += positionFactor * 0.06;
		chance += Math.min(0.08, liveRead.foldRate * 0.10);
		if (
			spotContext.headsUp && previousStreetCheckedThrough &&
			liveRead.foldRate >= 0.4
		) {
			chance += 0.04;
		}
		if (spotContext.multiRaised) chance -= 0.10;
		if (!spotContext.headsUp && playersBehind.length > 0) chance -= 0.04;
		if (liveRead.vpip >= 0.45 || liveHasShowdownStrong) {
			chance -= 0.07;
		}
		if (
			spotContext.singleRaised &&
			rawHandRank <= 2 &&
			drawEquity === 0
		) {
			chance -= 0.10;
		}
		if (
			spotContext.singleRaised &&
			rawHandRank <= 2 &&
			edge < 1.3
		) {
			chance -= 0.12;
		}
		if (
			spotContext.headsUp &&
			!previousStreetCheckedThrough &&
			rawHandRank <= 2 &&
			drawEquity === 0
		) {
			chance -= 0.08;
		}
		if (gateStrengthRatio >= 0.8) chance += 0.06;
		else if (gateStrengthRatio >= 0.7) chance += 0.02;
		if (drawEquity > 0) chance += 0.04;
		const weightScale = 0.75 + 0.25 * statsWeight;
		chance *= weightScale;
		chance = Math.max(0.08, Math.min(0.55, chance));
		return Math.random() < chance;
	}

	function computeSpotBluffChance(weight) {
		if (preflop) {
			let chance = Math.min(0.3, foldRate) * weight;
			chance *= 1 - textureRisk * 0.5;
			return Math.min(0.3, chance);
		}

		let chance = 0.04;
		if (spotContext.headsUp) chance += 0.04;
		if (isLastToAct) chance += 0.04;
		if (previousStreetCheckedThrough) chance += 0.04;
		if (!spotContext.headsUp && playersBehind.length > 0) chance -= 0.02;
		if (currentPhaseIndex === 2) chance -= 0.01;
		else if (currentPhaseIndex >= 3) chance -= 0.03;
		if (spotContext.multiRaised) chance -= 0.08;
		chance *= 1 - textureRisk * 0.4;

		let readMod = 1;
		if (liveRead.foldRate >= 0.45) {
			readMod += 0.08 * weight;
		} else if (liveRead.foldRate <= 0.25) {
			readMod -= 0.06 * weight;
		}
		if (
			playersBehind.length > 0 &&
			(behindRead.agg > 1.2 || behindRead.vpip > 0.45)
		) {
			readMod -= 0.08 * weight;
		}
		if (liveHasShowdownStrong) {
			readMod -= 0.05 * weight;
		}
		if (
			spotContext.headsUp && previousStreetCheckedThrough &&
			liveRead.foldRate >= 0.4
		) {
			readMod += 0.05 * weight;
		}

		const bluffAggFactor = Math.max(0.8, Math.min(1.2, aggressiveness));
		return Math.max(0, Math.min(0.22, chance * readMod * bluffAggFactor));
	}

	// Adjust based on observed opponent tendencies
	const statOpponents = liveOpponents;
	if (statOpponents.length > 0) {
		avgVPIP = tableReadProfile.vpip;
		avgAgg = tableReadProfile.agg;
		foldRate = liveRead.foldRate;
		const weight = tableReadProfile.weight;
		statsWeight = weight;
		bluffChance = computeSpotBluffChance(weight);

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

	raiseThreshold = Math.max(1, raiseThreshold - (aggressiveness - 1) * 0.8);
	if (!preflop) {
		let raiseAdj = 0;
		if (hasPrivateContribution) {
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
		if (isMarginalEdgeHand) {
			let marginalRaiseAdj = 0.30;
			if (!spotContext.headsUp) {
				marginalRaiseAdj += 0.15;
			}
			if (streetIndex === 3) {
				marginalRaiseAdj += 0.20;
			}
			if (raiseLevel >= 1) {
				marginalRaiseAdj += 0.20;
			}
			if (
				isCheckedToSpot &&
				(spotContext.headsUp || isLastToAct) &&
				previousStreetCheckedThrough &&
				streetIndex > 0 &&
				streetIndex < 3
			) {
				marginalRaiseAdj -= 0.10;
			}
			raiseThreshold += marginalRaiseAdj;
		}
		raiseThreshold = Math.max(1.4, raiseThreshold);
	}
	raiseThreshold += raiseLevel * RERAISE_RATIO_STEP * 10;
	if (preflop && raiseLevel > 0 && !useHarringtonStrategy) {
		if (blindLevelIndex <= 1) {
			raiseThreshold += 0.25;
		}
		if (effectiveStack >= 40 * bigBlind) {
			raiseThreshold += 0.35;
		}
		if (raiseLevel >= 2) {
			raiseThreshold += 0.35;
		}
	}
	if (!preflop && raiseLevel > 0) {
		raiseThreshold += getReraiseInvestmentThresholdAdj(
			handInvestmentRatio,
			edge,
		);
		raiseThreshold += getPostflopReraiseThresholdAdj(
			raiseLevel,
			edge,
			activeOpponents,
		);
		if (pairClass === "paired-board-private-pair") {
			raiseThreshold += edge >= 1.20 ? 0.25 : 1.00;
			if (activeOpponents >= 2) {
				raiseThreshold += 0.25;
			}
			if (streetIndex === 3) {
				raiseThreshold += 0.15;
			}
		}
		if (blindLevelIndex <= 1 && effectiveStack >= 40 * bigBlind) {
			raiseThreshold += raiseLevel === 1 ? 0.15 : 0.30;
			if (activeOpponents >= 2) {
				raiseThreshold += 0.10;
			}
		}
	}
	const betAggFactor = Math.max(0.9, Math.min(1.1, aggressiveness));
	const shoveAggAdj = Math.max(
		-0.08,
		Math.min(0.08, (aggressiveness - 1) * 0.12),
	);

	// Keep a simple betting-line memory for the preflop aggressor.
	let lineAbort = false;
	if (!preflop && botLine && botLine.preflopAggressor) {
		lineAbort = textureRisk > 0.7 && gateStrengthRatio < 0.45 &&
			drawEquity === 0;
		if (currentPhaseIndex === 1 && botLine.cbetIntent === null) {
			botLine.cbetIntent = decideCbetIntent(lineAbort);
		}
		if (
			currentPhaseIndex === 2 && botLine.cbetMade &&
			botLine.barrelIntent === null
		) {
			botLine.barrelIntent = decideBarrelIntent(lineAbort);
		}
	}

	const isNoBetOpportunity = isCheckedToSpot && canRaise;
	const noBetClass = isCheckedToSpot
		? classifyNoBetOpportunity({
			rawHandRank,
			drawOuts,
			hasPrivateMadeHand,
			topPair,
			overPair,
			pairClass,
			textureRisk,
			liftType,
			edge,
			headsUp: spotContext.headsUp,
			isLastToAct,
			previousStreetCheckedThrough,
			isMarginalMadeHand,
			communityCardsLength: communityCards.length,
		})
		: null;

	/* -------------------------
       Decision logic with tie-breakers
    ------------------------- */
	/* Tie-breaker explanation:
       - When the difference between hand strength and the raise threshold is within STRENGTH_TIE_DELTA,
         the bot randomly chooses between the two close options to introduce unpredictability.
       - Similarly, when the difference between the active strength ratio and callBarrier is within ODDS_TIE_DELTA,
         the bot randomly resolves between call and fold to break ties.
     */
	let decision;
	let checkRaiseIntentAction = null;
	let checkRaiseIntentReason = null;
	let passiveValueCheckAction = null;
	let passiveValueCheckReason = null;
	let passiveValueCheckBlockReason = null;

	if (botLine?.checkRaiseIntent) {
		const intent = botLine.checkRaiseIntent;
		const sameStreet = intent.streetIndex === streetIndex;
		let triggerBlockReason = null;
		if (preflop || streetIndex === 0) {
			triggerBlockReason = "not_postflop";
		} else if (liftType !== "structural") {
			triggerBlockReason = "not_structural_lift";
		} else if (edge < 2) {
			triggerBlockReason = "edge_lt_2";
		} else if (activeOpponents > 1 && rawHandRank < 5) {
			triggerBlockReason = "multiway_below_straight";
		} else {
			triggerBlockReason = getCheckRaiseStreetBlockReason(streetIndex, handContext) ??
				getCheckRaiseTextureBlockReason(rawHandRank, textureRisk);
		}
		const canFire = !preflop && sameStreet && needsToCall && canRaise &&
			triggerBlockReason === null;

		if (canFire) {
			botLine.checkRaiseIntent = null;
			checkRaiseIntentAction = "fired";
			checkRaiseIntentReason = "facing_bet";
			decision = {
				action: "raise",
				amount: Math.max(minRaiseAmount, valueBetSize()),
			};
		} else if (
			!preflop && sameStreet && needsToCall && !canRaise &&
			triggerBlockReason === null
		) {
			botLine.checkRaiseIntent = null;
			checkRaiseIntentAction = "blocked_cannot_raise";
			checkRaiseIntentReason = "induced_call";
		} else if (
			preflop || !sameStreet ||
			(needsToCall && triggerBlockReason !== null)
		) {
			botLine.checkRaiseIntent = null;
			checkRaiseIntentAction = "abandoned";
			checkRaiseIntentReason = !sameStreet
				? "street_changed"
				: !needsToCall
				? "not_facing_bet"
				: triggerBlockReason;
		}
	}

	if (botLine?.passiveValueCheckIntent) {
		const intent = botLine.passiveValueCheckIntent;
		const sameStreet = intent.streetIndex === streetIndex;
		if (!preflop && sameStreet && needsToCall) {
			botLine.passiveValueCheckIntent = null;
			passiveValueCheckAction = "followup";
			passiveValueCheckReason = "facing_bet";
		} else if (preflop || !sameStreet) {
			botLine.passiveValueCheckIntent = null;
			passiveValueCheckAction = "abandoned";
			passiveValueCheckReason = sameStreet ? "not_postflop" : "street_changed";
		}
	}

	if (useHarringtonStrategy) {
		decision = decideHarringtonAction({
			mZone,
			facingRaise,
			needsToCall,
			strengthRatio,
			deadPushThreshold,
			redPushThreshold,
			orangePushThreshold,
			yellowRaiseThreshold,
			yellowShoveThreshold,
			redCallThreshold: riskAdjustedRedCallThreshold,
			orangeCallThreshold: riskAdjustedOrangeCallThreshold,
			yellowCallThreshold: riskAdjustedYellowCallThreshold,
			canShove,
			canRaise,
			needToCall,
			playerChips: player.chips,
			yellowRaiseSize,
		});
	}

	// Automatic shove logic when stacks are shallow
	if (!decision) {
		const shallowShoveThreshold = Math.max(
			0,
			Math.min(1, 0.65 - shoveAggAdj),
		);
		const shortstackShoveThreshold = Math.max(
			0,
			Math.min(1, 0.75 - shoveAggAdj),
		);
		if (
			canShove &&
			spr <= 1.2 &&
			(preflop || hasPrivateRaiseEdge) &&
			gateStrengthRatio >= shallowShoveThreshold
		) {
			decision = { action: "raise", amount: player.chips };
		} else if (
			canShove &&
			preflop && player.chips <= blindLevel.big * 10 &&
			strengthRatio >= shortstackShoveThreshold
		) {
			decision = { action: "raise", amount: player.chips };
		}
	}

	if (!decision && isUnopenedPreflopActionSpot) {
		const openRaiseThreshold = getUnopenedPreflopRaiseThreshold({
			baseRaiseThreshold: raiseThreshold,
			player,
			spotContext,
			positionFactor,
			preflopSeatClass,
			activePlayerCount: active.length,
		});
		const openLimpThreshold = getUnopenedPreflopLimpThreshold({
			player,
			spotContext,
			positionFactor,
			preflopSeatClass,
			activePlayerCount: active.length,
		});
		const canOpenLimp = needsToCall &&
			canOpenLimpPreflop({
				preflopScores,
				player,
				spotContext,
				positionFactor,
				preflopSeatClass,
				activePlayerCount: active.length,
			}) &&
			preflopScores.openLimpScore / 10 >= openLimpThreshold &&
			passesPreflopCallLimit;

		if (
			canRaise &&
			preflopScores.openRaiseScore >= openRaiseThreshold &&
			hasPrivateRaiseEdge
		) {
			let raiseAmt = valueBetSize();
			raiseAmt = Math.max(minRaiseAmount, raiseAmt);
			if (
				Math.abs(preflopScores.openRaiseScore - openRaiseThreshold) <=
					STRENGTH_TIE_DELTA
			) {
				const alt = canOpenLimp
					? { action: "call", amount: Math.min(player.chips, needToCall) }
					: needsToCall
					? { action: "fold" }
					: { action: "check" };
				decision = Math.random() < 0.5 ? { action: "raise", amount: raiseAmt } : alt;
			} else {
				decision = { action: "raise", amount: raiseAmt };
			}
		} else if (canOpenLimp) {
			decision = { action: "call", amount: Math.min(player.chips, needToCall) };
		} else {
			decision = needsToCall ? { action: "fold" } : { action: "check" };
		}
	}

	if (!decision) {
		if (needToCall <= 0) {
			if (
				canRaise && decisionStrength >= raiseThreshold &&
				hasPrivateRaiseEdge
			) {
				let raiseAmt = valueBetSize();
				raiseAmt = Math.max(minRaiseAmount, raiseAmt);
				if (
					Math.abs(decisionStrength - raiseThreshold) <=
						STRENGTH_TIE_DELTA
				) {
					decision = Math.random() < 0.5 ? { action: "check" } : { action: "raise", amount: raiseAmt };
				} else {
					decision = { action: "raise", amount: raiseAmt };
				}
			} else {
				decision = { action: "check" };
			}
		} else if (
			canRaise && decisionStrength >= raiseThreshold &&
			hasPrivateRaiseEdge &&
			stackRatio <= 1 / 3
		) {
			let raiseAmt = protectionBetSize();
			const callAmt = Math.min(player.chips, needToCall);
			if (
				!preflop && raiseLevel >= 2 &&
				raiseAmt < minRaiseAmount &&
				player.chips > minRaiseAmount
			) {
				decision = { action: "call", amount: callAmt };
			} else {
				raiseAmt = Math.max(minRaiseAmount, raiseAmt);
				if (
					Math.abs(decisionStrength - raiseThreshold) <=
						STRENGTH_TIE_DELTA
				) {
					const alt = (callGateStrengthRatio >= eliminationBarrier &&
							passesPreflopCallLimit)
						? { action: "call", amount: callAmt }
						: { action: "fold" };
					decision = Math.random() < 0.5 ? { action: "raise", amount: raiseAmt } : alt;
				} else {
					decision = { action: "raise", amount: raiseAmt };
				}
			}
		} else if (
			callGateStrengthRatio >= eliminationBarrier && passesPreflopCallLimit
		) {
			const callAmt = Math.min(player.chips, needToCall);
			if (
				Math.abs(callGateStrengthRatio - eliminationBarrier) <=
					ODDS_TIE_DELTA
			) {
				decision = Math.random() < 0.5 ? { action: "call", amount: callAmt } : { action: "fold" };
			} else {
				decision = { action: "call", amount: callAmt };
			}
		} else {
			decision = { action: "fold" };
		}
	}
	if (preflop && premiumHand && decision.action === "fold") {
		decision = needsToCall ? { action: "call", amount: Math.min(player.chips, needToCall) } : { action: "check" };
	}
	if (
		!preflop && decision.action === "fold" && needsToCall &&
		rawHandRank >= TOP_TIER_POSTFLOP_GUARD_RANK_MIN
	) {
		decision = {
			action: "call",
			amount: Math.min(player.chips, needToCall),
		};
	}

	let isBluff = false;
	let isStab = false;
	if (!useHarringtonStrategy) {
		// If facing any all-in, do not fold always
		const facingAllIn = statOpponents.some((p) => p.allIn);
		if (decision.action === "fold" && facingAllIn) {
			const goodThreshold = preflop ? ALLIN_HAND_PREFLOP : ALLIN_HAND_POSTFLOP;
			const riskAdjustedThreshold = Math.min(
				1,
				goodThreshold + eliminationPenalty,
			);
			if (gateStrengthRatio >= riskAdjustedThreshold) {
				decision = {
					action: "call",
					amount: Math.min(player.chips, needToCall),
				};
			}
		}

		if (
			bluffChance > 0 && canRaise && !facingRaise &&
			(!preflop || strengthRatio >= MIN_PREFLOP_BLUFF_RATIO) &&
			(decision.action === "check" || decision.action === "fold") &&
			!facingAllIn &&
			!nonValueAggressionMade && canUsePureBluffLine
		) {
			const bluffAmt = Math.max(
				ceilTo10(minRaiseAmount),
				bluffBetSize(),
			);
			const bluffSpotChanceCap = preflop ? 0.3 : 0.22;
			const bluffSpotWeight = bluffSpotChanceCap > 0
				? Math.max(0, Math.min(1, bluffChance / bluffSpotChanceCap))
				: 0;
			bluffAlpha = getRequiredFoldRate(bluffAmt, pot + bluffAmt);
			bluffDecisionChance = Math.max(
				0,
				Math.min(1, bluffAlpha * bluffSpotWeight),
			);
			if (Math.random() < bluffDecisionChance) {
				decision = { action: "raise", amount: bluffAmt };
				isBluff = true;
			}
		}

		if (
			!preflop && currentBet === 0 && decision.action === "check" &&
			canRaise &&
			!facingRaise &&
			botLine && botLine.preflopAggressor && !lineAbort &&
			gateStrengthRatio < 0.9
		) {
			if (currentPhaseIndex === 1 && botLine.cbetIntent) {
				const wantsBluff = gateStrengthRatio < 0.6 && drawEquity === 0;
				if (
					!wantsBluff ||
					(!nonValueAggressionMade && !hasPrivateMadeHand)
				) {
					const bet = gateStrengthRatio >= 0.6 || drawEquity > 0 ? continuationBetSize() : probeBetSize();
					decision = {
						action: "raise",
						amount: Math.min(
							player.chips,
							Math.max(ceilTo10(lastRaise), bet),
						),
					};
					if (wantsBluff) {
						isBluff = true;
					}
				}
			} else if (currentPhaseIndex === 2 && botLine.barrelIntent) {
				const wantsBluff = gateStrengthRatio < 0.6 && drawEquity === 0;
				if (
					!wantsBluff ||
					(!nonValueAggressionMade && !hasPrivateMadeHand)
				) {
					const bet = gateStrengthRatio >= 0.75 || drawEquity > 0 ? continuationBetSize() : probeBetSize();
					decision = {
						action: "raise",
						amount: Math.min(
							player.chips,
							Math.max(ceilTo10(lastRaise), bet),
						),
					};
					if (wantsBluff) {
						isBluff = true;
					}
				}
			}
		}

		if (
			!preflop &&
			decision.action === "raise"
		) {
			const sizingIntent = getPostflopSizingIntent();
			const checkRaiseBlockReason = getCheckRaiseQualityBlockReason({
				preflop,
				streetIndex,
				handContext,
				currentBet,
				needsToCall,
				isLastToAct,
				decision,
				sizingIntent,
				isBluff,
				isStab,
				noBetClass,
				liftType,
				edge,
				rawHandRank,
				textureRisk,
				activeOpponents,
			});
			passiveValueCheckBlockReason = getPassiveValueCheckBlockReason({
				preflop,
				streetIndex,
				handContext,
				currentBet,
				needsToCall,
				isLastToAct,
				decision,
				sizingIntent,
				isBluff,
				isStab,
				noBetClass,
				rawHandRank,
				hasPrivateMadeHand,
				textureRisk,
				checkRaiseBlockReason,
			});

			if (
				checkRaiseBlockReason === null && botLine &&
				Math.random() < CHECK_RAISE_INTENT_CHANCE
			) {
				botLine.checkRaiseIntent = {
					handId: gameState.handId ?? 0,
					streetIndex,
					street: getCheckRaiseStreetName(streetIndex),
					edge: toRoundedNumber(edge, 4),
					rawHandRank,
					rawHand: rawHandName,
					textureRisk: toRoundedNumber(textureRisk),
					structureTag: spotContext.headsUp ? "HU" : "MW",
					reason: "value_raise_to_check",
					plannedAmount: decision.amount ?? 0,
				};
				checkRaiseIntentAction = "set";
				checkRaiseIntentReason = "value_raise_to_check";
				decision = { action: "check" };
			} else if (
				passiveValueCheckBlockReason === null && botLine &&
				Math.random() < PASSIVE_VALUE_CHECK_CHANCE
			) {
				botLine.passiveValueCheckIntent = {
					handId: gameState.handId ?? 0,
					streetIndex,
					street: getCheckRaiseStreetName(streetIndex),
					edge: toRoundedNumber(edge, 4),
					rawHandRank,
					rawHand: rawHandName,
					textureRisk: toRoundedNumber(textureRisk),
					structureTag: spotContext.headsUp ? "HU" : "MW",
					reason: "random_value_check",
					plannedAmount: decision.amount ?? 0,
				};
				passiveValueCheckAction = "set";
				passiveValueCheckReason = "random_value_check";
				decision = { action: "check" };
			}
		}

		if (
			!preflop && currentBet === 0 && decision.action === "check" &&
			checkRaiseIntentAction !== "set" &&
			passiveValueCheckAction !== "set" &&
			canRaise &&
			!facingRaise &&
			textureRisk < 0.4 && (foldRate > 0.25 || drawEquity > 0) &&
			(
				spotContext.headsUp ||
				isLastToAct ||
				previousStreetCheckedThrough
			) &&
			!spotContext.multiRaised &&
			!(
				currentPhaseIndex >= 2 &&
				!spotContext.headsUp &&
				!previousStreetCheckedThrough &&
				!isLastToAct &&
				drawEquity === 0
			) &&
			!(
				!spotContext.headsUp &&
				(behindRead.agg > 1.20 || behindHasShowdownStrong) &&
				drawEquity === 0
			) &&
			Math.random() < Math.max(
					0.04,
					Math.min(
						0.28,
						0.02 +
							(spotContext.headsUp ? 0.07 : 0) +
							(isLastToAct ? 0.08 : 0) +
							(previousStreetCheckedThrough ? 0.05 : 0) +
							(drawEquity > 0 ? 0.04 : 0) +
							positionFactor * 0.04 -
							(currentPhaseIndex === 2 ? 0.03 : currentPhaseIndex >= 3 ? 0.05 : 0),
					),
				) &&
			!nonValueAggressionMade
		) {
			const betAmt = probeBetSize();
			decision = {
				action: "raise",
				amount: Math.max(ceilTo10(lastRaise), betAmt),
			};
			isStab = true;
		}
	}

	const reraiseValueRatioBase = (topPair || overPair) ? RERAISE_TOP_PAIR_RATIO : RERAISE_VALUE_RATIO;
	const reraiseValueRatio = !preflop
		? getPostflopReraiseGateRatio(
			reraiseValueRatioBase,
			raiseLevel,
			edge,
		)
		: reraiseValueRatioBase;
	if (
		checkRaiseIntentAction !== "fired" &&
		decision.action === "raise" && raiseLevel > 0 &&
		gateStrengthRatio < reraiseValueRatio
	) {
		decision = needToCall > 0
			? { action: "call", amount: Math.min(player.chips, needToCall) }
			: { action: "check" };
		isBluff = false;
		isStab = false;
	}

	const noBetInitialAction = isCheckedToSpot ? decision.action : null;
	let noBetFilterApplied = false;
	let noBetBlockReason = null;

	if (
		isNoBetOpportunity && decision.action === "raise" &&
		noBetClass !== "auto-value"
	) {
		noBetBlockReason = getNoBetRaiseBlockReason({
			noBetClass,
			communityCards,
			spotContext,
			isLastToAct,
			playersBehind,
			behindRead,
			behindHasShowdownStrong,
			previousStreetCheckedThrough,
			drawEquity,
			liveRead,
			edge,
			liftType,
			topPair,
			overPair,
			pairClass,
		});
		if (noBetBlockReason) {
			decision = { action: "check" };
			isBluff = false;
			isStab = false;
			noBetFilterApplied = true;
		}
	}

	const h1 = formatCard(player.holeCards[0]);
	const h2 = formatCard(player.holeCards[1]);
	const handName = !preflop ? rawHandName : "preflop";

	// --- Ensure raises meet the minimum requirements ---
	if (decision.action === "raise") {
		const minRaise = needToCall + lastRaise; // minimum legal raise
		if (decision.amount < player.chips) {
			decision.amount = Math.min(
				player.chips,
				floorTo10(decision.amount),
			);
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
					? {
						action: "call",
						amount: Math.min(player.chips, needToCall),
					}
					: { action: "check" };
			}
		}
		if (
			decision.action === "raise" &&
			decision.amount > actionState.maxRaiseAmount &&
			decision.amount < player.chips
		) {
			decision.amount = actionState.maxRaiseAmount;
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

	if (
		!preflop &&
		needsToCall &&
		decision.action === "fold" &&
		marginalCallPenalty > 0 &&
		gateStrengthRatio < eliminationBarrier &&
		gateStrengthRatio >= Math.max(
				0,
				eliminationBarrier - marginalCallPenalty,
			)
	) {
		marginalDefenseBlocked = true;
	}

	if (
		shouldBlockRiverLowEdgeCall({
			decision,
			needsToCall,
			communityCards,
			hasPrivateRaiseEdge,
			isMarginalEdgeHand,
			activeOpponents,
			raiseLevel,
			rawHandRank,
			publicHandRank,
		})
	) {
		riverLowEdgeBlocked = true;
		decision = { action: "fold" };
	}

	const boardCtx = overPair
		? "OP"
		: topPair
		? "TP"
		: pairClass === "second-pair"
		? "SP"
		: pairClass === "weak-pair"
		? "WP"
		: pairClass === "pocket-underpair"
		? "UP"
		: pairClass === "board-pair-only"
		? "BP"
		: pairClass === "paired-board-private-pair"
		? "PBP"
		: drawChance
		? "DR"
		: "-";
	const drawFlag = isDraw ? "S" : (isWeakDraw ? "W" : "-");
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
	const lineTag = botLine && botLine.preflopAggressor ? "PFA" : "-";
	const cbetPlan = botLine && botLine.preflopAggressor
		? (botLine.cbetIntent === null ? "-" : (botLine.cbetIntent ? "Y" : "N"))
		: "-";
	const barrelPlan = botLine && botLine.preflopAggressor
		? (botLine.barrelIntent === null ? "-" : (botLine.barrelIntent ? "Y" : "N"))
		: "-";
	const cbetMade = botLine && botLine.preflopAggressor ? (botLine.cbetMade ? "Y" : "N") : "-";
	const barrelMade = botLine && botLine.preflopAggressor ? (botLine.barrelMade ? "Y" : "N") : "-";
	const lineAbortFlag = botLine && botLine.preflopAggressor ? (lineAbort ? "Y" : "N") : "-";
	const preflopSeatTag = getPreflopLogSeatTag(
		preflopSeatClass,
		active.length,
	);
	const [preflopSeat = "-", preflopSeatContext = "-"] = preflopSeatTag.split(
		"/",
		2,
	);
	const loggedRaiseThreshold = preflop ? 0 : raiseThreshold;
	const noBetTag = currentBet === 0 ? "Y" : "N";
	const canRaiseTag = canRaise ? "Y" : "N";
	const actingSlotIndex = spotContext.actingSlotIndex + 1;
	const actingSlotCount = spotContext.actingSlotCount;
	const actingSlotTag = `${actingSlotIndex}/${actingSlotCount}`;
	const nonValueAggressionBlocked = spotContext.multiRaised;
	const phase = preflop ? "preflop" : "postflop";
	const actionAmount = decision.amount ?? 0;
	const phaseWinProbabilities = active.filter((activePlayer) => typeof activePlayer.winProbability === "number");
	const ownWinProbability = typeof player.winProbability === "number" ? toRoundedNumber(player.winProbability) : null;
	const bestFieldRaw = phaseWinProbabilities.reduce((best, activePlayer) => {
		if (
			activePlayer === player ||
			typeof activePlayer.winProbability !== "number"
		) {
			return best;
		}
		return best === null || activePlayer.winProbability > best ? activePlayer.winProbability : best;
	}, null);
	const bestFieldWinProbability = bestFieldRaw === null ? null : toRoundedNumber(bestFieldRaw);
	const winProbRank = typeof player.winProbability === "number"
		? 1 +
			phaseWinProbabilities.filter((activePlayer) =>
				activePlayer !== player &&
				activePlayer.winProbability > player.winProbability
			).length
		: null;
	let decisionId = null;
	if (SPEED_MODE || botDecisionSink) {
		decisionId = gameState.nextDecisionId ?? 1;
		gameState.nextDecisionId = decisionId + 1;
	}
	const sizingMeta = getDecisionSizingLogMeta();
	const structuredDecision = {
		handId: gameState.handId ?? 0,
		decisionId,
		player: player.name,
		seatIndex: player.seatIndex,
		phase,
		action: decision.action,
		amount: actionAmount,
		toCall: needToCall,
		potBefore: pot,
		currentBet,
		chipsBefore: player.chips,
		communityCards: communityCards.slice(),
		holeCards: player.holeCards.slice(),
		ownWinProbability,
		bestFieldWinProbability,
		winProbRank,
		handName,
		aggressionStrength: toRoundedNumber(strengthRatio),
		passiveStrength: toRoundedNumber(strengthRatio),
		strengthRatioRaw: toRoundedNumber(strengthRatio),
		edgeBoost: toRoundedNumber(edgeBoost, 4),
		privateAwareStrength: toRoundedNumber(privateAwareStrength),
		mRatio: toRoundedNumber(mRatio),
		mZone,
		potOdds: toRoundedNumber(potOdds),
		callBarrier: toRoundedNumber(eliminationBarrier),
		mdfRequiredFoldRate: toRoundedNumber(mdfRequiredFoldRate, 4),
		bluffChance: toRoundedNumber(bluffChance, 4),
		bluffAlpha: toRoundedNumber(bluffAlpha, 4),
		bluffDecisionChance: toRoundedNumber(bluffDecisionChance, 4),
		rawStackRatio: toRoundedNumber(rawStackRatio),
		stackRatio: toRoundedNumber(stackRatio),
		commitmentPressure: toRoundedNumber(commitmentPressure),
		commitmentPenalty: toRoundedNumber(commitmentPenalty),
		eliminationRisk: toRoundedNumber(eliminationRisk),
		eliminationPenalty: toRoundedNumber(eliminationPenalty),
		adjustedEliminationPenalty: toRoundedNumber(adjustedEliminationPenalty),
		eliminationReliefCandidate,
		eliminationReliefApplied,
		positionFactor: toRoundedNumber(positionFactor),
		activeOpponents,
		activePlayers: activeOpponents + 1,
		effectiveStack,
		previousStreetCheckedThrough,
		flopCheckedThrough: streetLineRead.flopCheckedThrough,
		turnCheckedThrough: streetLineRead.turnCheckedThrough,
		priorCheckedThroughCount: streetLineRead.priorCheckedThroughCount,
		priorAggressiveStreetCount: streetLineRead.priorAggressiveStreetCount,
		passiveLineDepth: streetLineRead.passiveLineDepth,
		doubleCheckedThrough: streetLineRead.doubleCheckedThrough,
		streetCheckCount: streetLineRead.streetCheckCount,
		streetAggressiveActionCount: streetLineRead.streetAggressiveActionCount,
		noBet: noBetTag === "Y",
		canRaiseOpportunity: canRaiseTag === "Y",
		actingSlotIndex,
		actingSlotCount,
		actingSlotKey: actingSlotTag,
		raiseThreshold: toRoundedNumber(loggedRaiseThreshold / 10),
		aggressiveness: toRoundedNumber(aggressiveness),
		raiseLevel,
		raiseAdjustment: toRoundedNumber(raiseLevel * RERAISE_RATIO_STEP),
		spotType,
		structureTag,
		pressureTag,
		spotKey: `${spotType}/${structureTag}/${pressureTag}`,
		boardContext: boardCtx,
		pairClass,
		drawFlag,
		textureRisk: toRoundedNumber(textureRisk),
		liftType,
		publicHand: publicHandName,
		rawHand: rawHandName,
		rawHandRank,
		chipLeader: amChipleader,
		shortStack: shortstackRelative,
		premium: premiumHand,
		preflopSeat,
		preflopSeatContext,
		strengthScore: toRoundedNumber(preflopScores.strengthScore),
		playabilityScore: toRoundedNumber(preflopScores.playabilityScore),
		dominationPenalty: toRoundedNumber(preflopScores.dominationPenalty),
		openRaiseScore: toRoundedNumber(preflopScores.openRaiseScore),
		openLimpScore: toRoundedNumber(preflopScores.openLimpScore),
		flatScore: toRoundedNumber(preflopScores.flatScore),
		defendScore: toRoundedNumber(preflopScores.defendScore),
		threeBetValueScore: toRoundedNumber(preflopScores.threeBetValueScore),
		threeBetBluffScore: toRoundedNumber(preflopScores.threeBetBluffScore),
		pushScore: toRoundedNumber(preflopScores.pushScore),
		lineTag,
		cbetPlan,
		barrelPlan,
		cbetMade,
		barrelMade,
		lineAbort: lineAbortFlag,
		stab: isStab,
		bluff: isBluff,
		hasPrivateMadeHand,
		marginalEdge: isMarginalEdgeHand,
		marginalReason,
		edge: toRoundedNumber(edge, 4),
		hasPrivateRaiseEdge,
		marginalDefenseBlocked,
		riverLowEdgeBlocked,
		nonValueBlocked: nonValueAggressionBlocked,
		publicScore: toRoundedNumber(publicScore, 4),
		rawScore: toRoundedNumber(rawScore, 4),
		noBetClass,
		noBetInitialAction,
		noBetFilterApplied,
		noBetBlockReason,
		checkRaiseIntentAction,
		checkRaiseIntentReason,
		checkRaiseIntentStreet: checkRaiseIntentAction
			? getCheckRaiseStreetName(streetIndex)
			: botLine?.checkRaiseIntent?.street ?? null,
		passiveValueCheckAction,
		passiveValueCheckReason,
		passiveValueCheckBlockReason,
		passiveValueCheckStreet: passiveValueCheckAction
			? getCheckRaiseStreetName(streetIndex)
			: botLine?.passiveValueCheckIntent?.street ?? null,
		sizingKind: sizingMeta.sizingKind,
		targetSizeBucket: sizingMeta.targetSizeBucket,
		expectedRaiseAmount: sizingMeta.expectedRaiseAmount,
		offBucket: sizingMeta.offBucket,
		offBucketReason: sizingMeta.offBucketReason,
	};

	if (DEBUG_DECISIONS) {
		console.log(
			`${player.name} ${h1} ${h2} → ${decision.action} | ` +
				`H:${handName} Amt:${decision.amount ?? 0} | ` +
				`PA:${strengthRatio.toFixed(2)} PS:${strengthRatio.toFixed(2)} ` +
				`PAS:${privateAwareStrength.toFixed(2)} EBo:${edgeBoost.toFixed(4)} ` +
				`M:${mRatio.toFixed(2)} Z:${mZone} | ` +
				`PO:${potOdds.toFixed(2)} CB:${eliminationBarrier.toFixed(2)} MDFa:${
					mdfRequiredFoldRate.toFixed(2)
				} ` +
				`SR:${stackRatio.toFixed(2)} SRaw:${rawStackRatio.toFixed(2)} | ` +
				`CP:${commitmentPressure.toFixed(2)} CPen:${commitmentPenalty.toFixed(2)} | ` +
				`ER:${eliminationRisk.toFixed(2)} EP:${eliminationPenalty.toFixed(2)} | ` +
				`Pos:${positionFactor.toFixed(2)} Opp:${activeOpponents} Eff:${effectiveStack} | ` +
				`NB:${noBetTag} CR:${canRaiseTag} Act:${actingSlotTag} | ` +
				`RT10:${(loggedRaiseThreshold / 10).toFixed(2)} Agg:${
					aggressiveness.toFixed(2)
				} RL:${raiseLevel} RAdj:${(raiseLevel * RERAISE_RATIO_STEP).toFixed(2)} | ` +
				`Spot:${spotType}/${structureTag}/${pressureTag} | ` +
				`Pre:${preflopSeatTag} | ` +
				`Str:${preflopScores.strengthScore.toFixed(2)} Pla:${preflopScores.playabilityScore.toFixed(2)} Dom:${
					preflopScores.dominationPenalty.toFixed(2)
				} | ` +
				`OR:${preflopScores.openRaiseScore.toFixed(2)} OL:${preflopScores.openLimpScore.toFixed(2)} FL:${
					preflopScores.flatScore.toFixed(2)
				} DF:${preflopScores.defendScore.toFixed(2)} 3V:${preflopScores.threeBetValueScore.toFixed(2)} 3B:${
					preflopScores.threeBetBluffScore.toFixed(2)
				} PS:${preflopScores.pushScore.toFixed(2)} | ` +
				`Ctx:${boardCtx} Pair:${pairClass} Draw:${drawFlag} Tex:${textureRisk.toFixed(2)} LT:${liftType} | ` +
				`PH:${publicHandName} RH:${rawHandName} RHR:${rawHandRank} | ` +
				`Pub:${publicScore.toFixed(4)} Raw:${rawScore.toFixed(4)} ` +
				`PMH:${hasPrivateMadeHand ? "Y" : "N"} Edge:${edge.toFixed(4)} ` +
				`PRE:${hasPrivateRaiseEdge ? "Y" : "N"} ` +
				`ME:${isMarginalEdgeHand ? "Y" : "N"} MR:${marginalReason ?? "-"} | ` +
				`NVB:${nonValueAggressionBlocked ? "Y" : "N"} | ` +
				`CL:${amChipleader ? "Y" : "N"} SS:${shortstackRelative ? "Y" : "N"} Prem:${
					premiumHand ? "Y" : "N"
				} | ` +
				`Line:${lineTag} CP:${cbetPlan} BP:${barrelPlan} CM:${cbetMade} BM:${barrelMade} LA:${lineAbortFlag} | ` +
				`CRI:${checkRaiseIntentAction ?? "-"} CRR:${checkRaiseIntentReason ?? "-"} | ` +
				`PVC:${passiveValueCheckAction ?? "-"} PVR:${passiveValueCheckReason ?? "-"} PVB:${
					passiveValueCheckBlockReason ?? "-"
				} | ` +
				`Stab:${isStab ? "Y" : "N"} Bluff:${isBluff ? "Y" : "N"}`,
		);
	}
	if (botDecisionSink) {
		botDecisionSink(structuredDecision);
	}
	logSpeedmodeEvent("bot_decision", structuredDecision);

	return decision;
}
