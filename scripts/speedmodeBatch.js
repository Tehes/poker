const DEFAULT_RUN_COUNT = 1;
const DEFAULT_SERVER_PORT = 8123;
const DEFAULT_DEVTOOLS_PORT = 9222;
const DEFAULT_PAGE_PATH = "index.html?speedmode=1&botdebug=detail";
const DEFAULT_OUTPUT_BASE = "/tmp";
const DEFAULT_OUTPUT_PREFIX = "poker-speedmode-batch";
const LOAD_TIMEOUT_MS = 15000;
const RUN_TIMEOUT_MS = 180000;
const PAGE_READY_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;
const HAND_LABEL_PATTERN =
	"Straight Flush|Four of a Kind|Full House|Three of a Kind|Two Pair|High Card|Straight|Flush|Pair|-";
const PUBLIC_HAND_REGEX = new RegExp(`\\bPH:(${HAND_LABEL_PATTERN})(?=\\s|\\|)`);
const RAW_HAND_REGEX = new RegExp(`\\bRH:(${HAND_LABEL_PATTERN})(?=\\s|\\|)`);
const DECISION_ACTION_REGEX = /→ (check|call|fold|raise)\b/;
const HAND_SECTION_REGEX = /\bH:(.+?) Amt:(\d+)\b/;
const STRENGTH_SECTION_REGEX = /\bPA:(\d+\.\d+) PS:(\d+\.\d+) M:(\d+\.\d+) Z:([a-z]+)\b/i;
const PRESSURE_SECTION_REGEX = /\bPO:(\d+\.\d+) CB:(\d+\.\d+) SR:(\d+\.\d+)\b/;
const COMMIT_SECTION_REGEX = /\bCP:(\d+\.\d+) CPen:(\d+\.\d+)\b/;
const ELIMINATION_SECTION_REGEX = /\bER:(\d+\.\d+) EP:(\d+\.\d+)\b/;
const POSITION_SECTION_REGEX = /\bPos:(\d+\.\d+) Opp:(\d+) Eff:(\d+)\b/;
const OPPORTUNITY_SECTION_REGEX = /\bNB:(Y|N) CR:(Y|N) Act:(\d+)\/(\d+)(?=\s|\|)/;
const RAISE_SECTION_REGEX = /\bRT10:(\d+\.\d+) Agg:(\d+\.\d+) RL:(\d+) RAdj:(\d+\.\d+)\b/;
const SPOT_SECTION_REGEX = /\bSpot:([^/\s|]+)\/([^/\s|]+)\/([^ \|]+)\b/;
const CONTEXT_SECTION_REGEX = /\bCtx:([^ \|]+) Draw:([^ \|]+) Tex:(\d+\.\d+) LT:([^ \|]+)\b/;
const FLAG_SECTION_REGEX = /\bCL:(Y|N) SS:(Y|N) Prem:(Y|N)\b/;
const PREFLOP_SECTION_REGEX = /\bPre:([^/\s|]+)(?:\/([^ \|]+))?(?=\s|\|)/;
const PREFLOP_SCORE_SECTION_REGEX =
	/\bStr:(\d+\.\d+) Pla:(\d+\.\d+) Dom:(\d+\.\d+) \| OR:(\d+\.\d+) OL:(\d+\.\d+) FL:(\d+\.\d+) 3V:(\d+\.\d+) 3B:(\d+\.\d+) PS:(\d+\.\d+)\b/;
const LINE_SECTION_REGEX =
	/\bLine:([^ \|]+) CP:([YN-]) BP:([YN-]) CM:([YN-]) BM:([YN-]) LA:([YN-])(?=\s|\|)/;
