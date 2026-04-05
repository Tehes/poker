const DEFAULT_RUN_COUNT = 1;
const DEFAULT_SERVER_PORT = 8123;
const DEFAULT_DEVTOOLS_PORT = 9222;
const DEFAULT_PAGE_PATH = "index.html?speedmode=1&botdebug=detail";
const DEFAULT_OUTPUT_BASE = "/tmp";
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
const PAGE_READY_EXPRESSION =
	`(() => !!window.poker && !!document.getElementById("start-button"))()`;
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

function pushExample(target, line, limit = 10) {
	if (target.length < limit) {
		target.push(line);
	}
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
	const noBetInitialAction = typeof decision.noBetInitialAction === "string"
		? decision.noBetInitialAction
		: "-";

	return `${decision.player} → ${decision.action} | ` +
		`H:${decision.handName} Amt:${decision.amount ?? 0} | ` +
		`Spot:${decision.spotKey} | ` +
		`Ctx:${decision.boardContext} Draw:${decision.drawFlag} LT:${decision.liftType} | ` +
		`PH:${decision.publicHand} RH:${decision.rawHand} | ` +
		`Pub:${formatFixed(decision.publicScore, 4)} Raw:${formatFixed(decision.rawScore, 4)} ` +
		`PMH:${toFlag(decision.hasPrivateMadeHand)} Edge:${formatFixed(decision.edge, 4)} ` +
		`PRE:${toFlag(decision.hasPrivateRaiseEdge)} ` +
		`SRaw:${formatFixed(decision.strengthRatioRaw, 2)} ` +
		`EBo:${formatFixed(decision.edgeBoost, 4)} ` +
		`PAS:${formatFixed(decision.privateAwareStrength, 2)} | ` +
		`NVB:${toFlag(decision.nonValueBlocked)} | ` +
		`Line:${decision.lineTag} CP:${decision.cbetPlan} BP:${decision.barrelPlan} ` +
		`CM:${decision.cbetMade} BM:${decision.barrelMade} LA:${decision.lineAbort} | ` +
		`NBCls:${noBetClass} NBInit:${noBetInitialAction} | ` +
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
		noBetInitialAction: typeof decision.noBetInitialAction === "string"
			? decision.noBetInitialAction
			: null,
		noBetFilterApplied: decision.noBetFilterApplied === true,
		noBetBlockReason: typeof decision.noBetBlockReason === "string"
			? decision.noBetBlockReason
			: null,
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
				const bbResponse = remainingPreflopDecisions.find((decision) =>
					decision.preflopSeat === "bigBlind"
				);
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
				const sbResponse = remainingPreflopDecisions.find((decision) =>
					decision.preflopSeat === "smallBlind"
				);
				const bbResponse = remainingPreflopDecisions.find((decision) =>
					decision.preflopSeat === "bigBlind"
				);
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
			const bbResponse = remainingAfterOpenCall.find((decision) =>
				decision.preflopSeat === "bigBlind"
			);
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
			const sbResponse = remainingAfterOpenCall.find((decision) =>
				decision.preflopSeat === "smallBlind"
			);
			const bbResponse = remainingAfterOpenCall.find((decision) =>
				decision.preflopSeat === "bigBlind"
			);
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

	return {
		isPublicMadeHand,
		isBoardMadeLift,
		isPrivateMadeHand,
		isTopTier: TOP_TIER_POSTFLOP_HANDS.has(decision.rawHand),
		isHighRisk: decision.eliminationRisk >= 0.8,
	};
}

