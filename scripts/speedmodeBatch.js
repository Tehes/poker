const DEFAULT_RUN_COUNT = 1;
const DEFAULT_SERVER_PORT = 8123;
const DEFAULT_DEVTOOLS_PORT = 9222;
const DEFAULT_PAGE_PATH = "index.html?speedmode=1&botdebug=detail";
const DEFAULT_OUTPUT_BASE = "tmp";
const DEFAULT_OUTPUT_PREFIX = "poker-speedmode-batch";
const LOAD_TIMEOUT_MS = 15000;
const RUN_TIMEOUT_MS = 180000;
const PAGE_READY_TIMEOUT_MS = 15000;
const POST_RUN_DRAIN_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 500;
const SPEEDMODE_EVENT_PREFIX = "speedmode_event ";
const PUBLIC_MADE_HANDS = new Set([
	"Pair",
	"Two Pair",
	"Three of a Kind",
	"Straight",
	"Flush",
	"Full House",
	"Four of a Kind",
	"Straight Flush",
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
const TOP_TIER_POSTFLOP_HANDS = new Set([
	"Straight",
	"Flush",
	"Full House",
	"Four of a Kind",
	"Straight Flush",
]);
const PREMIUM_PAIR_BOARD_CONTEXTS = new Set(["TP", "OP"]);
const WEAK_PAIR_LIKE_BOARD_CONTEXTS = new Set(["SP", "WP", "UP", "BP", "PBP"]);
const BELOW_TRIPS_POSTFLOP_HANDS = new Set([
	"High Card",
	"Pair",
	"Two Pair",
]);
const RERAISE_LOW_EDGE_THRESHOLD = 1.0;
const DEAD_PRIVATE_MADE_HAND_EQ_THRESHOLD = 5;
const CARD_RANK_ORDER = "23456789TJQKA";
const HIGH_BOARD_MIN_RANK_INDEX = CARD_RANK_ORDER.indexOf("T");
const BAD_PRICE_POT_ODDS = 0.18;
const LARGE_RIVER_POT_ODDS = 0.2;
const CONTENT_TYPES = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
};
const START_CAPTURE_EXPRESSION = `(() => {
	window.__capturedLogs = [];
	const originalLog = console.log.bind(console);
	console.log = (...args) => {
		const text = args.map((arg) => {
			if (typeof arg === "string") {
				return arg;
			}
			try {
				return JSON.stringify(arg);
			} catch {
				return String(arg);
			}
		}).join(" ");
		window.__capturedLogs.push(text);
		return originalLog(...args);
	};
	const startButton = document.getElementById("start-button");
	if (!startButton) {
		throw new Error("start-button not found");
	}
	window.__speedmodeBatchStarted = true;
	startButton.click();
	return true;
})()`;
const PAGE_READY_EXPRESSION = `(() => !!window.poker && !!document.getElementById("start-button"))()`;
const RUN_STATE_EXPRESSION = `(() => {
	const poker = window.poker;
	const players = poker?.players ?? [];
	const livePlayers = players.filter((player) => player.chips > 0);
	const finished = !!window.__speedmodeBatchStarted &&
		poker?.gameFinished === true &&
		poker?.handInProgress === false;
	return {
		finished,
		activePlayers: livePlayers.length,
		champion: livePlayers.length === 1 ? livePlayers[0].name : null,
		logCount: window.__capturedLogs?.length ?? 0,
		maxHands: players.reduce((value, player) => Math.max(value, player.stats?.hands ?? 0), 0),
	};
})()`;
const RUN_PAYLOAD_EXPRESSION = `(() => {
	const poker = window.poker;
	const players = poker?.players ?? [];
	const livePlayers = players.filter((player) => player.chips > 0);
	const finished = !!window.__speedmodeBatchStarted &&
		poker?.gameFinished === true &&
		poker?.handInProgress === false;
	return {
		finished,
		players: players.map((player) => ({ name: player.name, chips: player.chips })),
		logs: window.__capturedLogs ?? [],
	};
})()`;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function incrementCount(target, key, amount = 1) {
	target[key] = (target[key] || 0) + amount;
}

function incrementNestedCount(target, outerKey, innerKey, amount = 1) {
	if (!target[outerKey]) {
		target[outerKey] = {};
	}
	target[outerKey][innerKey] = (target[outerKey][innerKey] || 0) + amount;
}

function incrementTripleNestedCount(target, firstKey, secondKey, thirdKey, amount = 1) {
	if (!target[firstKey]) {
		target[firstKey] = {};
	}
	if (!target[firstKey][secondKey]) {
		target[firstKey][secondKey] = {};
	}
	target[firstKey][secondKey][thirdKey] = (target[firstKey][secondKey][thirdKey] || 0) +
		amount;
}

function incrementNestedPathCount(target, keys, amount = 1) {
	let current = target;
	for (let index = 0; index < keys.length - 1; index += 1) {
		const key = keys[index];
		if (!current[key]) {
			current[key] = {};
		}
		current = current[key];
	}

	const finalKey = keys.at(-1);
	current[finalKey] = (current[finalKey] || 0) + amount;
}

function incrementQualityClassOutcome(target, qualityClass, decision) {
	if (!target[qualityClass]) {
		target[qualityClass] = {
			total: 0,
			winner: 0,
			loser: 0,
			unknown: 0,
			net: 0,
		};
	}

	const row = target[qualityClass];
	row.total += 1;
	if (decision.winnerSide === "winner") {
		row.winner += 1;
	} else if (decision.winnerSide === "loser") {
		row.loser += 1;
	} else {
		row.unknown += 1;
	}
	if (typeof decision.netChipDelta === "number") {
		row.net += decision.netChipDelta;
	}
}

function deepMergeCounts(target, source) {
	for (const [key, value] of Object.entries(source)) {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
				target[key] = {};
			}
			deepMergeCounts(target[key], value);
		} else {
			target[key] = (target[key] || 0) + value;
		}
	}
}

function parseSpeedmodeEventLine(line) {
	if (!line.startsWith(SPEEDMODE_EVENT_PREFIX)) {
		return null;
	}

	try {
		const payload = JSON.parse(line.slice(SPEEDMODE_EVENT_PREFIX.length));
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			return null;
		}
		return payload;
	} catch {
		return null;
	}
}

function createEmptyWinnerSideRow() {
	return {
		total: 0,
		winner: 0,
		loser: 0,
	};
}

function createEmptyOutcomeMetricsAccumulator() {
	return {
		decisionJoinCoverage: {
			totalDecisions: 0,
			joinedDecisions: 0,
			missingHandId: 0,
			missingHandStart: 0,
			missingHandResult: 0,
			totalHands: 0,
			joinedHands: 0,
			missingHandResults: 0,
		},
		winnerSideByPhaseAction: {},
		winnerSideByLiftAction: {},
		protectiveFoldCounts: {
			total: 0,
			preflop: 0,
			postflop: 0,
		},
		favoriteStrongHandFoldCounts: {
			total: 0,
			preflop: 0,
			postflop: 0,
		},
		nonStructuralMadeHandRaiseOutcome: {
			total: 0,
			winner: 0,
			loser: 0,
		},
		showdownVsUncontestedByAction: {},
	};
}

function incrementWinnerSideBreakdown(target, outerKey, innerKey, wonHand) {
	if (!target[outerKey]) {
		target[outerKey] = {};
	}
	if (!target[outerKey][innerKey]) {
		target[outerKey][innerKey] = createEmptyWinnerSideRow();
	}
	target[outerKey][innerKey].total += 1;
	if (wonHand) {
		target[outerKey][innerKey].winner += 1;
	} else {
		target[outerKey][innerKey].loser += 1;
	}
}

function finalizeWinnerSideRow(row) {
	return {
		total: row.total,
		winner: row.winner,
		loser: row.loser,
		winnerPct: row.total > 0 ? Number(((row.winner / row.total) * 100).toFixed(1)) : 0,
	};
}

function finalizeWinnerSideBreakdown(target) {
	return Object.fromEntries(
		Object.entries(target).map(([outerKey, innerTarget]) => [
			outerKey,
			Object.fromEntries(
				Object.entries(innerTarget).map(([innerKey, row]) => [
					innerKey,
					finalizeWinnerSideRow(row),
				]),
			),
		]),
	);
}

function finalizeOutcomeMetrics(metrics) {
	const decisionJoinCoverage = {
		...metrics.decisionJoinCoverage,
		pct: metrics.decisionJoinCoverage.totalDecisions > 0
			? Number(
				(
					(metrics.decisionJoinCoverage.joinedDecisions /
						metrics.decisionJoinCoverage.totalDecisions) * 100
				).toFixed(1),
			)
			: 0,
	};
	return {
		decisionJoinCoverage,
		winnerSideByPhaseAction: finalizeWinnerSideBreakdown(metrics.winnerSideByPhaseAction),
		winnerSideByLiftAction: finalizeWinnerSideBreakdown(metrics.winnerSideByLiftAction),
		protectiveFoldCounts: { ...metrics.protectiveFoldCounts },
		favoriteStrongHandFoldCounts: { ...metrics.favoriteStrongHandFoldCounts },
		nonStructuralMadeHandRaiseOutcome: {
			...metrics.nonStructuralMadeHandRaiseOutcome,
			winnerPct: metrics.nonStructuralMadeHandRaiseOutcome.total > 0
				? Number(
					(
						(metrics.nonStructuralMadeHandRaiseOutcome.winner /
							metrics.nonStructuralMadeHandRaiseOutcome.total) * 100
					).toFixed(1),
				)
				: 0,
		},
		showdownVsUncontestedByAction: structuredClone(metrics.showdownVsUncontestedByAction),
	};
}

function mergeOutcomeMetrics(target, source) {
	deepMergeCounts(target, source);
}

function flagToState(flag) {
	if (flag === "Y") {
		return "yes";
	}
	if (flag === "N") {
		return "no";
	}
	return "unknown";
}

function bucketPositionFactor(positionFactor) {
	if (positionFactor <= 0.2) {
		return "very-early";
	}
	if (positionFactor <= 0.4) {
		return "early";
	}
	if (positionFactor <= 0.6) {
		return "middle";
	}
	if (positionFactor <= 0.8) {
		return "late";
	}
	return "last";
}

function bucketEliminationRisk(eliminationRisk) {
	if (eliminationRisk <= 0) {
		return "none";
	}
	if (eliminationRisk >= 1) {
		return "max";
	}
	if (eliminationRisk >= 0.66) {
		return "high";
	}
	if (eliminationRisk >= 0.33) {
		return "medium";
	}
	return "low";
}

function bucketStackRatio(stackRatio) {
	if (stackRatio <= 0.1) {
		return "tiny";
	}
	if (stackRatio <= 0.25) {
		return "small";
	}
	if (stackRatio <= 0.5) {
		return "medium";
	}
	if (stackRatio <= 0.75) {
		return "large";
	}
	return "all-in";
}

function bucketCommitmentPressure(commitmentPressure) {
	if (commitmentPressure <= 0) {
		return "none";
	}
	if (commitmentPressure <= 0.25) {
		return "low";
	}
	if (commitmentPressure <= 0.5) {
		return "medium";
	}
	if (commitmentPressure <= 0.75) {
		return "high";
	}
	return "max";
}

function bucketRaiseLevel(raiseLevel) {
	return raiseLevel >= 3 ? "3+" : String(raiseLevel);
}

function bucketDecisionScore(score) {
	const clamped = Math.max(0, Math.min(10, score));
	if (clamped >= 10) {
		return "10.0";
	}
	const start = Math.floor(clamped);
	return `${start}-${start + 1}`;
}

function bucketDominationPenalty(score) {
	const clamped = Math.max(0, Math.min(1.5, score));
	if (clamped >= 1.5) {
		return "1.50";
	}
	const start = Math.floor(clamped * 4) / 4;
	const end = Math.min(1.5, start + 0.25);
	return `${start.toFixed(2)}-${end.toFixed(2)}`;
}

function bucketRequiredFoldRate(requiredFoldRate) {
	const clamped = Math.max(0, Math.min(1, requiredFoldRate));
	if (clamped <= 0.17) {
		return "<=17%";
	}
	if (clamped <= 0.25) {
		return "17-25%";
	}
	if (clamped <= 0.33) {
		return "25-33%";
	}
	if (clamped <= 0.5) {
		return "33-50%";
	}
	if (clamped <= 0.67) {
		return "50-67%";
	}
	return ">67%";
}

function bucketBetToPotRatio(toCall, potBefore) {
	if (!(toCall > 0) || !(potBefore > toCall)) {
		return "n/a";
	}

	const ratio = toCall / Math.max(1, potBefore - toCall);
	if (ratio <= 0.25) {
		return "<=25%";
	}
	if (ratio <= 0.5) {
		return "25-50%";
	}
	if (ratio <= 0.75) {
		return "50-75%";
	}
	if (ratio <= 1) {
		return "75-100%";
	}
	if (ratio <= 1.5) {
		return "100-150%";
	}
	return ">150%";
}

function bucketMarginToCall(marginToCall) {
	if (typeof marginToCall !== "number") {
		return "n/a";
	}
	if (marginToCall <= 0) {
		return "<=0";
	}
	if (marginToCall <= 0.02) {
		return "0-0.02";
	}
	if (marginToCall <= 0.03) {
		return "0.02-0.03";
	}
	if (marginToCall <= 0.04) {
		return "0.03-0.04";
	}
	if (marginToCall <= 0.06) {
		return "0.04-0.06";
	}
	if (marginToCall <= 0.08) {
		return "0.06-0.08";
	}
	if (marginToCall <= 0.12) {
		return "0.08-0.12";
	}
	return ">0.12";
}

function pushExample(target, line, limit = 10) {
	if (target.length < limit) {
		target.push(line);
	}
}

function createEmptyFoldRateRow() {
	return {
		total: 0,
		folds: 0,
		defends: 0,
		requiredFoldRateSum: 0,
	};
}

function incrementFoldRateRow(target, action, requiredFoldRate) {
	target.total += 1;
	if (action === "fold") {
		target.folds += 1;
	} else {
		target.defends += 1;
	}
	target.requiredFoldRateSum += requiredFoldRate;
}

function incrementFoldRateBreakdown(target, key, action, requiredFoldRate) {
	if (!target[key]) {
		target[key] = createEmptyFoldRateRow();
	}
	incrementFoldRateRow(target[key], action, requiredFoldRate);
}

function incrementNestedFoldRateBreakdown(
	target,
	firstKey,
	secondKey,
	action,
	requiredFoldRate,
) {
	if (!target[firstKey]) {
		target[firstKey] = {};
	}
	if (!target[firstKey][secondKey]) {
		target[firstKey][secondKey] = createEmptyFoldRateRow();
	}
	incrementFoldRateRow(target[firstKey][secondKey], action, requiredFoldRate);
}

function incrementTripleNestedFoldRateBreakdown(
	target,
	firstKey,
	secondKey,
	thirdKey,
	action,
	requiredFoldRate,
) {
	if (!target[firstKey]) {
		target[firstKey] = {};
	}
	if (!target[firstKey][secondKey]) {
		target[firstKey][secondKey] = {};
	}
	if (!target[firstKey][secondKey][thirdKey]) {
		target[firstKey][secondKey][thirdKey] = createEmptyFoldRateRow();
	}
	incrementFoldRateRow(target[firstKey][secondKey][thirdKey], action, requiredFoldRate);
}

function summarizeFoldRateRow(row) {
	if (!row || row.total <= 0) {
		return {
			actualFoldRate: 0,
			requiredFoldRate: 0,
			overfold: 0,
		};
	}

	const actualFoldRate = row.folds / row.total;
	const requiredFoldRate = row.requiredFoldRateSum / row.total;
	return {
		actualFoldRate,
		requiredFoldRate,
		overfold: actualFoldRate - requiredFoldRate,
	};
}

function combineFoldRateRows(target) {
	const combined = createEmptyFoldRateRow();
	if (!target || typeof target !== "object" || Array.isArray(target)) {
		return combined;
	}

	for (const row of Object.values(target)) {
		if (
			!row ||
			typeof row.total !== "number" ||
			typeof row.folds !== "number" ||
			typeof row.defends !== "number" ||
			typeof row.requiredFoldRateSum !== "number"
		) {
			continue;
		}
		combined.total += row.total;
		combined.folds += row.folds;
		combined.defends += row.defends;
		combined.requiredFoldRateSum += row.requiredFoldRateSum;
	}

	return combined;
}

function summarizeFoldRateBreakdownTree(target) {
	if (!target || typeof target !== "object" || Array.isArray(target)) {
		return target;
	}

	if (
		typeof target.total === "number" &&
		typeof target.folds === "number" &&
		typeof target.defends === "number" &&
		typeof target.requiredFoldRateSum === "number"
	) {
		const summary = summarizeFoldRateRow(target);
		return {
			total: target.total,
			folds: target.folds,
			defends: target.defends,
			requiredFoldRateSum: Number(target.requiredFoldRateSum.toFixed(4)),
			actualFoldRate: Number(summary.actualFoldRate.toFixed(4)),
			requiredFoldRate: Number(summary.requiredFoldRate.toFixed(4)),
			overfold: Number(summary.overfold.toFixed(4)),
		};
	}

	return Object.fromEntries(
		Object.entries(target).map(([key, value]) => [
			key,
			summarizeFoldRateBreakdownTree(value),
		]),
	);
}