const STAB_BLUFF_SECTION_REGEX = /\bStab:(Y|N) Bluff:(Y|N)\b/;
const PRIVATE_EDGE_SECTION_REGEX = /\bPMH:(Y|N) Edge:(-?\d+\.\d+) PRE:(Y|N)\b/;
const NON_VALUE_BLOCK_REGEX = /\bNVB:(Y|N)\b/;
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
	const players = window.poker?.players ?? [];
	const livePlayers = players.filter((player) => player.chips > 0);
	return {
		finished: !!window.__speedmodeBatchStarted && players.length > 0 && livePlayers.length <= 1,
		activePlayers: livePlayers.length,
		champion: livePlayers.length === 1 ? livePlayers[0].name : null,
		logCount: window.__capturedLogs?.length ?? 0,
		maxHands: players.reduce((value, player) => Math.max(value, player.stats?.hands ?? 0), 0),
	};
})()`;
const RUN_PAYLOAD_EXPRESSION = `(() => {
	const players = window.poker?.players ?? [];
	const livePlayers = players.filter((player) => player.chips > 0);
	return {
		finished: !!window.__speedmodeBatchStarted && players.length > 0 && livePlayers.length <= 1,
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

function parseJsonTail(line, marker) {
	const markerIndex = line.indexOf(marker);
	if (markerIndex === -1) {
		return null;
	}

	const jsonText = line.slice(markerIndex + marker.length).trim();
	if (!jsonText.startsWith("{")) {
		return null;
	}

	try {
		return JSON.parse(jsonText);
	} catch {
		return null;
	}
}

function parseBettingRoundLine(line) {
	const payload = parseJsonTail(line, "startBettingRound ");
	return payload && typeof payload.phase === "string" ? payload : null;
}

function parseSetPhaseLine(line) {
	const payload = parseJsonTail(line, "setPhase ");
	return payload && typeof payload.phase === "string" ? payload : null;
}

function splitLogsIntoHands(logs) {
	const hands = [];
	let currentHand = null;

	for (const line of logs) {
		const bettingRound = parseBettingRoundLine(line);
		if (bettingRound?.phase === "preflop") {
			if (currentHand?.length) {
				hands.push(currentHand);
			}
			currentHand = [line];
			continue;
		}
		if (currentHand) {
			currentHand.push(line);
		}
	}

	if (currentHand?.length) {
		hands.push(currentHand);
	}
	return hands;
}

function handSawFlop(handLines) {
	return handLines.some((line) => {
		const bettingRound = parseBettingRoundLine(line);
		if (bettingRound?.phase === "flop") {
			return true;
		}
		const phaseUpdate = parseSetPhaseLine(line);
		return phaseUpdate?.phase === "flop";
	});
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

function analyzePreflopTransitions(logs, metrics) {
	const hands = splitLogsIntoHands(logs);

	for (const handLines of hands) {
		const preflopDecisions = handLines
			.map((line) => parseDecisionLogLine(line))
			.filter((decision) => decision?.phase === "preflop");
		if (!preflopDecisions.length) {
			continue;
		}
		const sawFlop = handSawFlop(handLines);

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

function parseDecisionLogLine(line) {
	const actionMatch = line.match(DECISION_ACTION_REGEX);
	const handMatch = line.match(HAND_SECTION_REGEX);
	const strengthMatch = line.match(STRENGTH_SECTION_REGEX);
	const pressureMatch = line.match(PRESSURE_SECTION_REGEX);
	const commitMatch = line.match(COMMIT_SECTION_REGEX);
	const eliminationMatch = line.match(ELIMINATION_SECTION_REGEX);
	const positionMatch = line.match(POSITION_SECTION_REGEX);
	const opportunityMatch = line.match(OPPORTUNITY_SECTION_REGEX);
	const raiseMatch = line.match(RAISE_SECTION_REGEX);
	const spotMatch = line.match(SPOT_SECTION_REGEX);
	const contextMatch = line.match(CONTEXT_SECTION_REGEX);
	const publicMatch = line.match(PUBLIC_HAND_REGEX);
	const rawMatch = line.match(RAW_HAND_REGEX);
	const flagMatch = line.match(FLAG_SECTION_REGEX);
	const preflopMatch = line.match(PREFLOP_SECTION_REGEX);
	const preflopScoreMatch = line.match(PREFLOP_SCORE_SECTION_REGEX);
	const lineMatch = line.match(LINE_SECTION_REGEX);
	const stabBluffMatch = line.match(STAB_BLUFF_SECTION_REGEX);
	const privateEdgeMatch = line.match(PRIVATE_EDGE_SECTION_REGEX);
	const nonValueBlockMatch = line.match(NON_VALUE_BLOCK_REGEX);

	if (
		!actionMatch || !handMatch || !strengthMatch || !pressureMatch || !commitMatch ||
		!eliminationMatch || !positionMatch || !opportunityMatch || !raiseMatch || !spotMatch ||
		!contextMatch ||
		!publicMatch || !rawMatch || !flagMatch || !preflopMatch || !preflopScoreMatch ||
		!lineMatch || !stabBluffMatch || !privateEdgeMatch ||
		!nonValueBlockMatch
	) {
		return null;
	}

	const handName = handMatch[1].trim();
	const phase = handName === "preflop" ? "preflop" : "postflop";
	const amount = Number.parseInt(handMatch[2], 10);
	const aggressionStrength = Number.parseFloat(strengthMatch[1]);
	const passiveStrength = Number.parseFloat(strengthMatch[2]);
	const mRatio = Number.parseFloat(strengthMatch[3]);
	const mZone = strengthMatch[4];
	const potOdds = Number.parseFloat(pressureMatch[1]);
	const callBarrier = Number.parseFloat(pressureMatch[2]);
	const stackRatio = Number.parseFloat(pressureMatch[3]);
	const commitmentPressure = Number.parseFloat(commitMatch[1]);
	const commitmentPenalty = Number.parseFloat(commitMatch[2]);
	const eliminationRisk = Number.parseFloat(eliminationMatch[1]);
	const eliminationPenalty = Number.parseFloat(eliminationMatch[2]);
	const positionFactor = Number.parseFloat(positionMatch[1]);
	const activeOpponents = Number.parseInt(positionMatch[2], 10);
	const effectiveStack = Number.parseInt(positionMatch[3], 10);
	const noBet = opportunityMatch[1] === "Y";
	const canRaiseOpportunity = opportunityMatch[2] === "Y";
	const actingSlotIndex = Number.parseInt(opportunityMatch[3], 10);
	const actingSlotCount = Number.parseInt(opportunityMatch[4], 10);
	const raiseThreshold = Number.parseFloat(raiseMatch[1]);
	const aggressiveness = Number.parseFloat(raiseMatch[2]);
	const raiseLevel = Number.parseInt(raiseMatch[3], 10);
	const raiseAdjustment = Number.parseFloat(raiseMatch[4]);
	const spotType = spotMatch[1];
	const structureTag = spotMatch[2];
	const pressureTag = spotMatch[3];
	const boardContext = contextMatch[1];
	const drawFlag = contextMatch[2];
	const textureRisk = Number.parseFloat(contextMatch[3]);
	const liftType = contextMatch[4];
	const publicHand = publicMatch[1];
	const rawHand = rawMatch[1];
	const chipLeader = flagMatch[1] === "Y";
	const shortStack = flagMatch[2] === "Y";
	const premium = flagMatch[3] === "Y";
	const preflopSeat = preflopMatch[1];
	const preflopSeatContext = preflopMatch[2] ?? "-";
	const strengthScore = Number.parseFloat(preflopScoreMatch[1]);
	const playabilityScore = Number.parseFloat(preflopScoreMatch[2]);
	const dominationPenalty = Number.parseFloat(preflopScoreMatch[3]);
	const openRaiseScore = Number.parseFloat(preflopScoreMatch[4]);
	const openLimpScore = Number.parseFloat(preflopScoreMatch[5]);
	const flatScore = Number.parseFloat(preflopScoreMatch[6]);
	const threeBetValueScore = Number.parseFloat(preflopScoreMatch[7]);
	const threeBetBluffScore = Number.parseFloat(preflopScoreMatch[8]);
	const pushScore = Number.parseFloat(preflopScoreMatch[9]);
	const lineTag = lineMatch[1];
	const cbetPlan = flagToState(lineMatch[2]);
	const barrelPlan = flagToState(lineMatch[3]);
	const cbetMade = flagToState(lineMatch[4]);
	const barrelMade = flagToState(lineMatch[5]);
	const lineAbort = flagToState(lineMatch[6]);
	const stab = stabBluffMatch[1] === "Y";
	const bluff = stabBluffMatch[2] === "Y";
	const hasPrivateMadeHand = privateEdgeMatch[1] === "Y";
	const edge = Number.parseFloat(privateEdgeMatch[2]);
	const hasPrivateRaiseEdge = privateEdgeMatch[3] === "Y";
	const nonValueBlocked = nonValueBlockMatch[1] === "Y";

	return {
		line,
		action: actionMatch[1],
		phase,
		handName,
		amount,
		aggressionStrength,
		passiveStrength,
		mRatio,
		mZone,
		potOdds,
		callBarrier,
		stackRatio,
		commitmentPressure,
		commitmentPenalty,
		eliminationRisk,
		eliminationPenalty,
		positionFactor,
		activeOpponents,
		activePlayers: activeOpponents + 1,
		effectiveStack,
		noBet,
		canRaiseOpportunity,
		actingSlotIndex,
		actingSlotCount,
		actingSlotKey: `${actingSlotIndex}/${actingSlotCount}`,
		raiseThreshold,
		aggressiveness,
		raiseLevel,
		raiseAdjustment,
		spotType,
		structureTag,
		pressureTag,
		spotKey: `${spotType}/${structureTag}/${pressureTag}`,
		boardContext,
		drawFlag,
		textureRisk,
		liftType,
		publicHand,
		rawHand,
		chipLeader,
		shortStack,
		premium,
		preflopSeat,
		preflopSeatContext,
		strengthScore,
		playabilityScore,
		dominationPenalty,
		openRaiseScore,
		openLimpScore,
		flatScore,
		threeBetValueScore,
		threeBetBluffScore,
		pushScore,
		lineTag,
		cbetPlan,
		barrelPlan,
		cbetMade,
		barrelMade,
		lineAbort,
		stab,
		bluff,
		hasPrivateMadeHand,
		edge,
		hasPrivateRaiseEdge,
		nonValueBlocked,
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
		noBetOpportunityCount: 0,
		noBetOpportunityActions: {},
		noBetOpportunityByLineRole: {},
		noBetOpportunityBySpot: {},
		noBetOpportunityByStructure: {},
		noBetOpportunityByActingSlot: {},
		noBetOpportunityActionsByLineRoleAndActingSlot: {},
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

function analyzeRunLogs(logs) {
	const metrics = createEmptyMetrics();

	for (const line of logs) {
		const decision = parseDecisionLogLine(line);
		if (!decision) {
			continue;
		}

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
		if (decision.noBet && decision.canRaiseOpportunity) {
			metrics.postflop.noBetOpportunityCount += 1;
			incrementCount(metrics.postflop.noBetOpportunityActions, decision.action);
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

	analyzePreflopTransitions(logs, metrics);
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

async function runSingleTournament(page, config, runIndex, aggregateMetrics, champions) {
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

	const payload = await page.evaluate(RUN_PAYLOAD_EXPRESSION);
	const runMetrics = analyzeRunLogs(payload.logs);
	mergeRunMetrics(aggregateMetrics, runMetrics);
	incrementCount(champions, state.champion || "unknown");

	const logPath = `${config.outputDir}/run-${runLabel}.log`;
	const summaryPath = `${config.outputDir}/run-${runLabel}.json`;
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
		metrics: runMetrics,
	};
}

async function main() {
	const args = parseArgs(Deno.args);
	const projectRootUrl = new URL("../", import.meta.url);
	const projectRootPath = Deno.realPathSync(projectRootUrl);
	const outputDir = resolveOutputDir(args.outputDir);
	const chromeCommand = await resolveChromeCommand(args.chromePath);
	const aggregateMetrics = createEmptyMetrics();
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
			})),
			metrics: aggregateMetrics,
		};
		await Deno.writeTextFile(`${outputDir}/summary.json`, JSON.stringify(summary, null, 2));

		console.log(`runs=${args.runCount}`);
		console.log(`decisions=${aggregateMetrics.decisionCount}`);
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