function classifyWeakNoBetOpportunity(decision) {
	if (
		decision.phase !== "postflop" || !decision.noBet || !decision.canRaiseOpportunity ||
		decision.boardContext === "TP" || decision.boardContext === "OP" ||
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
		decision.rawHand === "Pair" &&
		decision.boardContext === "-" &&
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
	const handIds = Array.from(new Set([...handStarts.keys(), ...handResults.keys()])).sort((a, b) =>
		a - b
	);
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
	if (!outputDir) {
		return `${DEFAULT_OUTPUT_BASE}/${DEFAULT_OUTPUT_PREFIX}-${formatTimestamp()}`;
	}

	const normalizedOutputDir = outputDir.replace(/\/+$/, "");
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
		return request.method === "HEAD"
			? new Response(null, { headers })
			: new Response(file, { headers });
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
		privateTopTierMadeHandFoldCount: 0,
		highRiskPrivateMadeHandFoldCount: 0,
		highRiskPrivateTopTierMadeHandFoldCount: 0,
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
			postflopPublicMadeHandFold: [],
			postflopBoardMadeLiftFold: [],
			postflopPrivateMadeHandFold: [],
			postflopPrivateTopTierMadeHandFold: [],
			postflopHighRiskPrivateMadeHandFold: [],
			bluffRaiseAir: [],
			bluffRaiseDraw: [],
			bluffRaiseMadeHand: [],
			stabRaise: [],
			lineAbort: [],
			kickerRaise: [],
			meaningful: [],
			structural: [],
			postflopNoBetRaise: [],
			postflopNoBetCheck: [],
			postflopWeakNoBetRaise: [],
			postflopWeakNoBetCheck: [],
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
		incrementCount(metrics.postflop.actions, decision.action);
		incrementCount(metrics.liftCounts, decision.liftType);
		incrementCount(metrics.postflop.liftCounts, decision.liftType);
		incrementNestedCount(metrics.actionByLift, decision.liftType, decision.action);
		incrementNestedCount(metrics.postflop.actionByLift, decision.liftType, decision.action);

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
				if (madeHandFold.isHighRisk) {
					metrics.postflop.highRiskPrivateMadeHandFoldCount += 1;
					pushExample(metrics.examples.postflopHighRiskPrivateMadeHandFold, line);
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
	source.meaningfulRaiseExamples.forEach((line) =>
		pushExample(target.meaningfulRaiseExamples, line)
	);
	source.structuralExamples.forEach((line) => pushExample(target.structuralExamples, line));
	source.examples.preflopPremiumFold.forEach((line) =>
		pushExample(target.examples.preflopPremiumFold, line)
	);
	source.examples.preflopUnopenedCall.forEach((line) =>
		pushExample(target.examples.preflopUnopenedCall, line)
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
	source.examples.postflopPrivateTopTierMadeHandFold.forEach((line) =>
		pushExample(target.examples.postflopPrivateTopTierMadeHandFold, line)
	);
	source.examples.postflopHighRiskPrivateMadeHandFold.forEach((line) =>
		pushExample(target.examples.postflopHighRiskPrivateMadeHandFold, line)
	);
	source.examples.bluffRaiseAir.forEach((line) =>
		pushExample(target.examples.bluffRaiseAir, line)
	);
	source.examples.bluffRaiseDraw.forEach((line) =>
		pushExample(target.examples.bluffRaiseDraw, line)
	);
	source.examples.bluffRaiseMadeHand.forEach((line) =>
		pushExample(target.examples.bluffRaiseMadeHand, line)
	);
	source.examples.stabRaise.forEach((line) => pushExample(target.examples.stabRaise, line));
	source.examples.lineAbort.forEach((line) => pushExample(target.examples.lineAbort, line));
	source.examples.kickerRaise.forEach((line) => pushExample(target.examples.kickerRaise, line));
	source.examples.meaningful.forEach((line) => pushExample(target.examples.meaningful, line));
	source.examples.structural.forEach((line) => pushExample(target.examples.structural, line));
	source.examples.postflopNoBetRaise.forEach((line) =>
		pushExample(target.examples.postflopNoBetRaise, line)
	);
	source.examples.postflopNoBetCheck.forEach((line) =>
		pushExample(target.examples.postflopNoBetCheck, line)
	);
	source.examples.postflopWeakNoBetRaise.forEach((line) =>
		pushExample(target.examples.postflopWeakNoBetRaise, line)
	);
	source.examples.postflopWeakNoBetCheck.forEach((line) =>
		pushExample(target.examples.postflopWeakNoBetCheck, line)
	);
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
			`postflop_private_top_tier_made_hand_folds=${aggregateMetrics.postflop.privateTopTierMadeHandFoldCount}`,
		);
		console.log(
			`postflop_high_risk_private_made_hand_folds=${aggregateMetrics.postflop.highRiskPrivateMadeHandFoldCount}`,
		);
		console.log(`preflop_premium_folds=${aggregateMetrics.preflop.premiumFoldCount}`);
		console.log(`preflop_unopened_calls=${aggregateMetrics.preflop.unopenedCallCount}`);
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
			`bluff_raises_with_made_hand=${
				aggregateMetrics.postflop.bluffRaiseClassCounts["made-hand"] || 0
			}`,
		);
		console.log(
			`postflop_no_bet_opportunities=${aggregateMetrics.postflop.noBetOpportunityCount}`,
		);
		console.log(
			`postflop_no_bet_raises=${
				aggregateMetrics.postflop.noBetOpportunityActions.raise || 0
			}`,
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
			`postflop_weak_no_bet_opportunities=${aggregateMetrics.postflop.weakNoBetOpportunityCount}`,
		);
		console.log(
			`postflop_weak_no_bet_raises=${
				aggregateMetrics.postflop.weakNoBetOpportunityActions.raise || 0
			}`,
		);
		console.log(`kicker_raises=${aggregateMetrics.kickerRaiseCount}`);
		console.log(`meaningful_raises=${aggregateMetrics.meaningfulRaiseCount}`);
		console.log(
			`public_made_non_structural_raises=${aggregateMetrics.publicMadeNonStructuralRaiseCount}`,
		);
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