function createMdfAnalysis(mdfMetrics) {
	return {
		facingBetOverall: summarizeFoldRateBreakdownTree(
			combineFoldRateRows(mdfMetrics.facingBetByStreet),
		),
		facingBetByStreet: summarizeFoldRateBreakdownTree(mdfMetrics.facingBetByStreet),
		facingBetByStreetAndAlpha: summarizeFoldRateBreakdownTree(
			mdfMetrics.facingBetByStreetAndAlpha,
		),
		facingBetByStreetAndBetSize: summarizeFoldRateBreakdownTree(
			mdfMetrics.facingBetByStreetAndBetSize,
		),
		facingBetByStreetAndMargin: summarizeFoldRateBreakdownTree(
			mdfMetrics.facingBetByStreetAndMargin,
		),
		facingBetByStreetAndMarginAndBetSize: summarizeFoldRateBreakdownTree(
			mdfMetrics.facingBetByStreetAndMarginAndBetSize,
		),
		facingBetByStreetAndRaiseLevel: summarizeFoldRateBreakdownTree(
			mdfMetrics.facingBetByStreetAndRaiseLevel,
		),
		facingBetByStreetAndStructure: summarizeFoldRateBreakdownTree(
			mdfMetrics.facingBetByStreetAndStructure,
		),
		facingBetByStreetAndPressure: summarizeFoldRateBreakdownTree(
			mdfMetrics.facingBetByStreetAndPressure,
		),
		facingBetByStreetAndLift: summarizeFoldRateBreakdownTree(
			mdfMetrics.facingBetByStreetAndLift,
		),
		facingBetByStreetAndRawHand: summarizeFoldRateBreakdownTree(
			mdfMetrics.facingBetByStreetAndRawHand,
		),
		facingBetByQualityClass: summarizeFoldRateBreakdownTree(
			mdfMetrics.facingBetByQualityClass,
		),
		facingBetActionsByStreetAndBetSizeAndQualityReason: structuredClone(
			mdfMetrics.facingBetActionsByStreetAndBetSizeAndQualityReason,
		),
		facingBetActionsByStreetAndMarginAndBetSizeAndQualityReason: structuredClone(
			mdfMetrics.facingBetActionsByStreetAndMarginAndBetSizeAndQualityReason,
		),
		flopFacingBetByPreflopRoute: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetByPreflopRoute,
		),
		flopFacingBetByFinalPreflopRoute: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetByFinalPreflopRoute,
		),
		flopFacingBetByPreflopRouteAndReason: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetByPreflopRouteAndReason,
		),
		flopFacingBetByPreflopRouteAndHandFamily: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetByPreflopRouteAndHandFamily,
		),
		flopFacingBetByPreflopRouteAndStructure: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetByPreflopRouteAndStructure,
		),
		flopFacingBetByPreflopRouteAndPosition: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetByPreflopRouteAndPosition,
		),
		flopFacingBetByPreflopRouteAndLineRole: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetByPreflopRouteAndLineRole,
		),
		flopFacingBetHighCardNoDrawByPreflopRoute: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetHighCardNoDrawByPreflopRoute,
		),
		flopFacingBetWeakDrawBadPriceByPreflopRoute: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetWeakDrawBadPriceByPreflopRoute,
		),
		flopFacingBetByEntryRoute: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetByEntryRoute,
		),
		flopFacingBetByEntryRouteAndFinalPreflopRoute: summarizeFoldRateBreakdownTree(
			mdfMetrics.flopFacingBetByEntryRouteAndFinalPreflopRoute,
		),
		candidateOverall: summarizeFoldRateBreakdownTree(
			combineFoldRateRows(mdfMetrics.candidateByStreet),
		),
		candidateByStreet: summarizeFoldRateBreakdownTree(mdfMetrics.candidateByStreet),
		candidateByStreetAndMargin: summarizeFoldRateBreakdownTree(
			mdfMetrics.candidateByStreetAndMargin,
		),
		candidateByStreetAndBetSize: summarizeFoldRateBreakdownTree(
			mdfMetrics.candidateByStreetAndBetSize,
		),
		candidateByStreetAndMarginAndBetSize: summarizeFoldRateBreakdownTree(
			mdfMetrics.candidateByStreetAndMarginAndBetSize,
		),
		candidateByStreetAndRaiseLevel: summarizeFoldRateBreakdownTree(
			mdfMetrics.candidateByStreetAndRaiseLevel,
		),
		candidateByStreetAndStructure: summarizeFoldRateBreakdownTree(
			mdfMetrics.candidateByStreetAndStructure,
		),
		candidateByStreetAndPressure: summarizeFoldRateBreakdownTree(
			mdfMetrics.candidateByStreetAndPressure,
		),
		candidateByStreetAndLift: summarizeFoldRateBreakdownTree(
			mdfMetrics.candidateByStreetAndLift,
		),
		candidateByStreetAndRawHand: summarizeFoldRateBreakdownTree(
			mdfMetrics.candidateByStreetAndRawHand,
		),
		candidateByQualityClass: summarizeFoldRateBreakdownTree(
			mdfMetrics.candidateByQualityClass,
		),
		overrideCallCount: mdfMetrics.overrideCallCount,
		overrideCallByStreet: structuredClone(mdfMetrics.overrideCallByStreet),
		overrideCallByStreetAndMargin: structuredClone(mdfMetrics.overrideCallByStreetAndMargin),
		overrideCallByStreetAndBetSize: structuredClone(mdfMetrics.overrideCallByStreetAndBetSize),
		overrideCallByStreetAndMarginAndBetSize: structuredClone(
			mdfMetrics.overrideCallByStreetAndMarginAndBetSize,
		),
		overrideCallByStreetAndRaiseLevel: structuredClone(
			mdfMetrics.overrideCallByStreetAndRaiseLevel,
		),
		overrideCallByStreetAndStructure: structuredClone(
			mdfMetrics.overrideCallByStreetAndStructure,
		),
		overrideCallByStreetAndPressure: structuredClone(mdfMetrics.overrideCallByStreetAndPressure),
		overrideCallByStreetAndLift: structuredClone(mdfMetrics.overrideCallByStreetAndLift),
		overrideCallByStreetAndRawHand: structuredClone(mdfMetrics.overrideCallByStreetAndRawHand),
		overrideCallByQualityClass: structuredClone(mdfMetrics.overrideCallByQualityClass),
		overrideCallByQualityReason: structuredClone(mdfMetrics.overrideCallByQualityReason),
	};
}

function createEmptyPreflopTransitionMetrics() {
	return {
		unopenedRaiseAttemptsBySeatAndPlayers: {},
		unopenedRaiseUncontestedBySeatAndPlayers: {},
		unopenedRaiseFlopSeenBySeatAndPlayers: {},
		unopenedCallAttemptsBySeatAndPlayers: {},
		unopenedCallFlopSeenBySeatAndPlayers: {},
		sbHuOpen: {
			attempts: 0,
			bigBlindFold: 0,
			bigBlindCall: 0,
			bigBlindRaise: 0,
			bbDefend: 0,
			uncontested: 0,
			flopSeen: 0,
		},
		sbHuLimp: {
			attempts: 0,
			bigBlindCheck: 0,
			bigBlindRaise: 0,
			flopSeen: 0,
		},
		btn3Open: {
			attempts: 0,
			smallBlindFold: 0,
			smallBlindCall: 0,
			smallBlindRaise: 0,
			bigBlindFold: 0,
			bigBlindCall: 0,
			bigBlindRaise: 0,
			blindsDefend: 0,
			blindsFoldedThrough: 0,
			flopSeen: 0,
		},
		btn3Limp: {
			attempts: 0,
			smallBlindFold: 0,
			smallBlindCall: 0,
			smallBlindRaise: 0,
			bigBlindCheck: 0,
			bigBlindCall: 0,
			bigBlindRaise: 0,
			blindRaise: 0,
			flopSeen: 0,
		},
	};
}

function incrementTrackedBlindResponse(target, seatClass, action) {
	if (
		(seatClass !== "smallBlind" && seatClass !== "bigBlind") ||
		(action !== "fold" && action !== "call" && action !== "raise" && action !== "check")
	) {
		return;
	}

	const seatPrefix = seatClass === "smallBlind" ? "smallBlind" : "bigBlind";
	const actionSuffix = action === "fold"
		? "Fold"
		: action === "call"
		? "Call"
		: action === "check"
		? "Check"
		: "Raise";
	incrementCount(target, `${seatPrefix}${actionSuffix}`);
}

function formatDecisionExample(decision) {
	const formatFixed = (value, digits) => typeof value === "number" ? value.toFixed(digits) : "-";
	const toFlag = (value) => value ? "Y" : "N";
	const noBetClass = typeof decision.noBetClass === "string" ? decision.noBetClass : "-";
	const noBetInitialAction = typeof decision.noBetInitialAction === "string" ? decision.noBetInitialAction : "-";
	const sizingKind = typeof decision.sizingKind === "string" ? decision.sizingKind : "-";
	const targetSizeBucket = typeof decision.targetSizeBucket === "string" ? decision.targetSizeBucket : "-";
	const offBucketReason = typeof decision.offBucketReason === "string" ? decision.offBucketReason : "-";
	const checkRaiseIntentAction = typeof decision.checkRaiseIntentAction === "string"
		? decision.checkRaiseIntentAction
		: "-";
	const checkRaiseIntentReason = typeof decision.checkRaiseIntentReason === "string"
		? decision.checkRaiseIntentReason
		: "-";
	const passiveValueCheckAction = typeof decision.passiveValueCheckAction === "string"
		? decision.passiveValueCheckAction
		: "-";
	const passiveValueCheckReason = typeof decision.passiveValueCheckReason === "string"
		? decision.passiveValueCheckReason
		: "-";
	const passiveValueCheckBlockReason = typeof decision.passiveValueCheckBlockReason === "string"
		? decision.passiveValueCheckBlockReason
		: "-";

	return `${decision.player} → ${decision.action} | ` +
		`H:${decision.handName} Amt:${decision.amount ?? 0} | ` +
		`Spot:${decision.spotKey} | ` +
		`Ctx:${decision.boardContext} Draw:${decision.drawFlag} LT:${decision.liftType} | ` +
		`PH:${decision.publicHand} RH:${decision.rawHand} RHR:${decision.rawHandRank ?? "-"} | ` +
		`Pub:${formatFixed(decision.publicScore, 4)} Raw:${formatFixed(decision.rawScore, 4)} ` +
		`PMH:${toFlag(decision.hasPrivateMadeHand)} Edge:${formatFixed(decision.edge, 4)} ` +
		`PRE:${toFlag(decision.hasPrivateRaiseEdge)} ` +
		`ME:${toFlag(decision.marginalEdge)} MR:${decision.marginalReason ?? "-"} ` +
		`SRaw:${formatFixed(decision.strengthRatioRaw, 2)} ` +
		`EBo:${formatFixed(decision.edgeBoost, 4)} ` +
		`PAS:${formatFixed(decision.privateAwareStrength, 2)} ` +
		`MDFa:${formatFixed(decision.mdfRequiredFoldRate, 3)} ` +
		`MDFm:${formatFixed(decision.mdfMarginToCall, 3)} ` +
		`MDFc:${formatFixed(decision.mdfCallChance, 3)} ` +
		`MDF:${toFlag(decision.mdfApplied)} | ` +
		`NVB:${toFlag(decision.nonValueBlocked)} | ` +
		`ERC:${toFlag(decision.eliminationReliefCandidate)} ` +
		`ERA:${toFlag(decision.eliminationReliefApplied)} | ` +
		`Line:${decision.lineTag} CP:${decision.cbetPlan} BP:${decision.barrelPlan} ` +
		`CM:${decision.cbetMade} BM:${decision.barrelMade} LA:${decision.lineAbort} | ` +
		`CRI:${checkRaiseIntentAction} CRR:${checkRaiseIntentReason} | ` +
		`PVC:${passiveValueCheckAction} PVR:${passiveValueCheckReason} PVB:${passiveValueCheckBlockReason} | ` +
		`NBCls:${noBetClass} NBInit:${noBetInitialAction} | ` +
		`SZ:${sizingKind} TB:${targetSizeBucket} OB:${toFlag(decision.offBucket)} OBR:${offBucketReason} | ` +
		`Stab:${toFlag(decision.stab)} Bluff:${toFlag(decision.bluff)}`;
}

function normalizeStructuredDecision(decision) {
	if (
		!decision || typeof decision !== "object" || Array.isArray(decision) ||
		typeof decision.action !== "string" || typeof decision.phase !== "string"
	) {
		return null;
	}

	const positionFactor = decision.positionFactor ?? 0;
	const eliminationRisk = decision.eliminationRisk ?? 0;
	const stackRatio = decision.stackRatio ?? 0;
	const commitmentPressure = decision.commitmentPressure ?? 0;
	const raiseLevel = decision.raiseLevel ?? 0;
	const strengthScore = decision.strengthScore ?? 0;
	const playabilityScore = decision.playabilityScore ?? 0;
	const dominationPenalty = decision.dominationPenalty ?? 0;
	const openRaiseScore = decision.openRaiseScore ?? 0;
	const openLimpScore = decision.openLimpScore ?? 0;
	const flatScore = decision.flatScore ?? 0;
	const lineTag = decision.lineTag ?? "-";
	const mdfRequiredFoldRate = typeof decision.mdfRequiredFoldRate === "number" ? decision.mdfRequiredFoldRate : null;
	const mdfMarginToCall = typeof decision.mdfMarginToCall === "number"
		? decision.mdfMarginToCall
		: typeof decision.callBarrier === "number" && typeof decision.privateAwareStrength === "number"
		? decision.callBarrier - decision.privateAwareStrength
		: null;
	const quality = classifyPostflopQuality(decision);

	return {
		...decision,
		line: formatDecisionExample(decision),
		preflopSeat: decision.preflopSeat ?? "-",
		preflopSeatContext: decision.preflopSeatContext ?? "-",
		cbetPlan: flagToState(decision.cbetPlan),
		barrelPlan: flagToState(decision.barrelPlan),
		cbetMade: flagToState(decision.cbetMade),
		barrelMade: flagToState(decision.barrelMade),
		lineAbort: flagToState(decision.lineAbort),
		noBetClass: typeof decision.noBetClass === "string" ? decision.noBetClass : null,
		noBetInitialAction: typeof decision.noBetInitialAction === "string" ? decision.noBetInitialAction : null,
		noBetFilterApplied: decision.noBetFilterApplied === true,
		noBetBlockReason: typeof decision.noBetBlockReason === "string" ? decision.noBetBlockReason : null,
		checkRaiseIntentAction: typeof decision.checkRaiseIntentAction === "string"
			? decision.checkRaiseIntentAction
			: null,
		checkRaiseIntentReason: typeof decision.checkRaiseIntentReason === "string"
			? decision.checkRaiseIntentReason
			: null,
		checkRaiseIntentStreet: typeof decision.checkRaiseIntentStreet === "string"
			? decision.checkRaiseIntentStreet
			: null,
		passiveValueCheckAction: typeof decision.passiveValueCheckAction === "string"
			? decision.passiveValueCheckAction
			: null,
		passiveValueCheckReason: typeof decision.passiveValueCheckReason === "string"
			? decision.passiveValueCheckReason
			: null,
		passiveValueCheckBlockReason: typeof decision.passiveValueCheckBlockReason === "string"
			? decision.passiveValueCheckBlockReason
			: null,
		passiveValueCheckStreet: typeof decision.passiveValueCheckStreet === "string"
			? decision.passiveValueCheckStreet
			: null,
		eliminationReliefCandidate: decision.eliminationReliefCandidate === true,
		eliminationReliefApplied: decision.eliminationReliefApplied === true,
		marginalEdge: decision.marginalEdge === true,
		marginalReason: typeof decision.marginalReason === "string" ? decision.marginalReason : null,
		mdfEligible: decision.mdfEligible === true,
		mdfApplied: decision.mdfApplied === true,
		mdfRequiredFoldRate,
		mdfRequiredDefense: typeof decision.mdfRequiredDefense === "number" ? decision.mdfRequiredDefense : null,
		mdfMarginToCall,
		mdfMarginWindow: typeof decision.mdfMarginWindow === "number" ? decision.mdfMarginWindow : null,
		mdfCallChance: typeof decision.mdfCallChance === "number" ? decision.mdfCallChance : null,
		sizingKind: typeof decision.sizingKind === "string" ? decision.sizingKind : null,
		targetSizeBucket: typeof decision.targetSizeBucket === "string" ? decision.targetSizeBucket : null,
		expectedRaiseAmount: typeof decision.expectedRaiseAmount === "number" ? decision.expectedRaiseAmount : null,
		offBucket: decision.offBucket === true,
		offBucketReason: typeof decision.offBucketReason === "string" ? decision.offBucketReason : null,
		rawHandRank: typeof decision.rawHandRank === "number" ? decision.rawHandRank : null,
		lineRole: lineTag === "PFA" ? "pfa" : "other",
		positionBucket: bucketPositionFactor(positionFactor),
		eliminationRiskBucket: bucketEliminationRisk(eliminationRisk),
		stackRatioBucket: bucketStackRatio(stackRatio),
		commitmentBucket: bucketCommitmentPressure(commitmentPressure),
		raiseLevelBucket: bucketRaiseLevel(raiseLevel),
		strengthScoreBucket: bucketDecisionScore(strengthScore),
		playabilityScoreBucket: bucketDecisionScore(playabilityScore),
		dominationPenaltyBucket: bucketDominationPenalty(dominationPenalty),
		openRaiseScoreBucket: bucketDecisionScore(openRaiseScore),
		openLimpScoreBucket: bucketDecisionScore(openLimpScore),
		flatScoreBucket: bucketDecisionScore(flatScore),
		mdfRequiredFoldRateBucket: mdfRequiredFoldRate === null ? "n/a" : bucketRequiredFoldRate(mdfRequiredFoldRate),
		mdfBetSizeBucket: bucketBetToPotRatio(decision.toCall ?? 0, decision.potBefore ?? 0),
		mdfMarginBucket: bucketMarginToCall(mdfMarginToCall),
		qualityClass: quality.qualityClass,
		qualityReason: quality.qualityReason,
	};
}

function groupDecisionsByHandId(decisions) {
	const grouped = new Map();

	for (const decision of decisions) {
		if (typeof decision.handId !== "number") {
			continue;
		}
		if (!grouped.has(decision.handId)) {
			grouped.set(decision.handId, []);
		}
		grouped.get(decision.handId).push(decision);
	}

	for (const handDecisions of grouped.values()) {
		handDecisions.sort((a, b) => (a.decisionId ?? 0) - (b.decisionId ?? 0));
	}

	return grouped;
}

function classifyPreflopRoute(decision) {
	if (!decision || decision.phase !== "preflop") {
		return "unknown";
	}
	if (decision.action === "check") {
		return "bbFreeCheck";
	}
	if (decision.action === "call") {
		if (decision.spotType === "UO") {
			return "openLimp";
		}
		if (decision.spotType === "L") {
			return "overlimpOrComplete";
		}
		if (decision.spotType === "SR") {
			return "callVsRaise";
		}
		if (decision.spotType === "MR") {
			return "callVsMultiRaise";
		}
		return "unknown";
	}
	if (decision.action !== "raise") {
		return "unknown";
	}
	if (decision.sizingKind === "preflop-harrington") {
		return "harringtonRaise";
	}
	if (decision.sizingKind === "preflop-open") {
		return "openRaise";
	}
	if (decision.sizingKind === "preflop-iso") {
		return "isoRaise";
	}
	if (decision.sizingKind === "preflop-3bet") {
		return "threeBet";
	}
	if (decision.sizingKind === "preflop-squeeze") {
		return "squeeze";
	}
	if (
		decision.sizingKind === "preflop-4bet" ||
		decision.sizingKind === "preflop-5bet-plus"
	) {
		return "fourBetPlus";
	}
	if (decision.spotType === "UO") {
		return "openRaise";
	}
	if (decision.spotType === "L") {
		return "isoRaise";
	}
	if (decision.spotType === "SR") {
		return "threeBet";
	}
	if (decision.spotType === "MR") {
		return "fourBetPlus";
	}
	return "unknown";
}

function classifyPreflopHandFamily(holeCards) {
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

function getPostflopPositionRole(decision) {
	return decision.actingSlotIndex === decision.actingSlotCount ? "IP" : "OOP";
}

function getPostflopLineRole(decision) {
	return decision.lineTag === "PFA" ? "PFA" : "nonPFA";
}

function buildPreflopEntryByHandAndSeat(decisions) {
	const entries = new Map();

	for (const decision of decisions) {
		if (decision.phase !== "preflop" || decision.action === "fold") {
			continue;
		}
		if (typeof decision.handId !== "number" || typeof decision.seatIndex !== "number") {
			continue;
		}
		const key = `${decision.handId}:${decision.seatIndex}`;
		const route = classifyPreflopRoute(decision);
		const handFamily = classifyPreflopHandFamily(decision.holeCards);
		const currentEntry = entries.get(key);
		entries.set(key, {
			entryRoute: currentEntry?.entryRoute ?? route,
			finalPreflopRoute: route,
			handFamily,
		});
	}

	return entries;
}

function analyzeBlockedNoBetRaiseFollowups(decisions, metrics) {
	const decisionsByHandId = groupDecisionsByHandId(decisions);

	for (const handDecisions of decisionsByHandId.values()) {
		for (const decision of handDecisions) {
			if (
				decision.phase !== "postflop" ||
				decision.noBetFilterApplied !== true ||
				decision.noBetInitialAction !== "raise"
			) {
				continue;
			}

			const laterFacingBetDecision = handDecisions.find((laterDecision) =>
				laterDecision.seatIndex === decision.seatIndex &&
				(laterDecision.decisionId ?? 0) > (decision.decisionId ?? 0) &&
				laterDecision.phase === "postflop" &&
				laterDecision.toCall > 0
			);

			if (!laterFacingBetDecision) {
				metrics.postflop.blockedNoBetRaiseWithoutLaterFacingBetCount += 1;
				continue;
			}

			metrics.postflop.blockedNoBetRaiseLaterFacingBetCount += 1;
			incrementCount(
				metrics.postflop.blockedNoBetRaiseLaterFacingBetActions,
				laterFacingBetDecision.action,
			);
		}
	}
}

function isAutoValueCheckDecision(decision) {
	return decision.phase === "postflop" &&
		decision.noBet === true &&
		decision.canRaiseOpportunity === true &&
		decision.noBetClass === "auto-value" &&
		decision.action === "check";
}

function analyzeAutoValueCheckFollowups(decisions, metrics) {
	const decisionsByHandId = groupDecisionsByHandId(decisions);

	for (const handDecisions of decisionsByHandId.values()) {
		for (const decision of handDecisions) {
			if (!isAutoValueCheckDecision(decision)) {
				continue;
			}

			const laterFacingBetDecision = handDecisions.find((laterDecision) =>
				laterDecision.seatIndex === decision.seatIndex &&
				(laterDecision.decisionId ?? 0) > (decision.decisionId ?? 0) &&
				laterDecision.phase === "postflop" &&
				laterDecision.toCall > 0
			);

			if (!laterFacingBetDecision) {
				continue;
			}

			metrics.postflop.autoValueCheckLaterFacingBetCount += 1;
			if (laterFacingBetDecision.action === "fold") {
				metrics.postflop.autoValueCheckLaterFacingBetFolds += 1;
				pushExample(
					metrics.examples.postflopAutoValueCheckLaterFacingBetFold,
					`${decision.line} -> ${laterFacingBetDecision.line}`,
				);
			}
		}
	}
}

function analyzePreflopTransitions(decisions, hands, metrics) {
	const decisionsByHandId = groupDecisionsByHandId(decisions);

	for (const hand of hands) {
		const handDecisions = decisionsByHandId.get(hand.handId) ?? [];
		const preflopDecisions = handDecisions.filter((decision) => decision.phase === "preflop");
		if (!preflopDecisions.length) {
			continue;
		}

		const sawFlop = handDecisions.some((decision) => decision.phase === "postflop") ||
			(hand.handResult?.communityCards?.length ?? 0) >= 3;

		const openRaiseIndex = preflopDecisions.findIndex((decision) =>
			decision.spotType === "UO" && decision.action === "raise" &&
			decision.preflopSeat !== "-"
		);
		if (openRaiseIndex !== -1) {
			const openDecision = preflopDecisions[openRaiseIndex];
			const remainingPreflopDecisions = preflopDecisions.slice(openRaiseIndex + 1);
			const seatKey = openDecision.preflopSeat;
			const playerKey = String(openDecision.activePlayers);
			const uncontested = remainingPreflopDecisions.length > 0 &&
				remainingPreflopDecisions.every((decision) => decision.action === "fold") &&
				!sawFlop;

			incrementNestedCount(
				metrics.preflop.transitions.unopenedRaiseAttemptsBySeatAndPlayers,
				seatKey,
				playerKey,
			);
			if (uncontested) {
				incrementNestedCount(
					metrics.preflop.transitions.unopenedRaiseUncontestedBySeatAndPlayers,
					seatKey,
					playerKey,
				);
			}
			if (sawFlop) {
				incrementNestedCount(
					metrics.preflop.transitions.unopenedRaiseFlopSeenBySeatAndPlayers,
					seatKey,
					playerKey,
				);
			}

			if (seatKey === "smallBlind" && openDecision.activePlayers === 2) {
				const bbResponse = remainingPreflopDecisions.find((decision) => decision.preflopSeat === "bigBlind");
				metrics.preflop.transitions.sbHuOpen.attempts += 1;
				if (bbResponse) {
					incrementTrackedBlindResponse(
						metrics.preflop.transitions.sbHuOpen,
						"bigBlind",
						bbResponse.action,
					);
					if (bbResponse.action === "call" || bbResponse.action === "raise") {
						metrics.preflop.transitions.sbHuOpen.bbDefend += 1;
					}
				}
				if (uncontested) {
					metrics.preflop.transitions.sbHuOpen.uncontested += 1;
				}
				if (sawFlop) {
					metrics.preflop.transitions.sbHuOpen.flopSeen += 1;
				}
			}

			if (seatKey === "button" && openDecision.activePlayers === 3) {
				const sbResponse = remainingPreflopDecisions.find((decision) => decision.preflopSeat === "smallBlind");
				const bbResponse = remainingPreflopDecisions.find((decision) => decision.preflopSeat === "bigBlind");
				const blindsDefended = [sbResponse, bbResponse].some((decision) =>
					decision && (decision.action === "call" || decision.action === "raise")
				);
				const blindsFoldedThrough = sbResponse?.action === "fold" &&
					bbResponse?.action === "fold";

				metrics.preflop.transitions.btn3Open.attempts += 1;
				if (sbResponse) {
					incrementTrackedBlindResponse(
						metrics.preflop.transitions.btn3Open,
						"smallBlind",
						sbResponse.action,
					);
				}
				if (bbResponse) {
					incrementTrackedBlindResponse(
						metrics.preflop.transitions.btn3Open,
						"bigBlind",
						bbResponse.action,
					);
				}
				if (blindsDefended) {
					metrics.preflop.transitions.btn3Open.blindsDefend += 1;
				}
				if (blindsFoldedThrough) {
					metrics.preflop.transitions.btn3Open.blindsFoldedThrough += 1;
				}
				if (sawFlop) {
					metrics.preflop.transitions.btn3Open.flopSeen += 1;
				}
			}
		}

		const openCallIndex = preflopDecisions.findIndex((decision) =>
			decision.spotType === "UO" && decision.action === "call" && decision.preflopSeat !== "-"
		);
		if (openCallIndex === -1) {
			continue;
		}

		const openCallDecision = preflopDecisions[openCallIndex];
		const remainingAfterOpenCall = preflopDecisions.slice(openCallIndex + 1);
		const callSeatKey = openCallDecision.preflopSeat;
		const callPlayerKey = String(openCallDecision.activePlayers);

		incrementNestedCount(
			metrics.preflop.transitions.unopenedCallAttemptsBySeatAndPlayers,
			callSeatKey,
			callPlayerKey,
		);
		if (sawFlop) {
			incrementNestedCount(
				metrics.preflop.transitions.unopenedCallFlopSeenBySeatAndPlayers,
				callSeatKey,
				callPlayerKey,
			);
		}

		if (callSeatKey === "smallBlind" && openCallDecision.activePlayers === 2) {
			const bbResponse = remainingAfterOpenCall.find((decision) => decision.preflopSeat === "bigBlind");
			metrics.preflop.transitions.sbHuLimp.attempts += 1;
			if (bbResponse) {
				incrementTrackedBlindResponse(
					metrics.preflop.transitions.sbHuLimp,
					"bigBlind",
					bbResponse.action,
				);
			}
			if (sawFlop) {
				metrics.preflop.transitions.sbHuLimp.flopSeen += 1;
			}
		}

		if (callSeatKey === "button" && openCallDecision.activePlayers === 3) {
			const sbResponse = remainingAfterOpenCall.find((decision) => decision.preflopSeat === "smallBlind");
			const bbResponse = remainingAfterOpenCall.find((decision) => decision.preflopSeat === "bigBlind");
			const blindRaised = sbResponse?.action === "raise" || bbResponse?.action === "raise";

			metrics.preflop.transitions.btn3Limp.attempts += 1;
			if (sbResponse) {
				incrementTrackedBlindResponse(
					metrics.preflop.transitions.btn3Limp,
					"smallBlind",
					sbResponse.action,
				);
			}
			if (bbResponse) {
				incrementTrackedBlindResponse(
					metrics.preflop.transitions.btn3Limp,
					"bigBlind",
					bbResponse.action,
				);
			}
			if (blindRaised) {
				metrics.preflop.transitions.btn3Limp.blindRaise += 1;
			}
			if (sawFlop) {
				metrics.preflop.transitions.btn3Limp.flopSeen += 1;
			}
		}
	}
}

function classifyMadeHandFold(decision) {
	if (decision.action !== "fold" || !STRONG_POSTFLOP_HANDS.has(decision.rawHand)) {
		return null;
	}

	const hasPublicMadeHand = PUBLIC_MADE_HANDS.has(decision.publicHand);
	const isPublicMadeHand = hasPublicMadeHand && decision.publicHand === decision.rawHand;
	const isBoardMadeLift = hasPublicMadeHand && decision.publicHand !== decision.rawHand;
	const isPrivateMadeHand = !hasPublicMadeHand;
	const ownWinProbability = typeof decision.ownWinProbability === "number" ? decision.ownWinProbability : null;
	const isDeadOrNearDead = ownWinProbability !== null &&
		ownWinProbability <= DEAD_PRIVATE_MADE_HAND_EQ_THRESHOLD;

	return {
		isPublicMadeHand,
		isBoardMadeLift,
		isPrivateMadeHand,
		isTopTier: TOP_TIER_POSTFLOP_HANDS.has(decision.rawHand),
		isHighRisk: decision.eliminationRisk >= 0.8,
		isDeadOrNearDead,
		isLive: !isDeadOrNearDead,
	};
}

function getHighestBoardRankIndex(decision) {
	const communityCards = Array.isArray(decision.communityCards)
		? decision.communityCards
		: [];
	let highestRankIndex = -1;

	for (const card of communityCards) {
		if (typeof card !== "string" || card.length === 0) {
			continue;
		}
		const rankIndex = CARD_RANK_ORDER.indexOf(card[0]);
		if (rankIndex > highestRankIndex) {
			highestRankIndex = rankIndex;
		}
	}

	return highestRankIndex;
}

function hasHighBoard(decision) {
	return getHighestBoardRankIndex(decision) >= HIGH_BOARD_MIN_RANK_INDEX;
}

function hasBadPrice(decision, threshold = BAD_PRICE_POT_ODDS) {
	return typeof decision.potOdds === "number" && decision.potOdds >= threshold;
}

function isTurnOrRiverPressureSpot(decision) {
	const street = getPostflopStreet(decision);
	if (street !== "turn" && street !== "river") {
		return false;
	}
	return decision.pressureTag === "FR" || decision.raiseLevel > 0 ||
		hasBadPrice(decision);
}

function classifyPostflopQuality(decision) {
	if (decision.phase !== "postflop") {
		return { qualityClass: "n/a", qualityReason: "preflop" };
	}

	if (decision.rawHand === "High Card" && decision.drawFlag === "-") {
		return { qualityClass: "trash", qualityReason: "highCardNoDraw" };
	}
	if (decision.pairClass === "board-pair-only" && isTurnOrRiverPressureSpot(decision)) {
		return { qualityClass: "trash", qualityReason: "boardPairOnlyTurnRiverPressure" };
	}
	if (decision.liftType === "kicker" && isTurnOrRiverPressureSpot(decision)) {
		return { qualityClass: "trash", qualityReason: "kickerOnlyStrongLine" };
	}
	if (decision.drawFlag === "W" && hasBadPrice(decision)) {
		return { qualityClass: "trash", qualityReason: "weakDrawBadPrice" };
	}
	if (
		decision.pairClass === "weak-pair" &&
		decision.activeOpponents >= 2 &&
		decision.pressureTag === "FR" &&
		decision.drawFlag !== "S"
	) {
		return { qualityClass: "trash", qualityReason: "weakPairMwFacingRaise" };
	}

	if (decision.pairClass === "top-pair") {
		return { qualityClass: "defendable", qualityReason: "topPair" };
	}
	if (decision.pairClass === "overpair") {
		return { qualityClass: "defendable", qualityReason: "overpair" };
	}
	if (decision.pairClass === "second-pair") {
		return { qualityClass: "defendable", qualityReason: "secondPairPrivate" };
	}
	if (decision.drawFlag === "S") {
		return { qualityClass: "defendable", qualityReason: "strongDraw" };
	}
	if (decision.liftType === "structural" && decision.edge >= 1) {
		return { qualityClass: "defendable", qualityReason: "structuralEdgeGte1" };
	}
	if (STRONG_POSTFLOP_HANDS.has(decision.rawHand)) {
		return { qualityClass: "defendable", qualityReason: "twoPairPlus" };
	}

	if (decision.pairClass === "weak-pair" && decision.activeOpponents === 1) {
		return { qualityClass: "thin", qualityReason: "weakPairHu" };
	}
	if (decision.pairClass === "pocket-underpair" && !hasBadPrice(decision)) {
		return { qualityClass: "thin", qualityReason: "pocketUnderpairGoodPrice" };
	}
	if (
		decision.liftType === "kicker" &&
		decision.activeOpponents === 1 &&
		decision.raiseLevel <= 1
	) {
		return { qualityClass: "thin", qualityReason: "kickerEdgeHuSimpleLine" };
	}
	if (decision.liftType === "structural" && decision.edge > 0 && decision.edge < 1) {
		return { qualityClass: "thin", qualityReason: "weakStructuralEdge" };
	}
	if (
		decision.marginalEdge === true ||
		decision.marginalReason === "made" ||
		PUBLIC_MADE_HANDS.has(decision.rawHand)
	) {
		return { qualityClass: "thin", qualityReason: "marginalMadeHand" };
	}

	return { qualityClass: "thin", qualityReason: "otherCandidate" };
}

function getCallQualityConcernTags(decision) {
	if (decision.phase !== "postflop" || decision.action !== "call" || !(decision.toCall > 0)) {
		return [];
	}

	const street = getPostflopStreet(decision);
	const tags = [];
	if (decision.rawHand === "High Card" && decision.drawFlag === "-") {
		tags.push("deadHand");
	}
	if (street === "turn" && decision.drawFlag === "W" && hasBadPrice(decision)) {
		tags.push("weakDrawTurnBadPrice");
	}
	if (decision.pairClass === "board-pair-only" && isTurnOrRiverPressureSpot(decision)) {
		tags.push("boardPairOnlyTurnRiverPressure");
	}
	if (decision.pairClass === "weak-pair" && decision.pressureTag === "FR") {
		tags.push("weakPairFacingRaise");
	}
	if (decision.pairClass === "pocket-underpair" && hasHighBoard(decision)) {
		tags.push("pocketUnderpairHighBoard");
	}
	if (decision.liftType === "kicker" && isTurnOrRiverPressureSpot(decision)) {
		tags.push("kickerOnlyStrongLine");
	}
	return tags;
}

function getFoldQualityTags(decision) {
	if (decision.phase !== "postflop" || decision.action !== "fold" || !(decision.toCall > 0)) {
		return [];
	}

	const street = getPostflopStreet(decision);
	const tags = [];
	if (decision.pairClass === "board-pair-only" && isTurnOrRiverPressureSpot(decision)) {
		tags.push("boardPairOnlyTurnRiverPressure");
	}
	if (
		decision.pairClass === "weak-pair" &&
		(decision.activeOpponents >= 2 || decision.pressureTag === "FR")
	) {
		tags.push("weakPairMultiwayOrFacingRaise");
	}
	if (decision.pairClass === "pocket-underpair" && hasHighBoard(decision)) {
		tags.push("pocketUnderpairHighBoard");
	}
	if (
		decision.pairClass === "second-pair" &&
		street === "river" &&
		(decision.activeOpponents >= 2 || decision.pressureTag === "FR" ||
			hasBadPrice(decision, LARGE_RIVER_POT_ODDS))
	) {
		tags.push("secondPairRiverPressure");
	}
	if (decision.rawHand === "High Card" && decision.drawFlag === "-") {
		tags.push("highCardNoDraw");
	}
	if (street === "turn" && decision.drawFlag === "W" && hasBadPrice(decision)) {
		tags.push("weakDrawTurnBadPrice");
	}
	if (decision.liftType === "kicker" && isTurnOrRiverPressureSpot(decision)) {
		tags.push("kickerOnlyStrongLine");
	}
	return tags;
}

function getFoldWatchTags(decision) {
	if (decision.phase !== "postflop" || decision.action !== "fold" || !(decision.toCall > 0)) {
		return [];
	}

	if (
		decision.activeOpponents === 1 &&
		(decision.pairClass === "overpair" || decision.pairClass === "top-pair")
	) {
		return ["goodPairHu"];
	}

	return [];
}

function incrementTaggedDecisionCounts(totalKey, byTagKey, target, tags) {
	if (tags.length === 0) {
		return;
	}

	target[totalKey] += 1;
	for (const tag of tags) {
		incrementCount(target[byTagKey], tag);
	}
}

function classifyWeakNoBetOpportunity(decision) {
	if (
		decision.phase !== "postflop" || !decision.noBet || !decision.canRaiseOpportunity ||
		PREMIUM_PAIR_BOARD_CONTEXTS.has(decision.boardContext) ||
		decision.drawFlag === "S" ||
		STRONG_POSTFLOP_HANDS.has(decision.publicHand)
	) {
		return null;
	}

	if (decision.rawHand === "High Card") {
		if (decision.drawFlag === "-") {
			return "air";
		}
		if (decision.drawFlag === "W") {
			return "weak-draw";
		}
		return null;
	}

	if (
		(
			WEAK_PAIR_LIKE_BOARD_CONTEXTS.has(decision.boardContext) ||
			(
				decision.rawHand === "Pair" &&
				decision.boardContext === "-"
			)
		) &&
		(decision.publicHand === "High Card" || decision.publicHand === "Pair")
	) {
		return "weak-pair";
	}

	return null;
}

function classifyBluffRaise(decision) {
	if (decision.action !== "raise" || !decision.bluff) {
		return null;
	}
	if (decision.stab && decision.hasPrivateMadeHand) {
		return null;
	}
	if (PUBLIC_MADE_HANDS.has(decision.rawHand)) {
		return "made-hand";
	}
	if (decision.drawFlag !== "-") {
		return "draw";
	}
	return "air";
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

function isPostflopReraise(decision) {
	return decision.phase === "postflop" && decision.action === "raise" && decision.raiseLevel > 0;
}

function isRaiseAllIn(decision) {
	return typeof decision.chipsBefore === "number" && decision.chipsBefore > 0 &&
		(decision.amount ?? 0) >= decision.chipsBefore;
}

function isProtectiveFoldDecision(decision) {
	if (
		decision.action !== "fold" || decision.phase !== "postflop" || decision.toCall <= 0 ||
		typeof decision.ownWinProbability !== "number" ||
		typeof decision.bestFieldWinProbability !== "number"
	) {
		return false;
	}

	const behindField = decision.ownWinProbability < decision.bestFieldWinProbability;
	const expensiveCall = typeof decision.callBarrier === "number" &&
		typeof decision.potOdds === "number" &&
		decision.callBarrier >= decision.potOdds + 0.03;
	const survivalPressure = (typeof decision.eliminationRisk === "number" &&
		decision.eliminationRisk >= 0.33) ||
		(typeof decision.stackRatio === "number" && decision.stackRatio >= 0.25) ||
		(typeof decision.commitmentPressure === "number" &&
			decision.commitmentPressure >= 0.25);

	return behindField && expensiveCall && survivalPressure;
}

function isFavoriteStrongHandFoldDecision(decision) {
	if (
		decision.action !== "fold" || decision.phase !== "postflop" || decision.toCall <= 0 ||
		!STRONG_POSTFLOP_HANDS.has(decision.rawHand) ||
		typeof decision.ownWinProbability !== "number" ||
		typeof decision.bestFieldWinProbability !== "number" ||
		decision.winProbRank !== 1
	) {
		return false;
	}

	return decision.ownWinProbability > decision.bestFieldWinProbability;
}

function buildJoinedHandRecord(handId, handStart, handResult) {
	return {
		handId,
		complete: !!handStart && !!handResult,
		handStart: handStart ? structuredClone(handStart) : null,
		handResult: handResult ? structuredClone(handResult) : null,
	};
}

function analyzeOutcomeLogs(logs) {
	const handStarts = new Map();
	const handResults = new Map();
	const decisionEvents = [];

	for (const line of logs) {
		const event = parseSpeedmodeEventLine(line);
		if (!event) {
			continue;
		}

		switch (event.type) {
			case "hand_start":
				if (typeof event.handId === "number") {
					handStarts.set(event.handId, event);
				}
				break;
			case "hand_result":
				if (typeof event.handId === "number") {
					handResults.set(event.handId, event);
				}
				break;
			case "bot_decision":
				decisionEvents.push(event);
				break;
		}
	}

	const metrics = createEmptyOutcomeMetricsAccumulator();
	const handIds = Array.from(new Set([...handStarts.keys(), ...handResults.keys()])).sort((a, b) => a - b);
	const hands = handIds.map((handId) =>
		buildJoinedHandRecord(handId, handStarts.get(handId) ?? null, handResults.get(handId) ?? null)
	);
	const handsById = new Map(hands.map((hand) => [hand.handId, hand]));
	metrics.decisionJoinCoverage.totalHands = hands.length;

	for (const hand of hands) {
		if (hand.complete) {
			metrics.decisionJoinCoverage.joinedHands += 1;
		} else if (!hand.handResult) {
			metrics.decisionJoinCoverage.missingHandResults += 1;
		}
	}

	const decisions = decisionEvents
		.map((decision) => {
			metrics.decisionJoinCoverage.totalDecisions += 1;

			if (typeof decision.handId !== "number") {
				metrics.decisionJoinCoverage.missingHandId += 1;
				return {
					...decision,
					wonHand: null,
					wonMainPot: null,
					wonShowdown: null,
					winnerSide: "unknown",
					netChipDelta: null,
					uncontestedWin: null,
					hadShowdown: null,
					communityCardsFinal: decision.communityCards ?? [],
					protectiveFold: false,
					favoriteStrongHandFold: false,
				};
			}

			const joinedHand = handsById.get(decision.handId) ?? null;
			if (!joinedHand?.handStart) {
				metrics.decisionJoinCoverage.missingHandStart += 1;
			}
			if (!joinedHand?.handResult) {
				metrics.decisionJoinCoverage.missingHandResult += 1;
			}
			if (!joinedHand?.complete) {
				return {
					...decision,
					wonHand: null,
					wonMainPot: null,
					wonShowdown: null,
					winnerSide: "unknown",
					netChipDelta: null,
					uncontestedWin: null,
					hadShowdown: joinedHand?.handResult?.hadShowdown ?? null,
					communityCardsFinal: joinedHand?.handResult?.communityCards ??
						decision.communityCards ?? [],
					protectiveFold: false,
					favoriteStrongHandFold: false,
				};
			}

			metrics.decisionJoinCoverage.joinedDecisions += 1;
			const handResult = joinedHand.handResult;
			const decisionSeatKey = String(decision.seatIndex);
			const payout = handResult.totalPayoutBySeatIndex?.[decisionSeatKey] ?? 0;
			const totalBet = handResult.totalBetBySeatIndex?.[decisionSeatKey] ?? 0;
			const wonHand = handResult.winningSeatIndexes.includes(decision.seatIndex);
			const wonMainPot = handResult.mainPotWinnerSeatIndexes.includes(decision.seatIndex);
			const wonShowdown = handResult.hadShowdown === true && wonHand;
			const uncontestedWin = handResult.hadShowdown === false &&
				handResult.uncontestedWinnerSeatIndex === decision.seatIndex;
			const protectiveFold = isProtectiveFoldDecision(decision);
			const favoriteStrongHandFold = isFavoriteStrongHandFoldDecision(decision);

			incrementWinnerSideBreakdown(
				metrics.winnerSideByPhaseAction,
				decision.phase,
				decision.action,
				wonHand,
			);
			if (decision.phase === "postflop") {
				incrementWinnerSideBreakdown(
					metrics.winnerSideByLiftAction,
					decision.liftType,
					decision.action,
					wonHand,
				);
			}
			if (protectiveFold) {
				metrics.protectiveFoldCounts.total += 1;
				incrementCount(metrics.protectiveFoldCounts, decision.phase);
			}
			if (favoriteStrongHandFold) {
				metrics.favoriteStrongHandFoldCounts.total += 1;
				incrementCount(metrics.favoriteStrongHandFoldCounts, decision.phase);
			}
			if (
				decision.action === "raise" &&
				decision.liftType !== "structural" &&
				PUBLIC_MADE_HANDS.has(decision.publicHand)
			) {
				metrics.nonStructuralMadeHandRaiseOutcome.total += 1;
				if (wonHand) {
					metrics.nonStructuralMadeHandRaiseOutcome.winner += 1;
				} else {
					metrics.nonStructuralMadeHandRaiseOutcome.loser += 1;
				}
			}
			if (!metrics.showdownVsUncontestedByAction[decision.action]) {
				metrics.showdownVsUncontestedByAction[decision.action] = {
					showdown: 0,
					uncontested: 0,
				};
			}
			if (handResult.hadShowdown) {
				metrics.showdownVsUncontestedByAction[decision.action].showdown += 1;
			} else {
				metrics.showdownVsUncontestedByAction[decision.action].uncontested += 1;
			}

			return {
				...decision,
				wonHand,
				wonMainPot,
				wonShowdown,
				winnerSide: wonHand ? "winner" : "loser",
				netChipDelta: payout - totalBet,
				uncontestedWin,
				hadShowdown: handResult.hadShowdown,
				communityCardsFinal: handResult.communityCards.slice(),
				protectiveFold,
				favoriteStrongHandFold,
			};
		})
		.sort((a, b) => {
			if ((a.handId ?? 0) !== (b.handId ?? 0)) {
				return (a.handId ?? 0) - (b.handId ?? 0);
			}
			return (a.decisionId ?? 0) - (b.decisionId ?? 0);
		});

	return {
		hands,
		decisions,
		rawMetrics: metrics,
		metrics: finalizeOutcomeMetrics(metrics),
	};
}

async function waitForSettledRunPayload(page, timeoutMs = POST_RUN_DRAIN_TIMEOUT_MS) {
	const startedAt = Date.now();
	let latestPayload = null;

	while (Date.now() - startedAt < timeoutMs) {
		latestPayload = await page.evaluate(RUN_PAYLOAD_EXPRESSION);
		const outcome = analyzeOutcomeLogs(latestPayload.logs);
		const hasStructuredEvents = outcome.rawMetrics.decisionJoinCoverage.totalDecisions > 0 ||
			outcome.rawMetrics.decisionJoinCoverage.totalHands > 0;
		const missingOutcomeEvents = outcome.rawMetrics.decisionJoinCoverage.missingHandStart > 0 ||
			outcome.rawMetrics.decisionJoinCoverage.missingHandResult > 0 ||
			outcome.rawMetrics.decisionJoinCoverage.missingHandResults > 0;

		if (!hasStructuredEvents || !missingOutcomeEvents) {
			return { payload: latestPayload, outcome };
		}

		await sleep(POLL_INTERVAL_MS);
	}

	const payload = latestPayload ?? await page.evaluate(RUN_PAYLOAD_EXPRESSION);
	return {
		payload,
		outcome: analyzeOutcomeLogs(payload.logs),
	};
}

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
		serverPort: DEFAULT_SERVER_PORT,
		devtoolsPort: DEFAULT_DEVTOOLS_PORT,
		pagePath: DEFAULT_PAGE_PATH,
		outputDir: null,
		chromePath: null,
	};

	for (const arg of args) {
		if (arg === "--") {
			continue;
		} else if (arg.startsWith("--runs=")) {
			config.runCount = parsePositiveInteger(arg.slice(7), "runs");
		} else if (arg.startsWith("--server-port=")) {
			config.serverPort = parsePositiveInteger(
				arg.slice(14),
				"server port",
			);
		} else if (arg.startsWith("--devtools-port=")) {
			config.devtoolsPort = parsePositiveInteger(
				arg.slice(16),
				"DevTools port",
			);
		} else if (arg.startsWith("--page=")) {
			config.pagePath = arg.slice(7);
		} else if (arg.startsWith("--out=")) {
			config.outputDir = arg.slice(6);
		} else if (arg.startsWith("--chrome=")) {
			config.chromePath = arg.slice(9);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return config;
}

async function canRunCommand(command) {
	try {
		const child = new Deno.Command(command, {
			args: ["--version"],
			stdout: "null",
			stderr: "null",
		}).spawn();
		const status = await child.status;
		return status.success;
	} catch {
		return false;
	}
}

async function resolveChromeCommand(explicitCommand) {
	const candidates = [
		explicitCommand,
		Deno.env.get("CHROME_BIN") || null,
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"google-chrome",
		"chromium",
		"chromium-browser",
	].filter(Boolean);

	for (const candidate of candidates) {
		if (await canRunCommand(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		"Could not find a usable Chrome/Chromium binary. Set CHROME_BIN or pass --chrome=/path/to/browser.",
	);
}

async function ensureDirectory(path) {
	await Deno.mkdir(path, { recursive: true });
}

async function safeRemove(path) {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			await Deno.remove(path, { recursive: true });
			return;
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) {
				return;
			}
			const canRetry = error instanceof Deno.errors.PermissionDenied ||
				error.message.includes("Directory not empty") ||
				error.message.includes("resource busy");
			if (!canRetry || attempt === 4) {
				throw error;
			}
			await sleep(100 * (attempt + 1));
		}
	}
}

function getExtension(path) {
	const lastDot = path.lastIndexOf(".");
	return lastDot === -1 ? "" : path.slice(lastDot);
}

function createStaticHandler(rootUrl) {
	return async (request) => {
		const url = new URL(request.url);
		let pathname = decodeURIComponent(url.pathname);
		if (pathname === "/") {
			pathname = "/index.html";
		}
		if (pathname.includes("..")) {
			return new Response("Forbidden", { status: 403 });
		}

		const fileUrl = new URL(`.${pathname}`, rootUrl);
		let file;
		try {
			file = await Deno.readFile(fileUrl);
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) {
				return new Response("Not Found", { status: 404 });
			}
			throw error;
		}

		const extension = getExtension(pathname);
		const headers = new Headers();
		headers.set("content-type", CONTENT_TYPES[extension] || "application/octet-stream");
		return request.method === "HEAD" ? new Response(null, { headers }) : new Response(file, { headers });
	};
}

async function waitForUrl(url, timeoutMs) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			const response = await fetch(url, { method: "HEAD" });
			if (response.ok) {
				return;
			}
		} catch {
			// Server not ready yet.
		}
		await sleep(100);
	}
	throw new Error(`Timed out waiting for ${url}`);
}

async function getPageDebuggerUrl(devtoolsPort, expectedPrefix) {
	const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`);
	if (!response.ok) {
		throw new Error(`DevTools list request failed: ${response.status}`);
	}
	const pages = await response.json();
	const page = pages.find((entry) =>
		entry.type === "page" && typeof entry.url === "string" &&
		entry.url.startsWith(expectedPrefix)
	);
	if (!page?.webSocketDebuggerUrl) {
		throw new Error(`No debuggable page found for ${expectedPrefix}`);
	}
	return page.webSocketDebuggerUrl;
}

async function waitForDebuggerUrl(devtoolsPort, expectedPrefix, timeoutMs) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			return await getPageDebuggerUrl(devtoolsPort, expectedPrefix);
		} catch {
			// Browser may still be booting.
		}
		await sleep(100);
	}
	throw new Error("Timed out waiting for DevTools page target");
}

async function connectToPage(wsUrl) {
	const socket = new WebSocket(wsUrl);
	const openDeferred = createDeferred();
	const pending = new Map();
	const eventWaiters = new Map();
	let nextId = 1;

	socket.onopen = () => openDeferred.resolve();
	socket.onerror = () => openDeferred.reject(new Error("Failed to open DevTools WebSocket"));
	socket.onmessage = (event) => {
		const payload = JSON.parse(event.data);
		if (payload.id && pending.has(payload.id)) {
			const deferred = pending.get(payload.id);
			pending.delete(payload.id);
			if (payload.error) {
				deferred.reject(new Error(JSON.stringify(payload.error)));
			} else {
				deferred.resolve(payload.result);
			}
			return;
		}
		if (payload.method && eventWaiters.has(payload.method)) {
			const waiters = eventWaiters.get(payload.method);
			eventWaiters.delete(payload.method);
			waiters.forEach((deferred) => deferred.resolve(payload.params ?? {}));
		}
	};

	function send(method, params = {}) {
		const id = nextId++;
		socket.send(JSON.stringify({ id, method, params }));
		const deferred = createDeferred();
		pending.set(id, deferred);
		return deferred.promise;
	}

	function waitForEvent(method, timeoutMs) {
		const deferred = createDeferred();
		const waiters = eventWaiters.get(method) ?? [];
		waiters.push(deferred);
		eventWaiters.set(method, waiters);
		const timeoutId = setTimeout(() => {
			const queued = eventWaiters.get(method) ?? [];
			eventWaiters.set(method, queued.filter((entry) => entry !== deferred));
			deferred.reject(new Error(`Timed out waiting for ${method}`));
		}, timeoutMs);
		deferred.promise.finally(() => clearTimeout(timeoutId));
		return deferred.promise;
	}

	async function evaluate(expression) {
		const result = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails) {
			throw new Error(JSON.stringify(result.exceptionDetails));
		}
		return result.result?.value;
	}

	async function navigate(url) {
		const loadPromise = waitForEvent("Page.loadEventFired", LOAD_TIMEOUT_MS);
		await send("Page.navigate", { url });
		await loadPromise;
	}

	await openDeferred.promise;
	await send("Page.enable");
	await send("Runtime.enable");

	return {
		socket,
		evaluate,
		navigate,
	};
}

async function waitForPageReady(page) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < PAGE_READY_TIMEOUT_MS) {
		if (await page.evaluate(PAGE_READY_EXPRESSION)) {
			return;
		}
		await sleep(100);
	}
	throw new Error("Timed out waiting for page bootstrap");
}

function createEmptyPreflopMetrics() {
	return {
		decisions: 0,
		premiumFoldCount: 0,
		unopenedCallCount: 0,
		fixedSizeOffBucketCount: 0,
		fixedSizeOffBucketByKind: {},
		actions: {},
		actionsBySpotType: {},
		actionsByStructure: {},
		actionsByPressure: {},
		actionsByZone: {},
		actionsByPositionBucket: {},
		actionsBySeat: {},
		actionsByActivePlayers: {},
		actionsBySeatAndPlayers: {},
		actionsByRaiseLevel: {},
		actionsByPremium: {},
		actionsByChipLeader: {},
		actionsByShortStack: {},
		actionsByStrengthScoreBucket: {},
		actionsByPlayabilityScoreBucket: {},
		actionsByDominationPenaltyBucket: {},
		actionsByOpenRaiseScoreBucket: {},
		actionsByOpenLimpScoreBucket: {},
		actionsByFlatScoreBucket: {},
		uoActionsBySeat: {},
		uoActionsByActivePlayers: {},
		uoActionsBySeatAndPlayers: {},
		transitions: createEmptyPreflopTransitionMetrics(),
	};
}

function createEmptyPostflopMetrics() {
	return {
		decisions: 0,
		actions: {},
		liftCounts: {},
		actionByLift: {},
		publicHandCounts: {},
		publicHandActions: {},
		rawHandCounts: {},
		rawHandActions: {},
		boardContextCounts: {},
		boardContextActions: {},
		drawCounts: {},
		drawActions: {},
		qualityClassActions: {},
		qualityClassByStreet: {},
		qualityClassByStreetAndAction: {},
		qualityClassByStreetAndMdfApplied: {},
		qualityClassOutcome: {},
		marginalDecisionCount: 0,
		marginalActions: {},
		marginalReasonCounts: {},
		marginalActionByReason: {},
		marginalRaiseCount: 0,
		marginalRiverCallCount: 0,
		marginalFacingRaiseCallCount: 0,
		mdf: {
			facingBetByStreet: {},
			facingBetByStreetAndAlpha: {},
			facingBetByStreetAndBetSize: {},
			facingBetByStreetAndMargin: {},
			facingBetByStreetAndMarginAndBetSize: {},
			facingBetByStreetAndRaiseLevel: {},
			facingBetByStreetAndStructure: {},
			facingBetByStreetAndPressure: {},
			facingBetByStreetAndLift: {},
			facingBetByStreetAndRawHand: {},
			facingBetByQualityClass: {},
			facingBetActionsByStreetAndBetSizeAndQualityReason: {},
			facingBetActionsByStreetAndMarginAndBetSizeAndQualityReason: {},
			flopFacingBetByPreflopRoute: {},
			flopFacingBetByFinalPreflopRoute: {},
			flopFacingBetByPreflopRouteAndReason: {},
			flopFacingBetByPreflopRouteAndHandFamily: {},
			flopFacingBetByPreflopRouteAndStructure: {},
			flopFacingBetByPreflopRouteAndPosition: {},
			flopFacingBetByPreflopRouteAndLineRole: {},
			flopFacingBetHighCardNoDrawByPreflopRoute: {},
			flopFacingBetWeakDrawBadPriceByPreflopRoute: {},
			flopFacingBetByEntryRoute: {},
			flopFacingBetByEntryRouteAndFinalPreflopRoute: {},
			candidateByStreet: {},
			candidateByStreetAndMargin: {},
			candidateByStreetAndBetSize: {},
			candidateByStreetAndMarginAndBetSize: {},
			candidateByStreetAndRaiseLevel: {},
			candidateByStreetAndStructure: {},
			candidateByStreetAndPressure: {},
			candidateByStreetAndLift: {},
			candidateByStreetAndRawHand: {},
			candidateByQualityClass: {},
			overrideCallCount: 0,
			overrideCallByStreet: {},
			overrideCallByStreetAndMargin: {},
			overrideCallByStreetAndBetSize: {},
			overrideCallByStreetAndMarginAndBetSize: {},
			overrideCallByStreetAndRaiseLevel: {},
			overrideCallByStreetAndStructure: {},
			overrideCallByStreetAndPressure: {},
			overrideCallByStreetAndLift: {},
			overrideCallByStreetAndRawHand: {},
			overrideCallByQualityClass: {},
			overrideCallByQualityReason: {},
			overrideCallAfterRiverLowEdgeBlockCount: 0,
			overrideCallAfterMarginalDefenseBlockCount: 0,
			overrideCallAfterNonValueBlockCount: 0,
		},
		pairKickerActions: {},
		pfaDecisionCount: 0,
		lineActions: {},
		lineStates: {
			cbetPlan: {},
			cbetMade: {},
			barrelPlan: {},
			barrelMade: {},
			lineAbort: {},
		},
		stabCount: 0,
		bluffCount: 0,
		stabActions: {},
		bluffActions: {},
		bluffRaiseClassCounts: {},
		nonValueBlockedActions: {},
		checkedToSpotCount: 0,
		checkedToSpotActions: {},
		checkedToSpotByClass: {},
		checkedToSpotActionsByClass: {},
		noBetOpportunityCount: 0,
		noBetOpportunityActions: {},
		noBetOpportunityByClass: {},
		noBetOpportunityActionsByClass: {},
		noBetOpportunityByLineRole: {},
		noBetOpportunityBySpot: {},
		noBetOpportunityByStructure: {},
		noBetOpportunityByActingSlot: {},
		noBetOpportunityActionsByLineRoleAndActingSlot: {},
		blockedNoBetRaiseCount: 0,
		blockedNoBetRaiseByClass: {},
		blockedNoBetRaiseByReason: {},
		blockedNoBetRaiseByClassAndReason: {},
		blockedNoBetRaiseLaterFacingBetCount: 0,
		blockedNoBetRaiseLaterFacingBetActions: {},
		blockedNoBetRaiseWithoutLaterFacingBetCount: 0,
		autoValueCheckCount: 0,
		autoValueCheckLaterFacingBetCount: 0,
		autoValueCheckLaterFacingBetFolds: 0,
		checkRaiseIntent: {
			setCount: 0,
			firedCount: 0,
			blockedCannotRaiseCount: 0,
			inducedCallCount: 0,
			abandonedCount: 0,
			firedWonCount: 0,
			byStreet: {},
			firedByStreet: {},
			blockedCannotRaiseByStreet: {},
			blockedCannotRaiseActions: {},
			abandonedByReason: {},
		},
		passiveValueCheckIntent: {
			setCount: 0,
			followupCount: 0,
			inducedCallCount: 0,
			inducedRaiseCount: 0,
			inducedFoldCount: 0,
			abandonedCount: 0,
			byStreet: {},
			followupByStreet: {},
			followupActions: {},
			abandonedByReason: {},
			blockedByReason: {},
		},
		eliminationReliefCandidateCount: 0,
		eliminationReliefAppliedCount: 0,
		eliminationReliefCallCount: 0,
		normalBetOffBucketCount: 0,
		normalBetOffBucketByKind: {},
		weakNoBetOpportunityCount: 0,
		weakNoBetOpportunityActions: {},
		weakNoBetOpportunityByWeakClass: {},
		weakNoBetOpportunityByLineRole: {},
		weakNoBetOpportunityBySpot: {},
		weakNoBetOpportunityByStructure: {},
		weakNoBetOpportunityByActingSlot: {},
		weakNoBetOpportunityActionsByLineRoleAndActingSlot: {},
		madeHandFoldCount: 0,
		publicMadeHandFoldCount: 0,
		publicMadeHandFoldByHand: {},
		publicMadeHandFoldByLift: {},
		publicMadeHandFoldBySpot: {},
		publicMadeHandFoldByRiskBucket: {},
		publicMadeHandFoldByHandAndLift: {},
		boardMadeLiftFoldCount: 0,
		privateMadeHandFoldCount: 0,
		privateMadeHandFoldDeadOrNearDeadCount: 0,
		privateMadeHandFoldLiveCount: 0,
		privateTopTierMadeHandFoldCount: 0,
		highRiskPrivateMadeHandFoldCount: 0,
		highRiskPrivateMadeHandFoldDeadOrNearDeadCount: 0,
		highRiskPrivateMadeHandFoldLiveCount: 0,
		highRiskPrivateTopTierMadeHandFoldCount: 0,
		callQualityConcernCount: 0,
		callQualityConcernByTag: {},
		callQualityConcernByQualityClass: {},
		callQualityConcernByTagAndMdfApplied: {},
		foldQualityCount: 0,
		foldQualityByTag: {},
		foldQualityByQualityClass: {},
		foldQualityByTagAndMdfEligible: {},
		foldWatchCount: 0,
		foldWatchByTag: {},
		reraises: {
			totalCount: 0,
			lowEdgeCount: 0,
			activePlayers4PlusCount: 0,
			activePlayers5PlusCount: 0,
			flopMultiwayCount: 0,
			flopMultiway4PlusCount: 0,
			flopMultiway5PlusCount: 0,
			allInCount: 0,
			allInBelowTripsCount: 0,
			allInLowEdgeCount: 0,
			allInActivePlayers4PlusCount: 0,
			allInActivePlayers5PlusCount: 0,
			byStreet: {},
			byActivePlayers: {},
			byRawHand: {},
		},
	};
}

function createEmptyMetrics() {
	return {
		decisionCount: 0,
		actionCounts: {},
		phaseCounts: {},
		actionsByPhase: {},
		actionsBySpotType: {},
		actionsBySpot: {},
		actionsByStructure: {},
		actionsByPressure: {},
		actionsByZone: {},
		actionsByPositionBucket: {},
		actionsByRiskBucket: {},
		actionsByStackRatioBucket: {},
		actionsByCommitmentBucket: {},
		actionsByRaiseLevel: {},
		actionsByPremium: {},
		actionsByChipLeader: {},
		actionsByShortStack: {},
		actionsByNonValueBlock: {},
		preflop: createEmptyPreflopMetrics(),
		postflop: createEmptyPostflopMetrics(),
		examples: {
			preflopPremiumFold: [],
			preflopUnopenedCall: [],
			preflopFixedSizeOffBucket: [],
			postflopPublicMadeHandFold: [],
			postflopBoardMadeLiftFold: [],
			postflopPrivateMadeHandFold: [],
			postflopPrivateMadeHandFoldDeadOrNearDead: [],
			postflopPrivateMadeHandFoldLive: [],
			postflopPrivateTopTierMadeHandFold: [],
			postflopHighRiskPrivateMadeHandFold: [],
			postflopHighRiskPrivateMadeHandFoldDeadOrNearDead: [],
			postflopHighRiskPrivateMadeHandFoldLive: [],
			postflopReraiseLowEdge: [],
			postflopReraise4Plus: [],
			postflopFlopReraiseMultiway: [],
			postflopAllInReraiseBelowTrips: [],
			postflopAllInReraiseLowEdge: [],
			bluffRaiseAir: [],
			bluffRaiseDraw: [],
			bluffRaiseMadeHand: [],
			stabRaise: [],
			lineAbort: [],
			kickerRaise: [],
			meaningful: [],
			structural: [],
			mdfOverrideCall: [],
			mdfOverrideAfterRiverLowEdgeBlock: [],
			mdfOverrideAfterMarginalDefenseBlock: [],
			mdfOverrideAfterNonValueBlock: [],
			postflopNoBetRaise: [],
			postflopNoBetCheck: [],
			postflopAutoValueCheck: [],
			postflopAutoValueCheckLaterFacingBetFold: [],
			postflopCheckRaiseIntentSet: [],
			postflopCheckRaiseIntentFired: [],
			postflopCheckRaiseBlockedCannotRaise: [],
			postflopCheckRaiseIntentAbandoned: [],
			postflopPassiveValueCheckSet: [],
			postflopPassiveValueCheckFollowup: [],
			postflopPassiveValueCheckAbandoned: [],
			postflopEliminationReliefCall: [],
			postflopNormalBetOffBucket: [],
			postflopWeakNoBetRaise: [],
			postflopWeakNoBetCheck: [],
			flopPreflopMixedRoute: [],
		},
		postflopSpots: 0,
		kickerRaiseCount: 0,
		meaningfulRaiseCount: 0,
		publicMadeNonStructuralRaiseCount: 0,
		liftCounts: {},
		publicHandCounts: {},
		actionByLift: {},
		publicHandActions: {},
		pairKickerActions: {},
		kickerRaiseExamples: [],
		meaningfulRaiseExamples: [],
		structuralExamples: [],
	};
}

function analyzeRunDecisions(decisions, hands) {
	const metrics = createEmptyMetrics();
	const normalizedDecisions = decisions
		.map((decision) => normalizeStructuredDecision(decision))
		.filter(Boolean);
	const preflopEntriesByHandAndSeat = buildPreflopEntryByHandAndSeat(
		normalizedDecisions,
	);

	for (const decision of normalizedDecisions) {
		const line = decision.line;

		metrics.decisionCount += 1;
		incrementCount(metrics.actionCounts, decision.action);
		incrementCount(metrics.phaseCounts, decision.phase);
		incrementNestedCount(metrics.actionsByPhase, decision.phase, decision.action);
		incrementNestedCount(metrics.actionsBySpotType, decision.spotType, decision.action);
		incrementNestedCount(metrics.actionsBySpot, decision.spotKey, decision.action);
		incrementNestedCount(metrics.actionsByStructure, decision.structureTag, decision.action);
		incrementNestedCount(metrics.actionsByPressure, decision.pressureTag, decision.action);
		incrementNestedCount(metrics.actionsByZone, decision.mZone, decision.action);
		incrementNestedCount(
			metrics.actionsByPositionBucket,
			decision.positionBucket,
			decision.action,
		);
		incrementNestedCount(
			metrics.actionsByRiskBucket,
			decision.eliminationRiskBucket,
			decision.action,
		);
		incrementNestedCount(
			metrics.actionsByStackRatioBucket,
			decision.stackRatioBucket,
			decision.action,
		);
		incrementNestedCount(
			metrics.actionsByCommitmentBucket,
			decision.commitmentBucket,
			decision.action,
		);
		incrementNestedCount(
			metrics.actionsByRaiseLevel,
			decision.raiseLevelBucket,
			decision.action,
		);
		incrementNestedCount(
			metrics.actionsByPremium,
			decision.premium ? "yes" : "no",
			decision.action,
		);
		incrementNestedCount(
			metrics.actionsByChipLeader,
			decision.chipLeader ? "yes" : "no",
			decision.action,
		);
		incrementNestedCount(
			metrics.actionsByShortStack,
			decision.shortStack ? "yes" : "no",
			decision.action,
		);
		incrementNestedCount(
			metrics.actionsByNonValueBlock,
			decision.nonValueBlocked ? "yes" : "no",
			decision.action,
		);

		if (decision.phase === "preflop") {
			metrics.preflop.decisions += 1;
			incrementCount(metrics.preflop.actions, decision.action);
			incrementNestedCount(
				metrics.preflop.actionsBySpotType,
				decision.spotType,
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByStructure,
				decision.structureTag,
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByPressure,
				decision.pressureTag,
				decision.action,
			);
			incrementNestedCount(metrics.preflop.actionsByZone, decision.mZone, decision.action);
			incrementNestedCount(
				metrics.preflop.actionsByPositionBucket,
				decision.positionBucket,
				decision.action,
			);
			if (decision.preflopSeat !== "-") {
				incrementNestedCount(
					metrics.preflop.actionsBySeat,
					decision.preflopSeat,
					decision.action,
				);
				incrementNestedCount(
					metrics.preflop.actionsByActivePlayers,
					String(decision.activePlayers),
					decision.action,
				);
				incrementNestedCount(
					metrics.preflop.actionsBySeatAndPlayers,
					`${decision.preflopSeat}/${decision.activePlayers}`,
					decision.action,
				);
			}
			incrementNestedCount(
				metrics.preflop.actionsByRaiseLevel,
				decision.raiseLevelBucket,
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByPremium,
				decision.premium ? "yes" : "no",
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByChipLeader,
				decision.chipLeader ? "yes" : "no",
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByShortStack,
				decision.shortStack ? "yes" : "no",
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByStrengthScoreBucket,
				decision.strengthScoreBucket,
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByPlayabilityScoreBucket,
				decision.playabilityScoreBucket,
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByDominationPenaltyBucket,
				decision.dominationPenaltyBucket,
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByOpenRaiseScoreBucket,
				decision.openRaiseScoreBucket,
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByOpenLimpScoreBucket,
				decision.openLimpScoreBucket,
				decision.action,
			);
			incrementNestedCount(
				metrics.preflop.actionsByFlatScoreBucket,
				decision.flatScoreBucket,
				decision.action,
			);

			if (decision.premium && decision.action === "fold") {
				metrics.preflop.premiumFoldCount += 1;
				pushExample(metrics.examples.preflopPremiumFold, line);
			}
			if (decision.spotType === "UO" && decision.action === "call") {
				metrics.preflop.unopenedCallCount += 1;
				pushExample(metrics.examples.preflopUnopenedCall, line);
			}
			if (
				decision.action === "raise" &&
				decision.offBucket &&
				decision.sizingKind !== null &&
				decision.sizingKind !== "preflop-harrington"
			) {
				metrics.preflop.fixedSizeOffBucketCount += 1;
				incrementCount(metrics.preflop.fixedSizeOffBucketByKind, decision.sizingKind);
				pushExample(metrics.examples.preflopFixedSizeOffBucket, line);
			}
			if (decision.spotType === "UO" && decision.preflopSeat !== "-") {
				incrementNestedCount(
					metrics.preflop.uoActionsBySeat,
					decision.preflopSeat,
					decision.action,
				);
				incrementNestedCount(
					metrics.preflop.uoActionsByActivePlayers,
					String(decision.activePlayers),
					decision.action,
				);
				incrementNestedCount(
					metrics.preflop.uoActionsBySeatAndPlayers,
					`${decision.preflopSeat}/${decision.activePlayers}`,
					decision.action,
				);
			}
			continue;
		}

		metrics.postflopSpots += 1;
		metrics.postflop.decisions += 1;
		const postflopStreet = getPostflopStreet(decision);
		incrementCount(metrics.postflop.actions, decision.action);
		incrementCount(metrics.liftCounts, decision.liftType);
		incrementCount(metrics.postflop.liftCounts, decision.liftType);
		incrementNestedCount(metrics.actionByLift, decision.liftType, decision.action);
		incrementNestedCount(metrics.postflop.actionByLift, decision.liftType, decision.action);
		incrementNestedCount(
			metrics.postflop.qualityClassActions,
			decision.qualityClass,
			decision.action,
		);
		incrementNestedCount(
			metrics.postflop.qualityClassByStreet,
			postflopStreet,
			decision.qualityClass,
		);
		incrementTripleNestedCount(
			metrics.postflop.qualityClassByStreetAndAction,
			postflopStreet,
			decision.qualityClass,
			decision.action,
		);
		incrementTripleNestedCount(
			metrics.postflop.qualityClassByStreetAndMdfApplied,
			postflopStreet,
			decision.qualityClass,
			decision.mdfApplied ? "yes" : "no",
		);
		incrementQualityClassOutcome(
			metrics.postflop.qualityClassOutcome,
			decision.qualityClass,
			decision,
		);

		if (decision.publicHand !== "-") {
			incrementCount(metrics.publicHandCounts, decision.publicHand);
			incrementCount(metrics.postflop.publicHandCounts, decision.publicHand);
			incrementNestedCount(metrics.publicHandActions, decision.publicHand, decision.action);
			incrementNestedCount(
				metrics.postflop.publicHandActions,
				decision.publicHand,
				decision.action,
			);
		}
		if (decision.rawHand !== "-") {
			incrementCount(metrics.postflop.rawHandCounts, decision.rawHand);
			incrementNestedCount(
				metrics.postflop.rawHandActions,
				decision.rawHand,
				decision.action,
			);
		}

		incrementCount(metrics.postflop.boardContextCounts, decision.boardContext);
		incrementNestedCount(
			metrics.postflop.boardContextActions,
			decision.boardContext,
			decision.action,
		);
		incrementCount(metrics.postflop.drawCounts, decision.drawFlag);
		incrementNestedCount(metrics.postflop.drawActions, decision.drawFlag, decision.action);
		incrementNestedCount(
			metrics.postflop.nonValueBlockedActions,
			decision.nonValueBlocked ? "yes" : "no",
			decision.action,
		);
		if (decision.eliminationReliefCandidate) {
			metrics.postflop.eliminationReliefCandidateCount += 1;
			if (decision.eliminationReliefApplied) {
				metrics.postflop.eliminationReliefAppliedCount += 1;
				if (decision.action === "call") {
					metrics.postflop.eliminationReliefCallCount += 1;
					pushExample(metrics.examples.postflopEliminationReliefCall, line);
				}
			}
		}
		if (
			decision.action === "raise" &&
			decision.offBucket &&
			decision.sizingKind !== null &&
			decision.sizingKind.startsWith("postflop-")
		) {
			metrics.postflop.normalBetOffBucketCount += 1;
			incrementCount(metrics.postflop.normalBetOffBucketByKind, decision.sizingKind);
			pushExample(metrics.examples.postflopNormalBetOffBucket, line);
		}
		if (isPostflopReraise(decision)) {
			const street = getPostflopStreet(decision);
			const activePlayers = decision.activePlayers ?? 0;
			const isLowEdgeReraise = decision.edge < RERAISE_LOW_EDGE_THRESHOLD;
			const isAllInReraise = isRaiseAllIn(decision);

			metrics.postflop.reraises.totalCount += 1;
			incrementCount(metrics.postflop.reraises.byStreet, street);
			incrementCount(metrics.postflop.reraises.byActivePlayers, String(activePlayers));
			incrementCount(metrics.postflop.reraises.byRawHand, decision.rawHand);

			if (isLowEdgeReraise) {
				metrics.postflop.reraises.lowEdgeCount += 1;
				pushExample(metrics.examples.postflopReraiseLowEdge, line);
			}
			if (activePlayers >= 4) {
				metrics.postflop.reraises.activePlayers4PlusCount += 1;
				pushExample(metrics.examples.postflopReraise4Plus, line);
			}
			if (activePlayers >= 5) {
				metrics.postflop.reraises.activePlayers5PlusCount += 1;
			}
			if (street === "flop" && decision.structureTag === "MW") {
				metrics.postflop.reraises.flopMultiwayCount += 1;
				pushExample(metrics.examples.postflopFlopReraiseMultiway, line);
				if (activePlayers >= 4) {
					metrics.postflop.reraises.flopMultiway4PlusCount += 1;
				}
				if (activePlayers >= 5) {
					metrics.postflop.reraises.flopMultiway5PlusCount += 1;
				}
			}
			if (isAllInReraise) {
				metrics.postflop.reraises.allInCount += 1;
				if (activePlayers >= 4) {
					metrics.postflop.reraises.allInActivePlayers4PlusCount += 1;
				}
				if (activePlayers >= 5) {
					metrics.postflop.reraises.allInActivePlayers5PlusCount += 1;
				}
				if (BELOW_TRIPS_POSTFLOP_HANDS.has(decision.rawHand)) {
					metrics.postflop.reraises.allInBelowTripsCount += 1;
					pushExample(metrics.examples.postflopAllInReraiseBelowTrips, line);
				}
				if (isLowEdgeReraise) {
					metrics.postflop.reraises.allInLowEdgeCount += 1;
					pushExample(metrics.examples.postflopAllInReraiseLowEdge, line);
				}
			}
		}

		if (decision.lineTag === "PFA") {
			metrics.postflop.pfaDecisionCount += 1;
		}
		incrementNestedCount(
			metrics.postflop.lineActions,
			decision.lineTag === "PFA" ? "pfa" : "other",
			decision.action,
		);
		if (decision.cbetPlan !== "unknown") {
			incrementCount(metrics.postflop.lineStates.cbetPlan, decision.cbetPlan);
		}
		if (decision.cbetMade !== "unknown") {
			incrementCount(metrics.postflop.lineStates.cbetMade, decision.cbetMade);
		}
		if (decision.barrelPlan !== "unknown") {
			incrementCount(metrics.postflop.lineStates.barrelPlan, decision.barrelPlan);
		}
		if (decision.barrelMade !== "unknown") {
			incrementCount(metrics.postflop.lineStates.barrelMade, decision.barrelMade);
		}
		if (decision.lineAbort !== "unknown") {
			incrementCount(metrics.postflop.lineStates.lineAbort, decision.lineAbort);
		}
		if (decision.lineAbort === "yes") {
			pushExample(metrics.examples.lineAbort, line);
		}
		if (decision.marginalEdge) {
			metrics.postflop.marginalDecisionCount += 1;
			incrementCount(metrics.postflop.marginalActions, decision.action);
			if (decision.marginalReason) {
				incrementCount(
					metrics.postflop.marginalReasonCounts,
					decision.marginalReason,
				);
				incrementNestedCount(
					metrics.postflop.marginalActionByReason,
					decision.marginalReason,
					decision.action,
				);
			}
			if (decision.action === "raise") {
				metrics.postflop.marginalRaiseCount += 1;
			}
			if (getPostflopStreet(decision) === "river" && decision.action === "call") {
				metrics.postflop.marginalRiverCallCount += 1;
			}
			if (decision.pressureTag === "FR" && decision.action === "call") {
				metrics.postflop.marginalFacingRaiseCallCount += 1;
			}
		}
		if (decision.toCall > 0 && decision.mdfRequiredFoldRate !== null) {
			const street = getPostflopStreet(decision);
			incrementFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByStreet,
				street,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementNestedFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByStreetAndAlpha,
				street,
				decision.mdfRequiredFoldRateBucket,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementNestedFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByStreetAndBetSize,
				street,
				decision.mdfBetSizeBucket,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementNestedFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByStreetAndMargin,
				street,
				decision.mdfMarginBucket,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementTripleNestedFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByStreetAndMarginAndBetSize,
				street,
				decision.mdfMarginBucket,
				decision.mdfBetSizeBucket,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementNestedFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByStreetAndRaiseLevel,
				street,
				decision.raiseLevelBucket,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementNestedFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByStreetAndStructure,
				street,
				decision.structureTag,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementNestedFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByStreetAndPressure,
				street,
				decision.pressureTag,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementNestedFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByStreetAndLift,
				street,
				decision.liftType,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementNestedFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByStreetAndRawHand,
				street,
				decision.rawHand,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementFoldRateBreakdown(
				metrics.postflop.mdf.facingBetByQualityClass,
				decision.qualityClass,
				decision.action,
				decision.mdfRequiredFoldRate,
			);
			incrementNestedPathCount(
				metrics.postflop.mdf.facingBetActionsByStreetAndBetSizeAndQualityReason,
				[
					street,
					decision.mdfBetSizeBucket,
					decision.qualityReason,
					decision.action,
				],
			);
			incrementNestedPathCount(
				metrics.postflop.mdf.facingBetActionsByStreetAndMarginAndBetSizeAndQualityReason,
				[
					street,
					decision.mdfMarginBucket,
					decision.mdfBetSizeBucket,
					decision.qualityReason,
					decision.action,
				],
			);
			if (street === "flop") {
				const preflopEntry = preflopEntriesByHandAndSeat.get(
					`${decision.handId}:${decision.seatIndex}`,
				);
				const entryRoute = preflopEntry?.entryRoute ?? "unknown";
				const finalPreflopRoute = preflopEntry?.finalPreflopRoute ?? "unknown";
				const handFamily = preflopEntry?.handFamily ??
					classifyPreflopHandFamily(decision.holeCards);
				const positionRole = getPostflopPositionRole(decision);
				const lineRole = getPostflopLineRole(decision);

				incrementFoldRateBreakdown(
					metrics.postflop.mdf.flopFacingBetByPreflopRoute,
					finalPreflopRoute,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementFoldRateBreakdown(
					metrics.postflop.mdf.flopFacingBetByFinalPreflopRoute,
					finalPreflopRoute,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.flopFacingBetByPreflopRouteAndReason,
					finalPreflopRoute,
					decision.qualityReason,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.flopFacingBetByPreflopRouteAndHandFamily,
					finalPreflopRoute,
					handFamily,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.flopFacingBetByPreflopRouteAndStructure,
					finalPreflopRoute,
					decision.structureTag,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.flopFacingBetByPreflopRouteAndPosition,
					finalPreflopRoute,
					positionRole,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.flopFacingBetByPreflopRouteAndLineRole,
					finalPreflopRoute,
					lineRole,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementFoldRateBreakdown(
					metrics.postflop.mdf.flopFacingBetByEntryRoute,
					entryRoute,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.flopFacingBetByEntryRouteAndFinalPreflopRoute,
					entryRoute,
					finalPreflopRoute,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				if (decision.qualityReason === "highCardNoDraw") {
					incrementFoldRateBreakdown(
						metrics.postflop.mdf.flopFacingBetHighCardNoDrawByPreflopRoute,
						finalPreflopRoute,
						decision.action,
						decision.mdfRequiredFoldRate,
					);
				}
				if (decision.qualityReason === "weakDrawBadPrice") {
					incrementFoldRateBreakdown(
						metrics.postflop.mdf.flopFacingBetWeakDrawBadPriceByPreflopRoute,
						finalPreflopRoute,
						decision.action,
						decision.mdfRequiredFoldRate,
					);
				}
				if (entryRoute !== finalPreflopRoute) {
					pushExample(
						metrics.examples.flopPreflopMixedRoute,
						`${entryRoute} -> ${finalPreflopRoute} | Fam:${handFamily} Pos:${positionRole} ` +
							`Line:${lineRole} Reason:${decision.qualityReason} | ${line}`,
					);
				}
			}

			if (decision.mdfEligible) {
				incrementFoldRateBreakdown(
					metrics.postflop.mdf.candidateByStreet,
					street,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.candidateByStreetAndMargin,
					street,
					decision.mdfMarginBucket,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.candidateByStreetAndBetSize,
					street,
					decision.mdfBetSizeBucket,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementTripleNestedFoldRateBreakdown(
					metrics.postflop.mdf.candidateByStreetAndMarginAndBetSize,
					street,
					decision.mdfMarginBucket,
					decision.mdfBetSizeBucket,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.candidateByStreetAndRaiseLevel,
					street,
					decision.raiseLevelBucket,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.candidateByStreetAndStructure,
					street,
					decision.structureTag,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.candidateByStreetAndPressure,
					street,
					decision.pressureTag,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.candidateByStreetAndLift,
					street,
					decision.liftType,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementNestedFoldRateBreakdown(
					metrics.postflop.mdf.candidateByStreetAndRawHand,
					street,
					decision.rawHand,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				incrementFoldRateBreakdown(
					metrics.postflop.mdf.candidateByQualityClass,
					decision.qualityClass,
					decision.action,
					decision.mdfRequiredFoldRate,
				);
				if (decision.mdfApplied) {
					metrics.postflop.mdf.overrideCallCount += 1;
					incrementCount(metrics.postflop.mdf.overrideCallByStreet, street);
					incrementNestedCount(
						metrics.postflop.mdf.overrideCallByStreetAndMargin,
						street,
						decision.mdfMarginBucket,
					);
					incrementNestedCount(
						metrics.postflop.mdf.overrideCallByStreetAndBetSize,
						street,
						decision.mdfBetSizeBucket,
					);
					incrementTripleNestedCount(
						metrics.postflop.mdf.overrideCallByStreetAndMarginAndBetSize,
						street,
						decision.mdfMarginBucket,
						decision.mdfBetSizeBucket,
					);
					incrementNestedCount(
						metrics.postflop.mdf.overrideCallByStreetAndRaiseLevel,
						street,
						decision.raiseLevelBucket,
					);
					incrementNestedCount(
						metrics.postflop.mdf.overrideCallByStreetAndStructure,
						street,
						decision.structureTag,
					);
					incrementNestedCount(
						metrics.postflop.mdf.overrideCallByStreetAndPressure,
						street,
						decision.pressureTag,
					);
					incrementNestedCount(
						metrics.postflop.mdf.overrideCallByStreetAndLift,
						street,
						decision.liftType,
					);
					incrementNestedCount(
						metrics.postflop.mdf.overrideCallByStreetAndRawHand,
						street,
						decision.rawHand,
					);
					incrementCount(
						metrics.postflop.mdf.overrideCallByQualityClass,
						decision.qualityClass,
					);
					incrementNestedCount(
						metrics.postflop.mdf.overrideCallByQualityReason,
						decision.qualityClass,
						decision.qualityReason,
					);
					if (decision.riverLowEdgeBlocked) {
						metrics.postflop.mdf.overrideCallAfterRiverLowEdgeBlockCount += 1;
						pushExample(metrics.examples.mdfOverrideAfterRiverLowEdgeBlock, line);
					}
					if (decision.marginalDefenseBlocked) {
						metrics.postflop.mdf.overrideCallAfterMarginalDefenseBlockCount += 1;
						pushExample(metrics.examples.mdfOverrideAfterMarginalDefenseBlock, line);
					}
					if (decision.nonValueBlocked) {
						metrics.postflop.mdf.overrideCallAfterNonValueBlockCount += 1;
						pushExample(metrics.examples.mdfOverrideAfterNonValueBlock, line);
					}
					pushExample(metrics.examples.mdfOverrideCall, line);
				}
			}
		}
		if (decision.noBet) {
			const checkedToClass = decision.noBetClass ?? "unknown";
			metrics.postflop.checkedToSpotCount += 1;
			incrementCount(metrics.postflop.checkedToSpotActions, decision.action);
			incrementCount(metrics.postflop.checkedToSpotByClass, checkedToClass);
			incrementNestedCount(
				metrics.postflop.checkedToSpotActionsByClass,
				checkedToClass,
				decision.action,
			);
		}
		if (decision.noBet && decision.canRaiseOpportunity) {
			const noBetClass = decision.noBetClass ?? "unknown";
			metrics.postflop.noBetOpportunityCount += 1;
			incrementCount(metrics.postflop.noBetOpportunityActions, decision.action);
			incrementCount(metrics.postflop.noBetOpportunityByClass, noBetClass);
			incrementNestedCount(
				metrics.postflop.noBetOpportunityActionsByClass,
				noBetClass,
				decision.action,
			);
			incrementCount(metrics.postflop.noBetOpportunityByLineRole, decision.lineRole);
			incrementCount(metrics.postflop.noBetOpportunityBySpot, decision.spotKey);
			incrementCount(metrics.postflop.noBetOpportunityByStructure, decision.structureTag);
			incrementCount(metrics.postflop.noBetOpportunityByActingSlot, decision.actingSlotKey);
			incrementTripleNestedCount(
				metrics.postflop.noBetOpportunityActionsByLineRoleAndActingSlot,
				decision.lineRole,
				decision.actingSlotKey,
				decision.action,
			);
			if (decision.noBetFilterApplied && decision.noBetInitialAction === "raise") {
				const noBetBlockReason = decision.noBetBlockReason ?? "unknown";
				metrics.postflop.blockedNoBetRaiseCount += 1;
				incrementCount(metrics.postflop.blockedNoBetRaiseByClass, noBetClass);
				incrementCount(metrics.postflop.blockedNoBetRaiseByReason, noBetBlockReason);
				incrementNestedCount(
					metrics.postflop.blockedNoBetRaiseByClassAndReason,
					noBetClass,
					noBetBlockReason,
				);
			}
			if (decision.action === "raise") {
				pushExample(metrics.examples.postflopNoBetRaise, line);
			} else if (decision.action === "check") {
				pushExample(metrics.examples.postflopNoBetCheck, line);
			}
			if (noBetClass === "auto-value" && decision.action === "check") {
				metrics.postflop.autoValueCheckCount += 1;
				pushExample(metrics.examples.postflopAutoValueCheck, line);
			}
		}

		if (decision.checkRaiseIntentAction === "set") {
			metrics.postflop.checkRaiseIntent.setCount += 1;
			incrementCount(
				metrics.postflop.checkRaiseIntent.byStreet,
				decision.checkRaiseIntentStreet ?? postflopStreet,
			);
			pushExample(metrics.examples.postflopCheckRaiseIntentSet, line);
		} else if (decision.checkRaiseIntentAction === "fired") {
			metrics.postflop.checkRaiseIntent.firedCount += 1;
			incrementCount(
				metrics.postflop.checkRaiseIntent.firedByStreet,
				decision.checkRaiseIntentStreet ?? postflopStreet,
			);
			if (decision.wonHand === true) {
				metrics.postflop.checkRaiseIntent.firedWonCount += 1;
			}
			pushExample(metrics.examples.postflopCheckRaiseIntentFired, line);
		} else if (decision.checkRaiseIntentAction === "blocked_cannot_raise") {
			metrics.postflop.checkRaiseIntent.blockedCannotRaiseCount += 1;
			incrementCount(
				metrics.postflop.checkRaiseIntent.blockedCannotRaiseByStreet,
				decision.checkRaiseIntentStreet ?? postflopStreet,
			);
			incrementCount(
				metrics.postflop.checkRaiseIntent.blockedCannotRaiseActions,
				decision.action,
			);
			if (decision.action === "call") {
				metrics.postflop.checkRaiseIntent.inducedCallCount += 1;
			}
			pushExample(metrics.examples.postflopCheckRaiseBlockedCannotRaise, line);
		} else if (decision.checkRaiseIntentAction === "abandoned") {
			metrics.postflop.checkRaiseIntent.abandonedCount += 1;
			incrementCount(
				metrics.postflop.checkRaiseIntent.abandonedByReason,
				decision.checkRaiseIntentReason ?? "unknown",
			);
			pushExample(metrics.examples.postflopCheckRaiseIntentAbandoned, line);
		}

		if (decision.noBet && decision.canRaiseOpportunity && decision.passiveValueCheckBlockReason) {
			incrementCount(
				metrics.postflop.passiveValueCheckIntent.blockedByReason,
				decision.passiveValueCheckBlockReason,
			);
		}
		if (decision.passiveValueCheckAction === "set") {
			metrics.postflop.passiveValueCheckIntent.setCount += 1;
			incrementCount(
				metrics.postflop.passiveValueCheckIntent.byStreet,
				decision.passiveValueCheckStreet ?? postflopStreet,
			);
			pushExample(metrics.examples.postflopPassiveValueCheckSet, line);
		} else if (decision.passiveValueCheckAction === "followup") {
			metrics.postflop.passiveValueCheckIntent.followupCount += 1;
			incrementCount(
				metrics.postflop.passiveValueCheckIntent.followupByStreet,
				decision.passiveValueCheckStreet ?? postflopStreet,
			);
			incrementCount(
				metrics.postflop.passiveValueCheckIntent.followupActions,
				decision.action,
			);
			if (decision.action === "call") {
				metrics.postflop.passiveValueCheckIntent.inducedCallCount += 1;
			} else if (decision.action === "raise") {
				metrics.postflop.passiveValueCheckIntent.inducedRaiseCount += 1;
			} else if (decision.action === "fold") {
				metrics.postflop.passiveValueCheckIntent.inducedFoldCount += 1;
			}
			pushExample(metrics.examples.postflopPassiveValueCheckFollowup, line);
		} else if (decision.passiveValueCheckAction === "abandoned") {
			metrics.postflop.passiveValueCheckIntent.abandonedCount += 1;
			incrementCount(
				metrics.postflop.passiveValueCheckIntent.abandonedByReason,
				decision.passiveValueCheckReason ?? "unknown",
			);
			pushExample(metrics.examples.postflopPassiveValueCheckAbandoned, line);
		}

		const weakNoBetClass = classifyWeakNoBetOpportunity(decision);
		if (weakNoBetClass) {
			metrics.postflop.weakNoBetOpportunityCount += 1;
			incrementCount(metrics.postflop.weakNoBetOpportunityActions, decision.action);
			incrementCount(metrics.postflop.weakNoBetOpportunityByWeakClass, weakNoBetClass);
			incrementCount(metrics.postflop.weakNoBetOpportunityByLineRole, decision.lineRole);
			incrementCount(metrics.postflop.weakNoBetOpportunityBySpot, decision.spotKey);
			incrementCount(metrics.postflop.weakNoBetOpportunityByStructure, decision.structureTag);
			incrementCount(
				metrics.postflop.weakNoBetOpportunityByActingSlot,
				decision.actingSlotKey,
			);
			incrementTripleNestedCount(
				metrics.postflop.weakNoBetOpportunityActionsByLineRoleAndActingSlot,
				decision.lineRole,
				decision.actingSlotKey,
				decision.action,
			);
			if (decision.action === "raise") {
				pushExample(metrics.examples.postflopWeakNoBetRaise, line);
			} else if (decision.action === "check") {
				pushExample(metrics.examples.postflopWeakNoBetCheck, line);
			}
		}

		if (decision.stab) {
			metrics.postflop.stabCount += 1;
			incrementCount(metrics.postflop.stabActions, decision.action);
			if (decision.action === "raise") {
				pushExample(metrics.examples.stabRaise, line);
			}
		}
		if (decision.bluff) {
			metrics.postflop.bluffCount += 1;
			incrementCount(metrics.postflop.bluffActions, decision.action);
		}

		const bluffRaiseClass = classifyBluffRaise(decision);
		if (bluffRaiseClass) {
			incrementCount(metrics.postflop.bluffRaiseClassCounts, bluffRaiseClass);
			if (bluffRaiseClass === "air") {
				pushExample(metrics.examples.bluffRaiseAir, line);
			} else if (bluffRaiseClass === "draw") {
				pushExample(metrics.examples.bluffRaiseDraw, line);
			} else {
				pushExample(metrics.examples.bluffRaiseMadeHand, line);
			}
		}

		if (decision.liftType === "kicker" && decision.publicHand === "Pair") {
			incrementCount(metrics.pairKickerActions, decision.action);
			incrementCount(metrics.postflop.pairKickerActions, decision.action);
		}
		if (decision.action === "raise" && decision.liftType === "kicker") {
			metrics.kickerRaiseCount += 1;
			pushExample(metrics.kickerRaiseExamples, line);
			pushExample(metrics.examples.kickerRaise, line);
		}
		if (decision.action === "raise" && decision.liftType === "meaningful") {
			metrics.meaningfulRaiseCount += 1;
			pushExample(metrics.meaningfulRaiseExamples, line);
			pushExample(metrics.examples.meaningful, line);
		}
		if (
			decision.action === "raise" &&
			decision.liftType !== "structural" &&
			PUBLIC_MADE_HANDS.has(decision.publicHand)
		) {
			metrics.publicMadeNonStructuralRaiseCount += 1;
		}
		if (decision.liftType === "structural") {
			pushExample(metrics.structuralExamples, line);
			pushExample(metrics.examples.structural, line);
		}

		const callQualityConcernTags = getCallQualityConcernTags(decision);
		incrementTaggedDecisionCounts(
			"callQualityConcernCount",
			"callQualityConcernByTag",
			metrics.postflop,
			callQualityConcernTags,
		);
		if (callQualityConcernTags.length > 0) {
			incrementCount(metrics.postflop.callQualityConcernByQualityClass, decision.qualityClass);
			for (const tag of callQualityConcernTags) {
				incrementNestedCount(
					metrics.postflop.callQualityConcernByTagAndMdfApplied,
					tag,
					decision.mdfApplied ? "yes" : "no",
				);
			}
		}

		const foldQualityTags = getFoldQualityTags(decision);
		incrementTaggedDecisionCounts(
			"foldQualityCount",
			"foldQualityByTag",
			metrics.postflop,
			foldQualityTags,
		);
		if (foldQualityTags.length > 0) {
			incrementCount(metrics.postflop.foldQualityByQualityClass, decision.qualityClass);
			for (const tag of foldQualityTags) {
				incrementNestedCount(
					metrics.postflop.foldQualityByTagAndMdfEligible,
					tag,
					decision.mdfEligible ? "yes" : "no",
				);
			}
		}

		incrementTaggedDecisionCounts(
			"foldWatchCount",
			"foldWatchByTag",
			metrics.postflop,
			getFoldWatchTags(decision),
		);

		const madeHandFold = classifyMadeHandFold(decision);
		if (madeHandFold) {
			metrics.postflop.madeHandFoldCount += 1;
			if (madeHandFold.isPublicMadeHand) {
				metrics.postflop.publicMadeHandFoldCount += 1;
				incrementCount(metrics.postflop.publicMadeHandFoldByHand, decision.rawHand);
				incrementCount(metrics.postflop.publicMadeHandFoldByLift, decision.liftType);
				incrementCount(metrics.postflop.publicMadeHandFoldBySpot, decision.spotKey);
				incrementCount(
					metrics.postflop.publicMadeHandFoldByRiskBucket,
					decision.eliminationRiskBucket,
				);
				incrementNestedCount(
					metrics.postflop.publicMadeHandFoldByHandAndLift,
					decision.rawHand,
					decision.liftType,
				);
				pushExample(metrics.examples.postflopPublicMadeHandFold, line);
			} else if (madeHandFold.isBoardMadeLift) {
				metrics.postflop.boardMadeLiftFoldCount += 1;
				pushExample(metrics.examples.postflopBoardMadeLiftFold, line);
			} else {
				metrics.postflop.privateMadeHandFoldCount += 1;
				pushExample(metrics.examples.postflopPrivateMadeHandFold, line);
				if (madeHandFold.isDeadOrNearDead) {
					metrics.postflop.privateMadeHandFoldDeadOrNearDeadCount += 1;
					pushExample(metrics.examples.postflopPrivateMadeHandFoldDeadOrNearDead, line);
				} else {
					metrics.postflop.privateMadeHandFoldLiveCount += 1;
					pushExample(metrics.examples.postflopPrivateMadeHandFoldLive, line);
				}
				if (madeHandFold.isHighRisk) {
					metrics.postflop.highRiskPrivateMadeHandFoldCount += 1;
					pushExample(metrics.examples.postflopHighRiskPrivateMadeHandFold, line);
					if (madeHandFold.isDeadOrNearDead) {
						metrics.postflop.highRiskPrivateMadeHandFoldDeadOrNearDeadCount += 1;
						pushExample(
							metrics.examples.postflopHighRiskPrivateMadeHandFoldDeadOrNearDead,
							line,
						);
					} else {
						metrics.postflop.highRiskPrivateMadeHandFoldLiveCount += 1;
						pushExample(
							metrics.examples.postflopHighRiskPrivateMadeHandFoldLive,
							line,
						);
					}
				}
			}
			if (madeHandFold.isPrivateMadeHand && madeHandFold.isTopTier) {
				metrics.postflop.privateTopTierMadeHandFoldCount += 1;
				pushExample(metrics.examples.postflopPrivateTopTierMadeHandFold, line);
				if (madeHandFold.isHighRisk) {
					metrics.postflop.highRiskPrivateTopTierMadeHandFoldCount += 1;
				}
			}
		}
	}

	analyzeBlockedNoBetRaiseFollowups(normalizedDecisions, metrics);
	analyzeAutoValueCheckFollowups(normalizedDecisions, metrics);
	analyzePreflopTransitions(normalizedDecisions, hands, metrics);
	return metrics;
}

function mergeRunMetrics(target, source) {
	target.decisionCount += source.decisionCount;
	target.postflopSpots += source.postflopSpots;
	target.kickerRaiseCount += source.kickerRaiseCount;
	target.meaningfulRaiseCount += source.meaningfulRaiseCount;
	target.publicMadeNonStructuralRaiseCount += source.publicMadeNonStructuralRaiseCount;
	deepMergeCounts(target.actionCounts, source.actionCounts);
	deepMergeCounts(target.phaseCounts, source.phaseCounts);
	deepMergeCounts(target.actionsByPhase, source.actionsByPhase);
	deepMergeCounts(target.actionsBySpotType, source.actionsBySpotType);
	deepMergeCounts(target.actionsBySpot, source.actionsBySpot);
	deepMergeCounts(target.actionsByStructure, source.actionsByStructure);
	deepMergeCounts(target.actionsByPressure, source.actionsByPressure);
	deepMergeCounts(target.actionsByZone, source.actionsByZone);
	deepMergeCounts(target.actionsByPositionBucket, source.actionsByPositionBucket);
	deepMergeCounts(target.actionsByRiskBucket, source.actionsByRiskBucket);
	deepMergeCounts(target.actionsByStackRatioBucket, source.actionsByStackRatioBucket);
	deepMergeCounts(target.actionsByCommitmentBucket, source.actionsByCommitmentBucket);
	deepMergeCounts(target.actionsByRaiseLevel, source.actionsByRaiseLevel);
	deepMergeCounts(target.actionsByPremium, source.actionsByPremium);
	deepMergeCounts(target.actionsByChipLeader, source.actionsByChipLeader);
	deepMergeCounts(target.actionsByShortStack, source.actionsByShortStack);
	deepMergeCounts(target.actionsByNonValueBlock, source.actionsByNonValueBlock);
	deepMergeCounts(target.preflop, source.preflop);
	deepMergeCounts(target.postflop, source.postflop);
	deepMergeCounts(target.liftCounts, source.liftCounts);
	deepMergeCounts(target.publicHandCounts, source.publicHandCounts);
	deepMergeCounts(target.actionByLift, source.actionByLift);
	deepMergeCounts(target.publicHandActions, source.publicHandActions);
	deepMergeCounts(target.pairKickerActions, source.pairKickerActions);
	source.kickerRaiseExamples.forEach((line) => pushExample(target.kickerRaiseExamples, line));
	source.meaningfulRaiseExamples.forEach((line) => pushExample(target.meaningfulRaiseExamples, line));
	source.structuralExamples.forEach((line) => pushExample(target.structuralExamples, line));
	source.examples.preflopPremiumFold.forEach((line) => pushExample(target.examples.preflopPremiumFold, line));
	source.examples.preflopUnopenedCall.forEach((line) => pushExample(target.examples.preflopUnopenedCall, line));
	source.examples.preflopFixedSizeOffBucket.forEach((line) =>
		pushExample(target.examples.preflopFixedSizeOffBucket, line)
	);
	source.examples.postflopPublicMadeHandFold.forEach((line) =>
		pushExample(target.examples.postflopPublicMadeHandFold, line)
	);
	source.examples.postflopBoardMadeLiftFold.forEach((line) =>
		pushExample(target.examples.postflopBoardMadeLiftFold, line)
	);
	source.examples.postflopPrivateMadeHandFold.forEach((line) =>
		pushExample(target.examples.postflopPrivateMadeHandFold, line)
	);
	source.examples.postflopPrivateMadeHandFoldDeadOrNearDead.forEach((line) =>
		pushExample(target.examples.postflopPrivateMadeHandFoldDeadOrNearDead, line)
	);
	source.examples.postflopPrivateMadeHandFoldLive.forEach((line) =>
		pushExample(target.examples.postflopPrivateMadeHandFoldLive, line)
	);
	source.examples.postflopPrivateTopTierMadeHandFold.forEach((line) =>
		pushExample(target.examples.postflopPrivateTopTierMadeHandFold, line)
	);
	source.examples.postflopHighRiskPrivateMadeHandFold.forEach((line) =>
		pushExample(target.examples.postflopHighRiskPrivateMadeHandFold, line)
	);
	source.examples.postflopHighRiskPrivateMadeHandFoldDeadOrNearDead.forEach((line) =>
		pushExample(target.examples.postflopHighRiskPrivateMadeHandFoldDeadOrNearDead, line)
	);
	source.examples.postflopHighRiskPrivateMadeHandFoldLive.forEach((line) =>
		pushExample(target.examples.postflopHighRiskPrivateMadeHandFoldLive, line)
	);
	source.examples.postflopReraiseLowEdge.forEach((line) => pushExample(target.examples.postflopReraiseLowEdge, line));
	source.examples.postflopReraise4Plus.forEach((line) => pushExample(target.examples.postflopReraise4Plus, line));
	source.examples.postflopFlopReraiseMultiway.forEach((line) =>
		pushExample(target.examples.postflopFlopReraiseMultiway, line)
	);
	source.examples.postflopAllInReraiseBelowTrips.forEach((line) =>
		pushExample(target.examples.postflopAllInReraiseBelowTrips, line)
	);
	source.examples.postflopAllInReraiseLowEdge.forEach((line) =>
		pushExample(target.examples.postflopAllInReraiseLowEdge, line)
	);
	source.examples.bluffRaiseAir.forEach((line) => pushExample(target.examples.bluffRaiseAir, line));
	source.examples.bluffRaiseDraw.forEach((line) => pushExample(target.examples.bluffRaiseDraw, line));
	source.examples.bluffRaiseMadeHand.forEach((line) => pushExample(target.examples.bluffRaiseMadeHand, line));
	source.examples.mdfOverrideCall.forEach((line) => pushExample(target.examples.mdfOverrideCall, line));
	source.examples.mdfOverrideAfterRiverLowEdgeBlock.forEach((line) =>
		pushExample(target.examples.mdfOverrideAfterRiverLowEdgeBlock, line)
	);
	source.examples.mdfOverrideAfterMarginalDefenseBlock.forEach((line) =>
		pushExample(target.examples.mdfOverrideAfterMarginalDefenseBlock, line)
	);
	source.examples.mdfOverrideAfterNonValueBlock.forEach((line) =>
		pushExample(target.examples.mdfOverrideAfterNonValueBlock, line)
	);
	source.examples.stabRaise.forEach((line) => pushExample(target.examples.stabRaise, line));
	source.examples.lineAbort.forEach((line) => pushExample(target.examples.lineAbort, line));
	source.examples.kickerRaise.forEach((line) => pushExample(target.examples.kickerRaise, line));
	source.examples.meaningful.forEach((line) => pushExample(target.examples.meaningful, line));
	source.examples.structural.forEach((line) => pushExample(target.examples.structural, line));
	source.examples.postflopNoBetRaise.forEach((line) => pushExample(target.examples.postflopNoBetRaise, line));
	source.examples.postflopNoBetCheck.forEach((line) => pushExample(target.examples.postflopNoBetCheck, line));
	source.examples.postflopAutoValueCheck.forEach((line) => pushExample(target.examples.postflopAutoValueCheck, line));
	source.examples.postflopAutoValueCheckLaterFacingBetFold.forEach((line) =>
		pushExample(target.examples.postflopAutoValueCheckLaterFacingBetFold, line)
	);
	source.examples.postflopCheckRaiseIntentSet.forEach((line) =>
		pushExample(target.examples.postflopCheckRaiseIntentSet, line)
	);
	source.examples.postflopCheckRaiseIntentFired.forEach((line) =>
		pushExample(target.examples.postflopCheckRaiseIntentFired, line)
	);
	source.examples.postflopCheckRaiseBlockedCannotRaise.forEach((line) =>
		pushExample(target.examples.postflopCheckRaiseBlockedCannotRaise, line)
	);
	source.examples.postflopCheckRaiseIntentAbandoned.forEach((line) =>
		pushExample(target.examples.postflopCheckRaiseIntentAbandoned, line)
	);
	source.examples.postflopPassiveValueCheckSet.forEach((line) =>
		pushExample(target.examples.postflopPassiveValueCheckSet, line)
	);
	source.examples.postflopPassiveValueCheckFollowup.forEach((line) =>
		pushExample(target.examples.postflopPassiveValueCheckFollowup, line)
	);
	source.examples.postflopPassiveValueCheckAbandoned.forEach((line) =>
		pushExample(target.examples.postflopPassiveValueCheckAbandoned, line)
	);
	source.examples.postflopEliminationReliefCall.forEach((line) =>
		pushExample(target.examples.postflopEliminationReliefCall, line)
	);
	source.examples.postflopNormalBetOffBucket.forEach((line) =>
		pushExample(target.examples.postflopNormalBetOffBucket, line)
	);
	source.examples.postflopWeakNoBetRaise.forEach((line) => pushExample(target.examples.postflopWeakNoBetRaise, line));
	source.examples.postflopWeakNoBetCheck.forEach((line) => pushExample(target.examples.postflopWeakNoBetCheck, line));
	source.examples.flopPreflopMixedRoute.forEach((line) => pushExample(target.examples.flopPreflopMixedRoute, line));
}

async function runSingleTournament(
	page,
	config,
	runIndex,
	aggregateMetrics,
	aggregateOutcomeMetrics,
	champions,
) {
	const runLabel = String(runIndex).padStart(2, "0");
	const baseUrl = `http://127.0.0.1:${config.serverPort}/${config.pagePath}`;

	console.log(`run ${runLabel}: navigate`);
	await page.navigate(baseUrl);
	await waitForPageReady(page);
	await page.evaluate(START_CAPTURE_EXPRESSION);

	const startedAt = Date.now();
	let state = null;
	while (Date.now() - startedAt < RUN_TIMEOUT_MS) {
		state = await page.evaluate(RUN_STATE_EXPRESSION);
		if (state.finished) {
			break;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	if (!state?.finished) {
		throw new Error(`Run ${runLabel} timed out`);
	}

	const { payload, outcome: runOutcome } = await waitForSettledRunPayload(page);
	const runMetrics = analyzeRunDecisions(runOutcome.decisions, runOutcome.hands);
	mergeRunMetrics(aggregateMetrics, runMetrics);
	mergeOutcomeMetrics(aggregateOutcomeMetrics, runOutcome.rawMetrics);
	incrementCount(champions, state.champion || "unknown");

	const logPath = `${config.outputDir}/run-${runLabel}.log`;
	const summaryPath = `${config.outputDir}/run-${runLabel}.json`;
	const detailsPath = `${config.outputDir}/run-${runLabel}.details.json`;
	await Deno.writeTextFile(logPath, payload.logs.join("\n"));
	await Deno.writeTextFile(
		summaryPath,
		JSON.stringify(
			{
				run: runIndex,
				champion: state.champion,
				logCount: payload.logs.length,
				players: payload.players,
				metrics: runMetrics,
				analysis: {
					postflop: {
						mdf: createMdfAnalysis(runMetrics.postflop.mdf),
					},
				},
				outcomeMetrics: runOutcome.metrics,
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
				champion: state.champion,
				logCount: payload.logs.length,
				hands: runOutcome.hands,
				decisions: runOutcome.decisions,
				outcomeMetrics: runOutcome.metrics,
			},
			null,
			2,
		),
	);

	console.log(`run ${runLabel}: done champion=${state.champion} logs=${payload.logs.length}`);
	return {
		run: runIndex,
		champion: state.champion,
		logCount: payload.logs.length,
		logPath,
		summaryPath,
		detailsPath,
		metrics: runMetrics,
		outcomeMetrics: runOutcome.metrics,
	};
}

async function main() {
	const args = parseArgs(Deno.args);
	const projectRootUrl = new URL("../", import.meta.url);
	const projectRootPath = Deno.realPathSync(projectRootUrl);
	const outputDir = resolveOutputDir(args.outputDir);
	const chromeCommand = await resolveChromeCommand(args.chromePath);
	const aggregateMetrics = createEmptyMetrics();
	const aggregateOutcomeMetrics = createEmptyOutcomeMetricsAccumulator();
	const champions = {};
	const runSummaries = [];
	const profileDir = `${outputDir}/chrome-profile`;
	const serverAbort = new AbortController();
	let browserChild = null;

	await ensureDirectory(outputDir);
	await ensureDirectory(profileDir);

	try {
		const server = Deno.serve({
			hostname: "127.0.0.1",
			port: args.serverPort,
			signal: serverAbort.signal,
		}, createStaticHandler(projectRootUrl));

		await waitForUrl(`http://127.0.0.1:${args.serverPort}/index.html`, LOAD_TIMEOUT_MS);

		browserChild = new Deno.Command(chromeCommand, {
			args: [
				"--headless=new",
				`--remote-debugging-port=${args.devtoolsPort}`,
				`--user-data-dir=${profileDir}`,
				"--no-first-run",
				"--no-default-browser-check",
				`http://127.0.0.1:${args.serverPort}/${args.pagePath}`,
			],
			stdout: "null",
			stderr: "null",
		}).spawn();

		const debuggerUrl = await waitForDebuggerUrl(
			args.devtoolsPort,
			`http://127.0.0.1:${args.serverPort}/`,
			LOAD_TIMEOUT_MS,
		);
		const page = await connectToPage(debuggerUrl);

		for (let runIndex = 1; runIndex <= args.runCount; runIndex++) {
			const runSummary = await runSingleTournament(
				page,
				{
					serverPort: args.serverPort,
					pagePath: args.pagePath,
					outputDir,
				},
				runIndex,
				aggregateMetrics,
				aggregateOutcomeMetrics,
				champions,
			);
			runSummaries.push(runSummary);
		}

		page.socket.close();
		serverAbort.abort();
		await server.finished.catch(() => {});
		browserChild.kill("SIGTERM");
		await browserChild.status.catch(() => {});
		browserChild = null;

		const mdfAnalysis = createMdfAnalysis(aggregateMetrics.postflop.mdf);
		const summary = {
			generatedAt: new Date().toISOString(),
			config: {
				runCount: args.runCount,
				serverPort: args.serverPort,
				devtoolsPort: args.devtoolsPort,
				pagePath: args.pagePath,
				chromeCommand,
				outputDir,
				projectRootPath,
				analysisThresholds: {
					reraiseLowEdge: RERAISE_LOW_EDGE_THRESHOLD,
				},
			},
			champions,
			runs: runSummaries.map((runSummary) => ({
				run: runSummary.run,
				champion: runSummary.champion,
				logCount: runSummary.logCount,
				logPath: runSummary.logPath,
				summaryPath: runSummary.summaryPath,
				detailsPath: runSummary.detailsPath,
			})),
			metrics: aggregateMetrics,
			analysis: {
				postflop: {
					mdf: mdfAnalysis,
				},
			},
			outcomeMetrics: finalizeOutcomeMetrics(aggregateOutcomeMetrics),
		};
		await Deno.writeTextFile(`${outputDir}/summary.json`, JSON.stringify(summary, null, 2));

		console.log(`runs=${args.runCount}`);
		console.log(`decisions=${aggregateMetrics.decisionCount}`);
		console.log(
			`decision_join_coverage=${summary.outcomeMetrics.decisionJoinCoverage.joinedDecisions}/${summary.outcomeMetrics.decisionJoinCoverage.totalDecisions}`,
		);
		console.log(`preflop_spots=${aggregateMetrics.preflop.decisions}`);
		console.log(`postflop_spots=${aggregateMetrics.postflopSpots}`);
		console.log(`postflop_made_hand_folds=${aggregateMetrics.postflop.madeHandFoldCount}`);
		console.log(
			`postflop_public_made_hand_folds=${aggregateMetrics.postflop.publicMadeHandFoldCount}`,
		);
		console.log(
			`postflop_board_made_lift_folds=${aggregateMetrics.postflop.boardMadeLiftFoldCount}`,
		);
		console.log(
			`postflop_private_made_hand_folds=${aggregateMetrics.postflop.privateMadeHandFoldCount}`,
		);
		console.log(
			`postflop_private_made_hand_folds_dead_or_near_dead=${aggregateMetrics.postflop.privateMadeHandFoldDeadOrNearDeadCount}`,
		);
		console.log(
			`postflop_private_made_hand_folds_live=${aggregateMetrics.postflop.privateMadeHandFoldLiveCount}`,
		);
		console.log(
			`postflop_private_top_tier_made_hand_folds=${aggregateMetrics.postflop.privateTopTierMadeHandFoldCount}`,
		);
		console.log(`postflop_reraises=${aggregateMetrics.postflop.reraises.totalCount}`);
		console.log(
			`postflop_reraises_edge_lt_${
				RERAISE_LOW_EDGE_THRESHOLD.toFixed(1)
			}=${aggregateMetrics.postflop.reraises.lowEdgeCount}`,
		);
		console.log(
			`postflop_reraises_active_players_4_plus=${aggregateMetrics.postflop.reraises.activePlayers4PlusCount}`,
		);
		console.log(
			`postflop_reraises_active_players_5_plus=${aggregateMetrics.postflop.reraises.activePlayers5PlusCount}`,
		);
		console.log(
			`postflop_reraises_flop_multiway=${aggregateMetrics.postflop.reraises.flopMultiwayCount}`,
		);
		console.log(
			`postflop_reraises_allin_below_trips=${aggregateMetrics.postflop.reraises.allInBelowTripsCount}`,
		);
		console.log(
			`postflop_reraises_allin_edge_lt_${
				RERAISE_LOW_EDGE_THRESHOLD.toFixed(1)
			}=${aggregateMetrics.postflop.reraises.allInLowEdgeCount}`,
		);
		console.log(
			`postflop_high_risk_private_made_hand_folds=${aggregateMetrics.postflop.highRiskPrivateMadeHandFoldCount}`,
		);
		console.log(
			`postflop_high_risk_private_made_hand_folds_dead_or_near_dead=${aggregateMetrics.postflop.highRiskPrivateMadeHandFoldDeadOrNearDeadCount}`,
		);
		console.log(
			`postflop_high_risk_private_made_hand_folds_live=${aggregateMetrics.postflop.highRiskPrivateMadeHandFoldLiveCount}`,
		);
		console.log(`preflop_premium_folds=${aggregateMetrics.preflop.premiumFoldCount}`);
		console.log(`preflop_unopened_calls=${aggregateMetrics.preflop.unopenedCallCount}`);
		console.log(
			`preflop_fixed_size_offbucket=${aggregateMetrics.preflop.fixedSizeOffBucketCount}`,
		);
		console.log(
			`sb_hu_open_uncontested=${aggregateMetrics.preflop.transitions.sbHuOpen.uncontested}/${aggregateMetrics.preflop.transitions.sbHuOpen.attempts}`,
		);
		console.log(
			`bb_defend_vs_sb_hu_open=${aggregateMetrics.preflop.transitions.sbHuOpen.bbDefend}/${aggregateMetrics.preflop.transitions.sbHuOpen.attempts}`,
		);
		console.log(
			`flop_seen_after_sb_hu_open=${aggregateMetrics.preflop.transitions.sbHuOpen.flopSeen}/${aggregateMetrics.preflop.transitions.sbHuOpen.attempts}`,
		);
		console.log(
			`btn_3_open_uncontested=${aggregateMetrics.preflop.transitions.btn3Open.blindsFoldedThrough}/${aggregateMetrics.preflop.transitions.btn3Open.attempts}`,
		);
		console.log(
			`blinds_defend_vs_btn_3_open=${aggregateMetrics.preflop.transitions.btn3Open.blindsDefend}/${aggregateMetrics.preflop.transitions.btn3Open.attempts}`,
		);
		console.log(
			`flop_seen_after_btn_3_open=${aggregateMetrics.preflop.transitions.btn3Open.flopSeen}/${aggregateMetrics.preflop.transitions.btn3Open.attempts}`,
		);
		console.log(
			`bb_raise_vs_sb_hu_limp=${aggregateMetrics.preflop.transitions.sbHuLimp.bigBlindRaise}/${aggregateMetrics.preflop.transitions.sbHuLimp.attempts}`,
		);
		console.log(
			`flop_seen_after_sb_hu_limp=${aggregateMetrics.preflop.transitions.sbHuLimp.flopSeen}/${aggregateMetrics.preflop.transitions.sbHuLimp.attempts}`,
		);
		console.log(
			`blind_raise_vs_btn_3_limp=${aggregateMetrics.preflop.transitions.btn3Limp.blindRaise}/${aggregateMetrics.preflop.transitions.btn3Limp.attempts}`,
		);
		console.log(
			`flop_seen_after_btn_3_limp=${aggregateMetrics.preflop.transitions.btn3Limp.flopSeen}/${aggregateMetrics.preflop.transitions.btn3Limp.attempts}`,
		);
		console.log(
			`bluff_raises_with_made_hand=${aggregateMetrics.postflop.bluffRaiseClassCounts["made-hand"] || 0}`,
		);
		console.log(
			`postflop_no_bet_opportunities=${aggregateMetrics.postflop.noBetOpportunityCount}`,
		);
		console.log(
			`postflop_no_bet_raises=${aggregateMetrics.postflop.noBetOpportunityActions.raise || 0}`,
		);
		console.log(
			`postflop_blocked_no_bet_raises=${aggregateMetrics.postflop.blockedNoBetRaiseCount}`,
		);
		console.log(
			`postflop_blocked_no_bet_later_facing_bet=${aggregateMetrics.postflop.blockedNoBetRaiseLaterFacingBetCount}`,
		);
		console.log(
			`postflop_blocked_no_bet_later_facing_bet_folds=${
				aggregateMetrics.postflop.blockedNoBetRaiseLaterFacingBetActions.fold || 0
			}`,
		);
		console.log(
			`postflop_blocked_no_bet_later_facing_bet_calls=${
				aggregateMetrics.postflop.blockedNoBetRaiseLaterFacingBetActions.call || 0
			}`,
		);
		console.log(
			`postflop_blocked_no_bet_later_facing_bet_raises=${
				aggregateMetrics.postflop.blockedNoBetRaiseLaterFacingBetActions.raise || 0
			}`,
		);
		console.log(
			`postflop_blocked_no_bet_without_later_facing_bet=${aggregateMetrics.postflop.blockedNoBetRaiseWithoutLaterFacingBetCount}`,
		);
		console.log(
			`postflop_auto_value_checks=${aggregateMetrics.postflop.autoValueCheckCount}`,
		);
		console.log(
			`postflop_auto_value_checks_later_facing_bet=${aggregateMetrics.postflop.autoValueCheckLaterFacingBetCount}`,
		);
		console.log(
			`postflop_auto_value_checks_later_facing_bet_folds=${aggregateMetrics.postflop.autoValueCheckLaterFacingBetFolds}`,
		);
		console.log(
			`postflop_elim_relief_candidates=${aggregateMetrics.postflop.eliminationReliefCandidateCount}`,
		);
		console.log(
			`postflop_elim_relief_calls=${aggregateMetrics.postflop.eliminationReliefCallCount}`,
		);
		console.log(
			`postflop_normal_bet_offbucket=${aggregateMetrics.postflop.normalBetOffBucketCount}`,
		);
		console.log(
			`postflop_weak_no_bet_opportunities=${aggregateMetrics.postflop.weakNoBetOpportunityCount}`,
		);
		console.log(
			`postflop_weak_no_bet_raises=${aggregateMetrics.postflop.weakNoBetOpportunityActions.raise || 0}`,
		);
		console.log(
			`marginal_actions=${JSON.stringify(aggregateMetrics.postflop.marginalActions)}`,
		);
		console.log(`marginal_raises=${aggregateMetrics.postflop.marginalRaiseCount}`);
		console.log(
			`marginal_river_calls=${aggregateMetrics.postflop.marginalRiverCallCount}`,
		);
		console.log(
			`marginal_facing_raise_calls=${aggregateMetrics.postflop.marginalFacingRaiseCallCount}`,
		);
		console.log(
			`postflop_call_quality_concerns=${JSON.stringify(aggregateMetrics.postflop.callQualityConcernByTag)}`,
		);
		console.log(
			`postflop_fold_quality=${JSON.stringify(aggregateMetrics.postflop.foldQualityByTag)}`,
		);
		console.log(
			`postflop_fold_watch=${JSON.stringify(aggregateMetrics.postflop.foldWatchByTag)}`,
		);
		console.log(
			`mdf_override_after_river_low_edge_block=${aggregateMetrics.postflop.mdf.overrideCallAfterRiverLowEdgeBlockCount}`,
		);
		console.log(
			`mdf_override_after_marginal_defense_block=${aggregateMetrics.postflop.mdf.overrideCallAfterMarginalDefenseBlockCount}`,
		);
		console.log(
			`mdf_override_after_non_value_block=${aggregateMetrics.postflop.mdf.overrideCallAfterNonValueBlockCount}`,
		);
		console.log(`kicker_raises=${aggregateMetrics.kickerRaiseCount}`);
		console.log(`meaningful_raises=${aggregateMetrics.meaningfulRaiseCount}`);
		console.log(
			`public_made_non_structural_raises=${aggregateMetrics.publicMadeNonStructuralRaiseCount}`,
		);
		console.log(
			`mdf_overall_actual_vs_alpha=${mdfAnalysis.facingBetOverall.actualFoldRate.toFixed(3)}/${
				mdfAnalysis.facingBetOverall.requiredFoldRate.toFixed(3)
			} over=${mdfAnalysis.facingBetOverall.overfold.toFixed(3)}`,
		);
		console.log(
			`mdf_overall_candidates=${mdfAnalysis.candidateOverall.total} defends=${
				mdfAnalysis.candidateOverall.defends
			} actual_vs_alpha=${mdfAnalysis.candidateOverall.actualFoldRate.toFixed(3)}/${
				mdfAnalysis.candidateOverall.requiredFoldRate.toFixed(3)
			} over=${mdfAnalysis.candidateOverall.overfold.toFixed(3)}`,
		);
		for (const street of ["flop", "turn", "river"]) {
			const facingBetRow = aggregateMetrics.postflop.mdf.facingBetByStreet[street];
			const facingBetSummary = summarizeFoldRateRow(facingBetRow);
			console.log(
				`mdf_${street}_actual_vs_alpha=${facingBetSummary.actualFoldRate.toFixed(3)}/${
					facingBetSummary.requiredFoldRate.toFixed(3)
				} over=${facingBetSummary.overfold.toFixed(3)}`,
			);

			const candidateRow = aggregateMetrics.postflop.mdf.candidateByStreet[street];
			const candidateSummary = summarizeFoldRateRow(candidateRow);
			console.log(
				`mdf_${street}_candidates=${candidateRow?.total || 0} defends=${
					candidateRow?.defends || 0
				} actual_vs_alpha=${candidateSummary.actualFoldRate.toFixed(3)}/${
					candidateSummary.requiredFoldRate.toFixed(3)
				} over=${candidateSummary.overfold.toFixed(3)}`,
			);
			console.log(
				`mdf_${street}_facing_by_margin=${
					JSON.stringify(mdfAnalysis.facingBetByStreetAndMargin[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_facing_by_betsize=${
					JSON.stringify(mdfAnalysis.facingBetByStreetAndBetSize[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_facing_by_margin_and_betsize=${
					JSON.stringify(mdfAnalysis.facingBetByStreetAndMarginAndBetSize[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_facing_actions_by_betsize_and_reason=${
					JSON.stringify(mdfAnalysis.facingBetActionsByStreetAndBetSizeAndQualityReason[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_facing_actions_by_margin_betsize_reason=${
					JSON.stringify(
						mdfAnalysis.facingBetActionsByStreetAndMarginAndBetSizeAndQualityReason[street] || {},
					)
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_margin=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndMargin[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_margin_and_betsize=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndMarginAndBetSize[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_raise_level=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndRaiseLevel[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_structure=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndStructure[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_pressure=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndPressure[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_lift=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndLift[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_raw_hand=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndRawHand[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_overrides_by_margin=${
					JSON.stringify(mdfAnalysis.overrideCallByStreetAndMargin[street] || {})
				}`,
			);
		}
		console.log(`mdf_override_calls=${aggregateMetrics.postflop.mdf.overrideCallCount}`);
		console.log(`output_dir=${outputDir}`);
	} finally {
		serverAbort.abort();
		if (browserChild) {
			try {
				browserChild.kill("SIGTERM");
			} catch {
				// Browser already exited.
			}
			await browserChild.status.catch(() => {});
		}
		await safeRemove(profileDir);
	}
}

await main();
